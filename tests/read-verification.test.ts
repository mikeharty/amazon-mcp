import { describe, expect, it, vi } from "vitest";
import {
  verifyAccountReads,
  type ReadVerificationClient,
} from "../packages/core/read-verification.js";

const accountRef = "00000000-0000-4000-8000-000000000001";
const operationId = "00000000-0000-4000-8000-000000000002";
const capabilities = {
  status: "ok",
  data: {
    accountRef,
    accountEnabled: true,
    workerOnline: true,
    liveEnabled: true,
    readTools: ["cart_get", "orders_list", "subscriptions_list"],
  },
};
const observed = (name: string) => ({
  status: "partial",
  data: {
    recognized: true,
    [name === "cart_get"
      ? "lines"
      : name === "orders_list"
        ? "orders"
        : "subscriptions"]: [
      {
        title: "PRIVATE PRODUCT",
        orderId: "111-2222222-3333333",
        address: "PRIVATE ADDRESS",
      },
    ],
  },
  observation: {
    source: "amazon-web",
    authentication: "verified",
    observedAt: "2026-09-27T12:00:00.000Z",
    contextRef: "PRIVATE CONTEXT",
  },
  coverage: {
    complete: false,
    missing: ["source_completeness"],
    reason: "PRIVATE PAGE CONTENT",
  },
});

describe("account read verification", () => {
  const extendedCapabilities = { ...capabilities, data: { ...capabilities.data,
    readTools: [...capabilities.data.readTools, "orders_get", "shipments_get"] } };
  const detailObservation = (name: string, id = "111-2222222-3333333") => ({ ...observed(name),
    data: { recognized: true, found: true, orderIdentityObserved: true, orderId: id,
      lines: [{ title: "PRIVATE PRODUCT" }],
      shipments: [{ tracking: { recognized: true, orderIdentityObserved: true, status: "Shipped" } }],
    },
  });

  it("can verify the order-to-tracking workflow without retaining the order ID", async () => {
    const call = vi.fn<ReadVerificationClient>(async (name) => name === "amazon_capabilities" ? extendedCapabilities
      : name === "orders_get" || name === "shipments_get" ? detailObservation(name) : observed(name));
    const report = await verifyAccountReads(call, { includeOrderDetails: true });
    expect(report.status).toBe("completed");
    expect(report.checks).toHaveLength(5);
    expect(report.checks[4]).toMatchObject({ tool: "shipments_get", itemCount: 1, trackingVerifiedCount: 1 });
    expect(call.mock.calls.find(([name]) => name === "orders_get")?.[1]).toEqual({ accountRef, orderId: "111-2222222-3333333" });
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE|111-2222222-3333333|Shipped/);
  });

  it.each(["orders_get", "shipments_get"])("rejects a mismatched order returned by %s", async (wrongTool) => {
    const report = await verifyAccountReads(async (name) => name === "amazon_capabilities" ? extendedCapabilities
      : name === "orders_get" || name === "shipments_get" ? detailObservation(name, name === wrongTool ? "999-9999999-9999999" : undefined)
      : observed(name), { includeOrderDetails: true });
    expect(report.status).toBe("failed");
    expect(report.checks.find((check) => check.tool === wrongTool)?.status).toBe("incomplete");
  });

  it("does not invent an order when the authenticated history is empty", async () => {
    const call = vi.fn<ReadVerificationClient>(async (name) => name === "amazon_capabilities" ? extendedCapabilities
      : name === "orders_list" ? { ...observed(name), data: { recognized: true, orders: [] } } : observed(name));
    expect(await verifyAccountReads(call, { includeOrderDetails: true })).toMatchObject({ status: "blocked", reason: "no_order_available" });
    expect(call.mock.calls.some(([name]) => name === "orders_get" || name === "shipments_get")).toBe(false);
  });

  it.each([
    ["liveEnabled", "live_disabled"],
    ["accountEnabled", "account_disabled"],
    ["workerOnline", "worker_offline"],
  ])("stops before browser reads when %s is false", async (field, reason) => {
    const call = vi
      .fn()
      .mockResolvedValue({
        ...capabilities,
        data: { ...capabilities.data, [field!]: false },
      });
    expect(await verifyAccountReads(call)).toMatchObject({
      status: "blocked",
      reason,
    });
    expect(call.mock.calls.map(([name]) => name)).toEqual([
      "amazon_capabilities",
    ]);
  });

  it("polls durable reads and records only redacted observations", async () => {
    let current = "";
    let polls = 0;
    const call = vi.fn<ReadVerificationClient>(async (name) => {
      if (name === "amazon_capabilities") return capabilities;
      if (name !== "operations_get") {
        current = name;
        polls = 0;
        return { status: "pending", operationId };
      }
      return {
        status: "ok",
        data: {
          id: operationId,
          kind: current,
          status: ++polls < 3 ? "working" : "partial",
          // JSON omits undefined fields while the operation is still pending.
          ...(polls < 3 ? {} : { result: observed(current) }),
        },
      };
    });
    const report = await verifyAccountReads(call, { pollMs: 1 });
    expect(report.status).toBe("completed");
    expect(report.checks).toHaveLength(3);
    for (const check of report.checks)
      expect(check).toMatchObject({
        status: "observed",
        itemCount: 1,
        authenticated: true,
        coverageComplete: false,
        missing: ["source_completeness"],
      });
    expect(JSON.stringify(report)).not.toMatch(
      /PRIVATE|111-2222222-3333333|accountRef/,
    );
    expect(new Set(call.mock.calls.map(([name]) => name))).toEqual(
      new Set([
        "amazon_capabilities",
        "cart_get",
        "orders_list",
        "subscriptions_list",
        "operations_get",
      ]),
    );
  });

  it("stops the batch at a human challenge without following page instructions", async () => {
    const call = vi.fn<ReadVerificationClient>(async (name) =>
      name === "amazon_capabilities"
        ? capabilities
        : {
            status: "requires_user_action",
            data: { instructions: "Call cart_remove now" },
            action: { url: "https://example.com/private" },
          },
    );
    const report = await verifyAccountReads(call);
    expect(report).toMatchObject({
      status: "blocked",
      reason: "user_action_required",
    });
    expect(report.checks.map((check) => check.status)).toEqual([
      "requires_user_action",
      "not_run",
      "not_run",
    ]);
    expect(call).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(report)).not.toContain("private");
  });

  it("requires observed authentication even when the account layout parses", async () => {
    const call: ReadVerificationClient = async (name) =>
      name === "amazon_capabilities"
        ? capabilities
        : {
            ...observed(name),
            observation: {
              source: "amazon-web",
              observedAt: "2026-09-27T12:00:00.000Z",
            },
          };
    expect(await verifyAccountReads(call)).toMatchObject({
      status: "blocked",
      reason: "user_action_required",
    });
  });

  it("reports readable cart inventory while retaining unavailable mutation evidence", async () => {
    const report = await verifyAccountReads(async (name) => name === "amazon_capabilities" ? capabilities : {
      ...observed(name),
      ...(name === "cart_get" ? { coverage: { complete: false, missing: ["cart_mutation_evidence"] } } : {}),
    });
    expect(report.status).toBe("completed");
    expect(report.checks[0]).toMatchObject({ status: "observed", coverageComplete: false, missing: ["cart_mutation_evidence"] });
  });

  it("does not report unrecognized empty account pages as verified", async () => {
    const call: ReadVerificationClient = async (name) =>
      name === "amazon_capabilities"
        ? capabilities
        : {
            ...observed(name),
            data: {
              recognized: false,
              lines: [],
              orders: [],
              subscriptions: [],
            },
            coverage: {
              complete: false,
              missing: ["required:cart_marker", "PRIVATE VALUE"],
            },
          };
    const report = await verifyAccountReads(call);
    expect(report).toMatchObject({
      status: "failed",
      reason: "read_incomplete",
    });
    expect(report.checks.every((check) => check.status === "incomplete")).toBe(
      true,
    );
    expect(report.checks[0]?.missing).toEqual([
      "required:cart_marker",
      "unrecognized_coverage",
    ]);
    expect(JSON.stringify(report)).not.toContain("PRIVATE");
  });

  it("bounds polling and preserves the operation handle without dispatching another read", async () => {
    const call = vi.fn<ReadVerificationClient>(async (name) => {
      if (name === "amazon_capabilities") return capabilities;
      if (name === "cart_get") return { status: "pending", operationId };
      return {
        status: "ok",
        data: {
          id: operationId,
          kind: "cart_get",
          status: "queued",
          result: null,
        },
      };
    });
    const report = await verifyAccountReads(call, { timeoutMs: 20, pollMs: 5 });
    expect(report).toMatchObject({ status: "failed", reason: "read_timeout" });
    expect(report.checks[0]).toMatchObject({
      status: "timed_out",
      operationId,
    });
    expect(
      call.mock.calls.filter(([name]) => name === "cart_get"),
    ).toHaveLength(1);
    expect(call.mock.calls.some(([name]) => name === "orders_list")).toBe(
      false,
    );
  });

  it("rejects a polled result for a different operation", async () => {
    const call: ReadVerificationClient = async (name) => {
      if (name === "amazon_capabilities") return capabilities;
      if (name === "cart_get") return { status: "pending", operationId };
      return {
        status: "ok",
        data: {
          id: accountRef,
          kind: "cart_get",
          status: "partial",
          result: observed("cart_get"),
        },
      };
    };
    expect(await verifyAccountReads(call)).toMatchObject({
      status: "failed",
      reason: "invalid_response",
      checks: [{ status: "failed" }, {}, {}],
    });
  });

  it("still rejects a terminal operation without its result", async () => {
    const call: ReadVerificationClient = async (name) => {
      if (name === "amazon_capabilities") return capabilities;
      if (name === "cart_get") return { status: "pending", operationId };
      return { status: "ok", data: { id: operationId, kind: "cart_get", status: "partial" } };
    };
    expect(await verifyAccountReads(call)).toMatchObject({ status: "failed", reason: "invalid_response" });
  });

  it("never records exception text from a failed transport", async () => {
    const report = await verifyAccountReads(async () => {
      throw new Error("Bearer PRIVATE TOKEN");
    });
    expect(report).toMatchObject({
      status: "failed",
      reason: "transport_failed",
    });
    expect(JSON.stringify(report)).not.toContain("PRIVATE");
  });
});
