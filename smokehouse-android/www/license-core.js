export const PRODUCT_ID = 'ru.koptilnya.app';

// Fixed day counts remain for validating legacy keys minted before calendar-month terms were introduced.
export const PLAN_DAYS = Object.freeze({ '1m': 30, '3m': 90, '6m': 180, '12m': 365 });
export const PLAN_MONTHS = Object.freeze({ '1m': 1, '3m': 3, '6m': 6, '12m': 12 });
export const PLAN_LABELS = Object.freeze({ '1m': '1 месяц', '3m': '3 месяца', '6m': '6 месяцев', '12m': '12 месяцев' });

const DAY_MS = 24 * 60 * 60 * 1000;

// Add calendar months in UTC, clamping the day to the end of the destination month.
// Examples: 31 Jan + 1 month => 28/29 Feb; 29 Feb + 12 months => 28 Feb next year.
export function addCalendarMonths(instantMs, months) {
  if (!Number.isFinite(Number(instantMs)) || !Number.isInteger(months) || months < 0) return NaN;
  const date = new Date(Number(instantMs));
  if (!Number.isFinite(date.getTime())) return NaN;

  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
  return date.getTime();
}

// Only the public key ships with the APK. The matching private key must stay with the seller.
const LICENSE_PUBLIC_KEY_SPKI = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEVWLX7PNWvLw-nXDEgBbHS7ZtDPbYg4M7-IUEA-3CzrBRj3Z7Mgn8nOal--8CjMRCO_kjZhRbFpjb5bGEbB-phw';

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function decodeLicensePayload(token) {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('Неверный формат ключа.');
  const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
  return { payloadPart: parts[0], signature: decodeBase64Url(parts[1]), payload };
}

export async function verifyLicenseToken(token, expectedDeviceId, nowMs = Date.now()) {
  try {
    if (!globalThis.crypto?.subtle) return { valid: false, reason: 'crypto_unavailable' };
    const { payloadPart, signature, payload } = decodeLicensePayload(token);
    if (signature.length !== 64) return { valid: false, reason: 'bad_signature_format' };

    const publicKey = await crypto.subtle.importKey(
      'spki',
      decodeBase64Url(LICENSE_PUBLIC_KEY_SPKI),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const signatureValid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signature,
      new TextEncoder().encode(payloadPart),
    );
    if (!signatureValid) return { valid: false, reason: 'bad_signature' };
    if (payload?.v !== 1 || payload?.app !== PRODUCT_ID) return { valid: false, reason: 'wrong_product' };
    if (typeof expectedDeviceId !== 'string' || payload.device !== expectedDeviceId) return { valid: false, reason: 'wrong_device' };
    if (!Object.hasOwn(PLAN_DAYS, payload.plan)) return { valid: false, reason: 'wrong_plan' };
    if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return { valid: false, reason: 'bad_dates' };

    let durationMatches = false;
    if (payload.term === 'calendar_months') {
      const expectedExpiry = addCalendarMonths(payload.iat, PLAN_MONTHS[payload.plan]);
      durationMatches = Number.isFinite(expectedExpiry) && Math.abs(payload.exp - expectedExpiry) <= 60_000;
    } else if (payload.term == null) {
      // Backward compatibility: accept pre-existing signed v1 keys issued with fixed day counts.
      const expectedDuration = PLAN_DAYS[payload.plan] * DAY_MS;
      durationMatches = Math.abs((payload.exp - payload.iat) - expectedDuration) <= 60_000;
    }
    if (!durationMatches) return { valid: false, reason: 'bad_duration' };
    if (payload.iat > nowMs + 5 * 60 * 1000) return { valid: false, reason: 'not_yet_valid' };
    if (payload.exp <= nowMs) return { valid: false, reason: 'expired', payload };
    return { valid: true, reason: 'ok', payload };
  } catch {
    return { valid: false, reason: 'malformed' };
  }
}

export function evaluateTrial(firstRunAt, effectiveNowMs, trialDays = 7) {
  const start = Number(firstRunAt);
  const end = start + trialDays * DAY_MS;
  const remainingMs = Math.max(0, end - Number(effectiveNowMs));
  return {
    startedAt: start,
    expiresAt: end,
    active: Number.isFinite(start) && start > 0 && Number(effectiveNowMs) < end,
    remainingDays: Math.max(0, Math.ceil(remainingMs / DAY_MS)),
    remainingMs,
  };
}
