# Official Amazon API options for a personal shopping MCP

Checked: **2026-09-20**. This is an architecture assessment, not an implementation or a legal opinion. It uses Amazon's official documentation and official artifacts only. No Amazon account was accessed.

## Recommendation in context

For a personal Amazon.com account without established affiliate eligibility, the official APIs do not provide the requested shopping-account control. The overall proposal should therefore begin with a **browser-backed feasibility lane** that uses the user's ordinary Amazon.com web experience, with a deliberate review of Amazon's applicable terms and technical controls before any automation is implemented. This is a browser-integration proposal, not an assertion that Amazon offers or permits an undocumented consumer API.

Keep Creators API **disabled by default** as an optional official-API-only catalog lane. Eligibility alone is insufficient: the Associates use, distribution, and self-purchase rules make it a poor default fit for a personal installed MCP. Enable it only if the actual distribution and affiliate advertising use case complies with the Program Policies. In that lane, the MCP can search the catalog, retrieve product and variation details, show images, featured-offer price/availability/seller information, potentially show review aggregates after verification, and hand an eligible end user off to the Amazon detail-page URL returned by the API. It still cannot control a personal account's cart, checkout, orders, returns, subscriptions, or tracking.

Do not promise consumer account control. Amazon publishes no general consumer API for changing an Amazon retail cart, checking out on Amazon, placing consumer orders, initiating returns, managing retail subscriptions, or tracking consumer packages in real time. The nearest official consumer-account surface is **Amazon Data Portability**, which can export eligible customers' data, including EU marketplace order, return, physical subscription, shopping-basket, and customer-authored review records. It is an asynchronous, read-only transfer product with substantial onboarding and geographic limits, not a shopping-control API.

PA-API 5 is no longer a viable fallback. Amazon says it is deprecated, calls return `403 AccessDeniedException`, and new integrations must use Creators API: [PA-API 5 deprecation notice](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation).

## Capability coverage

| Requested capability | Official surface | Coverage and boundary |
|---|---|---|
| Product search | Creators API `SearchItems` | Yes. Keyword/actor/artist/author/brand/title search, category, browse node, price and other filters; up to 10 items per request. [SearchItems](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/search-items) |
| Product details | Creators API `GetItems`, `GetVariations`, `GetBrowseNodes` | Yes. Title, byline/brand/manufacturer, classifications, content/product/technical info, external IDs, features, trade-in info, browse nodes/ranks, variations, and detail-page URL, subject to resource and locale availability. Up to 10 ASINs in one `GetItems` call. [API reference](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference) |
| Offers and prices | Creators API `OffersV2` | Partial. Featured listing/buy-box-oriented data: availability, condition, price, saving basis/savings, order quantity, offer type, and MAP indication. It does not enumerate the complete offer marketplace. Amazon explicitly says `OffersV2` provides only featured listings and removed offer counts, price summaries, shipping/Prime flags, and promotions from legacy Offers. [OffersV2](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/resources/offersV2) |
| Seller data | Creators API `OffersV2.Listings.MerchantInfo` | Partial. Merchant ID and name for the featured offer. Seller feedback count/rating and default shipping country are explicitly unavailable in `OffersV2`. |
| Review data | Creators API official 1.3.0 SDK | Partial. The current official SDK exposes `customerReviews.count` and `customerReviews.starRating`, which are aggregate count/weighted rating only. It does not expose review bodies, reviewer identities, or review photos. The public operation pages currently omit these two resource names, so this must be confirmed with an approved live credential before making it a product guarantee. [Official SDK download page](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-sdk) |
| Product photos | Creators API Images resource | Yes. Primary and variant image URLs in small/medium/large sizes, plus dimensions. Images themselves may not be cached; image URLs may be cached for up to 24 hours. [Images](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/resources/images) |
| Deals | Creators API `OffersV2.Listings.DealDetails` | Partial. Deal metadata can accompany a returned featured listing: access type, badge, start/end time, Prime early-access duration, and sometimes percent claimed. There is no documented Creators operation that searches or enumerates all deals; Amazon directs users to the retail deals page to find deals. |
| Consumer cart read | Amazon Data Portability `portability::orders_cart` | Limited, read-only export for eligible customers. It returns ASIN, quantity, date added, and active/cart state. It is not a low-latency cart API. [Available portability scopes](https://developer.amazon.com/docs/amazon-data-portability/available-scopes.html) |
| Add/update/remove consumer cart items | None found | No documented official general-consumer operation. Creators API returns product links but has no cart operations. Data Portability cannot mutate data. |
| Consumer checkout/order placement | None found | No documented official general-consumer operation. Amazon Business Ordering API can place Amazon **Business** orders after partner/customer onboarding; it is not a personal retail-account API. |
| Consumer order history | Amazon Data Portability `portability::physical_orders` / `digital_orders` | Limited, read-only transfer for eligible customers and marketplaces. Physical order records include product, ASIN, order ID/date, quantity, condition, and amount. No Creators/LWA general order-history scope exists. |
| Consumer returns | Amazon Data Portability `portability::physical_order_returns` / `digital_order_returns` | Limited to exporting return/refund history. No operation initiates or changes a return. |
| Consumer subscriptions | Amazon Data Portability `portability::physical_subscriptions` and digital subscription scopes | Limited to exporting state/details. No operation creates, skips, edits, or cancels subscriptions. |
| Consumer package tracking | None found | The physical-order portability schema has no shipment or tracking fields. Amazon Business has package tracking/reporting for Business accounts, and SP-API exposes seller-side fulfillment/order data; neither grants a personal retail account's tracking data. |
| Customer's own submitted reviews/photos | Amazon Data Portability `portability::product_reviews` | Eligible, authorized export includes the customer's own review text, rating, photo/video URLs, ASIN, and status. This is not access to other customers' reviews for product research. |

## Creators API: access, restrictions, and operational limits

Creators API is a REST catalog API for publishers, influencers, and affiliate partners. Its four catalog operations are `SearchItems`, `GetItems`, `GetVariations`, and `GetBrowseNodes`: [Creators API introduction/reference](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference).

Access is not granted merely because someone has a retail Amazon account. Amazon's current registration page says the applicant must:

- have an Amazon Associates account that has received final acceptance;
- have referred qualified sales before Creators API signup is available; and
- use a valid Associate/partner tag for each requested marketplace.

See [Register for Creators API](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding/register-for-creators-api) and [Sign up as an Amazon Associate](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding/sign-up-as-an-amazon-associate). The latter says access is marketplace-specific even though credentials can be used with regional token endpoints.

New credentials start with up to **1 transaction per second and 8,640 transactions per day for the first 30 days**. Thereafter allocation is driven by attributed shipped revenue: one daily transaction per $0.05 of shipped revenue and one TPS per $4,320, capped at 10 TPS. Amazon says access is lost after 30 consecutive days without qualified referred sales and restored after attributed sales ship. A request containing up to 10 ASINs still counts as one transaction. [API rates](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/concepts/api-rates).

The Associates license materially shapes the MCP design: [Associates Program IP License and Usage Requirements](https://affiliate-program.amazon.com/help/operating/policies#Associates%20Program%20IP%20License).

- Product Advertising Content may be used only in an application whose principal purpose is advertising/marketing Amazon and driving sales to Amazon; each use must link to the relevant Amazon page.
- Product data other than images may generally be cached for at most 24 hours; image content cannot be cached, while image links may be cached for up to 24 hours. ASINs may be retained indefinitely while the license remains active. A client application may not cache Product Advertising Content.
- Price/availability displayed from data refreshed less often than hourly needs Amazon's prescribed timestamp and disclaimer. Text content requires Amazon's prescribed content disclaimer.
- Product content may not be used to develop or improve ML/foundation models, or directly train/fine-tune them. The proposed MCP should keep API content out of training, telemetry corpora, embeddings, and durable model memory.
- If the MCP uses Creators API or other Associates Program Content, [§4, “Agents,” of the Associates Program IP License and Usage Requirements](https://affiliate-program.amazon.com/help/operating/policies#Associates%20Program%20IP%20License) applies. Within that Associates scope, the definition covers autonomous or semi-autonomous software; all HTTP/HTTPS requests accessing Program Content must identify the agent as `Agent/[agent name]`, and the agent must not hide automation, mimic human interaction, solve/bypass CAPTCHAs, or evade controls. Amazon may restrict agent access.
- Credentials and Associate tags cannot be borrowed, transferred, or exposed. The server, not a browser/client, should hold the client secret.

The [Associates Program Participation Requirements](https://affiliate-program.amazon.com/help/operating/policies#Associates%20Program%20Participation%20Requirements) add three constraints that are especially important here:

- **§5, Distribution of Special Links Through Software and Devices:** Program Content, Special Links, and links to Amazon may not be used in connection with client-side software executable or installable by an end user, except Approved Mobile Applications. A locally installed MCP appears difficult to fit within this rule even if its owner has Creators credentials.
- **§6(u), self-purchases:** an Associate may not directly or indirectly purchase products through Special Links for the Associate's own use or another person's use, and may not encourage specified related people to do so. A personal MCP therefore must not route its owner's purchases through the owner's affiliate links.
- **§6(y), price tracking/alerts:** unless Amazon agrees otherwise, the Associate's Site may not have price-tracking or price-alerting functionality. Do not treat Creators API eligibility as permission to build personal price history or alerts.

These are Associates Program terms governing Creators API/Program Content. They are not evidence that browser automation of the general Amazon retail site is permitted. For this personal installed use case, leave the Creators connector off unless the distribution model and intended users fit the quoted rules. Separately check the current terms and controls that apply to Amazon.com browser use before implementing the browser lane.

## Amazon Data Portability: the narrow consumer-account exception

Amazon Data Portability lets an authorized third-party application import customer-selected Amazon data after explicit Login with Amazon consent: [overview](https://developer.amazon.com/docs/amazon-data-portability/overview.html). Marketplace transaction coverage currently includes Belgium, France, Germany, Ireland, Italy, Netherlands, Poland, Spain, and Sweden. Eligibility depends on applicable regulation and the customer's registered location.

It is relevant because its scopes include physical/digital orders, physical/digital returns, physical-product subscriptions, shopping basket, product reviews authored by that customer, seller feedback, lists, and other account data: [scope catalog and schemas](https://developer.amazon.com/docs/amazon-data-portability/available-scopes.html). It is still unsuitable as the primary shopping backend:

- It is **read-only export**, not action/control. There are no update-cart, checkout, place-order, return-initiation, subscription-management, or tracking operations.
- Onboarding requires a developer account, identity and security assessment, LWA security profile, use-case-specific LWA integration, and allowlisting. Category-2 scopes such as orders/cart/subscriptions require business identity and data-security verification. [Configuration requirements](https://developer.amazon.com/docs/amazon-data-portability/intro-configure.html)
- Scopes must be voluntary and customer-selected. The flow creates an asynchronous data query, waits for an HTTPS callback, then retrieves short-lived pre-signed files and schemas. [Workflow](https://developer.amazon.com/docs/amazon-data-portability/intro-connect.html)
- Create-query limits are 5 requests/second per scope, 5 concurrent, and no more than 20 within 20 minutes; only one in-progress query per customer/scope. List-query-records is 10 requests/second, 5 concurrent, and 100,000/day. File/schema links last five minutes; a completed query can be listed for at most one hour. [API reference](https://developer.amazon.com/docs/amazon-data-portability/api-reference.html)

If this MCP is for a US-based retail account or current shopping actions, treat Data Portability as unavailable unless Amazon confirms that account/data is eligible. If eligibility and onboarding are realistic, implement it later as a separate, explicitly consented import connector with separate storage and tool names that make its snapshot nature clear.

## Adjacent APIs that do not provide personal retail access

| Surface | What it actually authorizes | Why it is not the consumer MCP backend |
|---|---|---|
| Selling Partner API (SP-API) | Sellers/vendors authorize apps to manage their selling business: listings, prices, inventory, seller-fulfilled/customer orders, reports, shipping, etc. Private seller apps require a Professional selling account. [Registration overview](https://developer-docs.amazon.com/sp-api/docs/sp-api-registration-overview) | An Orders API record is an order **received by the seller**, not the signed-in shopper's Amazon purchase history. Current Orders API availability is “Sellers only.” [Orders API](https://developer-docs.amazon.com/sp-api/docs/orders-api) |
| Amazon Business APIs | Approved purchasing-system partners and Amazon Business customers access product search, ordering, carts, order status, package tracking, reporting, reconciliation, documents, and users under Business roles/onboarding. [Overview](https://docs.business.amazon.com/docs/what-are-amazon-business-apis), [Ordering API](https://docs.business.amazon.com/docs/ordering-api) | These are organizational procurement APIs. They do not authorize operations against an ordinary personal Amazon retail account. |
| Amazon Pay | Merchants accept Amazon Pay on the merchant's own site/app via checkout sessions, charge permissions, charges, refunds, and recurring checkout. It requires an Amazon Pay merchant account. [Setup](https://developer.amazon.com/docs/amazon-pay-checkout/get-set-up-for-integration.html), [API objects](https://developer.amazon.com/docs/amazon-pay-api-v2/v1-introduction.html) | It pays the MCP operator/merchant for that merchant's goods; it does not purchase Amazon.com catalog items, inspect Amazon retail orders, or manage Amazon retail returns. |
| Login with Amazon (ordinary scopes) | Authentication plus `profile`, `profile:user_id`, and `postal_code`. [Customer profile](https://developer.amazon.com/docs/login-with-amazon/customer-profile.html) | Login is not delegated access to cart, orders, payments, Prime, subscriptions, returns, or tracking. Data Portability adds separate allowlisted scopes and controls; an ordinary LWA token does not gain them. |

## SDK and maintenance evidence

| SDK/artifact | Current evidence checked 2026-09-20 | Assessment |
|---|---|---|
| Creators API Node.js, Python, PHP, Java downloads | Amazon's official SDK page lists all four and a shared changelog. Version **1.3.0, 2026-08-21** added the mandatory SearchItems `partnerTag` and fixes; 1.2.0 added v3 credentials in February 2026. Node/Python/PHP 1.3.0 archives contain Apache-2.0 licenses; Node package metadata is `@amzn/creatorsapi-nodejs-sdk` 1.3.0. [SDK page](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-sdk) | Actively updated and the best-supported catalog client. However, Amazon distributes downloadable archives rather than linking a public source repository/release history. The Java archive checked did not contain a top-level license file, so confirm its redistribution terms before using it. Pin an audited archive/checksum. |
| SP-API official SDK/models | Amazon's public `amzn/selling-partner-api-sdk` and `selling-partner-api-models` are Apache-2.0; the Amazon GitHub organization showed activity through 2026-07-30. [Official models repository](https://github.com/amzn/selling-partner-api-models) | Maintained, but categorically seller/vendor-side and therefore not useful for personal consumer access. |
| Amazon Pay Node.js SDK | Official `amzn/amazon-pay-api-sdk-nodejs`, Apache-2.0, also linked from Amazon Pay's current setup guide. [Repository](https://github.com/amzn/amazon-pay-api-sdk-nodejs) | Maintained merchant-payment tooling, but out of scope for buying on Amazon retail. |
| Amazon Data Portability | Amazon documents raw REST/LWA integration and schemas; no dedicated official portability client SDK was found. The LWA SDK can assist with tokens. | Plan for a small generated/manual REST client only if onboarding and eligibility are confirmed. |

## Proposed architecture before implementation

### Primary lane: browser-backed feasibility for personal Amazon.com

This is the proposed overall path because the user wants a personal Amazon.com assistant and has not established affiliate eligibility. Start with a short feasibility spike, not a production integration:

- Use a user-visible, user-controlled browser session. Keep credentials, cookies, MFA, and payment details inside the browser; do not copy session tokens into the MCP or call private retail endpoints.
- Validate read-only journeys first: search, inspect a product page, compare visible offers, and open cart/order pages. Treat selectors, page text, experiments, regional variation, and anti-automation controls as unstable inputs.
- Add state-changing browser tools only if the applicable Amazon terms and site controls permit the automation and each action can be made reviewable. Cart changes, order placement, cancellations, returns, and subscription changes should have explicit user confirmation immediately before the final action.
- Stop when Amazon presents a CAPTCHA, bot challenge, reauthentication, or other control that requires the user. Do not conceal automation, imitate human timing to evade detection, or use undocumented/private APIs.
- Keep a plain browser handoff as the durable fallback. A failed automation step should leave the user on the relevant Amazon page rather than claim the requested action completed.

Automation permission is a prerequisite, not an architecture assumption. Feasibility depends on the Amazon terms applicable to the user's account and locale, Amazon's technical controls, and any authorization Amazon provides. This report does not resolve that permission question.

### Optional official API lane: Creators product discovery

This connector is disabled by default. Do not expose it in the personal Amazon.com configuration merely because credentials are available; first establish that its deployment is not prohibited client-side software, that purchases will not be self-purchases through Special Links, and that no disallowed price tracking/alerting is present.

- An MCP service exposes `search_products`, `get_product`, `get_variations`, and `get_browse_node` only in an approved deployment model.
- A provider module wraps the official Creators REST endpoints, OAuth client-credentials token cache, marketplace/partner-tag configuration, rate limiter, exponential backoff, and a strict 24-hour-or-shorter response cache. Do not persist images or raw product content in logs/model memory.
- Normalize only fields needed by tools: ASIN, title, brand/byline, key attributes/features, primary/variant image URLs, featured-offer price/availability/condition/merchant, review count/rating when verified, deal metadata, and Amazon's returned detail-page URL.
- Return explicit provenance (`marketplace`, `retrievedAt`, `source=creators-api`) and policy-required price/content notices. Each product result must link to its relevant Amazon page with Amazon-returned URL parameters intact.
- For requests accessing Associates Program Content, set `User-Agent: Agent/AmazonShoppingMCP` (or the final registered name) as required by the Associates Agent Terms.
- No tools named or described as add-to-cart, buy, checkout, orders, returns, subscriptions, or tracking. Offer an `open_product_page`/URL handoff rather than pretending the action is API-backed.

Use the official Node SDK 1.3.0 if dependency review is acceptable; otherwise implement the very small documented REST surface directly. Direct REST does not avoid the Associates license. In either case, lock the API/credential version, archive checksum, and contract tests because the web reference and generated SDK currently disagree about review-aggregate resources.

### Optional official data lane: eligible Data Portability import

Keep this as a separate connector and permission domain. It would expose read-only snapshot/import tools such as `request_account_export`, `get_import_status`, `list_imported_orders`, `list_imported_returns`, `list_imported_subscriptions`, and `list_imported_cart_snapshot`. It needs an HTTPS notification receiver, per-scope consent tracking, encrypted refresh-token and exported-data storage, retention/deletion controls, and clear timestamps. Do not build it until Amazon approves/allowlists the application and confirms the target customer's data eligibility.

## Unresolved facts to verify before coding

1. **Creators deployment fit.** Participation Requirement §5 excludes client-side executable/installable software except Approved Mobile Applications. The documented exception does not match a local desktop MCP, so the optional connector remains disabled unless Amazon provides an applicable supported deployment path.
2. **Review aggregates.** The official 1.3.0 SDK contains `customerReviews.count` and `customerReviews.starRating`, but the current web operation/resource lists omit them. Verify with an approved test credential and obtain support confirmation before exposing them as reliable.
3. **Creators credential access.** Registration requires final Associate acceptance and qualified referred sales, while the rates page describes an initial 30-day allowance after credential creation. These statements are compatible only after credentials are granted; do not assume a new retail or newly opened Associate account can immediately obtain credentials.
4. **Deals completeness.** `DealDetails` is attached to featured offers and fields are optional. There is no documented discovery endpoint or completeness guarantee. Confirm expected US marketplace behavior with representative ASINs.
5. **Official SDK distribution.** Record checksums and run dependency/security review. Clarify the Java archive's missing license file if Java is considered; for this repository, Node is the natural candidate.
6. **Data Portability eligibility.** Confirm customer registered location, relevant EU marketplace transactions, scope approval, and whether Amazon will approve a personal/single-user business offering. Until then, present portability support as an optional architecture path only.
7. **No inferred buyer actions.** Recheck Amazon's official developer catalog immediately before implementation in case a consumer shopping action API is introduced. Do not substitute undocumented retail endpoints, browser session cookies, scraping, or reverse-engineered mobile APIs.
