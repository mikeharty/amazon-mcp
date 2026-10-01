# Browser runtime evidence

Status: authenticated headless MCP reads completed for cart, paginated order history, subscriptions, order detail and split-shipment tracking. Live 1Password retrieval and one password submission reached Amazon's authenticator step in a separate verification profile. No live account mutation was attempted. Ordinary Chrome cookies were not imported.

## Order-to-tracking verification, 2026-09-28 Pacific / 2026-09-29 UTC

The extended check `pnpm run amazon:smoke --order-details` completed through the actual MCP gateway and headless Graphile worker at **04:59:47–05:00:00 UTC**. It observed seven saved cart items, ten first-page orders, four subscriptions, one order with two items and two shipment groups, and **two verified tracking pages**. Dates and totals were present for every observed history record. The report is `.local/evidence/amazon-reads-2026-09-29T04-59-47.828Z-2b9b0385-2e34-4bde-9027-49eeacc761fe.json` (ignored, mode 0600).

A separate MCP page-two read at 05:00:30 UTC returned nine records, observed selected page 2, and no next-page link. Dates, totals and item links were present. This verifies two pages of the current history view, not exhaustive lifetime history. Its redacted report is `.local/evidence/order-pagination-2026-09-29T05-00-30.012Z.json`.

The live investigation found missing history totals and an unrecognized `#orderDetails` layout. Extraction now uses labeled header fields, the displayed order number and grand total, and each shipment's own item container. Invoice availability and action labels remain scoped to that order. Product links are normalized to canonical ASIN URLs; raw tracking URLs are used only within the read workflow and are never returned in results or reports.

Tracking follows the observed `/progress-tracker/package` links for that order only. It requires signed-in evidence, matching order/package navigation parameters, and a visible order-info link back to the requested order. Both live wrappers (`#pt-page-container` and `#pageContainer`) are supported. Delivery estimates and accessible milestone completion states are returned without treating future milestones as completed history. Up to five tracking pages are visited per operation; unread or unrecognized tracking detail remains an explicit coverage gap. No carrier API, private endpoint, delivery photo or document download was used.

Full verification passed **141 tests in 16 files**, with real Postgres suites enabled, typecheck/build, and **nine compiled Chromium checks**. Tests include split packages, unrelated order numbers, wrong-package redirects, hidden identity evidence, foreign links, sign-in expiry, page mismatches and bounded navigation. The primary headless worker is running with these changes. The separate authenticator-code window does not own or block that profile.

## Cart and subscription compatibility check, 2026-09-28 Pacific / 2026-09-29 UTC

The MCP/Graphile batch at 04:38:22–04:38:28 UTC completed with verified authentication and recognized layouts for all three reads:

- Cart: seven saved items with observed quantity and line identity; a visible heading explicitly established an empty active cart. Missing seller, condition and purchase mode are reported as `cart_mutation_evidence`. These gaps do not invalidate the read, and the existing strict mutation guards still reject changes without that evidence. The optional absent subtotal no longer causes a 30-second wait.
- Orders: ten first-page records; source completeness remains partial.
- Subscriptions: four modern tiles with observed title, identity, quantity, frequency and next-delivery label. Identity comes from the edit destination attached to each rendered tile; no AJAX endpoint or embedded application state was accessed. Source completeness remains partial. Empty modern inventories require an explicit visible empty-state message.

The redacted mode-0600 report is `.local/evidence/amazon-reads-2026-09-29T04-38-22.232Z-4228cf74-e274-4746-82a6-c354043f96d7.json` (ignored). No mutations, paid calls or watches were dispatched.

The separate login check successfully retrieved the selected Personal vault item's username/password, including a renamed password display label whose stable field ID remains `password`. Amazon rendered the password form directly at `/ax/claim`; the helper now accepts that observed page while still requiring a POST to Amazon's `/ap/signin` before filling the password. A single password submission reached Amazon's Two-Step Verification page requesting an authenticator code. That code remains a human handoff; the primary authenticated session was preserved.

Verification at that stage: **122 tests in 15 files**, real Postgres suites enabled, typecheck/build passed, plus **six compiled Chromium fixture checks**. The compiled password-flow check covers the same email-claim layout and avoids regressions hidden by test transpilation.

The gateway and primary headless worker were restarted after verification; the SDK health check reported 35 tools, live access enabled, an online worker and no account quarantine. Live access is enabled through process environment overrides for these running services; the private `.env` and distributed defaults remain off. The separate visible login window remains open for the authenticator code.

## Dedicated login

Run from the repository root:

```sh
AMAZON_PROFILE_DIR="$PWD/.local/amazon-profile" pnpm browser:login
```

The script creates or reuses only its marked dedicated profile, opens a visible browser at Amazon sign-in, and waits for the user to finish sign-in, MFA, or a challenge directly in Amazon UI. It refuses known normal Chrome, Edge, and Chromium profile paths and refuses a non-empty unmarked directory. It does not copy cookies from another browser, take screenshots, enable traces, or print credentials. Successful handoff revalidation increments the profile's session generation.

The worker must construct `PersistentBrowserRuntime` with the account row's current `initialSessionGeneration` and persist `onSessionGeneration` before resuming automation. A changed generation invalidates previously prepared intents and cached account state.

## 1Password and headless login checks, 2026-09-28

`pnpm run browser:login:1password` uses the local official `op` CLI to select a unique Amazon Login item and request only its username/password fields. Multiple matching items require an explicit item ID. The helper checks the HTTPS Amazon page and form destination before each fill and submission, makes one password attempt, and leaves unfamiliar layouts and authentication challenges visible for human completion. Password-only screens are not filled unless the same attempt supplied the username. Credentials and raw errors never enter application logs; login disables Playwright debug output. No extension or vault change is performed.

Live signed-out checks with the dedicated profile confirmed Amazon's account landing page, its JavaScript sign-in link, and the current email form (`ap_email_login`, a wrapped Continue button, and Amazon's `/ax/claim` destination). Both visible and headless Chromium reached the sign-in page. The local 1Password app was locked, and the CLI request timed out without returning login metadata. Credential retrieval, successful Amazon authentication, and authenticated headless reuse remain unverified.

A subsequent user-authorized CLI request successfully listed Amazon login metadata. Two matching Login items exist, so the helper correctly stopped before credential retrieval and requires explicit item selection. The local account is enabled and not quarantined; preflight found no queued/running/uncertain operations or watches.

Ctrl-C was checked against the visible login process: the browser closed, exit status was 2, and the same profile immediately reopened successfully. A subprocess regression also checks graceful SIGINT cleanup and lock removal. Latest verification: **109 tests in 15 files**, typecheck and production build passed. Tests cover destination validation, vault ambiguity, secret redaction, MFA handoff, headless profile persistence, and the serialized handoff fence. These do not establish live password-login success.

## Authenticated headless MCP reads, 2026-09-28 Pacific / 2026-09-29 UTC

The owner selected the Personal vault's Amazon item. Its item/vault IDs are configured only in the ignored private `.env`. The dedicated session had already completed visible sign-in; a new login run recognized it without requesting or submitting another password. A fresh headless Chromium process then verified the signed-in Amazon account greeting at 02:09:34 UTC. Automated 1Password password submission remains fixture-verified; it was not needed to establish this already authenticated session.

The actual gateway/Graphile worker returned authenticated observations for all three reads at 02:14:50–02:15:25 UTC:

- Cart: 7 visible lines; `required:cart_line_identity` remained missing. This does not establish safe cart mutation support. The optional subtotal selector also caused a roughly 30-second read delay on this layout.
- Order history: 10 visible records on the first page, with partial source completeness. This does not establish exhaustive history or every order field.
- Subscriptions: the expected page marker was absent. The empty extracted array does not establish an empty subscription inventory.

The verifier correctly reported the batch as incomplete. Redacted mode-0600 reports are in ignored `.local/evidence/`; private account content is not committed. No cart changes, purchases, subscription edits, paid calls or watches were performed. Temporary gateway/worker processes were stopped and the profile lock released afterward; persistent live access remains disabled in `.env`.

The run exposed two implementation faults that fixture-only checks had missed: `tsx` injected a `__name` helper into browser callbacks, and the verifier expected `running` instead of the journal's `working` status while requiring a result before one existed. Worker/login package commands now build and run compiled JavaScript. Polling accepts the actual queued/working lifecycle, permits an absent pending result, and still rejects missing terminal results. Full verification now includes a compiled Chromium fixture check for cart, orders and subscriptions.

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

## Account-read verification, 2026-09-27

`pnpm run amazon:smoke` runs three account reads through the actual MCP gateway: `cart_get`, `orders_list` (page 1), and `subscriptions_list`. It checks enabled access, worker health and tool availability before dispatch, polls each durable operation for at most 60 seconds, and stops on a human challenge or transport failure. The report records known coverage gaps and distinguishes an unrecognized empty page from an observed empty collection. A completed check does not claim exhaustive order history, subscription coverage or a working mutation adapter.

Account reads now require a visible Amazon.com navigation greeting with a named `Hello, …` state rather than `Hello, sign in`. Verified results carry `observation.authentication: "verified"`; the verifier rejects results without that evidence. This establishes the observed page sign-in state, not an independently verified legal identity. Missing, generic, hidden and signed-out greetings are covered by synthetic browser tests.

Reports are mode-0600 files under ignored `.local/evidence/`. They contain counts, timestamps, operation handles and allowlisted diagnostic labels only. Tests cover private-data exclusion, disabled/offline preflight, incomplete layouts, challenges, polling timeout, mismatched operation handles and the real HTTP/SDK/database path with simulated provider results. No authenticated live-read success is claimed by those tests. Dedicated human sign-in is still required before collecting live evidence.

The implemented read kinds are `products_search`, `products_get`, `products_variants`, `products_related`, `product_media_list`, `categories_browse`, `offers_list`, `sellers_get`, `seller_feedback_list`, `product_reviews_list`, `deals_search`, `cart_get`, `orders_list`, `orders_get`, `shipments_get`, `subscriptions_list`, `checkout_get`, and `checkout_prepare`. Checkout preparation snapshots and hashes visible exact terms; it does not create consent or submit an order.

The implemented reversible cart mutation kinds are `cart_add`, `cart_set_quantity`, `cart_remove`, and `cart_move`. `cart_add` requires `{ asin, quantity, expectedRevision, expectedSellerId, expectedCondition, purchaseMode: "one_time" }`. It re-reads the cart revision, confirms the exact child ASIN, seller ID, condition, positively selected purchase mode, and quantity before clicking, then requires the matching cart quantity to increase by exactly the requested amount. Any failure after dispatch returns non-retryable `outcome_unknown` for reconciliation. The other cart mutations require `{ lineRef, expectedRevision }`, with absolute `quantity` or a `destination` of `save_for_later`/`restore` as applicable.

List-like public sources return partial coverage even when the visible page parsed successfully because visible DOM does not prove an exhaustive source. Missing page markers and required identities use `required:` coverage entries so callers can suppress false empty-state changes when a layout drifts.

## Logged-out public smoke

On 2026-09-22 a fresh temporary dedicated profile, headless Chromium, and the transparent `Agent/AmazonShoppingMCP` user agent accessed Amazon.com without authentication. No account page or mutation was used. A search read returned `partial`, 60 visible items, and `source_completeness` missing as designed. A product read for the first visible exact ASIN returned visible `asin`, `title`, `url`, `byline`, `price`, `availability`, `features`, `attributes`, and `media`; rating and review count were absent on that observed layout. The implementation at smoke time reported `ok`; coverage hardening now reports that same field set as `partial` with `rating` and `reviewCount` missing. The final host was `www.amazon.com` and no challenge was observed. This establishes one public read observation only, not durable access, exhaustive results, authenticated support, or mutation support.
