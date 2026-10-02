# Private alpha review

Review target: `v0.1.0-alpha.1`, prepared October 1, 2026 (America/Los_Angeles).

## Local release verification

On October 1, a clean source copy with no existing dependencies, build output, or
environment file passed installation from the frozen lockfile on Node 26.0.0,
typecheck, all 147 tests in 17 files with database suites enabled, the production
build, and nine compiled Chromium fixture checks. The production dependency
audit reported no known vulnerabilities.

Fresh setup created a mode-0600 `.env` and preserved it on a repeated setup run.
An isolated empty database migrated successfully. The compiled gateway and worker
started, MCP discovered all 37 tools, and diagnostics correctly reported an online
worker with live access disabled. The temporary services and database were then
removed. No Amazon session or live account action was used in this check.

Gitleaks 8.30.1 found no unreviewed secrets in the source snapshot or Git history.
Two historical findings were the same synthetic notification-test sentinel; the
exact exception is documented in `.gitleaks.toml`. A separate comparison found no
configured local token, encryption-key, or 1Password item/vault values in source
or historical blobs. These are bounded checks, not a security certification.

GitHub Actions results are the source of truth for the Linux/Node matrix; the
local result above establishes the macOS Node 26 path only.

## Start here

1. Follow the README from a fresh checkout with no existing `.env`, `dist`, or
   `node_modules`. `local:init` creates fresh private secrets.
2. Start the database, migrate, and run the gateway with the distributed defaults.
3. Run `mcp:smoke` to check discovery without contacting Amazon. Live access is off
   by default. `local:doctor` can report attention needed until the worker is
   running and access is enabled; this is expected, not proof of a failed install.
4. Run full verification with `TEST_DATABASE_URL`. A test run that skips database
   suites is not the release verification.
5. Review `docs/capabilities.md` before enabling an Amazon session. Sign-in and
   any MFA remain local, visible user interactions.

## What the evidence establishes

The application has returned authenticated local reads for cart, order history,
order details, shipment tracking, and subscriptions. Those observations are
recorded in `docs/evidence/browser.md`; they are snapshots of specific runs, not
a promise of current page compatibility. CI exercises synthetic browser pages,
real isolated Postgres databases, MCP transport, and compiled JavaScript.

Cart writes remain fixture-verified. Purchase submission, cancellations, returns,
and subscription mutations are not exposed as automated actions. There is no
hosted OAuth server or supported multi-user deployment. Optional OS notification
display and every desktop MCP client UI have not been verified.

## Source and privacy review

Publication checks include Gitleaks against all local Git history and a clean
snapshot of tracked and non-ignored source files, plus a targeted check for local
secret values and recognizable personal-data patterns. Local runtime files are
excluded. The one scanner exception is an exact synthetic notification-test
sentinel, scoped to its test file; other findings must be investigated.

These checks reduce accidental disclosure risk and do not constitute an
independent security audit. Do not add `.env`, browser profiles, database backups,
raw Amazon pages, or private diagnostic reports to the repository.

## Distribution

The repository is private for owner review and the source is licensed under MIT.
`package.json` uses `license: "MIT"` and remains `private: true` to prevent
accidental npm publication. The MIT license begins with `v0.1.0-alpha.1`; the
original alpha archive predates this change. A public repository or hosted
deployment requires a separate decision; this release does not expose a service.

The Actions workflow runs on pushes and pull requests with read-only repository
permissions. It covers Node 22, 24, and 26 with Postgres 17 and local Chromium
fixtures. A separate job scans full Git history for secrets. Actions and the
scanner archive are pinned to immutable revisions/checksums.
