# Execution plan and agent ownership

> Design target. For implemented coverage and current runtime evidence, see [capability ledger](capabilities.md) and [implementation status](IMPLEMENTATION.md).

Proposal, 2026-09-20. This document sequences implementation after review of the proposal. No implementation agents have been launched. Research agents and a High-level design reviewer have only prepared/reviewed documents.

## Team and integration model

Use one **GPT-6 Astra High manager** (`gpt-6-astra`, high) and **GPT-5.6 Sol Medium workers** (`gpt-5.6-sol`, medium), or equivalent available models. This follows the requested architect → manager → worker structure.

The architect defines requirements/contracts and performs final integrated review. Once implementation starts, the architect waits for the manager's final candidate and answers only material scope questions. The manager owns decomposition, dispatch, cross-lane coordination, review/fix loops, tests, integration and the capability ledger. Workers implement bounded feature slices and return evidence. A worker cannot approve or merge its own slice.

The current environment permits **four concurrent agents total**: architect + High manager + two Medium workers. Therefore run at most two worker lanes at once. More workstreams exist than workers; the manager keeps a ready queue and moves workers to the next unblocked slice. Do not spawn an extra permanent reviewer; the High manager reviews completed work while the other Medium worker continues.

## Rules for parallel work

1. Manager first lands the shared skeleton/contracts and establishes an integration baseline.
2. Each slice gets a branch/worktree named `codex/<lane>-<slice>`, a base commit, explicitly owned paths, inputs/outputs and acceptance checks. Workers never share a mutable browser profile for live verification.
3. The manager exclusively owns root dependency manifests/lockfile, MCP registry, shared contracts, database migrations, auth policy, capability ledger and integration wiring. Workers request changes through a small contract proposal.
4. Each provider domain owns its extractors, service implementation and fixtures under the paths in the architecture document. It depends on shared runtime interfaces, not another lane's page internals.
5. Fixtures are domain-owned and redacted. Shared fixture helpers belong to the manager; no worker copies real cookies, addresses, cards or raw order pages into tests.
6. Live browser checks are serialized through a test-account lease and executed only within the actual authorized account-action scope. Ordinary CI is offline and cannot buy, cancel, return or subscribe.
7. Merge only after the review/fix loop passes. The manager integrates into the local mainline itself, reruns relevant integration checks and updates dependent bases. Remote publishing/deployment is a separate delivery decision; this plan does not create a remote or deploy now.

## Review/fix loop

For each slice the manager supplies: user-visible behavior, owned files, contract versions, excluded scope, fixture examples, acceptance criteria, dependency baseline and evidence format. Workers return a compact diff summary, tests run, remaining unsupported cases and any contract request.

The manager verifies behavior against requirements and existing code, checks input/ownership boundaries and postconditions, and sends concrete defects back to the same worker. The worker fixes and re-runs targeted checks; this repeats until acceptable. The manager then integrates and verifies the combined behavior. Reassign the worker only after the manager accepts or explicitly parks the slice with a reason.

A green fixture test alone is insufficient to call an Amazon capability live-verified. Record four distinct states: implemented, fixture-verified, live-read-verified, and authorized-live-mutation-verified. Record unavailable/blocked functionality honestly. Broad claims such as "checkout complete" require all relevant states and failure paths, not just tool registration.

## Stage 0: feasibility and shared contracts

| Slice | Owner/path | Deliverable and acceptance | Dependencies |
| --- | --- | --- | --- |
| F01 Workspace and dependency baseline | Manager: root, package layout | Pin current maintained packages/licenses; scripts for typecheck/test/build; clean startup; no secrets in repo | Proposal reviewed |
| F02 Domain and result contracts | Manager: `contracts`, provider ports | Identifiers, money, provenance, pagination, capabilities, typed errors, intent/operation and partial outcomes; schema examples compile | F01 |
| F03 MCP interoperability spike | Medium A: test harness; manager integrates gateway | Current handler/SDK with tool discovery, auth challenge, structured output, resource read, pending operation and legacy-client fallback; test chosen launch client(s) | F01–F02 |
| F04 Browser access and extraction spike | Medium B: browser proof fixtures | Dedicated profile, transparent supported automation, sign-in handoff; observe one product, offer, seller, cart and completed order where accessible; record challenges and source/access constraints | F02; actual account access authorized |
| F05 Queue and crash-recovery spike | Medium A: store/worker proof; manager owns migrations | Graphile named-queue serialization, durable jobs, restart, dead worker and scheduler behavior; replay cannot duplicate a fake external effect | F01–F02 |
| F06 Integration provider decisions | Manager | Record actual browser feasibility, optional API eligibility, source retention, client support and local/hosted decision; lock manifest | F03–F05 |

**Gate A:** If the necessary Amazon account pages are inaccessible or their access requirements cannot be met, report the specific unavailable flows and revise their delivery mode. Do not build a large transactional stack on an assumed private API or treat CAPTCHA workarounds as feasibility. Read-only handoff may be the appropriate supported outcome for some paths.

## Stage 1: reusable infrastructure

| Slice | Owner/path | Deliverable and acceptance | Dependencies |
| --- | --- | --- | --- |
| I01 Auth, scopes and owner UI | Medium A: gateway auth/UI; manager policy | Caller identity separated from Amazon; protected resources; owner-only exact-intent approval; expiry/revocation/cross-owner tests | Gate A, F03 |
| I02 Browser lifecycle and account actor | Medium B: `browser-runtime` | Dedicated profile; expected-page/wrong-account/challenge checks; single owner actor, handoff pause, stale-worker quiescence and quarantine | Gate A, F04 |
| I03 Operation journal and outbox | Manager: `store`, core operations | Atomic intent → one operation; idempotency conflict; single-use consent; event/job atomicity; unknown-outcome freeze and reconciliation interfaces | F05, I01 contracts |
| I04 Worker, jobs and scheduler | Medium A: `apps/worker` | Bounded job dispatch, heartbeat, cancellation, restart, stale job recovery, notification retry separation; no browser side effect in automatic replay | I02–I03 |
| I05 Provider/fixture harness | Medium B: isolated `testing` harness branch; manager accepts shared helpers | Draft validated extraction/redaction harness and page-state fixtures against frozen interfaces; manager owns acceptance of shared helpers/contracts | I02, F02 |
| I06 Gateway registry and operation tools | Manager | Fixed profile registry, schema/auth wrappers, capability/status/cancel/resume resources and tools; text fallback | I01–I05 |

The manager may integrate I03 while two workers are occupied. Its work is limited to shared foundations and integration, preserving feature implementation for the Medium workers.

## Stage 2: shopping research and account reading

These lanes are independently useful and may run in parallel, two slices at a time.

| Slice | Owner/path | Deliverable and acceptance | Dependencies |
| --- | --- | --- | --- |
| D01 Search and category browsing | Medium: `amazon-web/discovery` | Query/facets/sort/cursors, sponsored rank, allowed URL normalization; unsupported filters explicit | I05–I06 |
| D02 Product and variant details | Medium: `discovery` | Exact child ASIN, attributes/specs, variant matrix, missing fields, product media metadata; parent/child fixture cases | D01 |
| D03 Related products and comparison | Medium: `discovery` | Source-labelled relations, unit-price and delivered-cost comparison, unknown values; no mixed variants/currencies | D02; offers contract |
| O01 Offer enumeration and delivery/return terms | Medium: `amazon-web/offers` | Paginated seller offers; item/shipping costs and condition/fulfilment/membership context; partial coverage reported | I05–I06, D02 schema |
| O02 Seller profiles and feedback | Medium: `offers` | Public profile, separate rating periods/counts, feedback pagination and policies; no missing-to-zero conversion | O01 |
| R01 Reviews and rating distributions | Medium: `amazon-web/reviews` | Supported filters/sort/pages, pooled variants, aggregate-versus-retrieved counts, partial/restricted pages | D02 |
| R02 Customer media and documents | Medium: `reviews` | Customer image/video metadata, variant relation and product-document links; fetch/redirect protection | R01, I01 |
| A01 Order history and detail | Medium: `amazon-web/orders` | Date/query/cursor history, per-line money/status, split packages/refunds/replacements; exact account isolation | I05–I06 |
| A02 Order documents and private artifacts | Medium: `orders` | Receipt/invoice availability and authenticated retrieval, expiry/redaction/deletion; no public artifact leak | A01, I01 |
| A03 Shipping and tracking | Medium: `orders` | Package/line mapping, event timeline, changing ETA, proof availability, stale observations and partial delivery | A01 |
| A04 Subscription inventory | Medium: `amazon-web/subscriptions` | Read recurring items, frequency/next date/cutoff/price estimates, available actions, unavailable states | I05–I06 |

**Gate B:** Demonstrate search → exact variant → offers → seller/returns comparison, and orders → split shipment → tracking. Validate against visible source state and produce a capability report. Review bodies/seller data must be labelled partial where access limits apply.

## Stage 3: deals, history and cart

| Slice | Owner/path | Deliverable and acceptance | Dependencies |
| --- | --- | --- | --- |
| P01 Free observed-price history | Medium: core history + owned provider observer | Store permitted timestamped observations, source/context, gaps and series type; no fabricated backfill or Creator-content archive | D02, O01, I03 |
| P02 Sale-event and deals discovery | Medium: `amazon-web/deals` | Visible events/sections/items, start/end/timezone where known, pagination, Prime/claim state and official-versus-derived deals | D01–D02 |
| P03 Coupons and promotion conditions | Medium: `deals` | Read requirements/expiry; explicit clip action; verified clip state; discount stacking never assumed | P02, I03–I04 |
| C01 Cart/saved-item snapshots | Medium: `amazon-web/cart` | Line identity, selected state, seller/variant/mode, totals/warnings, revision and saved pagination | I05–I06, O01 |
| C02 Add/set quantity/remove | Medium: `cart` | Exact offer mutations with absolute quantity, stale revision detection, postcondition read and lost-response recovery | C01, I03–I04 |
| C03 Save/restore and purchase mode | Medium: `cart` | Verify moves; expose changed offers; subscription mode never creates a commitment implicitly | C02, A04 |

**Gate C:** Authorized reversible cart scenarios pass, including duplicate request, user edit, unavailable quantity, same ASIN/different seller and response loss. Restore test cart state where authorized. Cart correctness is a prerequisite for checkout.

## Stage 4: consequential account flows

| Slice | Owner/path | Deliverable and acceptance | Dependencies |
| --- | --- | --- | --- |
| X01 Checkout start/options | Medium: `amazon-web/checkout` | Explicit lines, saved masked address/payment, shipping groups/speeds, gifts/balance/promotions and updated totals | Gate C, I01–I04 |
| X02 Immutable checkout intent | Medium: `checkout` | Exact terms and expiry, source refresh, authorization binding, material-change rejection; owner UI contract | X01, I03 |
| X03 Submit and reconcile | Medium: `checkout` | Single-use intent across all keys; order IDs verified; split/compound partial outcomes; uncertain effects freeze writes; crash-after-click cases | X02, A01–A03 |
| Q01 Order cancellation and eligible edits | Medium: `orders` | Discover actions, typed prepare/submit, exact lines, requested-vs-confirmed cancellation, no retry after uncertain side effect | A01, I03, X02 consent contract |
| Q02 Buy-again proposal | Medium: `orders` | Historical item resolves to current variant/offer; user-visible difference; cart proposal and current price | D02, O01, C02, A01 |
| T01 Return/replacement options and preparation | Medium: `amazon-web/returns` | Per-line eligibility/deadline, user reason, quantities, fees/logistics, replacement order and contingent missed-return charge | A01, I03 |
| T02 Return submission and lifecycle | Medium: `returns` | Verified authorization and any replacement order, private labels/QR, refund stages, partial/unknown recovery | T01, A02–A03, X02 consent contract |
| S01 Subscription changes | Medium: `subscriptions` | Prepare/submit supported quantity/frequency/skip/pause/resume/cancel; actual available actions only | A04, I03, X02 consent contract |
| S02 Enrollment and immediate-order coupling | Medium: `subscriptions` | Enrollment joins checkout if first charge/order occurs; verifies both recurring and order state | S01, X03, C03 |
| V01 Review and contact options | Medium: `reviews` + isolated handoff module | Eligibility, exact destinations, draft from user facts, preview/handoff; no unsolicited publishing or messaging | R01, A01, I01 |

**Gate D:** Execute fixture failure scenarios for every consequential action. Live mutation verification requires the user to request a real purchase/return/etc.; if that has not happened, report the feature as implemented and simulated with live transaction verification pending. Never create purchases or returns solely to make a green test report.

## Stage 5: monitoring and optional integrations

| Slice | Owner/path | Deliverable and acceptance | Dependencies |
| --- | --- | --- | --- |
| N01 Watch configuration and scheduler | Medium: `notifications` | Typed subjects, cadence/budgets, timezone/quiet hours, pause/delete/expiry; worker offline/backfill behavior | I03–I04, A03, P01 |
| N02 Change detection and event inbox | Medium: `notifications` | Shipment/ETA/price/restock/subscription events first; occurrence-aware dedupe, replay and acknowledgement; add return/refund sources when ready | N01, A04; T02 only for return/refund integration |
| N03 Notification channels | Medium: `notifications/channels` | Local desktop and/or Web Push behind selected deployment; explicit channel enrollment, delivery retries and quiet hours | N02, I01; channel choice |
| N04 Optional connected-client updates | Medium: gateway notification adapter | Shared event bus if needed, actual host subscription test; event inbox remains canonical; no claim of app wakeup | N02, F03 |
| E01 Optional Keepa adapter | Medium: `providers/keepa` | Typed documented API, token budget/redaction, series decoding, historical/current offer distinction, missing coverage | F02, P01; paid plan explicitly enabled |
| E02 Optional Creators adapter | Medium: `providers/creators` | Official maintained SDK/HTTP client, eligibility/use fit, source retention/linking/notices, feature contract tests | F06; actual permitted use established |

E01/E02 are optional tracks, not core release dependencies. No API purchase, affiliate enrollment or request for remote credentials occurs merely because a slice exists. European portability is a future region-specific connector and is out of the Amazon.com first release.

## Stage 6: integrated delivery

| Slice | Owner/path | Deliverable and acceptance | Dependencies |
| --- | --- | --- | --- |
| Z01 Local packaging and recovery | Medium: startup/config/docs | Reproducible local gateway/worker/database, secret setup, profile repair, backup/delete, restart and sleep recovery | Implemented core stages |
| Z02 Hosted/hybrid profile | Medium: deployment config/docs | Only if selected: persistent worker and DB, secured remote gateway, handoff, profile custody, liveness and actual running-cost estimate | Deployment decision, Z01 |
| Z03 Integrated security/reliability review | Manager with Medium fixes | Ownership/context caches, prompt injection/SSRF, recording disabled on sensitive pages, stale runtime, reused consent, uncertain effects and notification misdelivery checked | All selected lanes |
| Z04 Final acceptance and handoff | Manager → architect | End-to-end demos, actual test output, dependency manifest, feature coverage/gaps, runbook, deployment state; architect reviews final candidate | Z03 |

The manager is responsible for integrating every accepted slice. The architect reviews the finished candidate for architectural adherence and remaining material defects, returns any to the manager for the same worker-fix loop, and reports the verified delivery state to the user.

## Example two-worker schedule

| Wave | Worker A | Worker B | Manager |
| --- | --- | --- | --- |
| Foundation | Protocol/auth | Browser feasibility/runtime | Contracts, dependency decisions, journal |
| Read surface | Discovery/products | Orders/shipments | Integration and reviews |
| Enrichment | Offers/sellers, then reviews | Deals/history, then subscription reads | Registry, capability ledger |
| Cart/checkout | Cart → checkout | Returns/options → order actions | Consent/recovery review and integration |
| Account actions | Checkout recovery → enrollment | Returns lifecycle → subscription changes | Cross-flow tests, defect routing |
| Monitoring | Watches/events | Channels, packaging | Selected optional adapters queued by priority |
| Final | Fixes from manager | Fixes from manager | Integrate, verify, submit to architect |

This is dependency-driven rather than a calendar promise. The manager may reorder independent slices when one lane waits on external account/provider access. Do not claim that additional workers can make unsupported Amazon APIs exist.

## Definition of a reviewable final candidate

- Core implemented features work against the selected account/deployment within their reported coverage.
- All shared schemas and packages agree; no abandoned stub is advertised as implemented.
- Typecheck/build and relevant contract/browser/operation tests pass. Live verification is labelled accurately.
- Every mutation has verified postconditions or a durable uncertainty state that blocks unsafe retries.
- Maintained dependency versions/licenses and optional service costs are recorded with dates.
- No raw secrets/private account fixtures are committed; local/private data can be revoked/deleted.
- The README explains setup, supported clients, worker uptime, payment/authentication handoff and actual notification limits.
- Final report lists deployed versus local-only state, unsupported/untested features and the next concrete action, without disguising simulation as production evidence.
