# Amazon consumer MCP proposal

Architecture and implementation plan prepared on **2026-09-20**. This repository currently contains the proposal and source research only. No application has been built or deployed, and no personal Amazon account has been accessed.

For a compressed implementation handoff, start with [ROADMAP.md](ROADMAP.md).

Confirmed scope: one personal **Amazon.com** account first; other regions designed for later; present local and hosted browser options; prefer free/open-source with paid integrations optional.

## Recommendation

Use **Vercel `mcp-handler` + the official TypeScript MCP server SDK**, a **persistent Playwright worker**, and **Postgres + Graphile Worker** for operation state and scheduled jobs. Keep providers and business logic independent of the MCP transport. Vercel hosting is optional; its framework works for a local server too.

The largest constraint is Amazon access. Research found no general official API for controlling an ordinary consumer account's cart, checkout, orders, returns or Subscribe & Save. Browser workflows are candidate integrations, not verified API capabilities. Amazon's current [retail conditions](https://digprjsurvey.amazon.com/csad/help/node/GLSBYFE9MGKKQXXM) restrict automated extraction and specify agent identification. Stage 0 must establish an acceptable access path and actual workflow reliability before the broad browser feature set becomes a delivery commitment.

Amazon's **Creators API** is an affiliate catalogue product, and **PA-API is deprecated**. Creators stays disabled by default: its eligibility and deployment/use restrictions are a poor default fit for a personal shopping MCP. European Data Portability is a narrow read-only export option for eligible future regional integrations. [Official API research](docs/research/amazon-apis.md)

For historical prices, collect only permitted observations from first use. Older history requires an additional dataset; **Keepa is optional and paid**, with an actual price quote still needed before activation. Existing Amazon MCP repositories reviewed were incomplete foundations, so the plan reuses maintained primitives rather than promising their advertised account coverage. [Browser/data research](docs/research/browser-and-data.md)

## Proposed coverage

| Area | Planned surface |
| --- | --- |
| Discovery | Search/facets/categories, product specifications, exact variants, photos/videos/documents, related items and comparisons |
| Buying research | Offers, sellers/profiles/feedback, product reviews/ratings, destination-specific delivery, return terms, unit and delivered cost |
| Prices and sales | Observed history, optional historical provider, coupons, conditional discounts, deal search and sale-event sections |
| Carts | Read/add/remove/set quantity, select lines, save/restore, explicit one-time versus subscription mode |
| Checkout | Saved payment/address selection, shipping groups/speeds, gifts/promotions, exact total preview, consent-bound submission and recovery |
| Orders | History/details/invoices, status/tracking, cancellation and eligible edits, buy-again proposals |
| After purchase | Return/replacement options and submission, private labels/QR, refund progress, review/feedback options and drafts |
| Subscriptions | Inventory, delivery/cutoff information, enrollment, quantity/frequency changes, supported skip/pause/resume/cancel |
| Monitoring | Shipment/ETA/exception, price/restock, return/refund and subscription watches; event inbox and optional notification channels |

Coverage is source-, account- and marketplace-dependent. Every result reports provenance, freshness and missing data. Reviews and seller offers are paginated observations, not guaranteed complete datasets.

## Local versus hosted

Start feasibility locally with a dedicated profile: no required browser-vendor spend and straightforward sign-in. A local worker stops observing while the Mac is asleep. Hosted operation can run continuously but needs a persistent browser/container, paid hosting, secure interactive authentication and private-session controls. Hybrid operation keeps the browser local and the MCP gateway remote, but still cannot browse Amazon while the Mac is off.

MCP does not guarantee waking a closed client or displaying a proactive prompt. The baseline is a durable event inbox; desktop/Web Push or another explicitly configured delivery integration supplies proactive alerts. [Protocol and platform research](docs/research/mcp-platform.md)

## Design package

1. [Full requirements](docs/requirements.md): requested features, refinements, exclusions, delivery stages and acceptance requirements.
2. [Architecture](docs/architecture.md): components, deployments, dependencies, packages, data model, provider authority, transaction recovery and private data handling.
3. [Tool catalogue](docs/tool-catalog.md): proposed tool inputs/results, resources, action boundaries and capability handling.
4. [Workstreams](docs/workstreams.md): bounded implementation slices, dependencies, owned paths, review/fix loops and stage gates.
5. [Amazon API research](docs/research/amazon-apis.md), [browser/data research](docs/research/browser-and-data.md), [MCP/platform research](docs/research/mcp-platform.md): primary sources, maintenance/license evidence and unresolved facts.

## Implementation management

After proposal review, one **Astra High manager** owns execution and local-mainline integration. It dispatches **two Medium workers concurrently**, reviews each slice, returns defects to that worker until accepted, then integrates and verifies the combined result. The architect waits for the final integrated candidate. This fits the current four-agent limit.

The manager owns shared contracts, dependencies, migrations and registry wiring. Feature workers get separate worktrees and bounded paths. Tests use redacted fixtures and simulated external effects by default; actual purchases/returns/subscription changes are not test chores and require a real user request. Final delivery distinguishes implemented, simulated, live-read-verified and live-mutation-verified capabilities.

## First milestone

Prove the access model and a small vertical slice: compatible MCP client → exact product/offer → dedicated account connection → cart read → one order/shipment read. In parallel, prove durable jobs, owner authorization, stale-worker handling and duplicate/uncertain-action recovery using fake effects. Use that evidence to choose local/hosted deployment and activate feature lanes. Do not start with a broad crawler or an automated checkout implementation.
