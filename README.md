# Amazon shopping MCP

A local TypeScript MCP gateway, durable Postgres/Graphile worker, and dedicated Playwright browser for one personal Amazon.com account. The broader [roadmap](ROADMAP.md) remains the target; the [capability ledger](docs/capabilities.md) records what the application actually does.

The gateway and durable core run locally. Authenticated headless MCP reads have returned the cart, paginated order history, order details, split-shipment tracking and subscription inventory from the configured personal account. The 1Password helper has submitted a password successfully and reached Amazon's authenticator step. Cart writes remain fixture-verified. Live browsing, retained product history and paid Keepa are disabled by default. No live purchases, returns, cancellations or subscription changes were performed.

**Private alpha (`v0.2.0-alpha`).** Unofficial and unaffiliated with Amazon. Intended for local personal use; page compatibility may change. Licensed under the [MIT License](LICENSE); the repository remains private for review. Start with the [release review guide](docs/RELEASE_REVIEW.md), [changelog](CHANGELOG.md), and [security notes](SECURITY.md).

## New shopping workflows

Create USD price alerts with `price_alert_create`, display observed product images with `product_image_get`, and compare two to five products with `products_research`. Research fetches current observations and returns a transparent preference-weighted ranking with source excerpts and unknowns. `orders_search` searches bounded pages of the current history view; `orders_export` returns CSV/JSON and coverage metadata. These features do not establish exhaustive history, all-in prices, or verified product compatibility. See [examples and limits](docs/SHOPPING_WORKFLOWS.md).

The server exposes 38 tools in the default Amazon read-only mode, or 42 with cart writes explicitly enabled. Read-only mode permits local alerts while blocking Amazon mutations in both gateway and worker.

## Run locally

Requires Node 22.18+, 24.x or 26+ (tested with 26.0.0), pnpm 10.32.1, Docker or a reachable Postgres 17 database. If pnpm is absent, replace `pnpm` below with `npx pnpm@10.32.1`.

```sh
pnpm run local:setup
pnpm run local:start
```

Setup installs locked dependencies and Chromium, creates private secrets if needed, starts the local Postgres service, builds/migrates, and generates a private client configuration. Use `--no-docker` with a preconfigured external database. The foreground start command waits for gateway and worker readiness; Ctrl-C stops both. A child exit stops its companion. No existing services or browser locks are taken over.

For first sign-in or session recovery, stop existing services and run:

```sh
pnpm run local:start --login
# Or use the optional 1Password helper:
pnpm run local:start --1password
```

After sign-in, enable `AMAZON_LIVE_ENABLED=true` in `.env` and restart. `AMAZON_READ_ONLY=true` is the default: live account reads and local alerts work, but Amazon cart mutations are unavailable. Enabling the existing cart adapters requires an explicit `AMAZON_READ_ONLY=false` in both gateway and worker; live cart writes remain unverified.

For manual operation, the individual `local:init`, `migrate`, `dev`, `worker`, and `browser:login` commands remain available. [Workflow documentation](docs/SHOPPING_WORKFLOWS.md) includes client setup and recovery details.

`local:init` generates independent random secrets into a private, ignored `.env`; it preserves an existing file. Use that exact script name; `pnpm setup` is pnpm's own shell setup command. The default database listens only on `127.0.0.1:55432`. Its development password is unsuitable for remote deployment.

The worker and login commands build and run compiled JavaScript. Run them through the package scripts: executing their TypeScript directly with `tsx` can inject helpers into Playwright callbacks that are unavailable inside Chromium. `pnpm verify` includes a separate compiled-browser fixture check.

The gateway binds only to `127.0.0.1:3433`:

- MCP endpoint: `http://127.0.0.1:3433/mcp`, Streamable HTTP, `Authorization: Bearer <MCP_TOKEN>` from your private `.env`.
- Owner control: `http://127.0.0.1:3433/owner`, using the separate `OWNER_TOKEN`.
- Health: `http://127.0.0.1:3433/health`.

Keep tokens out of chat, screenshots and committed client configuration. This release uses local bearer authentication; it does not implement an OAuth authorization server or expose a hosted endpoint. Compatibility is tested with the official MCP SDK's native 2026 and legacy 2025 protocol paths, not every desktop client UI.

```sh
pnpm run mcp:smoke
```

The smoke test lists tools and capability state without making Amazon requests. Browser tools return durable operation handles; poll `operations_get`. `amazon_capabilities` reports the account handle, worker state, configured providers and evidence boundary.

For local troubleshooting:

```sh
pnpm run local:doctor
pnpm run local:doctor --json
```

This calls `amazon_diagnostics` without accessing Amazon or retrying jobs. It reports the worker heartbeat, queued/active/uncertain job counts and recovery guidance. Exit 0 means local service availability, 2 means attention is needed, and 1 means diagnostics could not be read. Availability does not establish current Amazon sign-in. Worker liveness is service-wide; queue counts and recent job metadata are scoped to the authenticated owner.

After a client disconnect, `operations_list` can recover job handles. Filter by `accountRef`, `kind`, `mode` or `status`; use `limit` (1–100, default 25), then pass `data.nextCursor` with the same filters. Cursors are encrypted and bound to the owner and filters. History contains metadata and timestamps only; retrieve the selected result through `operations_get`. It never retries a job, clears quarantine or substitutes for Amazon order history.

MCP clients also receive server workflow instructions and can read `amazon://guide` for polling/recovery examples or `amazon://status` for local health. `amazon://events` remains the notification inbox. These resources require account read access.

## Dedicated Amazon login

Stop the browser worker before launching login. The login command loads the same `.env` as the worker, including a custom `AMAZON_PROFILE_DIR`; `pnpm run browser:login -- --check-config` prints only the resolved path without opening a browser. The login script exclusively owns its profile while the user interacts with Amazon:

```sh
pnpm run browser:login
```

Complete sign-in/MFA directly in the visible dedicated Chromium window. Login starts at Amazon's account page so Amazon constructs the sign-in flow. The command checks the session automatically and closes the browser when verification succeeds; Enter also checks immediately. If sign-in is incomplete, the same window remains open. Closing the terminal input or pressing Ctrl-C closes its browser and releases the profile lock. No normal browser cookies are copied and no sensitive-page traces/screenshots are recorded.

The worker uses Playwright with Chromium's modern headless mode by default (`AMAZON_HEADLESS=true`). Set it to `false` for a visible worker during debugging. The login command always stays visible; both commands use the same dedicated profile so its saved Amazon session survives browser restarts. A sign-in or human challenge pauses automation: stop the worker, run `browser:login`, complete sign-in, then restart the worker. Only one process may own the profile at a time.

For 1Password-assisted password login, install the official `op` CLI and enable [desktop app integration](https://www.1password.dev/cli/app-integration), then run:

```sh
pnpm run browser:login:1password
```

Unlock 1Password and approve its CLI prompt. The helper selects a unique Login item whose website is `https://amazon.com` or `https://www.amazon.com`; if several match, set `AMAZON_1PASSWORD_ITEM` to the intended item ID in `.env` (optionally scope it with `AMAZON_1PASSWORD_VAULT`). It requests only the username and password, keeps them in local process memory, validates the Amazon sign-in form before filling, and submits the password once. Credentials are not printed, stored in `.env`, or passed as command arguments. Browser debug logging is disabled for login. MFA, CAPTCHA, passkeys, unfamiliar layouts, and password-only screens whose account was not selected by this attempt require manual completion. The helper never changes vault items or installs an extension.

You can also use 1Password's supported [browser extension](https://support.1password.com/1password-extension/) or [Mac Autofill](https://support.1password.com/mac-universal-autofill/), subject to compatibility with the dedicated browser. An existing session in ordinary Chrome is separate from this dedicated profile.

After establishing the applicable source-access basis and completing login, set `AMAZON_LIVE_ENABLED=true` in `.env` and restart both gateway and worker. Browser automation is conditional on Amazon's access rules and actual page compatibility. See [source research](docs/research/browser-and-data.md) and [runtime evidence](docs/evidence/browser.md). Challenges require human interaction; there is no CAPTCHA bypass, stealth or private API fallback.

With the gateway and worker running, verify the authenticated read path:

```sh
pnpm run amazon:smoke
```

This checks access configuration and worker health, then reads the cart, the first order-history page and subscription inventory in sequence through MCP. Each account read requires a visible signed-in Amazon greeting. A challenge stops the batch for human sign-in. The check never dispatches cart edits or checkout actions.

To also check one recent order's details and shipment tracking:

```sh
pnpm run amazon:smoke --order-details
```

The extended check selects an observed order from that history page and calls `orders_get` and `shipments_get`. It verifies the returned order identity and reports how many tracking pages were recognized. The private report retains neither the order number nor tracking URLs. If the account has no observed order to check, it reports `no_order_available` without guessing an identifier.

A private mode-0600 JSON report is saved under `.local/evidence/`. It contains timestamps, operation handles, item counts and known coverage labels; it excludes product titles, order numbers, page URLs, addresses, credentials and raw provider errors. Exit code 0 means all three reads returned authenticated, recognized pages with the required read evidence; source completeness can still be partial. A `cart_mutation_evidence` gap also permits a successful read check, while preventing mutations when the target line lacks seller, condition or purchase-mode evidence. Exit code 2 means blocked or incomplete verification, and 1 means the connection or report could not be completed. Each read is bounded to 60 seconds. A timeout preserves its operation handle in the report; the queued read may still finish, so inspect `operations_get` before rerunning.

A crash may leave `.local/amazon-profile.amazon-mcp-owner`. The runtime deliberately refuses to steal any existing ownership lock. Stop all processes using that dedicated profile and verify their browser children have exited before manually removing the stale lock directory. Never delete a lock to make two browser owners run together.

`account_disconnect` cancels queued work and pauses watches after active operations settle. Owner control can enable access again; restart the worker afterward. Owner control also deletes stored private records, except when unresolved operations require the audit trail. The dedicated browser profile is retained; remove it separately only while its browser is stopped.

## Features and limits

The registered browser surface includes product/search/category/variant/media/related reads, offers, seller/feedback, reviews, deal cards, cart, order/shipment and subscription reads, and checkout review snapshots. Account reads require visible signed-in evidence before extraction and mark that evidence in their observation metadata; an unverified session returns a human sign-in handoff. Four cart mutations require explicit line identity, quantity, purchase mode and cart location before any UI effect, then check postconditions. Missing evidence returns unsupported before dispatch; absence of subscription text is not proof of one-time mode. Missing required identity/layout data prevents confident results or writes. Other account paths and all cart actions remain fixture-verified; see the capability ledger for their evidence boundaries.

Order history includes observed dates, totals and pagination metadata; a page mismatch is reported explicitly. Order details include the displayed total, item links, document availability and split-shipment item mapping. Shipment reads follow only the displayed Amazon tracking links for that exact order, recheck sign-in and package identity, and return delivery estimates plus milestone completion states. Future milestones are not presented as completed events. Local checks have verified split-shipment tracking and a second history page. Each shipment read visits at most five tracking pages and reports partial coverage for any remaining details. Exhaustive history, carrier event timelines and invoice downloads are not established.

Checkout review snapshots are **not executable purchase authorizations**. Checkout submission, payment/address/shipping selection, order cancellation/editing, returns/replacements, subscription mutation/enrollment and review submission are not exposed as automated actions. `content_draft` preserves supplied review/feedback/support text for owner review and never publishes. Internal action-proposal validation and the consent journal are tested with simulated effects; that does not establish an Amazon submission adapter.

Watches observe configured product/offer/order/shipment/subscription reads at intervals of at least five minutes. Product watches can emit only when an observed USD price crosses down to a configured threshold. Notifications stay in a durable owner-scoped inbox (`events_list` and `amazon://events`). The Mac and worker must be awake; MCP does not wake a closed client. Optional macOS desktop notices are implemented and default off: set `DESKTOP_NOTIFICATIONS=true` and restart gateway/worker to enable generic private-inbox notices. Delivery state is persisted; an interrupted delivery is not blindly repeated. The adapter is tested with fake delivery, and actual OS notification permission/display remains unverified. No email or Web Push integration is configured.

`RETAIN_OBSERVATIONS=true` enables product observations collected by this installation; there is no pre-install history. Product history survives ordinary worker/session restarts. Each point retains encrypted source/session/delivery provenance; unknown delivery contexts remain separate and are never merged into a quote. Keepa needs an existing paid key plus `KEEPA_ENABLED=true`. Limits in `.env.example` cap calls and estimated/reported token use per gateway process; restart resets them, and unknown provider charges cannot be guaranteed in advance. No paid provider calls are part of tests. Creators API remains unimplemented and disabled.

## Verification

```sh
TEST_DATABASE_URL=postgres://amazon_mcp:local-development-only@127.0.0.1:55432/amazon_mcp pnpm run verify
pnpm run test:startup
pnpm audit --prod
```

Database tests create and drop isolated temporary databases on that server, so the test role needs database-creation privileges. Without `TEST_DATABASE_URL`, those tests are explicitly skipped. Browser tests use synthetic fixtures in temporary profiles. Tests never buy, return, cancel or subscribe on Amazon.

The durable journal atomically publishes jobs, consumes one consent into one operation across every idempotency key, scopes handles to owners, and encrypts private payloads. A lost/ambiguous write outcome quarantines later writes. Automatic replay cannot clear that state; reconciliation is currently an operator task requiring observed evidence. There is no general-purpose MCP tool to bypass quarantine.

## Repository map

- `apps/gateway`: local HTTP adapter, typed MCP registry, separate owner UI.
- `apps/worker`: persistent queue/browser worker.
- `packages/store`: encrypted state, consent/operation journal, watches/events and migrations.
- `packages/browser-runtime`: exclusive dedicated-profile actor and human handoff.
- `packages/providers`: Amazon UI extraction/cart actions and optional Keepa.
- `packages/core`: execution, offer comparison and action-proposal rules.
- `tests`: MCP client, real Postgres/queue, browser fixture and domain coverage.
- [Implementation status](docs/IMPLEMENTATION.md), [capability ledger](docs/capabilities.md), [original architecture](docs/architecture.md), [requirements](docs/requirements.md), [proposed tools](docs/tool-catalog.md), [workstreams](docs/workstreams.md).

Local development is the implemented deployment. Hosting/hybrid choices remain documented design options, not deployed services. This source is prepared for private GitHub review; no hosted service or npm package is published.
