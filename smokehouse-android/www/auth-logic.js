export const isObfuscatedSignupResponse = (user) => {
  if (!user) return true;
  const email = typeof user.email === 'string' ? user.email.trim() : '';
  const identities = Array.isArray(user.identities) ? user.identities : null;
  // Supabase masks duplicate sign-up responses when email confirmations are enabled.
  return email.length === 0 || (identities !== null && identities.length === 0);
};

export const classifyAuthError = (error) => {
  const raw = String(error?.message || error?.error_description || error || '').toLowerCase();
  const name = String(error?.name || '').toLowerCase();
  const code = String(error?.code || error?.error_code || '').toLowerCase();
  const combined = raw + ' ' + code;
  if (/over_email_send_rate_limit|email rate limit exceeded|only request this after|too many requests/.test(combined)) return 'email_rate_limited';
  if (/aborterror|timed out|timeout|signal is aborted/.test(combined) || name === 'aborterror' || name === 'timeouterror') return 'timeout';
  if (/failed to fetch|network request failed|load failed|fetch failed|networkerror/.test(combined)) return 'network';
  if (/email not confirmed|email_not_confirmed/.test(combined)) return 'email_unconfirmed';
  if (/invalid login credentials|invalid_credentials/.test(combined)) return 'invalid_credentials';
  return 'other';
};
