# Amazon consumer MCP: agent handoff

## Objective and current state

Build an MCP server for one personal **Amazon.com** account, covering product research, carts, checkout, orders, returns, Subscribe & Save and monitoring. Design for additional regions later. Prefer maintained open-source dependencies; paid integrations remain optional.

**As of 2026-09-21: proposal only.** The repository contains requirements, architecture, research, 53 proposed tools and 49 implementation slices. No application, deployment or live Amazon verification exists. This handoff does not authorize test purchases or other real account commitments.

## Architecture decisions

- TypeScript/pnpm; **Vercel `mcp-handler` + official MCP TypeScript SDK** for the HTTP gateway.
- **Persistent Playwright worker**, separate from serverless requests, with a dedicated Amazon profile.
- **Postgres + Graphile Worker** for durable operations, scheduling and event delivery.
- Transport-independent domain services and replaceable providers; explicit capabilities, schemas, pagination, provenance, freshness and missing-data reporting.
- Recommend local feasibility first. Keep local, hosted and hybrid deployments possible; the user has not chosen one. Local browser monitoring pauses when the Mac is offline.
- Free history means permitted observations from collection onward. **Keepa is optional** for earlier history. **Creators API stays disabled by default**; affiliate eligibility and usage restrictions make it a poor personal-account default.

Research dated 2026-09-20 found no general consumer API covering the requested account actions. Browser flows remain conditional on access requirements and demonstrated reliability. Revalidate dependency versions, provider terms and target-client compatibility before implementation; do not treat old examples or repository claims as verified capabilities.

## Execution ownership

Use **one Astra High manager** and **two Medium workers concurrently**; architect + manager + workers fits the known four-agent limit. Recheck available concurrency before dispatch.

The architect reviews the final integrated candidate. The manager owns shared contracts, dependencies/lockfile, migrations, auth policy, tool registry, integration and the capability ledger. Workers get isolated `codex/<lane>-<slice>` worktrees and bounded feature paths. Shared changes require manager acceptance.

For every slice: assign behavior/contracts/acceptance criteria → worker implements and supplies evidence → manager reviews → same worker fixes defects until accepted → manager integrates into local mainline and verifies combined behavior. Remote publishing/deployment is not part of this documentation handoff.

## Sequenced roadmap

| Phase / detailed slice IDs | Deliverables | Exit evidence |
| --- | --- | --- |
| **0. Feasibility — F01–F06** | Scaffold/contracts; MCP client compatibility; dedicated browser access; product/offer/seller, cart and order reads; queue/crash spike | Document acceptable access path, actual page coverage and client support. Demonstrate durable jobs with fake effects. Resolve deployment direction |
| **1. Foundations — I01–I06** | Caller auth, owner review UI, browser actor/handoff, operation journal, outbox, scheduler, fixture harness and registry | Ownership isolation, restart/cancellation recovery, consent and duplicate-request invariants pass |
| **2. Read surface — D01–D03, O01–O02, R01–R02, A01–A04** | Search/categories; products/variants/media/related/comparison; offers/sellers/reviews; order history/documents/tracking; subscription inventory | Product-to-offer comparison and order-to-shipment workflows match observed source state; incomplete coverage labelled |
| **3. Prices and carts — P01–P03, C01–C03** | Observed price history, sale events/deals/coupons; cart/saved items, add/remove/quantity/save/restore/purchase mode | Correct variant/seller/line identity; stale edits, duplicate calls, quantity limits and lost responses handled |
| **4. Transactions — X01–X03, Q01–Q02, T01–T02, S01–S02, V01** | Checkout/payment/address/speed selection; order cancellation/eligible edits/buy-again; returns/replacements/refunds; subscription changes/enrollment; review drafts/handoff | Exact-intent authorization, verified postconditions and uncertainty recovery; real mutations only within actual user authorization |
| **5. Monitoring — N01–N04; optional E01–E02** | Shipment/price/restock/return/refund/subscription watches, inbox and configured notification channel; optional provider adapters | Restart-safe scheduling, occurrence-aware dedupe, offline gaps and verified channel delivery. Ship read-based watches before return actions if ready |
| **6. Delivery — Z01–Z04** | Local packaging/runbook; hosted/hybrid only if selected; integrated review and fixes | Relevant checks pass; capability ledger, dependency evidence, limitations and deployment state delivered to architect |

Run independent domain lanes in parallel after shared contracts land. If a provider/account path is blocked, report that specific limitation and continue independent work; do not claim a handoff or stub implements the requested automation.

## Invariants that must survive implementation

1. **No blind transaction retries.** An immutable intent consumes single-use consent into exactly one operation, across all idempotency keys. Consent comes from the authenticated owner UI or a verified host integration, never a model assertion. Bind account/session, item/variant/seller/quantity, totals, recurrence, address/payment references and delivery terms. Refresh changed terms.
2. **Unknown outcome is durable.** Reconcile using provider identifiers and observed state; missing order history is not proof of failure. Quarantine writes after ambiguous consequential dispatch. Include replacement orders, contingent return charges and compound partial outcomes.
3. **One browser owner per account.** Database leases cannot fence Amazon. Stop the old runtime before reassignment; suspend automation during human handoff and revalidate afterward.
4. **Protect private state.** Separate MCP identity from Amazon authentication; scope handles/caches to owner and delivery context. Keep credentials/payment secrets out of tools and logs; disable sensitive-page recording. User completes authentication in Amazon UI.
5. **Respect actual access boundaries.** No stealth, CAPTCHA bypass or private-endpoint dependency. Browser functionality and observation retention require a suitable source/access basis.
6. **Report evidence honestly.** Track implemented, fixture-verified, live-read-verified and authorized-live-mutation-verified separately. Simulations do not establish live checkout support. Ordinary CI never purchases, cancels, returns or subscribes.
7. **Notifications need a channel.** MCP cannot guarantee waking a closed client. Persist events; use explicitly configured desktop/Web Push delivery. Keep paid providers optional and bounded.

## Reference documents and first action

Use [workstreams](docs/workstreams.md) for exact slice ownership/dependencies, [tool catalogue](docs/tool-catalog.md) for proposed contracts, [architecture](docs/architecture.md) for state/recovery design, [requirements](docs/requirements.md) for full coverage, and [research](docs/research/) for dated primary-source evidence.

When implementation is requested: inspect current repo state, read phase 0 and the relevant research, establish the shared baseline, then dispatch the MCP/queue and browser-feasibility lanes. Resolve the target MCP client and local-versus-hosted choice without assuming the entire browser surface is already feasible.
