begin;

create extension if not exists pgtap with schema extensions;
select plan(23);

-- All fixtures are synthetic. They are rolled back with this test and never touch a hosted project.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'authenticated', 'authenticated',
   'koptilnya-tenant-a@example.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Tenant A"}'::jsonb, now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'authenticated', 'authenticated',
   'koptilnya-tenant-b@example.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Tenant B"}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.organizations (id, name, owner_user_id, timezone) values
  ('aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', 'Synthetic Koptilnya A', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Europe/Vilnius'),
  ('bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb', 'Synthetic Koptilnya B', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Europe/Vilnius');

insert into public.organization_members (organization_id, user_id, role, status) values
  ('aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner', 'active'),
  ('bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'owner', 'active');

insert into public.subscription_plans (
  id, code, name, billing_interval, price_minor_units, currency, trial_days, limits, is_active
) values (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'ci-test', 'Synthetic CI plan',
  'month', 0, 'RUB', 0, '{}'::jsonb, true
);

insert into public.organization_subscriptions (
  organization_id, plan_id, status, current_period_start, current_period_end
) values
  ('aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   'active', now() - interval '1 day', now() + interval '1 day'),
  ('bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   'active', now() - interval '1 day', now() + interval '1 day');

insert into public.clients (id, organization_id, name) values
  ('aaaaaaaa-2222-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', 'Tenant A customer'),
  ('bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb', 'Tenant B customer');

insert into public.products (
  id, organization_id, name, product_type, unit, tracks_inventory, stock_quantity, average_cost, purchase_price, sale_price
) values
  ('aaaaaaaa-3333-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa',
   'Synthetic smoked product A', 'finished', 'кг', true, 10, 4, 4, 10),
  ('bbbbbbbb-3333-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb',
   'Synthetic smoked product B', 'finished', 'кг', true, 20, 5, 5, 12);

insert into public.documents (
  id, organization_id, document_number, kind, status, document_date,
  counterparty_id, counterparty_name_snapshot, total_amount, total_cost, posted_at
) values
  ('aaaaaaaa-4444-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa',
   'SALE-A-OTHER-TEST', 'sale', 'posted', current_date,
   'aaaaaaaa-2222-4aaa-8aaa-aaaaaaaaaaaa', 'Tenant A customer', 900, 500, now()),
  ('bbbbbbbb-4444-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb',
   'SALE-B-TEST', 'sale', 'posted', current_date,
   'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb', 'Tenant B customer', 700, 400, now());

insert into public.documents (
  id, organization_id, document_number, kind, status, document_date,
  counterparty_id, counterparty_name_snapshot
) values
  ('aaaaaaaa-5555-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa',
   'SALE-A-TEST', 'sale', 'draft', current_date,
   'aaaaaaaa-2222-4aaa-8aaa-aaaaaaaaaaaa', 'Tenant A customer'),
  ('aaaaaaaa-6666-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa',
   'SALE-A-NEGATIVE-STOCK-TEST', 'sale', 'draft', current_date,
   'aaaaaaaa-2222-4aaa-8aaa-aaaaaaaaaaaa', 'Tenant A customer');

insert into public.document_items (
  organization_id, document_id, product_id, product_name_snapshot,
  unit_snapshot, quantity, unit_price, unit_cost
) values
  ('aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-5555-4aaa-8aaa-aaaaaaaaaaaa',
   'aaaaaaaa-3333-4aaa-8aaa-aaaaaaaaaaaa', 'Synthetic smoked product A', 'кг', 2, 10, 0),
  ('aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-6666-4aaa-8aaa-aaaaaaaaaaaa',
   'aaaaaaaa-3333-4aaa-8aaa-aaaaaaaaaaaa', 'Synthetic smoked product A', 'кг', 99, 10, 0);

select ok(
  not has_table_privilege('authenticated', 'public.import_staging_rows', 'SELECT'),
  'Raw legacy import staging is not readable by client roles'
);

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claim.role = 'authenticated';
set local role authenticated;

select is((select count(*) from public.products), 1::bigint,
  'Tenant A can read only its own products');
select is((select count(*) from public.clients), 1::bigint,
  'Tenant A can read only its own clients');
select throws_ok(
  $test$insert into public.clients (organization_id, name)
         values ('bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb', 'Cross-tenant write')$test$,
  '42501', null, 'Cross-tenant client insert is rejected by RLS'
);

select lives_ok(
  $test$select public.save_organization_data(
    'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 0,
    '{"products":[],"clients":[],"docs":[],"expenses":[],"batches":[],"recipes":[],"payments":[]}'::jsonb
  )$test$,
  'Owner can save an initial cloud workspace'
);
select is(
  (select revision from public.organization_data where organization_id = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa'::uuid),
  1::bigint, 'Cloud workspace revision increments after a successful save'
);
select throws_ok(
  $test$select public.save_organization_data(
    'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 0, '{}'::jsonb
  )$test$,
  '40001', 'Workspace changed on another device. Reload before saving.',
  'Stale cloud revision is rejected instead of overwriting a concurrent change'
);
select throws_ok(
  $test$select public.save_organization_data(
    'bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 0, '{}'::jsonb
  )$test$,
  '42501', 'Workspace access denied or workspace is read-only',
  'Tenant A cannot modify tenant B cloud snapshot'
);

select lives_ok(
  $test$select public.post_document('aaaaaaaa-5555-4aaa-8aaa-aaaaaaaaaaaa', 'ci-post-doc-a-0001')$test$,
  'Sale posting succeeds within one atomic transaction'
);
select lives_ok(
  $test$select public.post_document('aaaaaaaa-5555-4aaa-8aaa-aaaaaaaaaaaa', 'ci-post-doc-a-0001')$test$,
  'Repeating the same document posting request is idempotent'
);
select is(
  (select stock_quantity from public.products where id = 'aaaaaaaa-3333-4aaa-8aaa-aaaaaaaaaaaa'::uuid),
  8::numeric, 'Posting decrements inventory exactly once'
);
select is(
  (select count(*) from public.stock_movements where source_document_id = 'aaaaaaaa-5555-4aaa-8aaa-aaaaaaaaaaaa'::uuid),
  1::bigint, 'Exactly one stock movement is linked to the posted document'
);
select throws_ok(
  $test$select public.post_document('aaaaaaaa-6666-4aaa-8aaa-aaaaaaaaaaaa', 'ci-post-negative-0001')$test$,
  '23514', 'Stock movement rejected: product missing, not stock-tracked, or insufficient stock',
  'Attempting to make inventory negative is rejected'
);
select is(
  (select stock_quantity from public.products where id = 'aaaaaaaa-3333-4aaa-8aaa-aaaaaaaaaaaa'::uuid),
  8::numeric, 'Rejected posting rolls back without changing inventory'
);

select lives_ok(
  $test$select public.record_payment_with_allocations(
    'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-2222-4aaa-8aaa-aaaaaaaaaaaa',
    5, 'transfer',
    jsonb_build_array(jsonb_build_object('document_id', 'aaaaaaaa-5555-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'amount', 5)),
    'ci-payment-key-0001', 'Synthetic idempotency test'
  )$test$,
  'A partial customer payment can be allocated to a posted sale'
);
select lives_ok(
  $test$select public.record_payment_with_allocations(
    'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-2222-4aaa-8aaa-aaaaaaaaaaaa',
    5, 'transfer',
    jsonb_build_array(jsonb_build_object('document_id', 'aaaaaaaa-5555-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'amount', 5)),
    'ci-payment-key-0001', 'Synthetic idempotency test'
  )$test$,
  'Repeating the same payment request does not insert a second payment'
);
select is(
  (select count(*) from public.payments where idempotency_key = 'ci-payment-key-0001'),
  1::bigint, 'Payment idempotency key resolves to one payment row'
);
select is((select count(*) from public.document_balances), 2::bigint,
  'Tenant A sees only its posted sales/services, not drafts or Tenant B balances');
select is(
  (select balance_due from public.document_balances where id = 'aaaaaaaa-5555-4aaa-8aaa-aaaaaaaaaaaa'::uuid),
  15::numeric, 'Partial payment reduces the balance without being counted as revenue'
);

reset role;
update public.organization_subscriptions
set status = 'expired', current_period_end = now() - interval '1 minute', trial_ends_at = null
where organization_id = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa';

set local role authenticated;
select is(private.can_write_org('aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa'::uuid), false,
  'Expired subscriptions become read-only on the server');
select throws_ok(
  $test$insert into public.clients (organization_id, name)
         values ('aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', 'Write after expiry')$test$,
  '42501', null, 'Expired subscription cannot create new client records'
);

reset role;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local request.jwt.claim.role = 'authenticated';
set local role authenticated;

select is((select count(*) from public.products), 1::bigint,
  'Tenant B can read only its own products');
select is((select count(*) from public.document_balances), 1::bigint,
  'Tenant B can read only its own debt balances');

select * from finish();
rollback;
