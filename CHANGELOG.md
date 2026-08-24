# Changelog

This file records source changes. A merged entry does not prove that Nibleaf
Cloud or a published self-host image contains it. The committed self-host
manifest remains the authority for the latest published artifact.

## Unreleased

### Added

- Project-scoped add-ons with entitlement-aware availability, consent controls,
  reader feedback/actions, publish checks, revisions, and audit history (#103).
- Portable Harbor, Manuscript, and Signal documentation themes with distinct
  responsive structures, safe template exchange, and standalone Git exports
  (#104).
- Provider-neutral usage metering with exact quantities, advisory entitlements,
  reconciliation, export, deletion, and degraded states (#105).
- Project search configuration and privacy-safe index diagnostics for the
  tenant-safe hybrid search and grounded-answer foundation (#106).
- A project integrations engine with encrypted credentials, lifecycle actions,
  idempotency, revisions, confirmations, audit, and key rotation (#107).
- An authenticated, project-bound HTTP MCP control plane with least-privilege
  read adapters, audit, API-key expiry, host validation, and rate limiting
  (#108).

### Changed

- Added English and Arabic user, administrator, API, migration, rollback, and
  release documentation for the integrated capability set.
- Documented the Postgres dependency order: search, usage, add-ons,
  integrations, then MCP. The integrations migration owns the shared nullable
  `ApiKey.expiresAt` prerequisite used by MCP.

### Operational status

- All six capability pull requests are merged into source on `main` through
  `9fb787ef438ecee0b65da9c785ab42dd3f2bdc1c`.
- The published self-host manifest still identifies v0.1.2. No new image,
  deployment, or hosted-service availability is claimed by this entry.
- Operators must use a matching future artifact or reviewed source build and
  follow `docs/self-hosting/combined-release-migration.mdx` before upgrading.
