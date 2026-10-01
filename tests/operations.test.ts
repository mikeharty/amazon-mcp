import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "../packages/store/index.js";
import { OperationQueries } from "../packages/store/operations.js";

const connection = process.env.TEST_DATABASE_URL;
describe.skipIf(!connection)("operational history and diagnostics", () => {
  const db = `operations_test_${randomUUID().replaceAll("-", "")}`;
  let store: Store, admin: pg.Pool, queries: OperationQueries;
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: connection });
    await admin.query(`CREATE DATABASE ${db}`);
    const url = new URL(connection!); url.pathname = `/${db}`;
    store = new Store(url.toString(), randomBytes(32).toString("base64"));
    await store.migrate(); queries = new OperationQueries(store);
  }, 30_000);
  afterAll(async () => {
    await store?.close(); await admin?.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`); await admin?.end();
  });
  async function seed(owner: string, kind = "orders_get") {
    const account = await store.account(owner);
    return store.start(owner, account.id, kind, "read", { secret: "PRIVATE ORDER CONTENT" }, randomUUID());
  }

  it("paginates deterministically at microsecond precision without decrypting payloads", async () => {
    const ops = await Promise.all([seed("pages"), seed("pages"), seed("pages")]);
    await store.pool.query("UPDATE operations SET created_at='2026-09-28T01:02:03.123456Z',input='unreadable-private-payload' WHERE id=ANY($1::uuid[])", [ops.map((o) => o.id)]);
    await store.pool.query("UPDATE operations SET created_at='2026-09-28T01:02:03.123457Z' WHERE id=$1", [ops[0]!.id]);
    const first = await queries.list("pages", { limit: 1 });
    expect(first.operations[0]?.id).toBe(ops[0]!.id);
    const rest = await queries.list("pages", { limit: 2, cursor: first.nextCursor! });
    expect(new Set([...first.operations, ...rest.operations].map((o) => o.id)).size).toBe(3);
    expect(rest.nextCursor).toBeUndefined();
    expect(JSON.stringify({ first, rest })).not.toMatch(/PRIVATE|unreadable|input|result|idempotency/);
  });

  it("binds cursors to owner and filters and rejects tampering", async () => {
    await seed("cursor"); await seed("cursor"); await seed("foreign");
    const first = await queries.list("cursor", { limit: 1, mode: "read" });
    for (const [owner, input] of [
      ["foreign", { cursor: first.nextCursor!, mode: "read" as const }],
      ["cursor", { cursor: first.nextCursor!, status: "queued" as const }],
      ["cursor", { cursor: "tampered" }],
    ] as const) await expect(queries.list(owner, input)).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    const foreign = await store.account("foreign");
    await expect(queries.list("cursor", { accountRef: foreign.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const filtered = await queries.list("cursor", { kind: "cart_get" });
    expect(filtered.operations).toEqual([]);
  });

  it("reports owner-scoped queue risks without replaying or exposing private results", async () => {
    const queued = await seed("health"); const active = await seed("health"); const uncertain = await seed("health");
    await seed("other-health");
    await store.pool.query("UPDATE operations SET created_at=now()-interval '5 minutes' WHERE id=$1", [queued.id]);
    await store.pool.query("UPDATE operations SET status='working',heartbeat_at=now()-interval '3 minutes' WHERE id=$1", [active.id]);
    await store.pool.query("UPDATE operations SET status='outcome_unknown',result='unreadable-private-result' WHERE id=$1", [uncertain.id]);
    const data = await queries.diagnostics("health", false);
    expect(data).toMatchObject({ readiness: "needs_attention", authentication: "not_checked", queue: { queued: 1, active: 1, uncertain: 1, staleActive: 1 } });
    expect(data.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["live_disabled", "worker_offline", "uncertain_write", "queue_delayed", "stale_operations"]));
    expect(JSON.stringify(data)).not.toMatch(/PRIVATE|unreadable/);
    expect((await queries.list("health", { status: "outcome_unknown" })).operations).toHaveLength(1);
  });

  it("distinguishes local worker health from authentication and historical handoffs", async () => {
    const op = await seed("handoff");
    await store.pool.query("UPDATE operations SET status='requires_user_action' WHERE id=$1", [op.id]);
    await store.heartbeat("fixture-health-worker");
    expect(await queries.diagnostics("handoff", true)).toMatchObject({ authentication: "not_checked", worker: { online: true }, issues: [{ code: "recent_handoff" }] });
    await store.pool.query("UPDATE operations SET status='ok' WHERE id=$1", [op.id]);
    expect(await queries.diagnostics("handoff", true)).toMatchObject({ readiness: "available", authentication: "not_checked", issues: [] });
  });

  it("does not initialize an account as a side effect of diagnostics", async () => {
    await expect(queries.diagnostics("not-created", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await store.pool.query("SELECT id FROM accounts WHERE owner_id='not-created'")).rowCount).toBe(0);
  });
});
