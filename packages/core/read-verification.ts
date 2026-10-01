import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

const basicReadTools = ["cart_get", "orders_list", "subscriptions_list"] as const;
type ReadTool = (typeof basicReadTools)[number] | "orders_get" | "shipments_get";
type ToolName = ReadTool | "amazon_capabilities" | "operations_get";
export type ReadVerificationClient = (
  name: ToolName,
  args: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<unknown>;

const envelope = z.object({
  status: z.enum([
    "ok",
    "partial",
    "pending",
    "requires_user_action",
    "unsupported",
    "conflict",
    "failed",
    "outcome_unknown",
  ]),
  operationId: z.uuid().optional(),
  data: z.unknown().optional(),
  observation: z
    .object({
      source: z.string(),
      observedAt: z.iso.datetime(),
      authentication: z.literal("verified").optional(),
    })
    .optional(),
  coverage: z
    .object({ complete: z.boolean(), missing: z.array(z.string()) })
    .optional(),
});
const capabilities = z.object({
  accountRef: z.uuid(),
  accountEnabled: z.boolean(),
  workerOnline: z.boolean(),
  liveEnabled: z.boolean(),
  readTools: z.array(z.string()),
});

export type ReadCheck = {
  tool: ReadTool;
  status:
    | "not_run"
    | "observed"
    | "incomplete"
    | "requires_user_action"
    | "failed"
    | "timed_out";
  operationId?: string;
  observedAt?: string;
  itemCount?: number;
  trackingVerifiedCount?: number;
  coverageComplete?: boolean;
  authenticated?: boolean;
  missing?: string[];
};
export type ReadVerification = {
  version: 1;
  startedAt: string;
  finishedAt: string;
  status: "completed" | "blocked" | "failed";
  reason?:
    | "live_disabled"
    | "account_disabled"
    | "worker_offline"
    | "tools_unavailable"
    | "invalid_response"
    | "transport_failed"
    | "read_incomplete"
    | "user_action_required"
    | "no_order_available"
    | "read_timeout";
  checks: ReadCheck[];
};

// Only known diagnostic labels enter the report. Never copy page text, URLs,
// identifiers, exception messages, or provider-supplied error strings into it.
const diagnosticLabels = new Set([
  "source_completeness",
  "required:cart_marker",
  "required:cart_line_identity",
  "required:active_cart_state",
  "cart_mutation_evidence",
  "required:orders_marker",
  "required:order_identity",
  "required:orders_page",
  "order_fields",
  "required:shipments",
  "tracking_details",
  "required:subscriptions_marker",
  "required:subscription_identity",
]);
class InvalidReadResponse extends Error {}

export async function verifyAccountReads(
  call: ReadVerificationClient,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    includeOrderDetails?: boolean;
    onCheck?: (check: ReadCheck) => void;
  } = {},
): Promise<ReadVerification> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollMs = options.pollMs ?? 1_000;
  const readTools: ReadTool[] = [...basicReadTools, ...(options.includeOrderDetails ? ["orders_get", "shipments_get"] as const : [])];
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120_000 ||
    !Number.isInteger(pollMs) ||
    pollMs < 1 ||
    pollMs > timeoutMs
  )
    throw new Error("Invalid read verification timeout");
  const report: ReadVerification = {
    version: 1,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    status: "blocked",
    checks: readTools.map((tool) => ({ tool, status: "not_run" })),
  };
  const finish = (
    status: ReadVerification["status"],
    reason?: ReadVerification["reason"],
  ) => {
    report.status = status;
    report.reason = reason;
    report.finishedAt = new Date().toISOString();
    return report;
  };
  let account;
  try {
    const result = envelope.parse(
      await call("amazon_capabilities", {}, AbortSignal.timeout(timeoutMs)),
    );
    if (result.status !== "ok") return finish("failed", "invalid_response");
    account = capabilities.parse(result.data);
  } catch (error) {
    return finish(
      "failed",
      error instanceof z.ZodError ? "invalid_response" : "transport_failed",
    );
  }
  if (!account.liveEnabled) return finish("blocked", "live_disabled");
  if (!account.accountEnabled) return finish("blocked", "account_disabled");
  if (!account.workerOnline) return finish("blocked", "worker_offline");
  if (readTools.some((tool) => !account.readTools.includes(tool)))
    return finish("blocked", "tools_unavailable");

  let orderId: string | undefined;
  for (const check of report.checks) {
    const detailRead = check.tool === "orders_get" || check.tool === "shipments_get";
    if (detailRead && !orderId) return finish("blocked", "no_order_available");
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      let result = envelope.parse(
        await call(
          check.tool,
          {
            accountRef: account.accountRef,
            ...(check.tool === "orders_list" ? { page: 1 } : {}),
            ...(detailRead ? { orderId } : {}),
          },
          signal,
        ),
      );
      if (result.status === "pending") {
        if (!result.operationId) throw new InvalidReadResponse();
        check.operationId = result.operationId;
        while (true) {
          signal.throwIfAborted();
          const polled = envelope.parse(
            await call(
              "operations_get",
              { operationId: check.operationId },
              signal,
            ),
          );
          if (polled.status !== "ok") throw new InvalidReadResponse();
          const operation = z
            .object({
              id: z.uuid(),
              kind: z.literal(check.tool),
              status: z.string(),
              result: z.unknown().optional(),
            })
            .parse(polled.data);
          if (operation.id !== check.operationId)
            throw new InvalidReadResponse();
          if (!["queued", "working"].includes(operation.status)) {
            result = envelope.parse(operation.result);
            if (
              operation.status !== result.status ||
              result.status === "pending"
            )
              throw new InvalidReadResponse();
            break;
          }
          await delay(pollMs, undefined, { signal });
        }
      }
      if (result.status === "requires_user_action") {
        check.status = "requires_user_action";
        options.onCheck?.(check);
        return finish("blocked", "user_action_required");
      }
      if (!["ok", "partial"].includes(result.status)) {
        check.status = "failed";
        options.onCheck?.(check);
        return finish("failed", "read_incomplete");
      }
      const data = z.record(z.string(), z.unknown()).parse(result.data);
      const recognized = check.tool === "orders_get" ? data.recognized === true && data.found === true && data.orderId === orderId
        : check.tool === "shipments_get" ? data.orderIdentityObserved === true && data.orderId === orderId
        : z.boolean().parse(data.recognized);
      const collection =
        data[
          check.tool === "cart_get" || check.tool === "orders_get"
            ? "lines"
            : check.tool === "orders_list"
              ? "orders"
              : check.tool === "shipments_get" ? "shipments" : "subscriptions"
        ];
      if (
        !Array.isArray(collection) ||
        result.observation?.source !== "amazon-web" ||
        !result.coverage
      )
        throw new InvalidReadResponse();
      if (result.observation.authentication !== "verified") {
        check.status = "requires_user_action";
        options.onCheck?.(check);
        return finish("blocked", "user_action_required");
      }
      check.authenticated = true;
      check.observedAt = result.observation.observedAt;
      check.itemCount = collection.length;
      if (check.tool === "orders_list" && recognized) {
        orderId = collection.find((order) => order && typeof order.orderId === "string" && /^\d{3}-\d{7}-\d{7}$/.test(order.orderId))?.orderId;
      }
      if (check.tool === "shipments_get") {
        check.trackingVerifiedCount = collection.filter((shipment) => shipment?.tracking?.recognized === true &&
          shipment.tracking.orderIdentityObserved === true && typeof shipment.tracking.status === "string" && shipment.tracking.status.length > 0).length;
      }
      check.coverageComplete = result.coverage.complete;
      check.missing = [
        ...new Set(
          result.coverage.missing.map((label) =>
            diagnosticLabels.has(label) ? label : "unrecognized_coverage",
          ),
        ),
      ];
      const incomplete =
        !recognized ||
        check.missing.some((label) =>
          label !== "source_completeness" &&
          !(check.tool === "cart_get" && label === "cart_mutation_evidence"),
        ) ||
        (result.coverage.complete && check.missing.length > 0) ||
        (!result.coverage.complete && check.missing.length === 0);
      check.status = incomplete ? "incomplete" : "observed";
      options.onCheck?.(check);
    } catch (error) {
      check.status = signal.aborted ? "timed_out" : "failed";
      options.onCheck?.(check);
      return finish(
        "failed",
        signal.aborted
          ? "read_timeout"
          : error instanceof z.ZodError || error instanceof InvalidReadResponse
            ? "invalid_response"
            : "transport_failed",
      );
    }
  }
  return report.checks.every((check) => check.status === "observed")
    ? finish("completed")
    : finish("failed", "read_incomplete");
}
