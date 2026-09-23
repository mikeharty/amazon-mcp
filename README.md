# Amazon shopping MCP

A local TypeScript MCP gateway, durable Postgres/Graphile worker, and dedicated Playwright browser for one personal Amazon.com account. Implementation began on 2026-09-22. The broader [roadmap](ROADMAP.md) remains the target; the [capability ledger](docs/capabilities.md) records what the application actually does.

The gateway and durable core run locally. Browser extractors and cart actions are tested on synthetic pages; live Amazon account compatibility is not yet established. Live browsing, retained product history and paid Keepa are disabled by default. No live purchases, returns, cancellations or subscription changes were performed.

## Run locally

Requires Node 22.18+, 24.x or 26+ (tested with 26.7.0), pnpm 10.32.1, Docker or a reachable Postgres 17 database. If pnpm is absent, replace `pnpm` below with `npx pnpm@10.32.1`.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run local:init
docker compose up -d postgres
pnpm run migrate
pnpm run dev
```

In a second terminal:

```sh
pnpm run worker
```

`local:init` generates independent random secrets into a private, ignored `.env`; it preserves an existing file. Use that exact script name; `pnpm setup` is pnpm's own shell setup command. The default database listens only on `127.0.0.1:55432`. Its development password is unsuitable for remote deployment.

The gateway binds only to `127.0.0.1:3433`:

- MCP endpoint: `http://127.0.0.1:3433/mcp`, Streamable HTTP, `Authorization: Bearer <MCP_TOKEN>` from your private `.env`.
- Owner control: `http://127.0.0.1:3433/owner`, using the separate `OWNER_TOKEN`.
- Health: `http://127.0.0.1:3433/health`.

Keep tokens out of chat, screenshots and committed client configuration. This release uses local bearer authentication; it does not implement an OAuth authorization server or expose a hosted endpoint. Compatibility is tested with the official MCP SDK's native 2026 and legacy 2025 protocol paths, not every desktop client UI.

```sh
pnpm run mcp:smoke
```

The smoke test lists tools and capability state without making Amazon requests. Browser tools return durable operation handles; poll `operations_get`. `amazon_capabilities` reports the account handle, worker state, configured providers and evidence boundary.

## Dedicated Amazon login

Stop the browser worker before launching login. The login command loads the same `.env` as the worker, including a custom `AMAZON_PROFILE_DIR`; `pnpm run browser:login -- --check-config` prints only the resolved path without opening a browser. The login script exclusively owns its profile while the user interacts with Amazon:

```sh
pnpm run browser:login
```

Complete sign-in/MFA directly in the visible dedicated Chromium window. If the initial sign-in page needs navigation, use Amazon's home/account UI. Press Enter in that terminal only after the account page is ready. No normal browser cookies are copied and no sensitive-page traces/screenshots are recorded.

After establishing the applicable source-access basis and completing login, set `AMAZON_LIVE_ENABLED=true` in `.env` and restart both gateway and worker. Browser automation is conditional on Amazon's access rules and actual page compatibility. See [source research](docs/research/browser-and-data.md) and [runtime evidence](docs/evidence/browser.md). Challenges require human interaction; there is no CAPTCHA bypass, stealth or private API fallback.

A crash may leave `.local/amazon-profile.amazon-mcp-owner`. The runtime deliberately refuses to steal any existing ownership lock. Stop all processes using that dedicated profile and verify their browser children have exited before manually removing the stale lock directory. Never delete a lock to make two browser owners run together.

`account_disconnect` cancels queued work and pauses watches after active operations settle. Owner control can enable access again; restart the worker afterward. Owner control also deletes stored private records, except when unresolved operations require the audit trail. The dedicated browser profile is retained; remove it separately only while its browser is stopped.

## Features and limits

The registered browser surface includes product/search/category/variant/media/related reads, offers, seller/feedback, reviews, deal cards, cart, order/shipment and subscription reads, and checkout review snapshots. Four cart mutations require explicit line identity, quantity, purchase mode and cart location before any UI effect, then check postconditions. Missing evidence returns unsupported before dispatch; absence of subscription text is not proof of one-time mode. Missing required identity/layout data prevents confident results or writes. These integrations remain fixture verified until separately exercised against a live account.

Checkout review snapshots are **not executable purchase authorizations**. Checkout submission, payment/address/shipping selection, order cancellation/editing, returns/replacements, subscription mutation/enrollment and review submission are not exposed as automated actions. `content_draft` preserves supplied review/feedback/support text for owner review and never publishes. Internal action-proposal validation and the consent journal are tested with simulated effects; that does not establish an Amazon submission adapter.

Watches observe configured product/offer/order/shipment/subscription reads at intervals of at least five minutes. Product watches can emit only when an observed USD price crosses down to a configured threshold. Notifications stay in a durable owner-scoped inbox (`events_list` and `amazon://events`). The Mac and worker must be awake; MCP does not wake a closed client. Optional macOS desktop notices are implemented and default off: set `DESKTOP_NOTIFICATIONS=true` and restart gateway/worker to enable generic private-inbox notices. Delivery state is persisted; an interrupted delivery is not blindly repeated. The adapter is tested with fake delivery, and actual OS notification permission/display remains unverified. No email or Web Push integration is configured.

`RETAIN_OBSERVATIONS=true` enables product observations collected by this installation; there is no pre-install history. Product history survives ordinary worker/session restarts. Each point retains encrypted source/session/delivery provenance; unknown delivery contexts remain separate and are never merged into a quote. Keepa needs an existing paid key plus `KEEPA_ENABLED=true`. Limits in `.env.example` cap calls and estimated/reported token use per gateway process; restart resets them, and unknown provider charges cannot be guaranteed in advance. No paid provider calls are part of tests. Creators API remains unimplemented and disabled.

## Verification

```sh
TEST_DATABASE_URL=postgres://amazon_mcp:local-development-only@127.0.0.1:55432/amazon_mcp pnpm run verify
pnpm audit
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

Local development is the implemented deployment. Hosting/hybrid choices remain documented design options, not deployed services. Nothing has been pushed or published remotely.
