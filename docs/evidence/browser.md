# Browser runtime evidence

Status: implemented and synthetic-fixture verified. No authenticated Amazon account was inspected, and no live account mutation was attempted.

## Dedicated login

Run from the repository root:

```sh
AMAZON_PROFILE_DIR="$PWD/.local/amazon-profile" pnpm browser:login
```

The script creates or reuses only its marked dedicated profile, opens a visible browser at Amazon sign-in, and waits for the user to finish sign-in, MFA, or a challenge directly in Amazon UI. It refuses known normal Chrome, Edge, and Chromium profile paths and refuses a non-empty unmarked directory. It does not copy cookies from another browser, take screenshots, enable traces, or print credentials. Successful handoff revalidation increments the profile's session generation.

The worker must construct `PersistentBrowserRuntime` with the account row's current `initialSessionGeneration` and persist `onSessionGeneration` before resuming automation. A changed generation invalidates previously prepared intents and cached account state.

## Runtime guarantees covered by tests

- Atomic profile-directory ownership. Existing, foreign, stale, or unreadable locks are never stolen automatically; they require explicit operator recovery after the prior browser is quiesced.
- One serialized operation stream per runtime.
- Handoff pauses automation and resumes only after challenge reclassification.
- HTTPS Amazon host allowlist; navigation to other hosts is rejected before a request.
- No Playwright video, screenshot, or trace recording.

Verification on 2026-09-22 with Node 26.7.0, Playwright 1.63.0, and Chromium 153 fixture runtime:

```text
tests/browser-runtime.test.ts: 5 passed
typecheck: passed
build: passed
```

## Provider evidence boundary

Synthetic fixtures are explicitly test data and establish extractor behavior only. Public live-read checks, authenticated cart/order reads, and authorized live cart mutations must be recorded separately. Purchases, returns, cancellations, and subscription mutations are outside ordinary verification.

The implemented read kinds are `products_search`, `products_get`, `products_variants`, `products_related`, `product_media_list`, `categories_browse`, `offers_list`, `sellers_get`, `seller_feedback_list`, `product_reviews_list`, `deals_search`, `cart_get`, `orders_list`, `orders_get`, `shipments_get`, `subscriptions_list`, `checkout_get`, and `checkout_prepare`. Checkout preparation snapshots and hashes visible exact terms; it does not create consent or submit an order.

The implemented reversible cart mutation kinds are `cart_add`, `cart_set_quantity`, `cart_remove`, and `cart_move`. `cart_add` requires `{ asin, quantity, expectedRevision, expectedSellerId, expectedCondition, purchaseMode: "one_time" }`. It re-reads the cart revision, confirms the exact child ASIN, seller ID, condition, positively selected purchase mode, and quantity before clicking, then requires the matching cart quantity to increase by exactly the requested amount. Any failure after dispatch returns non-retryable `outcome_unknown` for reconciliation. The other cart mutations require `{ lineRef, expectedRevision }`, with absolute `quantity` or a `destination` of `save_for_later`/`restore` as applicable.

List-like public sources return partial coverage even when the visible page parsed successfully because visible DOM does not prove an exhaustive source. Missing page markers and required identities use `required:` coverage entries so callers can suppress false empty-state changes when a layout drifts.

## Logged-out public smoke

On 2026-09-22 a fresh temporary dedicated profile, headless Chromium, and the transparent `Agent/AmazonShoppingMCP` user agent accessed Amazon.com without authentication. No account page or mutation was used. A search read returned `partial`, 60 visible items, and `source_completeness` missing as designed. A product read for the first visible exact ASIN returned `ok` with visible `asin`, `title`, `url`, `byline`, `price`, `availability`, `features`, `attributes`, and `media`; rating and review count were absent on that observed layout. The final host was `www.amazon.com` and no challenge was observed. This establishes one public read observation only, not durable access, exhaustive results, authenticated support, or mutation support.
