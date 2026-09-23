# MCP platform and durable execution research

Checked 2026-09-20. This is an architecture recommendation, not an implementation or deployment. “Supported” below means verified in the linked specification, current source, release notes, or vendor documentation. Client behavior remains unverified until exercised against the chosen MCP hosts.

## Recommendation

Use [`mcp-handler` 2.x](https://github.com/vercel-labs/mcp-handler) as the thin public HTTP adapter over [`@modelcontextprotocol/server` 2.x](https://github.com/modelcontextprotocol/typescript-sdk). Keep the MCP route stateless and short lived. It should authenticate the caller, validate tool input, create or inspect application jobs, and return structured results. It should never own an Amazon browser process or rely on an MCP transport session for Amazon login state.

Run authenticated Playwright sessions in a separate, persistent worker service. The same worker contract should run either on the user's always-on Mac for a local-first deployment or in a hosted container/VM when monitoring must continue while that Mac is offline. Give each Amazon account a serialized mutation lane and an encrypted, durable browser profile or other recoverable authentication state. Dispatch work by durable job ID. Persist operation intent, approval binding, attempt state, observations, and outcome reconciliation in the application database. Queue delivery is at least once, so every mutating operation needs an idempotency key and a read-after-write/reconciliation path, especially order placement.

For the first TypeScript release, expose long-running work as application-level jobs because the current TypeScript MCP SDK does not implement the current Tasks extension. A call such as `start_shipment_watch` or `prepare_checkout` should return a typed `jobId`, `status`, and `statusResourceUri`; clients can call `get_job` or read `amazon://jobs/{jobId}`. If a client holds a supported subscription stream, a resource update may reduce polling latency, but polling remains the compatibility path.

For this personal-scale, Postgres-backed first release, use **Graphile Worker** as the one queue/scheduler dependency. It is a portable MIT-licensed Node/Postgres queue with retries, delayed jobs, recurring schedules, backfill, job keys, and named queues. Version 0.18.0 shipped on 2026-09-08 and fixed a named-queue concurrency bug. Run Graphile Worker in the same persistent process/container fleet as the Playwright adapter or in a small companion worker. Use a named queue per Amazon account to serialize account mutations, while read-only jobs may use a separate bounded-concurrency lane. Keep the application `jobs` table as the user-visible ledger; Graphile's internal tables are delivery machinery and should not become the public job model.

This avoids Vercel-specific paid infrastructure and another workflow control plane. Escalate to **Temporal** only if the product grows into multi-user, high-consequence workflows that need durable signals, activity heartbeats, and richer workflow history. Vercel Workflows/Queues and Inngest are credible managed alternatives, but they are not recommended launch dependencies: Vercel Queues is beta and ties dispatch to Vercel; Inngest adds another hosted control plane and its self-hosted server license is SSPL/DOSP. Do not install several orchestrators “for optionality”; preserve portability through the application job interface and idempotent worker contract.

Do not replace `mcp-handler` with a raw transport solely to gain durable jobs or browser persistence. Those are application concerns. Use the raw SDK handler only if the implementation needs transport behavior that the adapter intentionally omits, such as custom HTTP integration, a non-Fetch runtime, or direct access to a newly released SDK feature before `mcp-handler` forwards it. Raw TypeScript SDK use does not currently solve the Tasks-extension gap.

## Current package and maintenance evidence

| Component | Verified state on 2026-09-20 | License and maintenance evidence | Architectural consequence |
| --- | --- | --- | --- |
| `mcp-handler` | Current package/repo version is **2.2.0**. It requires Node 20+, `@modelcontextprotocol/server ^2.0.0`, and Zod 4. The latest release was 2026-09-18; the repository also had a commit that day. The old `vercel/mcp-handler` URL redirects to `vercel-labs/mcp-handler`. | [Releases](https://github.com/vercel-labs/mcp-handler/releases), [package.json](https://github.com/vercel-labs/mcp-handler/blob/main/package.json), [changelog](https://github.com/vercel-labs/mcp-handler/blob/main/CHANGELOG.md); Apache-2.0. Recent 2.0–2.2 releases are stronger evidence than the “Labs” org name or old third-party activity claims. | Reasonable thin adapter to pin and test. It delegates MCP behavior to SDK v2 and creates a fresh server per request. |
| MCP TypeScript SDK | Split-package **v2.0.0 is the stable line**, released 2026-07-27 for protocol 2026-07-28. Main had a commit on 2026-09-16. The roadmap says conformance runs for 2025-11-25 and 2026-07-28. The monolithic v1 package remains on a limited maintenance window. | [Roadmap](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/ROADMAP.md), [releases](https://github.com/modelcontextprotocol/typescript-sdk/releases), [v2 docs](https://ts.sdk.modelcontextprotocol.io/v2/); MIT for the published server/client/core packages. | Build on the split v2 packages. Do not start new work on `@modelcontextprotocol/sdk` v1. |
| MCP specification | **2026-07-28 is final and current**. It makes the core stateless, replaces server-initiated requests with multi-round-trip results, and replaces the general HTTP GET listener with `subscriptions/listen`. | [Current specification](https://modelcontextprotocol.io/specification/2026-07-28), [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), [release post](https://blog.modelcontextprotocol.io/posts/2026-07-28/). | Design new behavior for the 2026 protocol and add explicit degradation for 2025-era clients. |
| Tasks extension | The separately versioned `io.modelcontextprotocol/tasks` specification is published on the official extensions site but is marked **Draft**. The TypeScript SDK roadmap tracks it as future extension work, and [issue #2189](https://github.com/modelcontextprotocol/typescript-sdk/issues/2189) remains open with no implementation PR. | [Tasks overview](https://tasks.extensions.modelcontextprotocol.io/), [Tasks specification](https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks), [SDK tracking issue](https://github.com/modelcontextprotocol/typescript-sdk/issues/2189). | Do not make MCP Tasks a launch dependency. Keep the application job contract capable of mapping to it later. |
| Graphile Worker | Current release is **0.18.0** from 2026-09-08. It is a Node/Postgres queue with retries/backoff, delayed execution, cron-like recurring schedules and optional backfill, job keys, and named queues for serial execution. Node 22 is now the minimum. | [Repository](https://github.com/graphile/worker), [releases](https://github.com/graphile/worker/releases), [library mode](https://worker.graphile.org/docs/library), [recurring tasks](https://worker.graphile.org/docs/cron); MIT. | Recommended initial queue/scheduler because Postgres is already authoritative and the worker is TypeScript. Pin the 0.x version, test schema migrations, and never read/write its private job tables directly. |
| Vercel Workflow SDK / service | Workflow SDK stable release is **4.8.9**; 5.0 is beta. Vercel Workflows persists steps, retries, sleeps, hooks, streams, and state across crashes/deployments. Vercel says its managed service executes steps as Vercel Functions and uses Vercel Queues underneath. | [Vercel Workflows](https://vercel.com/docs/workflows), [SDK repository](https://github.com/vercel/workflow), [releases](https://github.com/vercel/workflow/releases); SDK Apache-2.0. | Good control-plane orchestration, not a home for a persistent authenticated browser. A workflow step should call or signal the worker service and wait on durable state/hook. |
| Vercel Queues | Public **beta**, with durable topics, retries, delayed delivery, consumer groups, Poll Mode from any environment, and at-least-once delivery. | [Queues overview](https://vercel.com/docs/queues), [Poll Mode](https://vercel.com/docs/queues/poll-mode). | Useful bridge from Vercel to external workers, but beta status and duplicate delivery require a database ledger and idempotent consumers. |
| Temporal TypeScript | Current SDK release is **1.24.0**. Temporal provides durable workflows and activities executed by persistent workers. | [TypeScript SDK](https://github.com/temporalio/sdk-typescript), [releases](https://github.com/temporalio/sdk-typescript/releases), [Workflow execution](https://docs.temporal.io/workflow-execution); SDK MIT. | Strongest fit for a dedicated worker fleet and consequential workflows, with the highest infrastructure and operational complexity. |
| Inngest | Current server release is **1.45.1** from 2026-09-17. Functions provide persisted steps, retries, schedules, waits, flow control, and serverless or Connect-worker execution. | [Functions](https://www.inngest.com/docs/learn/inngest-functions), [deployment modes](https://www.inngest.com/docs/platform/deployment), [server releases](https://github.com/inngest/inngest/releases). SDKs are Apache-2.0; the self-hosted server/CLI use SSPL with delayed Apache-2.0 publication, as stated in the [repository](https://github.com/inngest/inngest#license). | Simpler managed option than Temporal; Connect can reach persistent workers. Confirm commercial, data residency, and license fit before selecting self-hosting. |

## `mcp-handler` versus the raw SDK

`mcp-handler` 2.2.0 is now a small wrapper around the official SDK’s `createMcpHandler`. Its current source constructs a new `McpServer` for every request and calls the SDK handler with `legacy: "stateless"`. It adds a Web-standard `(Request) => Promise<Response>` surface, auth wrappers and protected-resource metadata helpers, framework examples, event logging, a subscription limit, and an experimental WebMCP bridge. It does not provide a durable job engine or shared application state.

Its supported transport posture is explicit:

- Native MCP 2026-07-28 over stateless Streamable HTTP.
- Stateless fallback for 2025-era Streamable HTTP clients.
- No 2024-11-05 HTTP+SSE endpoints, Redis session store, or 2.x session configuration.
- GET/DELETE session operations for the 2025 fallback return 405.
- A fresh server instance per request; application state must live elsewhere.

The official v2 SDK itself already exposes a Web `createMcpHandler`, so using it directly is also legitimate. The adapter remains useful for its stable route/auth ergonomics and small surface. The cost is an extra version boundary. Pin both packages, run protocol conformance/integration tests, and make the server definition independent of the adapter so changing the outer handler is inexpensive.

## Protocol and client support matrix

| Capability | Protocol / SDK status | `mcp-handler` 2.2 status | Client and deployment caveat |
| --- | --- | --- | --- |
| Streamable HTTP | Supported by MCP 2026-07-28 and SDK v2. Each request carries protocol/client metadata; there is no initialize session. | Supported natively. | Verify the target host accepts remote Streamable HTTP and negotiates 2026-07-28. Do not infer this from general “MCP support.” |
| 2025 compatibility | SDK v2 includes a legacy compatibility path. | Stateless fallback only. | Discovery and ordinary calls can work. Features requiring a live 2025 server-to-client request path, including legacy push elicitation/sampling, do not have a return path in the stateless fallback and must fail or degrade. Test each promised host. |
| Tool schemas and structured output | Tools support full JSON Schema 2020-12. `outputSchema` may have any JSON root in 2026, and `structuredContent` may be any conforming JSON value. SDK v2 validates registered Standard Schemas and returned structured data. | Inherited from SDK v2. | For 2025 compatibility, prefer an object-root output such as `{ items: [...] }`. Always include concise text/content fallback because clients vary in how they render or expose structured output. See [tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) and [SDK tool docs](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools). |
| Resources and resource templates | Supported. Resources can expose bounded job, product, order, invoice, or event-inbox state; tools may return resource links or embedded resources. | Inherited from SDK v2. | A client may ignore, hide, or not subscribe to resources. Treat resource URIs as an enhancement over ordinary `get_*` tools, not the only retrieval path. See [resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources). |
| Form and URL elicitation / approvals | In 2026 the server returns `resultType: "input_required"` with embedded requests; the client obtains user input and retries the original request with `inputResponses` and opaque `requestState`. SDK v2 provides `inputRequired`, typed response readers, request-state sealing, and a bounded round count. | Inherited from SDK v2 for 2026 clients. | The client must advertise and implement the required elicitation mode. Form mode must not collect secrets; URL mode is for sensitive/out-of-band flows. A decline/cancel is a normal outcome. See [MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr) and [elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation). |
| Consequential user approval | MCP defines consent principles and can carry an elicitation, but the shopping service must enforce its own approval invariant. | No separate transaction-approval store. | Bind approval to user, exact cart/offer/seller/quantity/recurrence, total/currency, destination label, masked payment, expiry, and operation ID. Re-check immediately before submission. If any material term changes, require new approval. Do not rely only on a tool annotation or on the host having shown a generic confirmation. |
| Progress | Request-scoped `notifications/progress` is supported when the client supplied a progress token. | Inherited while the response stream is open. | Progress is not a durable job feed. It is lost when the stream/request ends and cannot wake a disconnected client. See [progress](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress). |
| Logging notifications | Request-scoped logging remains available under 2026 rules when the request asks for a log level. | Inherited while the request stream is open. | Use OpenTelemetry/application logs for operations. MCP logging is not an alert channel or durable audit trail. |
| Change notifications | 2026 defines client-opened `subscriptions/listen` streams for tool/prompt/resource list changes and selected resource updates. SDK v2 exposes a notifier and in-memory event bus. | Supported; `maxSubscriptions` can bound/disable streams. | The client must open and keep the stream. Multi-process/serverless deployments need a shared `ServerEventBus`; the default bus is process-local. A broken stream has no replay and the client must subscribe again. Vercel function lifetime and intermediary limits make this an optimization, not the only watch-delivery mechanism. See [subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions) and [SDK notifications](https://ts.sdk.modelcontextprotocol.io/v2/servers/notifications). |
| Tasks / asynchronous tool result | The new Tasks extension defines `tasks/get`, `tasks/update`, and `tasks/cancel`; the client polls. It is opt-in per request and not part of the core protocol. | Not available through the current TypeScript SDK dependency. | Current TS SDK support is unverified because it is explicitly still tracked as unimplemented. The old experimental 2025 Tasks vocabulary is not a substitute and SDK v2 says it does not serve that component. |
| Cancellation | Core cancellation can cancel an in-flight request; the Tasks draft has task cancellation. | Core behavior inherited. | Cancellation of an HTTP request is not proof that an Amazon side effect stopped. Application jobs need their own cancel state and workers must reconcile any action that may already have reached Amazon. |
| Transport sessions and stream replay | The 2026 core is stateless and removes session IDs, SSE event IDs, `Last-Event-ID` replay, and message redelivery. A broken in-flight response is retried as a new request with a new ID. | Stateless by design. | Keep Amazon browser identity, job state, idempotency, and approval state outside MCP. Repeated tool calls must safely return the existing operation or reconcile it. See [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http). |

## Authentication boundary

Treat the MCP server as an OAuth resource server and Amazon as a separate third-party account connection.

For MCP caller authentication, `mcp-handler`’s [`withMcpAuth`](https://github.com/vercel-labs/mcp-handler/blob/main/docs/AUTHORIZATION.md) can verify bearer tokens, return RFC 9728 `WWW-Authenticate` challenges, and expose verified auth context to handlers. Its `protectedResourceHandler` publishes Protected Resource Metadata identifying the authorization server. It does **not** operate an authorization server, issue tokens, implement the login/consent UI, or add CIMD support to the authorization server. MCP 2026-07-28 deprecates Dynamic Client Registration in favor of Client ID Metadata Documents when the authorization server advertises support. The selected identity provider must supply correct issuer metadata, client registration behavior, token audience/resource restriction, scopes, refresh policy, and revocation. Validate issuer, audience/resource, expiry, signature, and scopes; never pass the MCP bearer token through to Amazon.

For Amazon authentication, the worker owns the browser profile and third-party session. The MCP/database identity maps to exactly one authorized worker profile or tenant-scoped set of profiles. The model never receives Amazon cookies, passwords, OTPs, CVV, full payment data, or raw profile archives. Login expiry, MFA, CAPTCHA, and sensitive account repair produce a short-lived HTTPS handoff bound to the same user and operation. URL elicitation may present that handoff to a supporting client, but the handoff must also be retrievable from job state because client elicitation support is not universal.

## Durable job shape

Use an application contract that can later adapt to MCP Tasks without making it protocol-dependent:

```text
Job {
  id, ownerId, kind, status,
  operationId, idempotencyKey,
  createdAt, updatedAt, expiresAt,
  inputDigest, approvalDigest?,
  attempt, workerLease?, heartbeatAt?,
  progress { current?, total?, message? },
  inputRequest?, result?, error?,
  statusResourceUri, revision
}
```

Recommended statuses are `queued`, `working`, `input_required`, `succeeded`, `failed`, `cancel_requested`, `cancelled`, and `outcome_unknown`. Persist only masked/minimized data. A worker lease is recoverable, not ownership of the job forever. The database transition and outbox/queue publication should be atomic or use a transactional outbox. Every worker result update uses compare-and-swap on the job revision.

Useful MCP surfaces:

- `start_*` tools return `{ jobId, status, statusResourceUri }` quickly.
- `get_job` and `cancel_job` work on owner-scoped IDs.
- `answer_job_input` submits a durable approval or handoff completion when the active client cannot drive MRTR.
- `amazon://jobs/{jobId}` exposes the same bounded state as a resource.
- `amazon://events` is the durable MCP-readable notification inbox.
- Resource update subscriptions advertise changes only as a latency optimization.

Do not keep an MCP HTTP request open for minutes while a worker browses. A short read-only browser call may stream progress if it fits deployment limits, but the durable job path should still exist for recovery.

## Can the server proactively prompt the user when shipping changes?

No general MCP mechanism can wake a closed client, start a new assistant turn, or display an arbitrary notification.

Under MCP 2026-07-28:

- Elicitation is part of a client-initiated tool/prompt/resource interaction. The server returns `input_required`; the client decides whether and how to ask the user, then retries. It is not a background push channel.
- Progress and log notifications are tied to the response stream of the request that caused them.
- `subscriptions/listen` is opened by the client and carries only the change-notification families it requested. A server may announce an updated subscribed resource or changed tool/resource list while that stream remains active. This does not guarantee a visible user alert and cannot reach a disconnected client.
- Tasks are polled by clients and, in this stack, are not yet implemented by the TypeScript SDK anyway.

Therefore a shipping change should be written to the event inbox and, if configured by the user, delivered through an explicit out-of-band channel such as Web Push, a local desktop notification, email, or another approved integration. The MCP client can read those events on its next call. Describe active-stream notifications as best effort and client-dependent; never claim autonomous MCP wakeups.

## Verification still required before implementation

The following remain unverified until the target product choices are made:

1. Which MCP clients negotiate 2026-07-28, render `structuredContent`, support resources and `subscriptions/listen`, and correctly drive form/URL MRTR.
2. Whether those clients surface resource updates to the user or merely refresh internal metadata.
3. Vercel production behavior for the required subscription duration, concurrency, and shared event bus.
4. The chosen authorization server’s CIMD, issuer, resource/audience, refresh, and scope behavior with each target client.
5. Whether the selected Postgres provider and Graphile Worker process meet wake-up latency, connection, backup, migration, retention, and always-on requirements for local and hosted operation.
6. Browser worker hosting choice, encrypted profile portability, session renewal, Amazon concurrency limits, and recovery after the local Mac or hosted worker is lost.

Pin exact versions only after a small compatibility harness proves tool discovery, typed output, resource reads, one elicitation accept/decline path, disconnect/retry behavior, auth challenge/discovery, job polling, and duplicate mutation delivery against every launch client. For Graphile Worker, also prove named-queue serialization, stale-lock recovery, schedule backfill policy, graceful shutdown, and schema-upgrade procedure before allowing transactional Amazon actions.
