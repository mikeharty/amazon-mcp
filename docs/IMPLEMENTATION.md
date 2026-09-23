# Implementation status

Started 2026-09-22. Manager: Astra High. Two Medium worker lanes; no remote publishing, paid activation or live consequential account actions.

## Executable sequence

1. Establish current registry/runtime evidence, shared contracts, locked dependencies and clean baseline.
2. In parallel: transport/client/queue interoperability and dedicated browser/runtime/domain extraction.
3. Manager builds Postgres journal, atomic consent/idempotency, quarantine, observation/watch/event persistence and integrates both lanes.
4. Extend practical domain reads, cart and transaction preparation/execution contracts against offline browser fixtures; keep unsupported live flows explicit.
5. Run typecheck/build/unit, real Postgres/queue, MCP client and browser-fixture checks. Run permitted read-only public smoke; provide dedicated login instructions when ready.
6. Same-worker defect loop; integrate accepted commits; document implemented vs fixture/live evidence and operation commands.

## Current status

- Healthy existing non-bare repository; no application baseline before this run.
- Registry recheck: mcp-handler 2.2.0, MCP server/client 2.0.0, Playwright 1.63.0, Graphile Worker 0.18.0.
- Node 26.7.0 present; pnpm not on PATH. Use pinned pnpm through npm exec.
- Personal Amazon authentication and actual client UI remain unverified. No secrets requested or account mutations performed.

## Gates

Record source access basis before live activation; no stealth, CAPTCHA bypass, private APIs or copied browser profiles. Real purchases/returns/cancellations/subscriptions require a concrete user request, never tests. All external writes use exact state and postconditions; ambiguous dispatch quarantines future writes. Simulation is not live verification.

## 2026-09-22 integration milestones

- Baseline committed; two isolated Medium worktrees active. Transport commit and manager-requested streaming-bound fix integrated.
- Actual local Node HTTP gateway runs at loopback port 3433; SDK smoke negotiates MCP 2026-07-28 and discovers 21 typed tools at this milestone. Legacy 2025 path independently tested.
- Loopback Postgres 17 container started; encrypted app tables and Graphile migrations applied. Local secrets generated into ignored mode-0600 .env, never printed.
- 18 tests currently pass: SDK transport/auth/body bounds; real Postgres consent/idempotency/uncertainty/ownership; actual Graphile serialization/restart/replay/rollback; owner login/CSRF/escaped review; money/crypto.
- Browser worker expanding 18 reads plus four cart mutations and checkout snapshots. Review identified and is fixing click-timeout uncertainty, exact-offer/delta verification and stale profile lock takeover before enabling them.
- Optional Keepa adapter is in second worker lane. Paid API calls remain disabled; fixtures test decoding and budgets.
- No personal Amazon account connected or live mutation attempted. Live operation activation and observation retention default off.

## Integration in progress, 19:05 local

- Accepted optional Keepa adapter and review fixes: 10 bounded-provider tests, no paid API calls.
- Real registry now tested over production HTTP bridge + SDK + PostgreSQL: discovery, durable read result, owner isolation, scope rejection and strict write input rejection.
- Disconnect/delete/reconnect added; 9 store tests and 2 real queue tests pass. New account generation invalidates old consent; unresolved effects block audit deletion.
- Browser final review returned layout completeness, exact-order identity, cart destination/offer checks and checkout URL restrictions to the same worker. Integration waits for those fixes.
- Internal order/return/replacement/subscription proposal validation is being reviewed independently; it will not be represented as a live submission adapter.
- README now documents actual install/start/login/test commands and default-off live/paid settings. Capability ledger separates delivered code from broader planned work.

## Final integrated verification, 2026-09-22

- `TEST_DATABASE_URL=postgres://amazon_mcp:local-development-only@127.0.0.1:55432/amazon_mcp npx pnpm@10.32.1 run verify`: **64 tests, 11 files passed**, typecheck and build passed, no skipped database suites. Tests create/drop distinct temporary databases; browser tests intercept all network and use synthetic pages.
- Full `npx pnpm@10.32.1 audit --json`: **zero advisories**, including development dependencies. Vitest upgraded from the initial 3.2.4 baseline to maintained 5.0.1 after the [maintainer advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9); tsx upgraded to 4.23.15. Registry versions and engine requirements were rechecked before install.
- Browser domain/runtime regression suite: 14 tests. Logged-out public search read observed 60 visible results and one exact product page; see browser evidence. No authenticated account read or live mutation was performed.
- macOS desktop adapter: 7 fake-delivery tests, default disabled; no actual notification sent. Durable outbox records accepted/failed/unknown states and never replays uncertain dispatch. Product price thresholds emit only downward crossings, with real database tests.
- Production HTTP + complete registry + official MCP SDK + Postgres: 3 integration tests, including owner isolation, input/scope checks, durable read results and exact user draft preservation.
- The separate login process remains waiting for human completion; no Enter/resume signal has been sent without a user answer. Account/live browsing and paid Keepa remain disabled in local configuration.
- Remaining feature gaps and their evidence boundaries are detailed in [capabilities](capabilities.md). Local deployment only; no remote push, deployment, paid call or shopping commitment.

### Final runtime smoke

The compiled gateway and worker run from `dist/` on loopback. `node --env-file=.env dist/scripts/mcp-smoke.js` negotiated MCP `2026-07-28`, discovered **35 tools**, and returned `workerOnline=true`, `liveEnabled=false`, `keepaEnabled=false`, and event-inbox-only configured delivery. Compiled worker registered `execute_operation`, `observe_watch` and `deliver_notification`. Markdown local links and `git diff --check` passed; repository remains non-bare.

64 tests by area: browser runtime/provider 14; transport 4; production registry 3; Postgres store 12; Graphile queue 2; owner UI 1; core money/crypto 4; action proposals 7; Keepa 10; notification adapter 7.
