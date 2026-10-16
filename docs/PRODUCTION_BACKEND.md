# Коптильня — production backend workstream

## Repository status at start

- Android prototype source: `smokehouse-android`.
- This work is isolated in `koptilnya-production`; `main`, `smokehouse-android`, and `smokehouse-prototype` are not modified by this workstream.
- The prototype uses localStorage and sample data. It is not a multi-tenant production application yet.
- The GitHub repository is public. Real `.BP` archives, exports containing customer information, database dumps, credentials, service-role keys, and payment secrets must never be committed here.

## Supabase project selection

No connected project was confidently identified as a dedicated Koptilnya project at the time of this audit. Do not link or apply these migrations to an unidentified project, `max-song-app`, or another application's database. Create or explicitly identify a separate project named for Koptilnya first, and confirm its organization/cost. Until then, SQL files in this branch are source only and have not been applied to any database.

## Current migration scope

The baseline migration defines tenant-owned business records, inventory ledger and atomic posting RPCs, production batches, payment allocations, subscription/entitlement tables, import and backup metadata, a server-only import staging table, audit metadata, and private Storage policies. Every public table created by the migration is covered by an explicit RLS coverage list. Subscription writes fail closed until a valid active plan/subscription row is provisioned server-side.

The branch includes:
- `supabase/config.toml` for an isolated local test project. It contains no hosted project reference or secrets.
- `supabase/tests/koptilnya_tenant_accounting.test.sql`, with synthetic pgTAP fixtures for organization isolation, inventory posting/idempotency, negative-stock rejection, payment replay, balance calculations, expired-subscription write denial, and private import staging.
- `.github/workflows/koptilnya-production-check.yml`: a PostgreSQL grammar/static contract job, a temporary local Supabase integration-test job, and the existing web/Android build pipeline.

The tests are source-controlled, but the integration suite must be reported as passed only after the corresponding CI job finishes green. A green local CI stack is not a substitute for reviewing and applying the migration to a separately identified hosted Koptilnya project.

This is a foundation, not a declaration of product completion. The following work remains before production:
- Review the migration and apply it to a separate Koptilnya project only after that project and its billing/organization are explicitly identified.
- Verify two-tenant isolation and business-operation tests in CI; add concurrency-focused tests and Storage object read/write isolation tests as the backend is expanded.
- Implement frontend Auth screens and bind existing screens to the Supabase data layer. The prototype still uses localStorage until that integration is completed.
- Configure Google OAuth and an SMS provider; credentials belong only in Supabase Auth settings.
- Select and configure a payment provider. Subscription rows are not client-writable; only a verified server-side webhook should change them.
- Build server-side export/restore and idempotent import jobs.
- Analyze the original `.BP` archive, produce a source-preserving Excel workbook and a before/after reconciliation report, and import only after explicit approval.
- Keep recipe/technology functions disabled and render only the "Скоро" stub.
- Produce a signed Android release and test on a physical device.

## Important implementation contracts

- Never ship Supabase service-role/secret keys inside Android or web assets. The client may use only the publishable key.
- All business rows include `organization_id`; child foreign keys also use composite organization-aware references.
- Inventory is changed only when a document or production batch is posted through a server transaction. Stock movement rows are read-only to clients.
- `post_document`, `post_production_batch`, and `record_payment_with_allocations` require stable idempotency keys and enforce write entitlements server-side.
- Payment receipts are not revenue. Revenue belongs to posted sale/service documents; payment allocations reduce document balances only.
- Client and product history is retained with archived rows and document snapshots. Expense corrections are represented as voided records rather than destructive deletion.
- Historical source names and identifiers should be preserved in staging/legacy fields until mapping and reconciliation are approved.
- No trial length, subscription price, or payment provider has been assumed in code.

## Setup checklist after a dedicated project is selected

1. Install the Supabase CLI and verify its version with `supabase --version`.
2. In a local checkout of this branch, initialize/link only the dedicated Koptilnya project.
3. Create the migration through the CLI, move the reviewed SQL into its generated migration file, and apply it first to a non-production branch/test project.
4. Run `supabase db lint` if supported by the installed CLI, then `supabase test db` and the project security advisors; fix all warnings before production.
5. Add project URL and publishable key as deployment configuration. Keep private/payment credentials in server-side secrets only.
6. Configure email confirmations and password recovery; enable Google only after OAuth client configuration. Enable phone OTP only after SMS-provider setup and testing.
7. Decide trial duration, tariff prices/limits, billing interval, grace period, and payment provider before enabling writes for end users.
8. Keep the migration report and source archive outside GitHub; store original file checksums with the private import run metadata.

## Original prototype baseline build

Before changes in this branch, the prototype's Android workflow succeeded on 2026-10-16:
https://github.com/cbklexa-bot/technopark-app/actions/runs/38841744614

It produced the CI artifact `koptilnya-android-test-build`. That debug package was a baseline; the newer branch's candidate artifacts are linked below.

## Latest verified CI build (2026-10-16)

Run [38874659642](https://github.com/cbklexa-bot/technopark-app/actions/runs/38874659642) completed successfully on branch `koptilnya-production`:
- PostgreSQL parser and schema/RLS contract checks passed.
- Local Supabase migration application succeeded.
- All 23 pgTAP integration assertions passed, including snapshot revision safety.
- Android smoke checks passed, including synthetic Excel import tests and local-vs-cloud conflict checks.
- Debug APK and unsigned AAB both built and were uploaded in artifact `koptilnya-production-candidate` (expires 2026-10-30).

**Important:** `smokehouse-android/www/cloud-config.js` intentionally contains empty public placeholders until the owner approves the dedicated Supabase organization/project. This candidate package will therefore display a configuration blocker and must not be used for live business records. Build a new package only after the real Koptilnya Supabase project is provisioned, the migration is applied, the public URL/key are configured, and hosted Auth has been verified.

The user's final Excel workbook was not attached to this workstream at the time of this CI run. No historical business data was imported and no hosted database was altered.

## Latest isolated CI evidence

Run [38867329750](https://github.com/cbklexa-bot/technopark-app/actions/runs/38867329750) validated the branch containing the tenant SQL schema and synthetic test-fixture corrections:
- PostgreSQL parser accepted the migration.
- Static schema security contracts passed.
- Local Supabase started, applied the migration, and all 19 pgTAP integration checks passed.
- The web bundle and smoke-test suite passed; the debug APK build completed successfully.
- The debug APK, unsigned Android App Bundle, and artifact upload have now all completed successfully. Artifact `koptilnya-production-candidate` is available from run 38867329750 until 2026-10-30:
https://github.com/cbklexa-bot/technopark-app/actions/runs/38867329750

Extracted artifacts were verified as an Android APK and an unsigned Android App Bundle. The APK is a debug build (suitable for test installation), not a signed production release. The AAB requires release signing before store distribution.

The later workflow-only change groups future runs by branch to cancel superseded jobs; older runs that used the previous per-commit concurrency group may still be finishing independently.
