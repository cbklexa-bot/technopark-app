# Коптильня — production backend workstream

## Repository status at start

- Android prototype source: `smokehouse-android`.
- This work is isolated in `koptilnya-production`; `main`, `smokehouse-android`, and `smokehouse-prototype` are not modified by this workstream.
- The UI keeps an editable client state, while `kp_organization_data` persists a revisioned JSON snapshot per organization in Supabase. The schema also defines normalized business tables for the next staged migration; the current UI uses the revision-checked snapshot RPC.
- The GitHub repository is public. Real `.BP` archives, exports containing customer information, database dumps, credentials, service-role keys, and payment secrets must never be committed here.

## Supabase project selection

The existing Supabase project `cbklexa-bot's Project` (`ereiiidezagburttpxtn`, `eu-central-1`) contains the Technopark `tp_*` tables. Koptilnya shares this project using `kp_`-prefixed tables, views, indexes, RPCs, and helper functions. Never apply this migration to `max-song-app`.

Auth and Storage are project-wide services, not separate Koptilnya instances. The migration uses the dedicated `koptilnya-private` Storage bucket and organization-membership RLS; it deliberately does not create a global trigger on `auth.users`. Supabase Security Advisor reported the existing `public.users`, `public.notebook`, and `public.user_budgets` tables have RLS disabled. Do not enable RLS on these legacy tables without reviewing policies and testing the Technopark app.

## Current migration scope

The baseline migration defines tenant-owned business records, inventory ledger and atomic posting RPCs, production batches, payment allocations, subscription/entitlement tables, import and backup metadata, a server-only import staging table, audit metadata, and private Storage policies. Every public table created by the migration is covered by an explicit RLS coverage list. Subscription writes fail closed until a valid active plan/subscription row is provisioned server-side.

The branch includes:
- `supabase/config.toml` for an isolated local test project. It contains no hosted project reference or secrets.
- `supabase/tests/koptilnya_tenant_accounting.test.sql`, with synthetic pgTAP fixtures for organization isolation, inventory posting/idempotency, negative-stock rejection, payment replay, balance calculations, expired-subscription write denial, and private import staging.
- `.github/workflows/koptilnya-production-check.yml`: a PostgreSQL grammar/static contract job, a temporary local Supabase integration-test job, and the existing web/Android build pipeline.

The tests are source-controlled, and the integration suite must be reported as passed only after the corresponding CI job finishes green. A green local CI stack is not a substitute for applying and verifying this namespaced migration against the hosted Technopark project.

This is a foundation, not a declaration of product completion. The following work remains before production:
- Review the namespaced migration and apply it only to `ereiiidezagburttpxtn` (the existing Technopark Supabase project), never to `max-song-app`.
- Verify two-tenant isolation and business-operation tests in CI; add concurrency-focused tests and Storage object read/write isolation tests as the backend is expanded.
- Implement frontend Auth screens and bind existing screens to the Supabase data layer. The UI's domain state is synchronized through the revision-checked `kp_organization_data` RPC; normalized business tables remain available for subsequent feature-by-feature migration.
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

## Hosted deployment status and remaining acceptance

The `kp_`-namespaced migration was applied to the existing Technopark Supabase project `ereiiidezagburttpxtn` on 2026-10-16. Verification returned 22 public `kp_` tables with RLS enabled, one namespaced view, five public RPC functions, and the private `koptilnya-private` Storage bucket. The migration is additive: it does not update existing `tp_*` business tables.

GitHub Actions run 53 validated the latest migration in an isolated Supabase stack: PostgreSQL grammar and schema contracts passed, local migration application succeeded, and all 23 pgTAP assertions passed. Run 53's APK was built before the client configuration was populated; use only the newest successful run after that change. CI does not simulate user signup, email confirmation, password recovery, or Android file-picker behavior on a real device.

Before recording real historical money or customer data, manually validate: email/password registration and login, confirmation/reset email behavior, first workspace creation, save/reopen after app restart, Excel preview/import, ZIP/Excel export, and denial of access to a second organization's records. The existing project has separate legacy Security Advisor warnings for `public.users`, `public.notebook`, `public.user_budgets`, and several public/anonymously accessible policies. These were not changed by the Koptilnya migration; review them in a separate, tested Technopark security maintenance.

Keep real Excel workbooks, database dumps, customer records, and exports outside this public repository. Never apply this migration to `max-song-app`.

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

**Historical note:** run 38874659642 produced an unconfigured placeholder APK. Do not install that artifact for use. The branch's cloud configuration has since been populated for the shared Technopark project; use the newest successful production-workflow artifact. Hosted Auth and physical-device acceptance still require manual verification.

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
