/**
 * Server-side sessions.
 *
 * A JWT on its own cannot be revoked and cannot be renewed, which is how users
 * end up either signed in forever or signed out without explanation. Every
 * sign-in therefore also creates a row here, and the token carries its `sid`:
 *
 *   · expiry slides forward while the session is in active use, so a working
 *     browser is never signed out mid-task;
 *   · signing out, changing a password or an admin removing an account can
 *     revoke the session immediately, on every device;
 *   · the row records the device so a user can see where they are signed in.
 */
const crypto = require('crypto');
const db = require('../db');

/** Days a session survives without use. Set SESSION_DAYS to change it. */
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS) || 30);

/** How long a token is valid before the server offers a fresh one. */
const TOKEN_DAYS = Math.max(1, Number(process.env.TOKEN_DAYS) || SESSION_DAYS);

/** Renovate when a token is past half its life. */
const RENEW_AFTER_SECONDS = Math.round((TOKEN_DAYS * 24 * 60 * 60) / 2);

/** last_seen_at is only written this often, to keep SQLite writes quiet. */
const TOUCH_SECONDS = 5 * 60;

const iso = (date) => new Date(date).toISOString().replace('T', ' ').slice(0, 19);
const inDays = (days) => iso(Date.now() + days * 24 * 60 * 60 * 1000);

function describeAgent(userAgent = '') {
  const ua = String(userAgent);
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
      : /Chrome\//.test(ua) ? 'Chrome'
        : /Safari\//.test(ua) ? 'Safari'
          : /Firefox\//.test(ua) ? 'Firefox'
            : /curl|node|axios|undici/i.test(ua) ? 'API client'
              : 'Unknown browser';
  const platform = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
      : /Mac OS X/.test(ua) ? 'macOS'
        : /Windows/.test(ua) ? 'Windows'
          : /Linux/.test(ua) ? 'Linux'
            : 'Unknown device';
  return { browser, platform, label: `${browser} on ${platform}` };
}

function create(userId, req = {}) {
  const id = crypto.randomBytes(24).toString('hex');
  const agent = describeAgent(req.headers?.['user-agent']);

  db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at, user_agent, ip, label, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    id,
    userId,
    inDays(SESSION_DAYS),
    String(req.headers?.['user-agent'] || '').slice(0, 300),
    String(req.ip || '').slice(0, 60),
    agent.label
  );

  return { id, expiresAt: inDays(SESSION_DAYS) };
}

function find(id) {
  if (!id) return null;
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(String(id));
}

function isUsable(session) {
  if (!session) return false;
  if (session.revoked_at) return false;
  return new Date(`${session.expires_at}Z`).getTime() > Date.now();
}

/** Slide the expiry forward and note the last time we saw this device. */
function touch(session) {
  const now = Date.now();
  const lastSeen = new Date(`${session.last_seen_at}Z`).getTime();

  const patch = { expires_at: inDays(SESSION_DAYS) };
  if (!Number.isFinite(lastSeen) || now - lastSeen > TOUCH_SECONDS * 1000) {
    patch.last_seen_at = iso(now);
  }

  db.prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?')
    .run(patch.expires_at, patch.last_seen_at || session.last_seen_at, session.id);

  return { ...session, ...patch };
}

function revoke(id) {
  if (!id) return;
  db.prepare(`UPDATE sessions SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`).run(String(id));
}

function revokeAll(userId, { exceptId = null } = {}) {
  if (exceptId) {
    db.prepare(`UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND id != ? AND revoked_at IS NULL`)
      .run(userId, exceptId);
    return;
  }
  db.prepare(`UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`).run(userId);
}

function listForUser(userId) {
  return db.prepare(`
    SELECT id, label, ip, created_at, last_seen_at, expires_at
    FROM sessions
    WHERE user_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')
    ORDER BY last_seen_at DESC
    LIMIT 20
  `).all(userId);
}

/** Drop rows that expired long ago so the table does not grow forever. */
function prune() {
  db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now', '-7 days')`).run();
}

module.exports = {
  SESSION_DAYS,
  TOKEN_DAYS,
  RENEW_AFTER_SECONDS,
  describeAgent,
  create,
  find,
  isUsable,
  touch,
  revoke,
  revokeAll,
  listForUser,
  prune,
};
