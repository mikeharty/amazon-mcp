# Transport interoperability evidence

Date: 2026-09-22

## Implemented surface

`createGateway` is a framework-independent Fetch handler backed by `mcp-handler` 2.2.0 and `@modelcontextprotocol/server` 2.0.0. The registry is injected as explicit tool and static-resource definitions. Each tool definition requires input and output schemas, annotations, and a handler that receives the authenticated `Owner`; the gateway does not expose a generic action executor.

The boundary requires a bearer token before calling the injected authenticator. It accepts loopback hosts by default (`localhost`, `127.0.0.1`, and `::1`), rejects mismatched browser origins, limits declared and observed request bodies to 1 MiB by default, disables subscription streams, and returns cache-disabled errors. Tool exceptions become an MCP `isError` result with the fixed text `Tool execution failed`. Resource and gateway errors are similarly replaced with fixed messages; exception messages and stacks are not returned.

The default is suitable only for a locally bound gateway. A hosted deployment must supply an explicit host allowlist and terminate TLS in a trusted configuration; proxy forwarding and OAuth protected-resource metadata remain integration work.

## Verified behavior

The test harness mounts the Fetch handler on a real ephemeral Node HTTP server and connects through the published `@modelcontextprotocol/client` 2.0.0 `StreamableHTTPClientTransport`.

- Modern `server/discover` negotiation selects the 2026 protocol era.
- Tool listing preserves schemas and annotations.
- A structured tool call reaches the injected handler with the authenticated owner and returns validated `structuredContent` plus text fallback.
- Static resource listing and reading work through the SDK client.
- Explicit legacy mode negotiates a 2025 protocol and completes a tool call through `mcp-handler`'s stateless fallback.
- Missing bearer credentials, non-loopback hosts, foreign origins, and oversized bodies are rejected.
- A handler exception containing a sentinel secret returns a sanitized MCP error without that value.

Command: `npx pnpm@10.32.1 test -- tests/transport.test.ts`

Result: 4 tests passed. This proves SDK interoperability in the local harness. It does not establish compatibility with a specific desktop/client UI, hosted proxy, authorization server, or long-lived subscription stream.

## Graphile Worker 0.18 API findings

`makeWorkerUtils().addJob()` obtains its own pooled client. It therefore cannot be used to atomically commit an application journal row and its queue delivery inside an existing Store transaction. Graphile Worker's own 0.18 implementation enqueues through its public schema function:

```sql
select *
from graphile_worker.add_job(
  identifier => $1::text,
  payload => $2::json,
  queue_name => $3::text,
  run_at => $4::timestamptz,
  max_attempts => $5::int,
  job_key => $6::text,
  priority => $7::int,
  flags => $8::text[],
  job_key_mode => $9::text
);
```

Calling that function with the Store's existing `pg.PoolClient` gives one database transaction for the journal transition and enqueue. Use a stable, bounded-cardinality account queue name for serialized Amazon mutations, and a durable job or operation identifier as `job_key`. Do not address Graphile's private tables directly.

Library-mode startup is `run({ pgPool, taskList, noHandleSignals: true })`. Orderly shutdown is `await runner.stop(reason)` followed by `await runner.promise`. Graphile periodically recovers abandoned locks after process loss. `forceUnlockWorkers(workerIds)` is documented only for workers confirmed dead, never for normal restart or a possibly live worker. A task receives `helpers.abortSignal` during graceful shutdown. If a consequential browser effect might already have been dispatched, that abort must transition the application operation to `outcome_unknown` for reconciliation rather than causing an automatic replay.

These findings are package/API validation only. Named-queue serialization, stale-lock timing, crash restart, cron backfill, and schema upgrades still require a live Postgres integration test before transactional Amazon actions are enabled.

## Operational discovery and recovery, 2026-09-30 Pacific

After updating the local gateway, the official SDK client at 2026-10-01 05:34 UTC discovered 37 tools and three resources (`amazon://guide`, `amazon://status`, `amazon://events`). Server workflow instructions were available. The client read both new resources and retrieved two pages of operation metadata with distinct handles and no private inputs/results. `local:doctor` exited 0: worker online, no queued/active/uncertain jobs. This establishes local service health only; it did not contact Amazon or verify current authentication.

The full test run passed 147 tests in 17 files, typecheck/build and nine compiled Chromium fixture checks. New real Postgres tests cover owner isolation, encrypted cursor tampering and changed filters, timestamp precision, payload exclusion, stale queue/worker findings and diagnostics without account-creation side effects. Recovery guidance does not perform recovery or replay any operation.
