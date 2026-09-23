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
tests/browser-runtime.test.ts: 3 passed
typecheck: passed
build: passed
```

## Provider evidence boundary

Synthetic fixtures are explicitly test data and establish extractor behavior only. Public live-read checks, authenticated cart/order reads, and authorized live cart mutations must be recorded separately. Purchases, returns, cancellations, and subscription mutations are outside ordinary verification.
