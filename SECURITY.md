# Security and private data

This is an experimental local application for one personal Amazon.com account.
It has not received an independent security audit. It uses local bearer tokens;
hosted OAuth and multi-user deployment are not implemented. Keep the gateway and
database on loopback. Do not expose them through a public tunnel or proxy.

## Reporting a problem

For this private review, contact the repository owner privately through the
channel used to arrange access. Describe the affected commit, prerequisites,
expected behavior, and a minimal reproduction using synthetic data. Do not put
credentials, cookies, order records, addresses, or browser captures in issues.
No response-time guarantee or supported stable version is offered during alpha.

## Local storage

- `.env` holds generated bearer tokens and the database encryption key. The
  setup command creates it with mode 0600 and preserves existing files.
- `.local/` includes the dedicated browser profile, session cookies, and private
  diagnostic reports. Treat the whole directory as sensitive even when a report
  intentionally excludes account content.
- Postgres contains encrypted private payloads and unencrypted operational
  metadata. Protect the database, backups, and encryption key separately.
- `.env`, `.local/`, logs, build output, dependencies, and test reports are
  ignored by Git. Never force-add them or upload them as CI artifacts.

Disconnecting an account does not delete its browser profile. Follow the README's
shutdown instructions before deleting a dedicated profile or recovering a lock.
An ambiguous write is quarantined; inspect the actual Amazon state before any
operator reconciliation. Do not automatically replay it.

## Verification boundaries

CI uses synthetic browser pages and isolated test databases. It needs no Amazon
credentials, 1Password access, or paid provider key. A green build does not prove
that Amazon's current pages work or that a live cart mutation is safe.

Secret scanning is an additional check, not a guarantee. If a real credential is
committed, revoke or rotate it before addressing repository history. Never paste
the value into a report. See the release review guide for the publishing checks.
