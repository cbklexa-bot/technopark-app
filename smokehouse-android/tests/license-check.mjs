import assert from 'node:assert/strict';
import { PLAN_DAYS, PLAN_LABELS, PRODUCT_ID, addCalendarMonths, evaluateTrial, verifyLicenseToken } from '../www/license-core.js';

assert.equal(PRODUCT_ID, 'ru.koptilnya.app');
assert.deepEqual(PLAN_DAYS, { '1m': 30, '3m': 90, '6m': 180, '12m': 365 });
assert.deepEqual(PLAN_LABELS, { '1m': '1 месяц', '3m': '3 месяца', '6m': '6 месяцев', '12m': '12 месяцев' });

const jan31 = Date.UTC(2026, 0, 31, 12, 30);
assert.equal(new Date(addCalendarMonths(jan31, 1)).toISOString(), '2026-02-28T12:30:00.000Z');
assert.equal(new Date(addCalendarMonths(Date.UTC(2024, 0, 31), 1)).toISOString(), '2024-02-29T00:00:00.000Z');
assert.equal(new Date(addCalendarMonths(Date.UTC(2026, 1, 28), 12)).toISOString(), '2027-02-28T00:00:00.000Z');

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
