import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationPath = join(root, 'supabase', 'migrations', '20261016150000_koptilnya_core.sql');
const sql = readFileSync(migrationPath, 'utf8');

const tables = [...sql.matchAll(/create\s+table\s+public\.([a-z_][a-z0-9_]*)/gi)]
  .map((match) => match[1].toLowerCase());
assert.ok(tables.length >= 18, 'Expected the core business tables, not an empty stub');
assert.equal(new Set(tables).size, tables.length, 'Public table names must be unique');

const rlsBlock = sql.match(
  /-- Enable RLS on every public table created by this migration\.\s*do \$\$\s*declare\s+t text;\s*begin\s*foreach t in array array\[([\s\S]*?)\]\s*loop\s*execute format\('alter table public\.%I enable row level security', t\);/
);
assert.ok(rlsBlock, 'Migration must contain the explicit RLS coverage list');
const rlsTables = [...rlsBlock[1].matchAll(/'([a-z_][a-z0-9_]*)'/gi)].map((match) => match[1].toLowerCase());
assert.deepEqual([...tables].sort(), [...rlsTables].sort(), 'Every public table must be covered by RLS; no unprotected business table is allowed');

for (const requiredTable of [
  'kp_profiles', 'kp_organizations', 'kp_organization_data', 'kp_organization_members', 'kp_clients', 'kp_products',
  'kp_documents', 'kp_document_items', 'kp_production_batches', 'kp_production_batch_inputs',
  'kp_stock_movements', 'kp_expense_categories', 'kp_expenses', 'kp_payments',
  'kp_payment_allocations', 'kp_subscription_plans', 'kp_organization_subscriptions',
  'kp_subscription_payment_events', 'kp_backup_exports', 'kp_import_runs', 'kp_import_staging_rows', 'kp_audit_events',
]) assert.ok(tables.includes(requiredTable), 'Missing required business table: ' + requiredTable);

for (const rpc of [
  'kp_create_organization', 'kp_save_organization_data', 'kp_post_document', 'kp_post_production_batch',
  'kp_record_payment_with_allocations',
]) {
  assert.ok(sql.includes('function public.' + rpc + '('), 'Missing server-side RPC: ' + rpc);
  assert.ok(
    new RegExp('revoke all on function public\\.' + rpc + '\\(', 'i').test(sql),
    'RPC must revoke default PUBLIC/anon execution: ' + rpc,
  );
  assert.ok(
    new RegExp('grant execute on function public\\.' + rpc + '\\(').test(sql),
    'RPC should grant execution only after explicit review: ' + rpc,
  );
}

for (const helper of ['kp_is_org_member', 'kp_has_org_role', 'kp_can_write_org', 'kp_can_edit_org']) {
  assert.ok(sql.includes('function kp_private.' + helper + '('), 'Missing private authorization helper: ' + helper);
}
assert.ok(sql.includes('set search_path = \'\''), 'Security-sensitive functions must pin the search_path');
assert.ok(sql.includes('kp_private.kp_can_edit_org(v_document_org_id)'), 'Document posting must enforce role and subscription rights');
assert.ok(sql.includes('kp_private.kp_can_edit_org(v_batch_org_id)'), 'Production posting must enforce role and subscription rights');
assert.ok(sql.includes('kp_private.kp_can_edit_org(p_organization_id)'), 'Payment posting must enforce role and subscription rights');
assert.ok(sql.includes('kp_private.kp_can_edit_org(p_organization_id)'), 'Workspace save must be role and subscription protected');
assert.ok(sql.includes('p_expected_revision'), 'Workspace saves must have optimistic concurrency protection');
assert.ok(sql.includes('owner-early-access'), 'New owners must receive launch access without blocking basic account creation');

assert.ok(sql.includes('create unique index kp_stock_movement_doc_line_unique'), 'Document posting must be idempotent at stock-movement level');
assert.ok(sql.includes('create unique index kp_stock_movement_batch_input_unique'), 'Production inputs must not be deducted twice');
assert.ok(sql.includes('create unique index kp_stock_movement_batch_output_unique'), 'Production output must not be posted twice');
assert.ok(sql.includes('unique (organization_id, idempotency_key)'), 'Payments must have organization-scoped idempotency');
assert.ok(sql.includes('create unique index kp_documents_post_key_unique'), 'Documents must protect posting against duplicates');
assert.ok(sql.includes('create unique index kp_production_batches_post_key_unique'), 'Batches must protect posting against duplicates');

assert.ok(sql.includes('with (security_invoker = true)'), 'Financial balance view must obey invoker RLS');
assert.ok(sql.includes('greatest(d.total_amount - coalesce(a.amount_paid, 0), 0)'), 'Outstanding debt must derive from allocations');
assert.ok(sql.includes('kp_payment_allocations_document_idx'), 'Payment allocations must be indexed by document');
assert.ok(sql.includes("array['owner', 'admin', 'manager', 'operator']"), 'Write operations must be role-limited');
assert.ok(sql.includes("bucket_id = 'koptilnya-private'"), 'File storage must use the Koptilnya private bucket');
assert.ok(sql.includes('create table public.kp_organization_data'), 'Authenticated workspace persistence table is required');
assert.ok(sql.includes('function public.kp_save_organization_data('), 'Cloud state saves must go through the server-side revision RPC');
assert.ok(sql.includes('p_expected_revision'), 'Cloud state writes must reject concurrent stale revisions');
assert.ok(sql.includes('kp_private.kp_can_edit_org(p_organization_id)'), 'Cloud state write RPC must enforce organization role and active entitlement');
assert.ok(sql.includes('owner-early-access'), 'The owner workspace must have a server-provisioned initial access plan');

assert.ok(sql.includes('create table public.kp_import_staging_rows'), 'Historical data must be staged for review before importing');
assert.ok(sql.includes('public.kp_import_staging_rows, public.kp_audit_events from anon, authenticated'), 'Raw import staging must not be exposed to client roles');

const productsGrants = sql.match(/grant[^;]+on public\.kp_products to authenticated/gi) || [];
assert.ok(productsGrants.length >= 2, 'Product permissions should be column-scoped where writes are allowed');
assert.ok(
  !/grant\s+(?:select\s*,\s*)?insert\s*,\s*update\s+on public\.kp_products\s+to authenticated/i.test(sql),
  'Do not grant direct writes to cached stock or average cost columns',
);

assert.ok(!/create\s+table\s+public\.kp_recipes\b/i.test(sql), 'Recipe module must not be made active in this release');
assert.ok(!/create\s+function\s+public\.kp_(?:create|update|delete)_recipe\b/i.test(sql), 'Recipe mutations must remain unavailable');
assert.ok(sql.includes('Intentionally no recipe/technology table'), 'The deliberate recipe-module block should be documented');
assert.ok(!/service_role.{0,100}(?:publishable|client bundle)/i.test(sql), 'Do not mix secret service-role credentials into client configuration');
assert.ok(!/\b(?:sk_live_[A-Za-z0-9]+|sb_secret_[A-Za-z0-9]+)\b/.test(sql), 'SQL source must not contain live secret keys');

console.log(
  'Koptilnya schema contract passed: ' + tables.length +
  ' public tables have explicit RLS coverage; tenant, inventory, payment, subscription, storage, and recipe-disable guards are present.',
);
