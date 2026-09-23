# Amazon consumer MCP: proposed requirements

> Design target. For implemented coverage and current runtime evidence, see [capability ledger](capabilities.md) and [implementation status](IMPLEMENTATION.md).

Proposal dated 2026-09-20. This is a design for review, not an implementation or a claim of Amazon account access. No personal Amazon session has been inspected. Provider research is in `docs/research/`.

## Product boundary

Expose useful, structured Amazon shopping and account actions to MCP clients. Reuse supported provider APIs where their eligibility and permitted use fit; evaluate isolated browser adapters for account experiences without a suitable public API. Browser-dependent functionality is conditional on access feasibility, including source restrictions, and account-flow validation. Represent unavailable features honestly and provide a browser handoff when automation cannot complete them.

Confirmed preferences: start with the user's personal Amazon.com account; design for other regions later; present both local and hosted browser options before choosing; prefer free/open-source with paid integrations optional. Initial assumptions are physical products, USD and US delivery destinations. Support one marketplace end to end before claiming others. Keep marketplace, currency, account and delivery context explicit throughout. Personal shopping is the primary use case; affiliate publishing, merchant operations, Amazon Business procurement and digital subscriptions are separate products.

"All details" means all fields and pages actually exposed to the selected provider and account, with reported coverage. It does not promise an exhaustive review corpus, every personalized promotion, unavailable seller data or every historical price.

## Delivery stages

| Stage | Outcome | Exit condition |
| --- | --- | --- |
| 0: feasibility | Prove current protocol compatibility, provider access and browser viability | Evidence for a product, offers, account identity, cart and one order; no purchases needed |
| 1: shopping research | Search, product details, offers, seller information, reviews, media, comparisons, deals and optional history | Results identify variant, seller, context, freshness and missing fields |
| 2: account reading and carts | Order history, shipments, cart, saved items, subscriptions and account-specific availability | Reads match the visible account; cart mutations reconcile exactly |
| 3: transactional flows | Checkout preparation and confirmed placement; cancellation, returns and subscription changes | Every consequential action has a valid intent, fresh state and verified outcome or explicit uncertainty |
| 4: monitoring and polish | Shipment/price/return/subscription watches, notifications, exports and client UI | Durable restart recovery, deduplicated events and verified delivery channel |

Stages are acceptance boundaries, not a prohibition on parallel work. Later lanes may build against agreed contracts and fixtures while earlier live checks run.

## Functional coverage

### Search and navigation

- Keyword search, ASIN/URL lookup, category browsing, supported facets, sort order, price and condition filters, Prime and seller/fulfilment filters where exposed.
- Preserve sponsored placement, result rank, marketplace, delivery context, applied filters and pagination. Unsupported filters must be rejected or reported, never silently ignored.
- Resolve shortened Amazon links through approved redirects. Normalize to a marketplace and ASIN; reject arbitrary external navigation.
- Represent parent/child variants and available size, colour, capacity and pack options. Resolve the exact child item before price comparisons or mutations.
- Optional multi-product comparison over user-selected attributes, delivered cost, unit price, delivery promise, return terms and seller evidence.
- Do not treat ranked or personalized search results as a complete catalogue.

### Product details and media

- Title, brand, model, identifiers, description, bullets, specifications, dimensions/weight, category path, variants, availability, fulfilment restrictions and relevant product documents when exposed.
- Image gallery with source URLs, captions/alt text if available, variant association and pagination. Include videos and customer photos as links/media metadata where supported.
- Related products: alternatives, similar items, frequently bought together and accessories, preserving Amazon's relationship label and sponsored status. Distinguish source recommendations from our computed comparisons.
- Rating average, count, distribution and review links; timestamp every observation.
- Extract only available fields. Each field may be unavailable, not applicable, restricted, unparsed or stale; none of these means zero or false.

### Offers, sellers, shipping and return terms

- Offer identity includes ASIN, marketplace, condition/subcondition, seller, fulfilment, purchase mode and an observed offer reference. An ASIN alone is insufficient to add the intended seller's offer.
- List available offers with seller, item price, shipping, tax estimate when exposed, minimum quantity, stock indication, delivery window, Prime/ membership eligibility and offer-level return terms.
- Separate seller from fulfilment provider. A seller's feedback score is distinct from the product rating; show feedback counts and the applicable period.
- Seller profile: display/legal business information published by Amazon, storefront link, feedback summary, recent feedback pages, returns/shipping policies and seller status where exposed. Do not invent a trust score from missing evidence.
- Shipping promises are destination-, account-, membership-, quantity- and time-dependent. Record those inputs and distinguish product-page estimates from checkout-confirmed choices.
- Returns: category/offer return policy for research, and actual eligibility/deadline/methods for a purchased line. Holiday exceptions, return postage, restocking fees and final-sale restrictions are explicit when shown.

### Price history, discounts and sale events

- Optional history provider supplies timestamped series by marketplace, ASIN/variant, price type and condition. Explain whether shipping is included. Preserve gaps and sampling limits.
- Summaries: observed low/high, selected-window median or other declared statistic, comparison with current comparable offer, and known history coverage. Do not call a partial history an all-time low.
- Separate reference/list price, current price, coupon, percentage discount, multi-buy offer, Prime price, Subscribe & Save price and financing. Conditional benefits are not automatically additive.
- Coupon discovery and optional clipping use their own action and report requirements, cap, expiry and whether the coupon actually applied. Final savings are confirmed at checkout.
- List/search currently visible deals and sale events. Event details include title, active/upcoming/ended state, available time boundaries/timezone, category sections, item pages, membership requirements and pagination.
- Track Lightning Deal claim/expiry information only when exposed. Read current event pages dynamically; do not hard-code Prime Day or holiday event dates.
- Distinguish Keepa's computed price-drop deals from Amazon's official sale-event inventory.

### Cart, saved items and shopping lists

- Read active cart and saved-for-later lists, quantities, selected/unselected lines, sellers, variants, purchase modes, changed prices, unavailable items and warnings.
- Add a specific offer and quantity; set quantity; remove a line; move to saved-for-later; restore a saved item. Re-read after every mutation.
- Keep line identity separate from ASIN because the same product may appear under different sellers, conditions, modes or delivery groups.
- Apply optimistic concurrency using a cart version/fingerprint and serialize browser access per account. Report user edits that happened between reads instead of overwriting them.
- Support changing between one-time and subscription purchase only where Amazon exposes that path. A cart operation must not accidentally create a recurring commitment.
- Optional later extension: wish lists and named shopping lists, list item notes and reorder suggestions. Do not subscribe or buy automatically from a suggestion.

### Checkout

- Create/resume a checkout from explicitly selected cart lines. List available saved address labels, masked payment instruments, shipping groups/speeds and delivery options.
- Select existing address/payment/shipping choices and applicable gift balance, promotion code or gift options when supported. Show how the selection changes delivery and total.
- Support split shipments, multiple sellers, tax, shipping fees, gift options, coupons and unavailable items. Preserve per-group delivery promises.
- Prepare an exact order summary: items/variants, sellers, quantities, one-time versus recurring purchase, subtotal, discounts, shipping, tax, final total/currency, masked payment, destination label and delivery promise.
- Place the order only against a current, user-authorized summary; bind consent to those terms. Material changes require a refreshed summary. Cart editing does not require a redundant approval dialog on every change.
- Return confirmed order identifier(s) only when observed. If submission may have succeeded but the response was lost, reconcile order history before any retry and otherwise return `outcome_unknown`.
- Adding a new card, handling CVV, bank authentication, password/OTP, gift-card claim secrets and account recovery happen in Amazon's interactive UI. The MCP does not accept raw payment credentials.
- Initial exclusions: automatic purchasing, bidding, buy-now shortcuts, credit applications, gift-card purchases and digital content purchases. Add deliberately scoped capabilities later if wanted.

### Orders and shipping

- Paginated history by supported date range/status/query; details include order date, line items, sellers, quantities, actual paid amounts, shipment grouping, payment summary, invoices/receipts and available actions.
- Handle partial shipment, split order, replacement, cancellation, refunds and mixed item statuses. Order status and package status are separate entities.
- Tracking includes carrier/reference where visible, event timeline, original and revised estimated delivery, out-for-delivery/delivered/exception state, tracking link and delivery proof availability.
- Retrieve receipt/invoice and delivery proof via owner-authorized short-lived access; do not expose public links to private documents.
- Discover available order edits (address/speed/payment) and cancellation eligibility. Prepare and submit only the specific supported change. Cancellation requested is not cancellation confirmed.
- Buy-again builds an explicit proposal with current variant/offer and price; it does not reuse an old seller or price as a current quote.

### Returns, replacements, refunds and reviews

- List eligible lines, quantities, deadline, return/replacement methods, refund destination and amounts, fees, drop-off/pickup options and required packaging when shown.
- Prepare a return with the user's actual reason and preferences; do not invent a reason. Submit the chosen option with user intent recorded; expose label/QR/instructions privately.
- Replacement intents disclose any immediate replacement order, original-item return deadline and contingent charge for a missed return. Verify return authorization and replacement order separately.
- Track return authorization, transit, receipt, refund initiation and refund completion as separate states. Changes/cancellation of a return are capability-dependent.
- Review options include product review and seller feedback eligibility plus the correct destinations. Draft text only from the user's supplied experience.
- Initial release supports draft-and-handoff. Automatic review/feedback publication is an optional later feature requiring exact final text and explicit user authorization.
- Support contact/support handoff and user-approved message drafts. Do not send seller messages or open support cases without an explicit request.

### Subscribe & Save and other recurring purchases

- Inventory subscriptions with exact variant, quantity, seller where shown, current/estimated price, schedule, next delivery, change cutoff, discount conditions, status and available actions.
- Prepare enrollment, frequency/quantity changes, skip-next, pause/resume where supported and cancellation. Show recurring commitment and first-order consequences.
- Model enrollment that immediately creates an order as a compound checkout action, not a harmless cart edit.
- Discount estimates may depend on other items in the delivery; do not guarantee today's price for future renewals.
- Membership management (Prime), Kindle/Audible and unrelated digital subscriptions are out of the initial scope.

### Watches and notifications

- Explicitly create/list/update/pause/delete watches for shipment changes, delivery exception, refund progress, return deadline, price threshold, restock, deal window or subscription cutoff.
- Specify watched subject, filters, observation cadence, channel, timezone, quiet hours, expiry, cooldown and optional escalation. Stop completed watches according to the user's rule.
- Persist permitted observations and emit only meaningful changes. Deduplicate by subject, event type and occurrence/revision; preserve later repeated threshold crossings and distinguish an updated ETA from a repeated observation.
- Baseline delivery is an MCP-readable event inbox. Optional browser Web Push, local desktop notification or user-configured external channel provides proactive delivery.
- MCP capability negotiation can enhance an active client, but cannot by itself guarantee that a closed app opens, an assistant wakes or a notification appears. Advertise actual delivery support per client and deployment.
- If the local Mac/browser is offline, queued watches resume later and disclose the observation gap. Do not call stale polling results live updates.

## Cross-cutting acceptance requirements

| Requirement | Acceptance evidence |
| --- | --- |
| Explicit capability coverage | Feature report per provider, marketplace and account state; unsupported operations return a reason and handoff |
| Provenance and freshness | Source, observed time, effective context and coverage on each result; checkout uses a fresh authoritative account view |
| Safe mutation recovery | One account mutation lane; durable operation identity; duplicate call and lost-response tests do not duplicate effects |
| Authentication isolation | MCP caller identity is checked independently from Amazon browser identity; every handle belongs to its owner |
| Human authentication | Expiry/MFA/CAPTCHA pauses with a resumable handoff; no password or session cookie appears in model input/logs |
| Sensitive data minimization | Masked addresses/payment; encrypted private records; short-lived document access; export/delete/revoke controls |
| Bounded results | Cursor pagination, configurable page limits, explicit truncation and media/resource links instead of enormous tool output |
| Robust extraction | Semantic selectors, known page-state checks, fixtures, versioned extractors and explicit failure on changed layouts |
| Host compatibility | Tested tool discovery and representative calls on the selected clients, plus older-protocol compatibility where promised |
| Maintainable dependencies | Registry/release/license/activity evidence at pin time; lockfile; upgrade checks; no abandoned Amazon SDK in the critical path |
| Operational visibility | Per-provider latency/error/cost, action audit trail, session health, worker heartbeat, watch lag and queue age |
| Cost controls | Maximum page fetches, polling budgets, provider tokens and paid enrichment opt-in; no unbounded crawl |

## Additional features worth including

Priority additions: delivered-cost comparison, unit-price normalization, price/drop and return-window watches, subscription renewal reminders, order/invoice export, explicit buy-again comparisons and availability/session diagnostics. These directly improve shopping decisions and reduce missed deadlines.

Later candidates: wish-list synchronization, compatibility/accessory checks grounded in specifications, warranty/document collection, spend summaries derived from the user's own orders, and recall lookup through a separate authoritative provider. Each gets its own scope; inferred compatibility or review sentiment must not be presented as a verified product fact.

## Decisions to settle before enabling integrations

1. Confirmed: one personal Amazon.com account first, with other regions designed for later.
2. Open: local persistent browser versus hosted browser, and whether monitoring must work while the Mac is off. Present both options.
3. Confirmed: prefer free/open-source; paid historical/catalogue data is optional. Any paid integration needs an actual plan quote and eligibility check before activation.
4. Initial MCP clients and preferred notification surface.
5. Whether first delivery ends at checkout handoff or includes confirmed purchase/return/subscription execution.

These decisions affect deployment and feature activation; they do not block completing the architecture and independent implementation plan.
