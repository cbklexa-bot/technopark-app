import assert from 'node:assert/strict';
import { PLAN_DAYS, PLAN_LABELS, PRODUCT_ID, evaluateTrial, verifyLicenseToken } from '../www/license-core.js';

assert.equal(PRODUCT_ID, 'ru.koptilnya.app');
assert.deepEqual(PLAN_DAYS, { '1m': 30, '3m': 90, '6m': 180, '12m': 365 });
assert.deepEqual(PLAN_LABELS, { '1m': '1 месяц', '3m': '3 месяца', '6m': '6 месяцев', '12m': '12 месяцев' });

const day = 24 * 60 * 60 * 1000;
const started = Date.UTC(2026, 0, 1);
const atStart = evaluateTrial(started, started);
assert.equal(atStart.active, true);
assert.equal(atStart.remainingDays, 7);
const afterOneDay = evaluateTrial(started, started + day);
assert.equal(afterOneDay.active, true);
assert.equal(afterOneDay.remainingDays, 6);
const atExpiry = evaluateTrial(started, started + 7 * day);
assert.equal(atExpiry.active, false);
assert.equal(atExpiry.remainingDays, 0);

assert.equal((await verifyLicenseToken('', 'device-1', started)).valid, false);
assert.equal((await verifyLicenseToken('not-a-license', 'device-1', started)).reason, 'malformed');
assert.equal((await verifyLicenseToken('e30.AA', 'device-1', started)).reason, 'bad_signature_format');

console.log('License core tests passed: plan catalogue, seven-day trial boundaries, and malformed-key rejection.');
