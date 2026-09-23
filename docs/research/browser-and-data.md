# Browser and product-data research

Checked 2026-09-20. This is research for one personal Amazon.com account first, with other marketplaces later. It does not inspect an Amazon account, run browser automation against Amazon, or implement an integration. Paid services are optional.

## Recommendation

Use three replaceable layers:

1. **Deterministic Playwright workflows for Amazon account state and actions.** Run explicit, versioned page flows for cart, orders, checkout preparation, tracking, returns, and Subscribe & Save. Use a dedicated persistent browser profile and let the user complete sign-in, MFA, CAPTCHA, payment authentication, and other challenges in visible Amazon UI. Stop instead of disguising automation or bypassing a challenge.
2. **A conditional local observation store for forward history.** Where the source and provider terms permit retention, record the minimum normalized product/offer observations needed after installation. This can be a free baseline, but it is not guaranteed and provides no pre-install price history.
3. **Optional providers behind adapters.** Keepa is the strongest historical-data enrichment reviewed. Keep Amazon Creators API disabled by default; it is an affiliate advertising API whose eligibility and usage restrictions are a poor default fit for a personal installed shopping tool. Neither provider replaces the authenticated browser.

Build against the Playwright library, not an autonomous browser agent, for consequential paths. The official Playwright MCP is useful for exploration and diagnostics, but nesting a general browser MCP inside a domain MCP adds another protocol boundary without supplying Amazon schemas, state reconciliation, or action safety. Stagehand is a reasonable optional fallback for read-only extraction when a page layout changes. Browser Use is better suited to exploration or recovery than repeatable checkout and account mutations.

Keep local and hosted browser runtimes as deployment options behind the same browser adapter. The local option is the safer default for a personal account; the hosted option is useful when monitoring must continue while the Mac is off, but it moves authenticated browser state and potentially account/order data to a third party.

## Coverage map

| Capability | Deterministic authenticated browser | Keepa API | Amazon Creators API |
| --- | --- | --- | --- |
| Product search/details/variants | Current, personalized Amazon view; extraction maintenance required | Broad database search and detailed product objects; data can be delayed or absent | Official `SearchItems`, `GetItems`, `GetVariations`, and browse nodes; Associates eligibility and use constraints |
| Offers and sellers | Current visible offers, delivery context, checkout quote, seller pages | Best retrieved offers plus history; not guaranteed exhaustive; seller profile/statistics and limited recent feedback metadata | OffersV2 exposes featured listings rather than every marketplace offer |
| Product reviews | Visible rating, distribution, review pages, and text subject to pagination | Rating/review-count histories; no review text; variation `ratingCount` stopped updating 2025-04-09 | No complete review corpus |
| Media | Visible image/video/A+ pages | Image metadata, videos, and A+ content when parameters/data are available | Primary and variant image URLs; no claim of full customer media |
| Deals | Current visible Amazon event/deal pages | Price-drop deals, Lightning Deals, coupons/promotions, and deal badges | Current product/offer resources, not historical deal discovery |
| Price history | Conditional on permitted observation/retention; only post-install data | Strongest reviewed backfill: multiple price types, offer/buy-box history, gaps and sampling limits | No historical series |
| Cart, saved items, orders, checkout | Candidate UI path; unverified | No | No |
| Returns/refunds/replacements | Candidate UI path; unverified | No | No |
| Subscribe & Save | Candidate UI path; unverified; price and recurrence would require confirmation | `isSNS` indicates Buy Box eligibility, not account enrollment or management | No account subscription management |
| Shipment tracking | Candidate order/package UI path; unverified | “Tracking” means product price watches, not packages | No |

The final buyer quote must come from the authenticated Amazon page or checkout review, not Keepa. Delivery promise, tax, coupons, Prime eligibility, Subscribe & Save discount, stock, and final total depend on account, address, time, quantity, seller, and purchase mode.

## Maintenance and license evidence

Dates below are release or repository evidence, not a promise of future support.

| Project/service | Current evidence checked | License | Assessment |
| --- | --- | --- | --- |
| [Playwright](https://github.com/microsoft/playwright) | npm [`playwright` 1.63.0](https://www.npmjs.com/package/playwright), published 2026-09-04; [commit 2026-09-19](https://github.com/microsoft/playwright/commit/07f1a6154795f055f341b8972086533e8e48b36f) | Apache-2.0 | Mature deterministic browser base; preferred critical-path runtime |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | npm [`@playwright/mcp` 0.0.82](https://www.npmjs.com/package/@playwright/mcp), published 2026-09-18; [matching release commit](https://github.com/microsoft/playwright-mcp/commit/f1257a5a67aff872f947fae274759f7d54853862) | Apache-2.0 | Official and active; useful as an operator/prototyping surface, not an Amazon domain implementation |
| [Stagehand](https://github.com/browserbase/stagehand) | npm [`@browserbasehq/stagehand` 4.1.0](https://www.npmjs.com/package/@browserbasehq/stagehand), published 2026-09-09; [commit 2026-09-19](https://github.com/browserbase/stagehand/commit/ea2789ca56e8a7ee154850de37657823c98604f8) | MIT | Active local/cloud AI browser SDK; optional resilience/extraction layer, not the transaction controller |
| [Browser Use](https://github.com/browser-use/browser-use) | PyPI [`browser-use` 0.13.10](https://pypi.org/project/browser-use/), published 2026-09-04; [commit 2026-09-15](https://github.com/browser-use/browser-use/commit/d8110c5ff87ccba887aaa726cdb780f2f84bef8d) | MIT | Very active agent framework; higher run-to-run variability and model cost than scripted Playwright |
| [Keepa API](https://keepa.com/api-docs/) | Current endpoint/object documentation checked 2026-09-20 | Proprietary paid service | Best reviewed historical enrichment; token-metered, incomplete in defined ways, no buyer account actions |
| [Keepa Python client](https://github.com/akaszynski/keepa) | [v1.5.0 released 2026-07-02](https://github.com/akaszynski/keepa/releases/tag/v1.5.0); repo updated 2026-07-22 | Apache-2.0 | Maintained community client if Python is used |
| [Keepa Java client](https://github.com/keepacom/api_backend) | [commit 2026-07-25](https://github.com/keepacom/api_backend/commit/683bfa839b84d172a156085bda0b29ce8c3eee45) | Apache-2.0 | Official client, active; not a reason to introduce Java into a TypeScript server |
| [Keepa PHP client](https://github.com/keepacom/php_api) | [commit 2026-07-04](https://github.com/keepacom/php_api/commit/7b07f7cca5b6387d4081c490b0193e1a795ed493) | No SPDX license detected in GitHub metadata | Official client, but license status should be resolved before reuse |
| [Amazon Creators API](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/) | Official SDK changelog lists 1.3.0 on 2026-08-21 | Amazon service/SDK terms | Disabled by default; affiliate catalogue source only when eligibility, application form, and intended purpose fit; not a general consumer account API |

For a TypeScript implementation, a small typed Keepa HTTP adapter may be simpler than adding another language runtime. Keepa documents Node/fetch examples and also offers a [hosted MCP server](https://keepa.com/api-docs/mcp.html), but the hosted MCP's source and license were not established in this review. Direct API access gives the domain server clearer cost limits, caching, freshness metadata, and error handling.

### Keepa: exact strengths and limits

Keepa documents product lookup/search/finder, seller lookup/finder, best sellers, [browsing deals](https://keepa.com/api-docs/deals.html), Lightning Deals, graph images, and product-price tracking/notifications. Its [Product Object](https://keepa.com/api-docs/product-object.html) includes price/rank histories, product attributes, variants, images, videos, A+ content, promotions, deal badges, offers, buy-box history, and review/count history.

Important limits must be preserved in MCP responses:

- Marketplace offers are fetched according to the requested offer count. Keepa says regularly updating every offer is infeasible, stale offers occur, near-duplicates are collapsed to the cheapest, and complete coverage requires repeated requests. Use `offersSuccessful`, `liveOffersOrder`, `lastSeen`, and update timestamps. See the [Marketplace Offer Object](https://keepa.com/api-docs/offer-object.html).
- The `offers` array contains historical as well as current records. `liveOffersOrder` identifies the offers Keepa currently sees, but still does not prove the buyer's final delivered quote.
- Seller objects include identity/business fields, ratings/count histories, storefront data, and up to five recent feedback entries containing date, rating, and strike status. They do not provide the full feedback text corpus. Keepa itself labels some seller storefront/offer-derived statistics incomplete or potentially outdated. See the [Seller Object](https://keepa.com/api-docs/seller-object.html).
- Product review data is counts/history, not review bodies. Keepa states variation `ratingCount` history has not updated since 2025-04-09 because Amazon removed that data point.
- If the applicable source terms permit observation and retention, a local observer could build history only from installation onward. This free path is conditional, not guaranteed scraping access. Keepa backfill is optional and must report `trackingSince`, missing intervals, price type/condition, whether shipping is represented, and observation freshness. Do not label a partial range as an all-time low.
- Keepa's API is token-bucket metered. The [plans/tokens documentation](https://keepa.com/api-docs/plans-tokens.html) gives endpoint token costs, but an unauthenticated, stable plan-price table was not verified. Do not hard-code a monthly price; confirm it in the subscriber account before adoption.

### Amazon Creators API: optional catalogue provider

Creators API replaces the deprecated Product Advertising API and offers official SDKs for Node.js, Python, PHP, and Java. Amazon describes equivalent product-discovery operations with OAuth 2.0 credentials; see the [migration guide](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/migrating-to-creatorsapi-from-paapi) and [SDK page](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-sdk).

It is not a general personal-shopping API. [Registration](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding/register-for-creators-api) requires a finally accepted Amazon Associates account with qualified referred sales, and [best practices](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/concepts/best-programming-practices) say applications must direct sales to Amazon and comply with the Creators API terms. The current [Associates Program policies](https://affiliate-program.amazon.com/help/operating/policies) also prohibit buying through one's own Special Links, generally prohibit Program Content and Special Links in client-side installed software, and disallow price tracking/alerting unless Amazon agrees otherwise. Access rates depend on referred shipped revenue, and OffersV2 intentionally returns featured listings rather than all offers. Keep this provider disabled by default and enable it only after Amazon eligibility and the exact application/use have been confirmed; otherwise omit it.

## Browser-tool assessment

### Playwright and Playwright MCP

Playwright supplies locators, isolated contexts, traces, downloads, network observation, and persistent contexts. [`launchPersistentContext`](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context) stores cookies and local storage in a user-data directory. Its documentation warns that automating the normal default Chrome profile is unsupported and recommends a separate automation profile. Only one browser process can use a given profile directory at once.

[Playwright MCP profiles](https://playwright.dev/docs/getting-started-mcp) are persistent by default, support a chosen `--user-data-dir`, isolated sessions, and an extension path to existing tabs. For this project, prefer direct Playwright calls inside narrow Amazon tools. The MCP is useful for supervised feasibility checks and diagnosing a changed page, but it supplies no Amazon-specific pagination, normalized offer identity, freshness semantics, idempotency, or confirmation binding.

### Stagehand and Browserbase

Stagehand v4 provides Playwright-style page control plus LLM-backed `act`, `observe`, and schema-based `extract`, and runs [locally or on Browserbase](https://github.com/browserbase/stagehand/blob/main/packages/docs/v3/references/stagehand.mdx). Use it only around variable read-only content or as a supervised repair aid. A deterministic script should still select the operation, validate page state, constrain navigation, and verify the result. Do not let `agent()` decide whether to place an order, submit a return, or create/cancel a subscription.

Browserbase can keep cookies, storage, and tokens in reusable [Contexts](https://www.browserbase.com/templates/context), and offers hosted browsers, session replay, and operational observability. Those features help unattended watches but enlarge the trust boundary. Browserbase and Stagehand also advertise stealth and CAPTCHA-solving features; those features are explicitly out of scope here.

### Browser Use

Browser Use supports local and hosted browsers, custom tools, structured output, existing Chrome profiles, and an agent loop. Its [README and current release](https://github.com/browser-use/browser-use) show active maintenance. It also notes that cloud profile sync transfers cookies but not local storage, IndexedDB, or extensions, so some sites require another login.

This project needs exact state transitions more than open-ended navigation. Browser Use can help explore an unfamiliar return or subscription flow and produce fixtures, but a learned successful path should become a versioned Playwright workflow. Its hosted stealth/CAPTCHA features are not part of the design.

## Existing consumer Amazon MCPs reviewed

These are useful references, not recommended foundations.

| Repository | Maintenance/license | What it covers | Why not adopt as the core |
| --- | --- | --- | --- |
| [madebydia/amazon-mcp-server](https://github.com/madebydia/amazon-mcp-server) | [last commit 2026-06-08](https://github.com/madebydia/amazon-mcp-server/commit/b1655033776bac07e0ecdb7c26a815ec2d4fbb93); MIT | Puppeteer, local persistent profile, search, add to cart, view cart, login check | Small surface; hard-coded selectors; source contains webdriver/property changes intended to avoid detection; no orders, checkout, returns, tracking, full offers, sellers, or subscriptions |
| [rigwild/mcp-server-amazon](https://github.com/rigwild/mcp-server-amazon) | [last commit 2026-07-25](https://github.com/rigwild/mcp-server-amazon/commit/eb8ff6662d22d67ce6bf0a38c475ac003e65500c); MIT | Puppeteer/Cheerio search, product detail, cart mutations, and order-history parsing | Ordering is explicitly fake/demo; DOM parsing is narrow; no checkout, returns, package tracking, seller/offer breadth, or subscription management. Tool naming/tests may be useful references |
| [jbeshir/mcp-servers/amazon-products](https://github.com/jbeshir/mcp-servers/tree/main/amazon-products) | [repo commit 2026-07-19](https://github.com/jbeshir/mcp-servers/commit/d159085b6aae8e427d9084c58bb0e2e246ed8c07); MIT | Go/chromedp public product search/details across 22 regions | Read-only catalogue only. It advertises WAF-cookie retries and JavaScript anti-detection overrides, which conflict with this design's transparency/no-bypass constraint |

The npm package [`@striderlabs/mcp-amazon`](https://www.npmjs.com/package/@striderlabs/mcp-amazon) was also considered because it claims cart, ordering, shipment tracking, and account features. npm 0.2.0 was published 2026-06-17, but its npm metadata has no source repository and its documentation advertises webdriver masking and user-agent rotation. It was excluded from the open-source shortlist and should not be used as evidence that these flows are reliable.

## Source-site constraints translated into engineering rules

This is an engineering reading of the current source documentation, not a legal conclusion.

- The current [Amazon.com Conditions of Use](https://digprjsurvey.amazon.com/csad/help/node/GLSBYFE9MGKKQXXM), last updated 2026-08-14 on Amazon's public help renderer, directly govern the retail site. “License and Access” restricts collection/use of product listings, descriptions, or prices and use of data-mining, robots, or similar extraction tools. Its “Agents” section requires agent requests to identify themselves with `Agent/[agent name]`; agents must not conceal automation by mimicking human timing or navigation, complete or circumvent CAPTCHAs, or bypass measures controlling agent access.
- The separate [Associates Program policies](https://affiliate-program.amazon.com/help/operating/policies) impose additional constraints when Creators API, Program Content, or Special Links are involved. Technical ability to drive a visible browser does not establish that the proposed access, extraction, storage, or action is permitted. Resolve that question before live use.
- Never use stealth, webdriver masking, residential proxy rotation, CAPTCHA solvers, or fake human delays. On a challenge, return a resumable `user_action_required` result and open the visible browser for the user.
- Do not call undocumented Amazon retail endpoints as a data API, replay intercepted requests, or depend on private mobile/GraphQL protocols. Operate the visible supported web experience and verify page outcomes. This reduces coupling to private interfaces; it does not make DOM automation officially supported.
- Bound reads to the user's request. Do not crawl Amazon into a local catalogue or review database. Cache only the minimum normalized observations needed for personal history, reconciliation, and watch deduplication, subject to the source/provider terms.
- Identify a changed/blocked page as unsupported instead of retrying aggressively. Back off on throttling and stop on account security warnings.

## Local and hosted authenticated browser options

| Question | Local dedicated profile | Hosted browser/context |
| --- | --- | --- |
| Authentication custody | Cookies/storage remain on the user's Mac in a dedicated profile | Provider stores or handles browser state; credentials/cookies leave the device trust boundary |
| Login/MFA/challenges | Best experience: switch to visible browser and let user act | Requires live-view handoff; geo/IP/device changes may prompt more verification |
| Availability | Mac and service must be running; watches pause while offline | Can run scheduled monitoring while Mac is off |
| Network/account consistency | Uses user's normal region/network | Datacenter/hosted egress can change perceived location and risk signals |
| Operations | User owns browser installation, profile lock, updates, and recovery | Provider handles browsers, scaling, replay, and runtime availability |
| Sensitive artifacts | Local traces/screenshots still require redaction and retention limits | Session replay/logs may contain addresses, order data, or masked payment details; configure retention and access carefully |
| Cost | Open-source runtime plus local compute/model costs | Usage fees plus model/provider costs |

Implement both behind a `BrowserRuntime` interface, but start feasibility with local Playwright and a new, dedicated profile. Never point automation at the user's normal Chrome `User Data` directory. Encrypt or OS-protect the automation profile, exclude it from backups/source control where appropriate, serialize access, and redact logs/traces.

If hosted operation is later enabled, use a separate opt-in context, regionally appropriate egress, short retention, narrowly scoped service access, and a visible reauthentication flow. Do not copy a normal browser profile wholesale. Consider limiting hosted use initially to read-only order/price monitoring, with checkout, returns, and subscription mutations local and supervised.

## Implementation implications

- Define one typed tool per bounded read/action. Do not expose a generic `browse_anywhere` tool to normal MCP callers.
- Keep browser flows deterministic: allowed Amazon hosts, known start states, semantic locators, explicit pagination budgets, versioned extractors, before/after snapshots, and terminal-state assertions.
- Route product history through a provider-neutral interface. Store local forward observations only from sources whose terms permit the required observation and retention; enable Keepa only with configured credentials/budget. Attach source, observed/update time, marketplace, ASIN/variant, seller/condition, price type, shipping treatment, and coverage gaps to every value.
- Treat purchase, return submission, cancellation, and subscription enrollment/change as confirmed mutations. Bind approval to a fresh summary, use an operation id, and reconcile current account state before retrying after uncertainty.
- Keep LLMs away from secrets and raw profile data. Return opaque handles for address, payment, order documents, and browser handoffs. The user enters authentication/payment challenges directly into Amazon UI.
- For shipment watches, poll the authenticated order/package page at a bounded cadence and normalize visible event deltas. Keepa tracking is only for product price alerts.

## Unresolved facts to verify in feasibility

1. Whether Amazon permits the proposed personal-agent access, extraction, retention, and mutations under the 2026-08-14 Amazon.com Conditions of Use, and whether consent or written approval is required. Technical feasibility is not permission; also recheck any account-specific notices at testing time.
2. Whether transparent `Agent/[name]` browser identification changes Amazon.com access, and what supported handoff occurs when agent access is limited.
3. Current Keepa plan prices in the prospective subscriber account, token budget for representative product/offer/seller calls, and data freshness on the user's typical categories.
4. Whether the user qualifies for Creators API and whether this personal MCP's intended use satisfies its affiliate-purpose requirements. Omit it if either answer is no.
5. Exact DOM/page availability for all-offers, seller feedback, review pagination/media, saved items, order tracking, returns, and Subscribe & Save on the chosen Amazon.com account. Amazon commonly runs account/region experiments, so fixtures from public repositories are not proof.
6. Hosted-browser privacy, retention, region, live-view, and reauthentication settings acceptable to the user; do not decide local versus hosted only from feature lists.
7. Whether Amazon exposes enough stable visible identifiers to select a specific seller/condition offer and reconcile cart lines without any undocumented endpoint. If not, narrow that capability rather than infer success.
