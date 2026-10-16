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
  'profiles', 'organizations', 'organization_members', 'clients', 'products',
  'documents', 'document_items', 'production_batches', 'production_batch_inputs',
  'stock_movements', 'expense_categories', 'expenses', 'payments',
  'payment_allocations', 'subscription_plans', 'organization_subscriptions',
  'subscription_payment_events', 'backup_exports', 'import_runs', 'audit_events',
]) assert.ok(tables.includes(requiredTable), 'Missing required business table: ' + requiredTable);

for (const rpc of [
  'create_organization', 'post_document', 'post_production_batch',
  'record_payment_with_allocations',
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

for (const helper of ['is_org_member', 'has_org_role', 'can_write_org', 'can_edit_org']) {
  assert.ok(sql.includes('function private.' + helper + '('), 'Missing private authorization helper: ' + helper);
}
assert.ok(sql.includes('set search_path = \'\''), 'Security-sensitive functions must pin the search_path');
assert.ok(sql.includes('private.can_edit_org(v_doc.organization_id)'), 'Document posting must enforce role and subscription rights');
assert.ok(sql.includes('private.can_edit_org(v_batch.organization_id)'), 'Production posting must enforce role and subscription rights');
assert.ok(sql.includes('private.can_edit_org(p_organization_id)'), 'Payment posting must enforce role and subscription rights');

assert.ok(sql.includes('create unique index stock_movement_doc_line_unique'), 'Document posting must be idempotent at stock-movement level');
assert.ok(sql.includes('create unique index stock_movement_batch_input_unique'), 'Production inputs must not be deducted twice');
assert.ok(sql.includes('create unique index stock_movement_batch_output_unique'), 'Production output must not be posted twice');
assert.ok(sql.includes('unique (organization_id, idempotency_key)'), 'Payments must have organization-scoped idempotency');
assert.ok(sql.includes('unique (organization_id, post_idempotency_key)'), 'Documents/batches must protect posting against duplicates');

assert.ok(sql.includes('with (security_invoker = true)'), 'Financial balance view must obey invoker RLS');
assert.ok(sql.includes('greatest(d.total_amount - coalesce(a.amount_paid, 0), 0)'), 'Outstanding debt must derive from allocations');
assert.ok(sql.includes('payment_allocations_document_idx'), 'Payment allocations must be indexed by document');
assert.ok(sql.includes("array['owner', 'admin', 'manager', 'operator']"), 'Write operations must be role-limited');
assert.ok(sql.includes("bucket_id = 'koptilnya-private'"), 'File storage must use the Koptilnya private bucket');

const productsGrants = sql.match(/grant[^;]+on public\.products to authenticated/gi) || [];
assert.ok(productsGrants.length >= 2, 'Product permissions should be column-scoped where writes are allowed');
assert.ok(
  !/grant\s+(?:select\s*,\s*)?insert\s*,\s*update\s+on public\.products\s+to authenticated/i.test(sql),
  'Do not grant direct writes to cached stock or average cost columns',
);

assert.ok(!/create\s+table\s+public\.recipes\b/i.test(sql), 'Recipe module must not be made active in this release');
assert.ok(!/create\s+function\s+public\.(?:create|update|delete)_recipe\b/i.test(sql), 'Recipe mutations must remain unavailable');
assert.ok(sql.includes('Intentionally no recipe/technology table'), 'The deliberate recipe-module block should be documented');
assert.ok(!/service_role.{0,100}(?:publishable|client bundle)/i.test(sql), 'Do not mix secret service-role credentials into client configuration');
assert.ok(!/\b(?:sk_live_[A-Za-z0-9]+|sb_secret_[A-Za-z0-9]+)\b/.test(sql), 'SQL source must not contain live secret keys');

console.log(
  'Koptilnya schema contract passed: ' + tables.length +
  ' public tables have explicit RLS coverage; tenant, inventory, payment, subscription, storage, and recipe-disable guards are present.',
);
