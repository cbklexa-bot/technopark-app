import assert from 'node:assert/strict';
import { PLAN_DAYS, PLAN_MONTHS, PLAN_LABELS, PRODUCT_ID, addCalendarMonths, evaluateTrial, verifyLicenseToken } from '../www/license-core.js';

assert.equal(PRODUCT_ID, 'ru.koptilnya.app');
assert.deepEqual(PLAN_DAYS, { '1m': 30, '3m': 90, '6m': 180, '12m': 365 });
assert.deepEqual(PLAN_MONTHS, { '1m': 1, '3m': 3, '6m': 6, '12m': 12 });
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

// Paid licenses use calendar months, clamping to the last valid day of the target month.
const jan31_2026 = Date.UTC(2026, 0, 31, 12, 34, 56, 789);
assert.equal(addCalendarMonths(jan31_2026, 0), jan31_2026);
assert.equal(addCalendarMonths(jan31_2026, 1), Date.UTC(2026, 1, 28, 12, 34, 56, 789));
assert.equal(addCalendarMonths(Date.UTC(2024, 0, 31, 8), 1), Date.UTC(2024, 1, 29, 8));
assert.equal(addCalendarMonths(Date.UTC(2024, 1, 29, 8), 12), Date.UTC(2025, 1, 28, 8));
assert.equal(addCalendarMonths(Date.UTC(2026, 9, 31, 9), 3), Date.UTC(2027, 0, 31, 9));
assert.equal(addCalendarMonths(Date.UTC(2026, 0, 15), 12), Date.UTC(2027, 0, 15));
assert.equal(Number.isNaN(addCalendarMonths(Date.UTC(2026, 0, 1), -1)), true);

assert.equal((await verifyLicenseToken('', 'device-1', started)).valid, false);
assert.equal((await verifyLicenseToken('not-a-license', 'device-1', started)).reason, 'malformed');
assert.equal((await verifyLicenseToken('e30.AA', 'device-1', started)).reason, 'bad_signature_format');

console.log('License core tests passed: legacy plan catalogue, calendar-month expiry boundaries (including leap years), seven-day trial, and malformed-key rejection.');
