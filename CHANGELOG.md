# Changelog

## 0.1.0-alpha — 2026-10-01

Initial private review release of an unofficial local Amazon.com MCP server for
one personal account.

- 37 MCP tools and three resources, including local diagnostics, operation
  history, and workflow guidance.
- Durable Postgres/Graphile operations with owner scoping, encrypted private
  payloads, and quarantine after uncertain writes.
- Dedicated persistent Playwright Chromium profile, headless reads, visible
  human sign-in, and optional 1Password CLI assistance.
- Authenticated reads for cart, paginated order history, order details,
  split-shipment tracking, and subscription inventory observed in local testing.
- Cart adapters covered by synthetic fixtures; live write behavior is not
  established. No automated purchase submission, cancellations, returns,
  subscription changes, or review publication.
- Optional local watch inbox and retained product observations. Paid Keepa
  integration remains disabled unless explicitly configured.
- Reproducible verification against Postgres and compiled Chromium fixtures,
  plus CI and secret scanning. No account credentials are needed for CI.

This is a private source release, not an npm package or hosted service. The
software is experimental, unaffiliated with Amazon, and all rights are reserved
pending a licensing decision. See [review notes](docs/RELEASE_REVIEW.md).
