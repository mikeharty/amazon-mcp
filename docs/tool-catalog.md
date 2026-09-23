# Proposed MCP tool and resource catalogue

> Design target. For implemented coverage and current runtime evidence, see [capability ledger](capabilities.md) and [implementation status](IMPLEMENTATION.md).

Proposal, 2026-09-20. Names are contracts to refine in the foundation workstream, not implemented tools. Read this with [requirements.md](requirements.md) and [architecture.md](architecture.md). The full surface is phased; do not advertise an operation as usable until its provider and account capability are verified.

## Common contract

- Every account tool accepts an owner-bound `accountRef`. Product tools accept explicit `marketplace` and optional `deliveryContextRef`; the first supported marketplace is Amazon.com.
- Money always carries currency and minor units. Date/time values include timezone/offset where user-facing; persisted instants use UTC.
- Lists accept bounded `limit` and opaque `cursor`, return `nextCursor`, `coverage`, source and observation time. Filtering/sorting is explicitly supported or rejected.
- Mutations accept an `idempotencyKey` and relevant revision/precondition. A repeated request returns the existing operation/result. Same key with changed arguments fails.
- Long calls return `operationId`; all operations can be read without keeping a transport connection open.
- Consequential commits require a server-verifiable consent receipt tied to a prepared intent. A boolean from the model is insufficient. Receipt creation lives in the authenticated owner UI or verified host consent integration.
- Every tool declares input/output schemas, truthful annotations, capability requirements, scope and maximum work budget. Tool errors distinguish auth, challenge, stale state, rate limit, layout change, unsupported operation and unknown outcome.
- Text output is a concise fallback for hosts that do not render structured content/resources. No raw HTML, secrets or entire browser snapshots are returned.

## Connection and operation control

| Tool | Inputs / result | Behavior |
| --- | --- | --- |
| `amazon_capabilities` | Marketplace/account/client context → feature support, reasons, providers, session and worker health | Includes supported notification channels, enabled paid providers and last successful verification |
| `account_connect` | Marketplace, local/hosted profile choice → authenticated sign-in/handoff handle | Starts dedicated browser connection; credentials entered only with Amazon |
| `account_disconnect` | Account, optional pending-operation handling → revoked session/worker access state | Reject or reconcile active consequential work; local disconnect and deleting stored profile are explicit distinct options |
| `operations_get` | Operation handle → status, progress, required input, result, uncertainty | Owner-scoped durable source of truth |
| `operations_resume` | Operation handle, expected revision, schema-validated missing input/handoff result → updated state | Verifies handoff completion; cannot manufacture approval or bypass changed terms |
| `operations_cancel` | Operation handle, expected revision → cancellation requested/confirmed/too late | Stopping work is distinct from cancelling an Amazon order |

Resources: `amazon://accounts/{accountRef}/capabilities`, `amazon://operations/{operationId}`. Both require authorization; opaque handles are not authorization by themselves.

## Discovery, products, sellers and reviews

| Tool | Inputs / result | Coverage details |
| --- | --- | --- |
| `products_search` | Query, filters/sort, marketplace/context, cursor → result summaries and supported facets | Retains sponsored/rank signals and exact child ASIN when resolved |
| `products_get` | ASIN or allowed Amazon URL, requested field groups → product/variant details | Expensive sections are opt-in; identify unresolved parent versus purchasable child |
| `products_variants` | Product, selected attributes → variant options and identifiers | Selection availability and per-variant prices are observations, not checkout guarantees |
| `categories_browse` | Category/node, filters/sort, cursor → breadcrumbs, children and products | Provider-specific categories normalized without inventing universal IDs |
| `products_compare` | Product/offer references, requested attributes → comparable rows and unknowns | Normalize unit price only when quantity/unit is explicit; separate shipping/tax estimates |
| `offers_list` | Exact variant, condition, quantity, context, cursor → observed offers | Exact seller/fulfilment/mode, price and delivery terms; source completeness reported |
| `sellers_get` | Marketplace + seller ref → public profile, feedback summaries and policies | Seller feedback periods/counts remain separate from product ratings |
| `seller_feedback_list` | Seller ref, supported filters, cursor → feedback pages | Full-text/metadata availability is source-dependent; no inferred missing sentiment |
| `product_reviews_list` | Variant/product, supported rating/verified/media/sort filters, cursor → reviews and coverage | Label variation pooling, translated text, aggregate versus retrieved review count |
| `product_media_list` | Product, source types, cursor → image/video/document metadata | Separate product images from customer media and preserve variant association |
| `products_related` | Product, relation types, cursor → source-labelled related items | Sponsored, frequently-bought and computed alternatives are distinct |

Resources: bounded public `amazon://products/{marketplace}/{asin}` and owner-bound `amazon://accounts/{accountRef}/contexts/{contextRef}/products/{asin}` for personalized observations, plus paginated review/media resources. Personalized resource/cache keys include account and delivery context; authorization validates every reference. Provider-specific retention constraints still apply.

## Prices, deals and coupons

| Tool | Inputs / result | Coverage details |
| --- | --- | --- |
| `prices_history` | Variant, time range, price/condition type, granularity → series and summary | Default own observations since first collection; optional Keepa clearly identified; gaps retained |
| `deals_search` | Query/category/event, supported discount/price filters, cursor → visible deals/events | Distinguish Amazon sale inventory from history-provider price-drop findings |
| `sale_events_get` | Event ref or allowed event URL, section/cursor → event state, dates, sections and items | Contextual/membership restrictions and incomplete event pagination explicit |
| `coupons_clip` | Observed coupon ref, product/context, idempotency key → clip result and conditions | No purchase; re-read application eligibility; clipping is not proof of checkout savings |

Price summaries never compare unrelated variants/conditions or label retail reference price as paid-price history. No claim that coupon/Prime/subscription discounts stack until checkout verifies it.

## Cart and saved items

| Tool | Inputs / result | Mutation invariant |
| --- | --- | --- |
| `cart_get` | Active/saved view, account → lines, totals/estimates, warnings, revision | Mask private information and identify unselected lines |
| `cart_add` | Exact offer ref, quantity, purchase mode, expected context → updated cart and actual line | Match variant/seller/condition/mode after add; reconcile lost response before retry |
| `cart_set_quantity` | Line ref, absolute desired quantity, expected revision → cart | Set-to semantics; surface Amazon minimum/maximum/stock constraints |
| `cart_remove` | Line ref, expected revision → cart | Verify correct line removed; absent already-removed line is distinguishable from wrong revision |
| `cart_move` | Line ref, `save_for_later` or `restore`, expected revision → cart/saved views | Verify destination and preserve intended offer or report changed offer |
| `cart_set_purchase_mode` | Line ref, one-time/subscription preference, frequency, revision → updated state/proposal | If action would create an order/subscription, route to prepared consequential flow |

Optional later shopping-list CRUD gets a separate contract; it is not conflated with saved-for-later.

## Checkout

| Tool | Inputs / result | Mutation invariant |
| --- | --- | --- |
| `checkout_start` | Account, selected cart line refs and cart revision → checkout handle/options | Explicit selection; do not buy or include unselected items |
| `checkout_get` | Checkout handle → current options, selections, warnings and totals | Saved addresses/payment instruments exposed as masked selectable references |
| `checkout_configure` | Handle, expected revision, typed selection changes → refreshed choices/totals | Whitelisted changes for address, payment, shipment speed, gifts, balance/promotion; no arbitrary field/JS execution |
| `checkout_prepare` | Handle/revision → expiring exact order intent and review URL | Full material-terms fingerprint; surface recurring commitment and delivery grouping |
| `checkout_submit` | Prepared intent, single-use consent receipt, idempotency key → operation/confirmed orders | Intent maps to one operation even with a new key; re-read, compare, reconcile independently; quarantine uncertain effects |

Selecting an address or payment does not mean editing the stored account record. New-card/CVV/bank authentication stays in Amazon UI. Return a handoff if the payment selection cannot safely be completed through supported controls.

## Orders, shipments and order changes

| Tool | Inputs / result | Coverage details |
| --- | --- | --- |
| `orders_list` | Date/status/query filters, cursor → history summaries | Pagination is bounded and dates/statuses reflect actual available filters |
| `orders_get` | Order handle → line amounts, shipments, status, refunds and supported actions | Mask payment/address; distinguish original order data from current product data |
| `order_documents_list` | Order handle → available invoices/receipts, owner-authorized resource refs | Downloads handled via private document read endpoint/resource; no public signed artifact in logs |
| `shipments_get` | Shipment/order handle → packages, tracking events, ETA and proof availability | Include last successful observation and observation gaps |
| `order_actions_prepare` | Order/line refs, typed action: cancel, eligible edit, or buy-again proposal → exact intent | Require cancellation reason only if Amazon requires it; never invent one. Buy-again prepares current cart changes |
| `order_actions_submit` | Intent, receipt where consequential, idempotency key → observed state | Cancellation requested versus accepted distinguished; unsupported edit returns handoff |

Resources: `amazon://orders/{orderRef}`, `amazon://shipments/{shipmentRef}`, `amazon://documents/{documentRef}`. Access is checked on every read.

## Returns, replacement and review options

| Tool | Inputs / result | Coverage details |
| --- | --- | --- |
| `returns_options` | Order line refs/quantities → eligibility, deadlines, reasons, refund/replacement and transport options | Actual purchased-line eligibility; policy text alone is insufficient |
| `returns_prepare` | Selected lines, user's reason, desired resolution/method → expiring return intent | Fees/refund destination/logistics, replacement order and contingent charge/return deadline shown |
| `returns_submit` | Intent, consent receipt, idempotency key → authorization state and private instructions | Verify return and any replacement order separately; quarantine unknown/partial outcomes; label/QR after confirmed authorization |
| `returns_get` | Return handle → lifecycle, shipping and refund milestones | Supports watch subject; return cancellation/change remains a later typed extension |
| `review_options_get` | Order/product reference → product-review/seller-feedback eligibility, destination, optional user-authored draft | Initial delivery uses draft and UI handoff; no automatic publication |

User-authored reason/review text is untrusted input but must not be silently rewritten into a different claim. Support contact and seller-message drafts are handoffs until a separately authorized messaging feature exists.

## Recurring purchases

| Tool | Inputs / result | Mutation invariant |
| --- | --- | --- |
| `subscriptions_list` | Account, state, cursor → recurring purchase summaries | Subscribe & Save only initially; ordinary Prime membership excluded |
| `subscriptions_get` | Subscription handle → item, schedule, next estimate, cutoff and actions | Estimated future price is not guaranteed |
| `subscriptions_prepare` | Typed enroll/change/skip/pause/resume/cancel, fields, expected revision → intent | Advertise only available actions; enrollment creating an order is a compound purchase |
| `subscriptions_submit` | Intent, consent receipt, idempotency key → verified subscription/order state | Verify both recurring state and any immediate order; partial/unknown outcomes are explicit |

## Watches and event delivery

| Tool | Inputs / result | Behavior |
| --- | --- | --- |
| `watches_list` | Account/type/status, cursor → configured watches and health | Includes last success, next due, lag and channel status |
| `watches_upsert` | Typed subject/rule, cadence, timezone, expiry, channel, quiet hours, cooldown → watch | Owner-scoped, bounded polling, explicit consent for destination/channel |
| `watches_pause` | Watch handle, paused boolean, expected revision → state | Resuming respects missed-observation/backfill policy |
| `watches_delete` | Watch handle → removed state | Does not delete the user's underlying order/product/subscription |
| `events_list` | Since cursor, subject/severity/unread filters → durable event feed | Works without protocol notification support |
| `events_acknowledge` | Event IDs, expected owner → acknowledged state | Acknowledgement is not a downstream shopping action |

Resources: `amazon://events`, `amazon://watches/{watchRef}`. Channel enrollment is done in owner UI or a separate verified host integration. No arbitrary webhook URL from untrusted page content can become a notification destination.

## Initial export profiles and acceptance

Publish a stable read-only profile first, then an account/cart profile, then the transactional profile. Profiles are explicit configuration or separate fixed endpoints, not a different tool list per connection. Use lazy/grouped client discovery when supported; ordinary clients can use the smaller profile to avoid loading the eventual full catalogue.

Every implemented tool requires: schema examples; capability/precondition documentation; missing/partial-data behavior; pagination or operation limits; redacted fixture cases; ownership/auth checks; and postcondition/reconciliation tests for mutations. The capability ledger separately records live verification. A tool name in this proposal is not evidence of working Amazon support.
