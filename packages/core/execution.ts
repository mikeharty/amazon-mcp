import type { Result, ShoppingProvider } from "../contracts/index.js";
import { Store, type Operation } from "../store/index.js";
import { Monitoring } from "../store/monitoring.js";
import {
  productHistorySubject,
  productObservationProvenance,
} from "./observations.js";
import { digest } from "../store/crypto.js";
export class Executor {
  constructor(
    readonly store: Store,
    readonly provider: ShoppingProvider,
    readonly workerId: string,
    readonly retainObservations = false,
    readonly desktopNotifications = false,
  ) {}
  async run(id: string): Promise<void> {
    const op = await this.store.claim(id, this.workerId);
    if (!op) return;
    let dispatched = false;
    try {
      const account = await this.store.getAccount(op.owner_id, op.account_id);
      const ctx = {
        ownerId: op.owner_id,
        accountRef: op.account_id,
        marketplace: account.marketplace,
        sessionGeneration: account.session_generation,
      };
      let result: Result;
      if (op.mode === "read")
        result = await this.provider.read(op.kind, op.input, ctx);
      else {
        if (op.mode === "commit") {
          const intent = await this.store.getIntent(op.owner_id, op.intent_id!);
          if (
            intent.session_generation !== account.session_generation ||
            intent.expires_at <= new Date()
          ) {
            await this.store.finish(op, this.workerId, {
              status: "conflict",
              error: { code: "STALE_INTENT", retryable: false },
            });
            return;
          }
          // A provider supplies an exact fresh summary, not a caller's restatement.
          const fresh = await this.provider.read(
            `${op.kind}_preconditions`,
            op.input,
            ctx,
          );
          if (fresh.status !== "ok" || digest(fresh.data) !== intent.digest) {
            await this.store.finish(op, this.workerId, {
              status: "conflict",
              error: { code: "TERMS_CHANGED_OR_UNVERIFIED", retryable: false },
            });
            return;
          }
        }
        dispatched = await this.store.markDispatch(op.id, this.workerId);
        if (!dispatched) return;
        result = await this.provider.mutate(op.kind, op.input, ctx);
      }
      await this.store.finish(op, this.workerId, result);
      if (
        this.retainObservations &&
        op.mode === "read" &&
        op.kind === "products_get" &&
        ["ok", "partial"].includes(result.status) &&
        op.input.asin &&
        result.data &&
        typeof result.data === "object" &&
        "asin" in result.data &&
        result.data.asin === op.input.asin
      ) {
        // Runtime generations are provenance, not permanent history partitions.
        await new Monitoring(this.store).record(
          op.owner_id,
          op.account_id,
          productHistorySubject(ctx.marketplace, String(op.input.asin)),
          op.kind,
          result.data,
          productObservationProvenance(ctx, String(op.input.asin), result),
        );
      }
    } catch {
      const result: Result = dispatched
        ? {
            status: "outcome_unknown",
            error: { code: "DISPATCH_OUTCOME_UNKNOWN", retryable: false },
          }
        : {
            status: "failed",
            error: { code: "OPERATION_FAILED", retryable: op.mode === "read" },
          };
      // Never downgrade a persisted uncertain outcome if result handling itself failed.
      await this.store.finish(op, this.workerId, result).catch(() => undefined);
    }
  }
  async watch(id: string, revision: number) {
    const monitoring = new Monitoring(this.store, this.desktopNotifications);
    const watch = await monitoring.get(id);
    if (
      !watch ||
      watch.paused ||
      watch.revision !== revision ||
      (watch.expires_at && watch.expires_at <= new Date())
    )
      return;
    const a = await this.store.getAccount(watch.owner_id, watch.account_id);
    if (!a.enabled) return;
    const result = await this.provider.read(watch.kind, watch.input, {
      ownerId: a.owner_id,
      accountRef: a.id,
      sessionGeneration: a.session_generation,
      marketplace: a.marketplace,
    });
    await monitoring.observe(watch, result);
  }
}
