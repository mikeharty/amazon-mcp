import type { ObservationProvenance } from "../core/observations.js";
import { randomUUID } from "node:crypto";
import { DomainError, type Result } from "../contracts/index.js";
import { Store } from "./index.js";
import { digest } from "./crypto.js";
export type PriceThreshold = { currency: "USD"; minorUnits: number };
export type Watch = {
  id: string;
  owner_id: string;
  account_id: string;
  kind: string;
  input: Record<string, unknown>;
  cadence_seconds: number;
  paused: boolean;
  revision: number;
  last_digest: string | null;
  last_success: Date | null;
  priceThreshold?: PriceThreshold;
  next_due: Date;
  expires_at: Date | null;
};
export class Monitoring {
  constructor(
    readonly store: Store,
    readonly desktopNotifications = false,
  ) {}
  private decode(row: Record<string, unknown>): Watch {
    return {
      ...row,
      input: this.store.vault.open(String(row.input), String(row.owner_id)),
      priceThreshold: row.price_threshold
        ? this.store.vault.open(
            String(row.price_threshold),
            String(row.owner_id),
          )
        : undefined,
    } as Watch;
  }
  async create(
    owner: string,
    accountId: string,
    kind: string,
    input: Record<string, unknown>,
    cadenceSeconds: number,
    expiresAt?: string,
    requestKey: string = randomUUID(),
    priceThreshold?: PriceThreshold,
  ): Promise<Watch> {
    await this.store.getAccount(owner, accountId);
    if (
      !Number.isInteger(cadenceSeconds) ||
      cadenceSeconds < 300 ||
      cadenceSeconds > 604800
    )
      throw new DomainError(
        "INVALID_CADENCE",
        "Cadence must be 300 to 604800 seconds",
        400,
      );
    if (
      expiresAt &&
      (!Number.isFinite(Date.parse(expiresAt)) ||
        Date.parse(expiresAt) <= Date.now())
    )
      throw new DomainError(
        "INVALID_EXPIRY",
        "Expiry must be in the future",
        400,
      );
    if (
      priceThreshold &&
      (kind !== "products_get" ||
        priceThreshold.currency !== "USD" ||
        !Number.isSafeInteger(priceThreshold.minorUnits) ||
        priceThreshold.minorUnits < 0)
    )
      throw new DomainError(
        "INVALID_THRESHOLD",
        "Price thresholds require product reads and nonnegative USD minor units",
        400,
      );
    return this.store.transaction(async (c) => {
      const account = await this.store.getAccount(owner, accountId, c, true);
      if (!account.enabled)
        throw new DomainError(
          "ACCOUNT_DISCONNECTED",
          "Account access is disconnected",
        );
      const hash = digest({
        accountId,
        kind,
        input,
        cadenceSeconds,
        expiresAt: expiresAt ?? null,
        priceThreshold: priceThreshold ?? null,
      });
      const existing = await c.query(
        "SELECT * FROM watches WHERE owner_id=$1 AND request_key=$2",
        [owner, requestKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].input_digest !== hash)
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            "Watch key already identifies another rule",
          );
        return this.decode(existing.rows[0]);
      }
      const { rows } = await c.query(
        `INSERT INTO watches(id,owner_id,account_id,kind,input,cadence_seconds,expires_at,request_key,input_digest,price_threshold) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          randomUUID(),
          owner,
          accountId,
          kind,
          this.store.vault.seal(input, owner),
          cadenceSeconds,
          expiresAt ?? null,
          requestKey,
          hash,
          priceThreshold ? this.store.vault.seal(priceThreshold, owner) : null,
        ],
      );
      return this.decode(rows[0]);
    });
  }
  async list(owner: string): Promise<Watch[]> {
    const { rows } = await this.store.pool.query(
      "SELECT * FROM watches WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100",
      [owner],
    );
    return rows.map((r) => this.decode(r));
  }
  async pause(
    owner: string,
    id: string,
    paused: boolean,
    revision: number,
  ): Promise<void> {
    const { rowCount } = await this.store.pool.query(
      `UPDATE watches SET paused=$3,revision=revision+1,next_due=now() WHERE id=$1 AND owner_id=$2 AND revision=$4`,
      [id, owner, paused, revision],
    );
    if (!rowCount)
      throw new DomainError("STALE_WATCH", "Watch not found or changed");
  }
  async remove(owner: string, id: string): Promise<void> {
    const { rowCount } = await this.store.pool.query(
      "DELETE FROM watches WHERE id=$1 AND owner_id=$2",
      [id, owner],
    );
    if (!rowCount) throw new DomainError("NOT_FOUND", "Watch not found", 404);
  }
  async due(): Promise<Watch[]> {
    return this.store.transaction(async (c) => {
      const { rows } = await c.query(
        `SELECT * FROM watches WHERE paused=false AND next_due<=now() AND (expires_at IS NULL OR expires_at>now()) ORDER BY next_due FOR UPDATE SKIP LOCKED LIMIT 20`,
      );
      for (const row of rows) {
        await c.query(
          "UPDATE watches SET next_due=now()+make_interval(secs:=cadence_seconds) WHERE id=$1",
          [row.id],
        );
        await c.query(
          `SELECT graphile_worker.add_job('observe_watch',$1::json,queue_name:=$2,job_key:=$3,max_attempts:=3)`,
          [
            JSON.stringify({ watchId: row.id, revision: row.revision }),
            `account:${row.account_id}`,
            `watch:${row.id}`,
          ],
        );
      }
      return rows.map((r) => this.decode(r));
    });
  }
  async get(id: string): Promise<Watch | null> {
    const { rows } = await this.store.pool.query(
      "SELECT * FROM watches WHERE id=$1",
      [id],
    );
    return rows[0] ? this.decode(rows[0]) : null;
  }
  // Semantic state deliberately excludes observation timestamps; occurrence increments when state changes.
  async observe(watch: Watch, result: Result): Promise<boolean> {
    if (
      !["ok", "partial"].includes(result.status) ||
      !result.data ||
      result.coverage?.missing.some((field) => field.startsWith("required:"))
    )
      return false;
    return this.store.transaction(async (c) => {
      const { rows } = await c.query(
        "SELECT * FROM watches WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [watch.id, watch.owner_id],
      );
      const current = rows[0];
      if (
        !current ||
        current.paused ||
        current.revision !== watch.revision ||
        (current.expires_at && new Date(current.expires_at) <= new Date())
      )
        return false;
      const state = semantic(result.data);
      const hash = digest(state);
      const threshold = current.price_threshold
        ? this.store.vault.open<PriceThreshold>(
            current.price_threshold,
            watch.owner_id,
          )
        : undefined;
      const prior = current.last_value
        ? this.store.vault.open(current.last_value, watch.owner_id)
        : undefined;
      const changed =
        current.last_digest !== null &&
        current.last_digest !== hash &&
        (!threshold || crossesPriceThreshold(prior, state, threshold));
      if (changed) {
        const eventId = randomUUID();
        await c.query(
          `INSERT INTO events(id,owner_id,watch_id,kind,payload) VALUES($1,$2,$3,$4,$5)`,
          [
            eventId,
            watch.owner_id,
            watch.id,
            watch.kind,
            this.store.vault.seal(
              {
                previous: current.last_value
                  ? this.store.vault.open(current.last_value, watch.owner_id)
                  : null,
                current: state,
                observedAt:
                  result.observation?.observedAt ?? new Date().toISOString(),
                priorSuccess: current.last_success,
              },
              watch.owner_id,
            ),
          ],
        );
        if (this.desktopNotifications)
          await c.query(
            "INSERT INTO notification_deliveries(event_id) VALUES($1)",
            [eventId],
          );
      }
      await c.query(
        "UPDATE watches SET last_digest=$2,last_value=$3,last_success=now() WHERE id=$1",
        [watch.id, hash, this.store.vault.seal(state, watch.owner_id)],
      );
      return changed;
    });
  }
  async events(owner: string, after = "0", limit = 50) {
    if (
      !/^\d{1,18}$/.test(after) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new DomainError(
        "INVALID_CURSOR",
        "Invalid event cursor or limit",
        400,
      );
    const { rows } = await this.store.pool.query(
      "SELECT events.*,(SELECT status FROM notification_deliveries WHERE event_id=events.id) AS desktop_delivery_status FROM events WHERE owner_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3",
      [owner, after, limit],
    );
    return {
      items: rows.map((r) => ({
        ...r,
        payload: this.store.vault.open(r.payload, owner),
      })),
      nextCursor: rows.at(-1)?.sequence ?? after,
    };
  }
  async acknowledge(owner: string, ids: string[]) {
    await this.store.pool.query(
      "UPDATE events SET acknowledged_at=now() WHERE owner_id=$1 AND id=ANY($2::uuid[])",
      [owner, ids],
    );
  }
  async record(
    owner: string,
    accountId: string,
    subject: string,
    kind: string,
    value: unknown,
    provenance?: ObservationProvenance,
  ): Promise<void> {
    await this.store.getAccount(owner, accountId);
    await this.store.pool.query(
      "INSERT INTO observations(id,owner_id,account_id,subject,kind,value,digest,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        randomUUID(),
        owner,
        accountId,
        subject,
        kind,
        this.store.vault.seal(value, owner),
        digest(value),
        provenance ? this.store.vault.seal(provenance, owner) : null,
      ],
    );
  }
  async history(
    owner: string,
    accountId: string,
    subject: string,
    limit = 100,
  ) {
    await this.store.getAccount(owner, accountId);
    const { rows } = await this.store.pool.query(
      "SELECT * FROM observations WHERE owner_id=$1 AND account_id=$2 AND subject=$3 ORDER BY observed_at DESC LIMIT $4",
      [owner, accountId, subject, Math.max(1, Math.min(limit, 500))],
    );
    return rows.map((r) => {
      const provenance = r.provenance
        ? this.store.vault.open<ObservationProvenance>(r.provenance, owner)
        : null;
      return {
        recordedAt: r.observed_at,
        observedAt: provenance?.sourceObservedAt ?? null,
        source: provenance?.source ?? "unrecorded-provider",
        kind: r.kind,
        provenance,
        value: this.store.vault.open(r.value, owner),
      };
    });
  }
  async purge(before: Date) {
    await this.store.pool.query(
      "DELETE FROM observations WHERE observed_at<$1",
      [before],
    );
    await this.store.pool.query(
      "DELETE FROM events WHERE created_at<$1 AND acknowledged_at IS NOT NULL",
      [before],
    );
  }
}
export function semantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semantic);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            ![
              "observedAt",
              "retrievedAt",
              "revision",
              "lastCheckedAt",
            ].includes(key),
        )
        .map(([k, v]) => [k, semantic(v)]),
    );
  return value;
}

function crossesPriceThreshold(
  previous: unknown,
  current: unknown,
  threshold: PriceThreshold,
): boolean {
  const price = (v: unknown): number | undefined => {
    if (!v || typeof v !== "object") return;
    const p = (v as { price?: unknown }).price;
    if (!p || typeof p !== "object") return;
    const value = p as { currency?: unknown; minorUnits?: unknown };
    return value.currency === threshold.currency &&
      Number.isSafeInteger(value.minorUnits) &&
      Number(value.minorUnits) >= 0
      ? Number(value.minorUnits)
      : undefined;
  };
  const before = price(previous),
    after = price(current);
  return (
    before !== undefined &&
    after !== undefined &&
    before > threshold.minorUnits &&
    after <= threshold.minorUnits
  );
}
