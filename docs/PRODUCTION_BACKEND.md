# Коптильня — production backend workstream

## Repository status at start

- Android prototype source: `smokehouse-android`.
- This work is isolated in `koptilnya-production`; `main`, `smokehouse-android`, and `smokehouse-prototype` are not modified by this workstream.
- The prototype uses localStorage and sample data. It is not a multi-tenant production application yet.
- The GitHub repository is public. Real `.BP` archives, exports containing customer information, database dumps, credentials, service-role keys, and payment secrets must never be committed here.

## Supabase project selection

No connected project was confidently identified as a dedicated Koptilnya project at the time of this audit. Do not link or apply these migrations to an unidentified project, `max-song-app`, or another application's database. Create or explicitly identify a separate project named for Koptilnya first, and confirm its organization/cost. Until then, SQL files in this branch are source only and have not been applied to any database.

## Current migration scope

The initial schema file defines tenant-owned business records, inventory ledger and atomic posting RPCs, production batches, payment allocations, subscription/entitlement tables, import and backup metadata, audit metadata, and private Storage policies. Every public table created by the migration enables RLS. Subscription writes fail closed until a valid active plan/subscription row is provisioned server-side.

This is a foundation, not a declaration of product completion. The following work remains before production:
- Provision the dedicated Supabase project and run the migration using the Supabase CLI after review.
- Add and run database integration tests, including two-organization RLS isolation, concurrent stock reductions, duplicate posting, payment races, subscription expiry, and Storage isolation.
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

## Test Android build

The latest workflow run checked during this audit succeeded on 2026-10-16:
https://github.com/cbklexa-bot/technopark-app/actions/runs/38841744614

It produced the expiring CI artifact `koptilnya-android-test-build`. That is a debug/test package, not a signed production release.
