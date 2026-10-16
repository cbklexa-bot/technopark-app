import assert from 'node:assert/strict';
import { classifyAuthError, isObfuscatedSignupResponse } from '../www/auth-logic.js';

assert.equal(isObfuscatedSignupResponse({ id: 'masked', email: '', identities: [] }), true);
assert.equal(isObfuscatedSignupResponse({ id: 'masked', identities: [] }), true);
assert.equal(isObfuscatedSignupResponse({ id: 'new', email: 'new@example.com', identities: [{ provider: 'email' }] }), false);
assert.equal(isObfuscatedSignupResponse({ id: 'existing', email: 'user@example.com', identities: [{ provider: 'email' }], email_confirmed_at: '2026-10-16T00:00:00Z' }), false);

assert.equal(classifyAuthError({ message: 'TypeError: Failed to fetch' }), 'network');
assert.equal(classifyAuthError({ name: 'AbortError', message: 'Supabase request timed out' }), 'timeout');
assert.equal(classifyAuthError({ message: 'Email not confirmed' }), 'email_unconfirmed');
assert.equal(classifyAuthError({ message: 'Invalid login credentials' }), 'invalid_credentials');
assert.equal(classifyAuthError({ code: 'over_email_send_rate_limit', message: '429 email rate limit exceeded' }), 'email_rate_limited');
console.log('Auth flow tests passed: duplicate signup, timeout, network error, email rate limit and credential errors.');
