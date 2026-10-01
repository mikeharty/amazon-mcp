# Contributing during private review

Start with the [README](README.md) and [capability ledger](docs/capabilities.md).
This repository is currently private and all rights are reserved; access for
review does not grant an open-source license.

Use Node 22.18+, 24.x, or 26+ and pnpm 10.32.1. Install from the committed lockfile,
install Playwright Chromium, and start the local Postgres service as documented.
Run the full verification before proposing a change:

```sh
TEST_DATABASE_URL=postgres://amazon_mcp:local-development-only@127.0.0.1:55432/amazon_mcp pnpm run verify
pnpm audit --prod
```

The database suites create and drop isolated databases; the test role needs
`CREATEDB`. Without `TEST_DATABASE_URL`, those suites skip and verification is
incomplete. The compiled browser check matters: TypeScript test transpilation can
hide failures in callbacks executed inside Chromium.

Keep fixtures synthetic. Preserve owner scoping, exact cart identity, conservative
coverage reporting, and quarantine after ambiguous writes. Never add retries that
can repeat a dispatched write. Do not introduce live Amazon calls, paid provider
calls, credentials, or existing browser profiles into tests or CI.

Describe the problem, changed behavior, verification performed, and any remaining
evidence gaps. Update the capability ledger when support changes. Live purchases,
cart edits, subscriptions, cancellations, and returns are not routine release tests.
