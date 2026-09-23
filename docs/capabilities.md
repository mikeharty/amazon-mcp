# Capability ledger

2026-09-22. This is the implementation ledger; the original tool catalogue and workstreams describe a larger target. **Implemented** means runnable code; **fixture verified** means deterministic synthetic/provider tests; neither means Amazon permits access or the current account layout works.

| Area | Implemented surface | Evidence and remaining gap |
| --- | --- | --- |
| MCP | Typed tools, owner-scoped resource, Streamable HTTP, local bearer token, body/Host/Origin limits | Actual official SDK client tests for native 2026 and legacy 2025; no target desktop UI verification or hosted OAuth |
| Durability | Postgres journal/encryption; transactional Graphile enqueue; per-account queue; cancellation; single-use owner consent; uncertain-write quarantine | Real Postgres/Graphile crash/redelivery/rollback/concurrency tests; consent uses fake external effects, not a live purchase adapter |
| Account/runtime | Dedicated persistent Chromium profile; exclusive ownership lock; serialized actor; human authentication pause/revalidation; disconnect, reconnect, private-record deletion | Runtime fixture tests; interactive login launched, account readiness not yet confirmed. No normal-profile import or lock stealing |
| Product discovery | Search, categories, detail, visible variants, related links, media | Browser fixtures plus one logged-out search/product smoke; no claim of full facets, all variations, downloadable manuals/video content or complete pagination |
| Buying research | Visible offers, sellers and feedback, product reviews; caller-observation unit/delivered-price comparison | Browser fixtures and monetary tests; destination-specific delivery, all offer conditions and complete review datasets not established |
| Deals | Visible deal cards and displayed pricing/discount text | Browser fixtures; no automatic coupon clipping, eligibility calculation, promotion application or complete sale-event coverage |
| Cart | Read; add, set quantity, remove, save/restore | Fixture actions with explicit identity/quantity/mode/location evidence checked before any effect, plus revision/postcondition checks; no live cart mutation. Unsupported or ambiguous layout fails conservatively; line selection and subscription enrollment not implemented |
| Checkout | Read a recognized review page and compare its snapshot revision | Read-only preview; cannot authorize/submit purchase. Address/payment/speed/gift/promotion selection, complete totals and executable purchase adapter absent |
| Orders/tracking | Visible order history/details, shipment fields, document availability labels | Browser fixtures; no authenticated account verification, private document download/invoice storage or carrier API integration |
| Returns/replacements | Internal validation of trusted observed proposal terms including fees and contingent charges | Simulated domain tests only; no live eligibility/options reader, return submission, labels/QR, replacement order or refund-progress adapter |
| Order changes/buy again | Internal trusted-option proposal validation and current/prior offer comparison | Simulated domain tests only; no live cancel/edit/reorder adapter |
| Subscriptions | Visible inventory; internal trusted-option change proposal rules | Fixtures only; no live enrollment, skip/pause/resume/cancel/frequency/date execution or immediate subscription order |
| Reviews/feedback | Visible review/feedback extraction; exact user-text draft helper | Does not generate a claimed purchase experience or submit/publish/contact anyone; `content_draft` returns supplied text and an owner handoff, with eligibility explicitly unverified |
| Price history | Opt-in own observations; optional disabled Keepa history/seller provider | Encrypted retained-data tests verify restart continuity and owner isolation; source/session/delivery provenance stays attached to individual points, with unverified contexts never treated as one quote. Keepa response fixtures; no backfill without dataset, no paid API call performed, no Creators adapter |
| Monitoring | Product/offer/order/shipment/subscription observation jobs; USD product-price threshold crossings; persisted baseline; occurrence-aware inbox; ack/pause/delete | Real database/queue tests; incomplete required fields suppress observations. Optional macOS desktop adapter and durable delivery outbox tested with fake delivery; actual OS display unverified. No return/refund watch, Web Push/email or guaranteed closed-client wakeup |
| Packaging | Local install/config/migrations/build/run scripts, Docker Compose Postgres, SDK smoke | Local Mac runtime; no remote deployment, push or remote repository created |

## Transaction and privacy boundaries

- The application exposes cart mutations only. It does not expose checkout submission, cancellation, return or subscription commit tools.
- Consent internals consume one immutable owner-approved intent into one durable operation even under different idempotency keys. The owner token is separate from the MCP bearer token. This core is ready for a future independently verified commit adapter; it is not proof such an adapter exists.
- `outcome_unknown` is persisted and quarantines later writes. There is no automated clearing or replay; operator reconciliation must establish observed external state. Data deletion cannot erase unresolved effects.
- Browser ownership locks never automatically expire. Quiesce the old process and its browser before operator lock recovery. Database leases alone do not fence a browser.
- Private payloads use AES-256-GCM at rest with owner-associated data. Local browser cookies remain browser-profile files. General disk encryption/backups/key rotation and a remote multi-user security model are outside this local release.
- Results and logs avoid raw login/payment credentials. Product and account page text remains untrusted data, never an instruction to execute a tool.
- A restarted process resets optional Keepa local usage caps. Caps reserve estimated cost before dispatch and reconcile upward; they are not an account-wide billing limit.

## Evidence

See [implementation status](IMPLEMENTATION.md), [transport evidence](evidence/transport.md), [browser evidence](evidence/browser.md), and test files. Final acceptance corrections passed 69 tests, typecheck/build and full dependency audit; compiled runtime smoke discovered 35 tools with worker online and live browsing disabled. Exact commands and counts are in implementation status. Live observations and authorized live mutations must be appended as separate evidence, never inferred from synthetic fixtures.
