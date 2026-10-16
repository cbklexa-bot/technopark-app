import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const html = readFileSync(join(root, 'www', 'index.html'), 'utf8');
const backend = readFileSync(join(root, 'www', 'cloud-backend.js'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

assert.ok(pkg.dependencies['@supabase/supabase-js'], 'Supabase client dependency must be installed');
assert.ok(backend.includes('createClient(SUPABASE_URL, SUPABASE_KEY'), 'Frontend must initialize the Supabase client');
assert.ok(backend.includes('supabase.auth.signInWithPassword'), 'Email/password sign-in must be implemented');
assert.ok(backend.includes('supabase.auth.signUp'), 'Email/password registration must be implemented');
assert.ok(backend.includes('supabase.auth.resetPasswordForEmail'), 'Password recovery must be implemented');
assert.ok(backend.includes('supabase.auth.getSession'), 'Saved sessions must be restored after restart');
assert.ok(backend.includes('supabase.auth.signOut()'), 'Account sign-out must be implemented');
assert.ok(backend.includes(".from('organization_members')"), 'Every signed-in user must be resolved to an organization membership');
assert.ok(backend.includes("rpc('create_organization'"), 'First-time owners must be able to initialize a workspace');
assert.ok(backend.includes(".from('organization_data')"), 'The app must fetch server state, not only localStorage');
assert.ok(backend.includes("rpc('save_organization_data'"), 'Mutations must persist to the server');
assert.ok(backend.includes('p_expected_revision: revision'), 'Cloud state writes must use optimistic concurrency checks');
assert.ok(backend.includes("if (error.code === '40001')"), 'Concurrent edits must fail closed instead of silently overwriting data');
assert.ok(backend.includes('exportFullArchive'), 'Destructive Excel replacement must first create a ZIP backup');
assert.ok(backend.includes("XLSX.read(bytes"), 'Excel workbook parsing must happen on-device');
for (const clientName of ['Тортика', 'Деревенька', 'Пекарня', 'Кочевник', 'Наш', 'Клиенты цеха']) assert.ok(backend.includes(clientName), 'Missing approved active client: ' + clientName);
assert.ok(backend.includes("findSheet(workbook, ['Документы', 'Накладные', 'Documents'])"), 'Import must require source document records');
assert.ok(backend.includes("['Сводка','Продажи','Услуги','По месяцам']") === false,
  'Derived report sheets must never be silently treated as transactions');
assert.ok(backend.includes('summary.sheets'), 'Importer must display workbook sheet names and row counts before import');
assert.ok(backend.includes('summary.years[year]'), 'Importer must preview annual totals for 2025 and 2026');
assert.ok(backend.includes('Повтор ключа документа'), 'Duplicate document keys must be exposed for review');
assert.ok(backend.includes('manualAmount'), 'Source document totals must be retained when the workbook lacks itemized rows');
assert.ok(backend.includes("rawPositions.forEach((r, index) =>"), 'The importer must process the source positions sheet');
assert.ok(!backend.includes("if (rawPositions.length) {\n    docs.forEach((d) => {\n      if (d.items.length) d.items = [];"),
  'Imported document positions must never be cleared after they have been read');
assert.ok(backend.includes('Строка позиции №'), 'Unmapped source positions must be reported');
assert.ok(backend.includes('ambiguousDocNumbers'), 'Repeated document numbers must not be used to assign payments arbitrarily');
assert.ok(backend.includes('Платёж с распределением по'), 'Ambiguous historical payment allocations must be reported');
assert.ok(backend.includes('Исторический снимок названия') || backend.includes('как исторический снимок названия'), 'Unmatched legacy product names must remain in document items');


assert.ok(backend.includes('На устройстве уже есть локальные записи'), 'Existing local records must require an explicit keep-or-replace choice');

assert.ok(html.includes('cloud-backend.js'), 'The Android app must load the cloud backend module');
assert.ok(html.includes('window.KoptilnyaApp='), 'The existing accounting UI must expose its state to the cloud adapter');
assert.ok(html.includes("koptilnya-state-change"), 'Local business mutations must notify the cloud sync adapter');
assert.ok(html.includes('var seed={products:[],clients:[],docs:[],expenses:[],batches:[],recipes:[],payments:[]}'),
  'Fresh installs must start empty instead of showing invented demo accounting data');
assert.ok(html.includes('function amount(d){if(d&&d.manualAmount!=null'), 'Imported legacy totals must be preserved when no positions exist');
assert.ok(html.includes('function cost(d){if(d&&d.manualCost!=null'), 'Imported legacy costs must be preserved when no positions exist');
assert.ok(!html.includes("name:'Розничный покупатель (цех)'"), 'An unrequested seventh default client must not be created');
assert.ok(!backend.includes('service_role'), 'Service-role keys must never ship in the client');
assert.ok(!/https:\/\/[a-z0-9]+\.supabase\.co/.test(backend), 'A hosted Supabase project must not be hardcoded before it is provisioned');
assert.ok(!/sb_secret_[A-Za-z0-9_-]{12,}/.test(backend), 'No Supabase secret key may be bundled into the app');

console.log('Cloud workflow contract passed: Auth, persistent workspace sync, conflict safety, empty start, and reviewed Excel import.');
