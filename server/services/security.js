/**
 * Security helpers shared by the auth routes.
 *
 * Everything here is server-side on purpose: the browser is treated as
 * untrusted input, never as the place where rules are enforced.
 */
const db = require('../db');

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

/** Passwords that are guessed first in every credential-stuffing list. */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd',
  '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyuiop',
  'letmein1', 'iloveyou', 'admin123', 'administrator', 'welcome1',
  'abc12345', 'football', 'baseball', 'sunshine', 'princess',
]);

const LOCKOUT_WINDOW_MINUTES = 15;
const MAX_FAILED_ATTEMPTS = 10;

/**
 * Check a proposed password. Returns an explanation string, or null when the
 * password is acceptable.
 */
function passwordProblem(password, { username = '', email = '', name = '' } = {}) {
  const value = String(password ?? '');

  if (value.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
  if (value.length > MAX_PASSWORD) return `Password must be under ${MAX_PASSWORD} characters`;
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Password must include both letters and numbers';
  }

  const lower = value.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'That password is too common — pick something less guessable';

  const local = String(email).toLowerCase().split('@')[0];
  if (local && local.length >= 3 && lower.includes(local)) {
    return 'Password must not contain your email address';
  }
  if (username && String(username).length >= 3 && lower.includes(String(username).toLowerCase())) {
    return 'Password must not contain your username';
  }
  const first = String(name).trim().split(/\s+/)[0];
  if (first && first.length >= 4 && lower === first.toLowerCase()) {
    return 'Password must not be your name';
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Sign-in throttling
 *
 * Rate limiting by IP alone is not enough: a slow attacker rotating IPs still
 * gets unlimited guesses against one account. Failures are therefore counted
 * per email address as well, and a locked account is refused regardless of
 * where the attempt comes from.
 * ------------------------------------------------------------------ */

function recordAttempt(email, ip, succeeded) {
  db.prepare('INSERT INTO login_attempts (email, ip, succeeded) VALUES (?, ?, ?)')
    .run(String(email || '').toLowerCase().slice(0, 160), String(ip || '').slice(0, 60), succeeded ? 1 : 0);

  // Keep the table small; older rows cannot affect a lockout any more.
  db.prepare(`DELETE FROM login_attempts WHERE created_at < datetime('now', '-2 days')`).run();
}

function failedAttempts(email) {
  const row = db.prepare(`
    SELECT COUNT(*) AS failures, MAX(created_at) AS last_failure
    FROM login_attempts
    WHERE email = ? AND succeeded = 0 AND created_at >= datetime('now', ?)
  `).get(String(email || '').toLowerCase().slice(0, 160), `-${LOCKOUT_WINDOW_MINUTES} minutes`);

  return { failures: row?.failures || 0, lastFailure: row?.last_failure || null };
}

function lockoutFor(email) {
  const { failures } = failedAttempts(email);
  if (failures < MAX_FAILED_ATTEMPTS) return null;

  const lockedUntil = new Date(Date.now() + LOCKOUT_WINDOW_MINUTES * 60 * 1000);
  return {
    failures,
    retryAfterSeconds: LOCKOUT_WINDOW_MINUTES * 60,
    message: `Too many failed attempts. Try again in ${LOCKOUT_WINDOW_MINUTES} minutes, or reset your password.`,
    lockedUntil,
  };
}

function clearAttempts(email) {
  db.prepare('DELETE FROM login_attempts WHERE email = ? AND succeeded = 0')
    .run(String(email || '').toLowerCase().slice(0, 160));
}

/** Best-effort client address, honouring the configured proxy hops. */
function clientIp(req) {
  return (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
}

module.exports = {
  MIN_PASSWORD,
  MAX_PASSWORD,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_WINDOW_MINUTES,
  passwordProblem,
  recordAttempt,
  lockoutFor,
  clearAttempts,
  clientIp,
};
