import { Store } from "./index.js";
export type DeliveryOutcome = {
  status: "sent" | "failed" | "outcome_unknown";
  code?: string;
  error?: { code: string };
};
export type NotificationChannel = {
  deliver(event: { eventId: string; kind: string }): Promise<DeliveryOutcome>;
};
/** Durable one-attempt delivery. An interrupted dispatch is never blindly repeated. */
export class NotificationOutbox {
  constructor(
    readonly store: Store,
    readonly channel: NotificationChannel,
  ) {}
  async enqueuePending() {
    await this.store.transaction(async (c) => {
      const { rows } = await c.query(
        "SELECT event_id FROM notification_deliveries WHERE status='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 50",
      );
      for (const row of rows)
        await c.query(
          "SELECT graphile_worker.add_job('deliver_notification',$1::json,queue_name:='desktop-notifications',job_key:=$2,max_attempts:=3)",
          [
            JSON.stringify({ eventId: row.event_id }),
            `notification:${row.event_id}`,
          ],
        );
    });
  }
  async deliver(eventId: string) {
    const event = await this.store.transaction(async (c) => {
      const { rows } = await c.query(
        "UPDATE notification_deliveries SET status='dispatching',updated_at=now() WHERE event_id=$1 AND status='pending' RETURNING event_id",
        [eventId],
      );
      if (!rows[0]) return null;
      const result = await c.query("SELECT id,kind FROM events WHERE id=$1", [
        eventId,
      ]);
      return result.rows[0] ?? null;
    });
    if (!event) return;
    let result: DeliveryOutcome;
    try {
      result = await this.channel.deliver({
        eventId: event.id,
        kind: event.kind,
      });
    } catch {
      result = { status: "outcome_unknown", code: "DELIVERY_RESULT_UNKNOWN" };
    }
    await this.store.pool.query(
      "UPDATE notification_deliveries SET status=$2,result_code=$3,updated_at=now() WHERE event_id=$1 AND status='dispatching'",
      [eventId, result.status, result.code ?? result.error?.code ?? null],
    );
  }
  async recoverStale(before: Date) {
    await this.store.pool.query(
      "UPDATE notification_deliveries SET status='outcome_unknown',result_code='INTERRUPTED_DELIVERY',updated_at=now() WHERE status='dispatching' AND updated_at<$1",
      [before],
    );
  }
}
