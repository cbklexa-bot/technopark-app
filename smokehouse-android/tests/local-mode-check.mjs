import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const html = readFileSync(join(root, 'www', 'index.html'), 'utf8');
const backend = readFileSync(join(root, 'www', 'local-backend.js'), 'utf8');
const licenseCore = readFileSync(join(root, 'www', 'license-core.js'), 'utf8');
const bridge = readFileSync(join(root, 'www', 'native-bridge.js'), 'utf8');
const installer = readFileSync(join(root, 'scripts', 'install-download-plugin.mjs'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

assert.ok(html.includes('src="./local-backend.js"'), 'APK must use the offline backend');
assert.ok(!html.includes('cloud-backend.js'), 'Old cloud backend must not be bundled');
assert.ok(!pkg.dependencies['@supabase/supabase-js'], 'Supabase runtime dependency must be removed');
assert.ok(!pkg.dependencies['@capacitor/app'], 'Auth deep-link plugin must be removed when auth is removed');
assert.ok(!backend.toLowerCase().includes('supabase'), 'Local backend must not contact Supabase');
assert.ok(!backend.includes('fetch('), 'Local backend must not make network requests');
assert.ok(backend.includes("localStorage.setItem(TRIAL_STATE_KEY"), 'Trial state must have local persistence');
assert.ok(backend.includes('getLicenseIdentity'), 'License code must use native device identity on Android');
assert.ok(backend.includes('getTrialState'), 'Trial history must read native persistent state');
assert.ok(backend.includes('saveTrialState'), 'Trial history must persist natively');
assert.ok(backend.includes('verifyLicenseToken'), 'Activation must cryptographically verify signed licenses');
assert.ok(backend.includes('evaluateTrial(trialState.firstRunAt, now, TRIAL_DAYS)'), 'Trial must use first launch and configured trial duration');
assert.ok(backend.includes('await exportFullBackup();'), 'Import must create a backup before replacing user data');
assert.ok(backend.includes('app()?.setState(parsed.state)'), 'Excel import must save imported state through the local app');
assert.ok(backend.includes('Импорт Excel'), 'Excel import action must remain available');
assert.ok(backend.includes('Сохранить резервную копию'), 'Expired users must still be able to export their data');
assert.ok(backend.includes('koptilnya-state-change'), 'Local saves should refresh the app status');
assert.ok(licenseCore.includes('ECDSA'), 'License token must use asymmetric digital signatures');
assert.ok(licenseCore.includes('P-256'), 'Public-key verifier must use the matching P-256 curve');
assert.ok(licenseCore.includes('wrong_device'), 'Keys must be bound to one device');
assert.ok(licenseCore.includes("'1m': 30") && licenseCore.includes("'3m': 90") && licenseCore.includes("'6m': 180") && licenseCore.includes("'12m': 365"),
  'License plans must be 1, 3, 6 and 12 months');
assert.ok(licenseCore.includes('trialDays = 7'), 'Trial evaluation must default to seven days');
assert.ok(bridge.includes('getLicenseIdentity') && bridge.includes('getTrialState') && bridge.includes('saveTrialState'),
  'Native bridge must expose identity and anti-clock-rollback trial state');
assert.ok(installer.includes('Settings.Secure.ANDROID_ID'), 'Android device ID must be derived from the Android installation identity');
assert.ok(installer.includes('SharedPreferences'), 'Android trial state must persist outside WebView localStorage');
assert.ok(!installer.includes('android.intent.action.VIEW'), 'App manifest generator must no longer configure auth deep links');

console.log('Offline mode contract passed: local storage, device-bound signed licenses, 7-day trial, 1/3/6/12-month plans, and export after expiry.');
