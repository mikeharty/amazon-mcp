import { describe, expect, it, vi } from "vitest";

import {
  createMacOSNotificationChannel,
  MACOS_NOTIFICATION_SCRIPT,
  type ExecRunner,
} from "../packages/notifications/index.js";

describe("macOS notification channel", () => {
  it("delivers generic text through an argument-safe osascript invocation", async () => {
    const run = vi.fn<ExecRunner>().mockResolvedValue({ status: "ok" });
    const channel = createMacOSNotificationChannel({
      enabled: true,
      platform: "darwin",
      exec: run,
    });

    const result = await channel.deliver({
      eventId: "event-1",
      kind: "shipment_update",
    });

    expect(result).toEqual({ status: "sent", eventId: "event-1" });
    expect(run).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      [
        "-e",
        MACOS_NOTIFICATION_SCRIPT,
        "--",
        "Amazon Shopping",
        "A shipment update is available.",
      ],
      { timeoutMs: 5_000 },
    );
  });

  it("is disabled by default and does not execute a process", async () => {
    const run = vi.fn<ExecRunner>();
    const channel = createMacOSNotificationChannel({
      platform: "darwin",
      exec: run,
    });

    expect(
      await channel.deliver({ eventId: "event-1", kind: "refund_update" }),
    ).toEqual({
      status: "failed",
      eventId: "event-1",
      error: { code: "channel_disabled", retryable: false },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("reports unsupported operating systems explicitly without execution", async () => {
    const run = vi.fn<ExecRunner>();
    const channel = createMacOSNotificationChannel({
      enabled: true,
      platform: "linux",
      exec: run,
    });

    expect(
      await channel.deliver({ eventId: "event-1", kind: "restock" }),
    ).toEqual({
      status: "failed",
      eventId: "event-1",
      error: { code: "unsupported_os", retryable: false },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("treats a timeout as ambiguous because the notification may already be visible", async () => {
    const run = vi
      .fn<ExecRunner>()
      .mockResolvedValue({ status: "failed", reason: "timeout" });
    const channel = createMacOSNotificationChannel({
      enabled: true,
      platform: "darwin",
      exec: run,
      timeoutMs: 25,
    });

    expect(
      await channel.deliver({
        eventId: "event-timeout",
        kind: "return_update",
      }),
    ).toEqual({
      status: "outcome_unknown",
      eventId: "event-timeout",
      error: { code: "delivery_timeout", retryable: false },
    });
  });

  it("reports an explicit process rejection as a retryable failure", async () => {
    const run = vi
      .fn<ExecRunner>()
      .mockResolvedValue({ status: "failed", reason: "error" });
    const channel = createMacOSNotificationChannel({
      enabled: true,
      platform: "darwin",
      exec: run,
    });

    expect(
      await channel.deliver({ eventId: "event-failed", kind: "price_change" }),
    ).toEqual({
      status: "failed",
      eventId: "event-failed",
      error: { code: "delivery_failed", retryable: true },
    });
  });

  it("never interpolates a hostile kind or event ID into script or displayed text", async () => {
    const run = vi.fn<ExecRunner>().mockResolvedValue({ status: "ok" });
    const channel = createMacOSNotificationChannel({
      enabled: true,
      platform: "darwin",
      exec: run,
    });
    const hostileKind = 'x" & do shell script "touch /tmp/pwned" & "';
    const hostileEventId = "order 123; rm -rf /";

    await channel.deliver({ eventId: hostileEventId, kind: hostileKind });

    const [executable, args] = run.mock.calls[0]!;
    expect(executable).toBe("/usr/bin/osascript");
    expect(args[1]).toBe(MACOS_NOTIFICATION_SCRIPT);
    expect(args).not.toContain(hostileKind);
    expect(args).not.toContain(hostileEventId);
    expect(args.at(-1)).toBe("An Amazon update is available.");
  });

  it("sanitizes thrown runner failures and treats them as ambiguous", async () => {
    const secret = "private-order-123";
    const run = vi
      .fn<ExecRunner>()
      .mockRejectedValue(new Error(`osascript failed for ${secret}`));
    const channel = createMacOSNotificationChannel({
      enabled: true,
      platform: "darwin",
      exec: run,
    });

    const result = await channel.deliver({
      eventId: "event-1",
      kind: "system",
    });

    expect(result).toEqual({
      status: "outcome_unknown",
      eventId: "event-1",
      error: { code: "delivery_outcome_unknown", retryable: false },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
