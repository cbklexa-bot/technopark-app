import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const html = readFileSync(join(root, 'www', 'index.html'), 'utf8');
const backend = readFileSync(join(root, 'www', 'cloud-backend.js'), 'utf8');
const cloudConfig = readFileSync(join(root, 'www', 'cloud-config.js'), 'utf8');
const importer = readFileSync(join(root, 'www', 'excel-import.js'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

assert.ok(pkg.dependencies['@supabase/supabase-js'], 'Supabase client dependency must be installed');
assert.ok(backend.includes("import './cloud-config.js'"), 'Hosted client config must be imported into the bundled backend module');
assert.ok(!html.includes('<script src="./cloud-config.js"></script>'), 'Do not reference an unbundled standalone cloud-config.js file');
assert.ok(cloudConfig.includes('https://ereiiidezagburttpxtn.supabase.co'), 'Cloud configuration must point at the isolated Koptilnya namespace host');
assert.ok(/publishableKey:\s*'sb_publishable_[A-Za-z0-9_-]+'/.test(cloudConfig), 'Cloud configuration must include only a public publishable key');
assert.ok(!/sb_secret_[A-Za-z0-9_-]{12,}|service_role\s*:\s*['"]/.test(cloudConfig), 'No secret/service-role key may ship in client config');
assert.ok(backend.includes('createClient(SUPABASE_URL, SUPABASE_KEY'), 'Frontend must initialize the Supabase client');
assert.ok(backend.includes('supabase.auth.signInWithPassword'), 'Email/password sign-in must be implemented');
assert.ok(backend.includes('supabase.auth.signUp'), 'Email/password registration must be implemented');
assert.ok(backend.includes('const friendlyAuthError ='), 'Auth errors must be translated to actionable Russian messages');
assert.ok(backend.includes('submit.textContent = signingUp ? \'Создаём аккаунт…\' : \'Выполняем вход…\''), 'Submit buttons must visibly show progress while requests are pending');
assert.ok(backend.includes('submit.textContent = originalSubmitLabel'), 'Submit buttons must be restored after success/error and not remain disabled');
assert.ok(backend.includes('Откройте почту и подтвердите адрес'), 'Successful registrations must clearly explain the email confirmation step');
assert.ok(backend.includes('Аккаунт с этой почтой уже существует'), 'Duplicate registrations must direct users to sign in or recover the password');
assert.ok(backend.includes('Supabase временно ограничил отправку писем'), 'Email rate limits must be shown as actionable guidance');
assert.ok(backend.includes('Повторить подключение'), 'A saved session must have a retry path when workspace loading fails');
assert.ok(backend.includes('supabase.auth.resetPasswordForEmail'), 'Password recovery must be implemented');
assert.ok(backend.includes("AUTH_REDIRECT_URL = 'ru.koptilnya.app://auth/callback'"), 'Native Auth callback must use the app deep link');
assert.ok(backend.includes('emailRedirectTo: AUTH_REDIRECT_URL'), 'Sign-up and resend must pass an explicit native confirmation redirect');
assert.ok(backend.includes('resetPasswordForEmail(email, { redirectTo: AUTH_REDIRECT_URL })'), 'Password recovery must return to Android');
assert.ok(backend.includes('supabase.auth.resend('), 'Users must be able to request a fresh sign-up confirmation email');
assert.ok(backend.includes("App.addListener('appUrlOpen'"), 'Android must receive auth links while the app is open');
assert.ok(backend.includes('App.getLaunchUrl()'), 'Android must process auth links that launch the app from a closed state');
assert.ok(backend.includes('supabase.auth.setSession({ access_token, refresh_token })'), 'Implicit-flow auth callbacks must be exchanged for a saved session');
assert.ok(backend.includes('supabase.auth.exchangeCodeForSession(code)'), 'PKCE auth callbacks must be supported');
assert.ok(backend.includes("errorCode === 'otp_expired'"), 'Expired email links must show actionable guidance');
assert.ok(!backend.includes('http://localhost:3000'), 'A native auth redirect must never default to a localhost web server');
assert.ok(backend.includes('supabase.auth.getSession'), 'Saved sessions must be restored after restart');
assert.ok(backend.includes('supabase.auth.signOut()'), 'Account sign-out must be implemented');
assert.ok(backend.includes(".from('kp_organization_members')"), 'Every signed-in user must be resolved to an organization membership');
assert.ok(backend.includes("kp_organizations(name, timezone)"), 'Membership query must join the namespaced organization table');
assert.ok(backend.includes('membership.kp_organizations?.name'), 'Workspace name must be read from the namespaced relationship');
assert.ok(backend.includes("rpc('kp_create_organization'"), 'First-time owners must be able to initialize a workspace');
assert.ok(backend.includes(".from('kp_organization_data')"), 'The app must fetch server state, not only localStorage');
assert.ok(backend.includes("rpc('kp_save_organization_data'"), 'Mutations must persist to the server');
assert.ok(backend.includes('p_expected_revision: revision'), 'Cloud state writes must use optimistic concurrency checks');
assert.ok(backend.includes("if (error.code === '40001')"), 'Concurrent edits must fail closed instead of silently overwriting data');
assert.ok(backend.includes('exportFullArchive'), 'Destructive Excel replacement must first create a ZIP backup');
assert.ok(backend.includes("XLSX.read(bytes"), 'Excel workbook parsing must happen on-device');
for (const clientName of ['Тортика', 'Деревенька', 'Пекарня', 'Кочевник', 'Наш', 'Клиенты цеха']) assert.ok(importer.includes(clientName), 'Missing approved active client: ' + clientName);
assert.ok(importer.includes("findSheet(workbook, ['Документы', 'Накладные', 'Documents'])"), 'Import must require source document records');
assert.ok(importer.includes('Summary/report sheets are never treated as operations'), 'Derived report sheets must never be treated as transactions');
assert.ok(backend.includes('summary.sheets'), 'Importer must display workbook sheet names and row counts before import');
assert.ok(backend.includes('summary.years[year]'), 'Importer must preview annual totals for 2025 and 2026');
assert.ok(importer.includes('Повтор ключа документа'), 'Duplicate document keys must be exposed for review');
assert.ok(importer.includes('manualAmount'), 'Source document totals must be retained when the workbook lacks itemized rows');
assert.ok(importer.includes("rawPositions.forEach((r, index) =>"), 'The importer must process the source positions sheet');
assert.ok(!importer.includes("if (rawPositions.length) {\n    docs.forEach((d) => {\n      if (d.items.length) d.items = [];"),
  'Imported document positions must never be cleared after they have been read');
assert.ok(importer.includes('Строка позиции №'), 'Unmapped source positions must be reported');
assert.ok(importer.includes('ambiguousDocNumbers'), 'Repeated document numbers must not be used to assign payments arbitrarily');
assert.ok(importer.includes('Платёж с распределением по'), 'Ambiguous historical payment allocations must be reported');
assert.ok(importer.includes('как исторический снимок названия'), 'Unmatched legacy product names must remain in document items');


assert.ok(backend.includes('На устройстве уже есть локальные записи'), 'Existing local records must require an explicit keep-or-replace choice');
assert.ok(backend.includes("id=\"koptilnyaUseCloud\""), 'Existing cloud data must offer an explicit keep-cloud option');
assert.ok(backend.includes("id=\"koptilnyaUseLocal\""), 'Existing local data must offer an explicit local replacement option');
assert.ok(backend.includes('Перед заменой будет создан ZIP-архив облачной базы'), 'Replacing cloud data must confirm a remote backup before overwriting');
assert.ok(backend.includes("persistToCloud: remoteExists"), 'A chosen local replacement must be saved to the server using the expected revision');
assert.ok(backend.includes('hasLegacyDemoData'), 'Old prototype sample records must be detected before moving local data to cloud');
assert.ok(backend.includes('Для загрузки своего Excel лучше сначала начать с пустой облачной базы'), 'The login flow must warn against importing demo data');
assert.ok(backend.includes('const localPreview ='), 'The data-source choice must show actual record names before migration');



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

assert.ok(backend.includes('isObfuscatedSignupResponse(result.user)'), 'Masked duplicate-signup responses must not be shown as a successful new registration');
assert.ok(backend.includes('signInWithPassword({email, password})'), 'A masked duplicate signup should attempt sign-in with the supplied credentials');
assert.ok(backend.includes('global: { fetch: fetchWithTimeout }'), 'Cloud requests must have a timeout');
assert.ok(backend.includes("const showRetry ="), 'The retry action should be contextual, not shown permanently');
assert.ok(backend.includes('id="koptilnyaAuthSwitch"'), 'Sign-in and registration must remain switchable');

console.log('Cloud workflow contract passed: Auth, duplicate signup, request timeout, persistent workspace sync, conflict safety, and reviewed Excel import.');
