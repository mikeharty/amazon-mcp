import { execFile } from "node:child_process";

import type {
  DeliveryErrorCode,
  DeliveryResult,
  NotificationChannel,
  NotificationEvent,
} from "./index.js";

const OSASCRIPT_PATH = "/usr/bin/osascript";
const DEFAULT_TIMEOUT_MS = 5_000;

export const MACOS_NOTIFICATION_SCRIPT = [
  "on run argv",
  "set notificationTitle to item 1 of argv",
  "set notificationBody to item 2 of argv",
  "display notification notificationBody with title notificationTitle",
  "end run",
].join("\n");

export type ExecRunner = (
  executable: string,
  args: readonly string[],
  options: Readonly<{ timeoutMs: number }>,
) => Promise<
  Readonly<{ status: "ok" } | { status: "failed"; reason: "timeout" | "error" }>
>;

export type MacOSNotificationOptions = Readonly<{
  enabled?: boolean;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  exec?: ExecRunner;
}>;

export function createMacOSNotificationChannel(
  options: MacOSNotificationOptions = {},
): NotificationChannel {
  const enabled = options.enabled ?? false;
  const platform = options.platform ?? process.platform;
  const timeoutMs = validateTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const run = options.exec ?? runExecFile;

  return {
    async deliver(event: NotificationEvent): Promise<DeliveryResult> {
      if (
        !event.eventId ||
        event.eventId.length > 512 ||
        !event.kind ||
        event.kind.length > 512
      ) {
        return failed(event.eventId, "invalid_event", false);
      }
      if (!enabled) return failed(event.eventId, "channel_disabled", false);
      if (platform !== "darwin")
        return failed(event.eventId, "unsupported_os", false);

      const body = genericBody(event.kind);
      try {
        const result = await run(
          OSASCRIPT_PATH,
          ["-e", MACOS_NOTIFICATION_SCRIPT, "--", "Amazon Shopping", body],
          { timeoutMs },
        );
        if (result.status === "ok")
          return { status: "sent", eventId: event.eventId };
        if (result.reason === "timeout") {
          return {
            status: "outcome_unknown",
            eventId: event.eventId,
            error: { code: "delivery_timeout", retryable: false },
          };
        }
        return failed(event.eventId, "delivery_failed", true);
      } catch {
        return {
          status: "outcome_unknown",
          eventId: event.eventId,
          error: { code: "delivery_outcome_unknown", retryable: false },
        };
      }
    },
  };
}

function genericBody(kind: string): string {
  switch (kind) {
    case "shipment_update":
      return "A shipment update is available.";
    case "price_change":
      return "A price update is available.";
    case "restock":
      return "A restock update is available.";
    case "return_update":
      return "A return update is available.";
    case "refund_update":
      return "A refund update is available.";
    case "subscription_update":
      return "A subscription update is available.";
    default:
      return "An Amazon update is available.";
  }
}

function failed(
  eventId: string,
  code: DeliveryErrorCode,
  retryable: boolean,
): DeliveryResult {
  return { status: "failed", eventId, error: { code, retryable } };
}

function validateTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) {
    throw new TypeError("timeoutMs must be an integer from 1 to 60000");
  }
  return value;
}

const runExecFile: ExecRunner = (executable, args, options) =>
  new Promise((resolve) => {
    execFile(executable, [...args], { timeout: options.timeoutMs }, (error) => {
      if (!error) {
        resolve({ status: "ok" });
        return;
      }
      const timedOut = "killed" in error && error.killed === true;
      resolve({ status: "failed", reason: timedOut ? "timeout" : "error" });
    });
  });
