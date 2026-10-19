/**
 * /api/auth — registration, sign-in, session renewal and sign-out.
 *
 * Signing in creates a server-side session (see services/sessions.js) and sets
 * an httpOnly cookie alongside the token in the response body. The cookie means
 * a browser reload lands back in the session even when site storage is blocked
 * or has been cleared — the usual reason people are "randomly signed out".
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, clearSessionCookie, startSession, signToken, resolveSessionId } = require('../middleware/auth');
const { getUserById, getUserWithPassword, getUserByEmail, userStats, audit } = require('../db/helpers');
const notifications = require('../services/notifications');
const sessions = require('../services/sessions');
const security = require('../services/security');

const router = express.Router();

function withStats(user) {
  const fresh = getUserById(user.id);
  return { ...fresh, stats: userStats(user.id) };
}

/** The shape the account screen works with — never the raw session rows. */
function presentSession(row, currentId) {
  return {
    id: row.id,
    label: row.label || 'Unknown device',
    ip: row.ip || '',
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    expires_at: row.expires_at,
    current: row.id === currentId,
  };
}

const RESERVED = new Set(['admin', 'root', 'eventtracker', 'support', 'help', 'api', 'settings', 'login', 'register']);

router.post('/register', (req, res, next) => {
  try {
    const { name, username, email, password, phone = '', location = '', interests = [] } = req.body || {};

    if (!name || !username || !email || !password) {
      return res.status(400).json({ error: 'Name, username, email and password are required' });
    }
    if (!/^[a-z0-9_.]{3,24}$/i.test(username)) {
      return res.status(400).json({ error: 'Username must be 3–24 characters (letters, numbers, underscores)' });
    }
    if (RESERVED.has(String(username).toLowerCase())) {
      return res.status(400).json({ error: 'That username is reserved' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email))) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    const passwordIssue = security.passwordProblem(password, { username, email, name });
    if (passwordIssue) return res.status(400).json({ error: passwordIssue });

    const cleanUsername = String(username).toLowerCase();
    const cleanEmail = String(email).toLowerCase();

    if (db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername)) {
      return res.status(409).json({ error: 'That username is already taken' });
    }
    if (getUserByEmail(cleanEmail)) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const hash = bcrypt.hashSync(String(password), 12);
    const interestString = (Array.isArray(interests) ? interests : String(interests).split(','))
      .map((s) => String(s).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 8)
      .join(',');

    const info = db.prepare(`
      INSERT INTO users (name, username, email, password_hash, bio, location, phone, interests)
      VALUES (?, ?, ?, ?, '', ?, ?, ?)
    `).run(
      String(name).trim().slice(0, 80),
      cleanUsername,
      cleanEmail,
      hash,
      String(location).trim().slice(0, 120),
      String(phone).trim().slice(0, 40),
      interestString
    );

    const user = getUserById(info.lastInsertRowid);

    notifications.create({
      userId: user.id,
      type: 'system',
      title: 'Welcome to EventTracker',
      body: 'Follow a few categories, save your first event, and create one of your own when you are ready.',
      link: '/discover',
    });

    audit(user.id, 'account.created', 'user', user.id, { username: cleanUsername, ip: security.clientIp(req) });

    const { token } = startSession(user, req, res);
    res.status(201).json({ token, user: withStats(user) });
  } catch (error) {
    next(error);
  }
});

router.post('/login', (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const cleanEmail = String(email).trim().toLowerCase();
    const ip = security.clientIp(req);

    const lockout = security.lockoutFor(cleanEmail);
    if (lockout) {
      audit(null, 'auth.locked', 'user', cleanEmail, { ip, failures: lockout.failures });
      return res.status(429).json({ error: lockout.message, retry_after: lockout.retryAfterSeconds });
    }

    const user = getUserWithPassword(cleanEmail);
    const ok = Boolean(user) && bcrypt.compareSync(String(password), user.password_hash);

    if (!ok) {
      security.recordAttempt(cleanEmail, ip, false);
      audit(user?.id || null, 'auth.failed', 'user', cleanEmail, { ip });
      // Same message either way: no account enumeration.
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    security.recordAttempt(cleanEmail, ip, true);
    security.clearAttempts(cleanEmail);

    const { token } = startSession(user, req, res);
    audit(user.id, 'auth.login', 'user', user.id, { ip, device: sessions.describeAgent(req.headers['user-agent']).label });

    res.json({ token, user: withStats(user) });
  } catch (error) {
    next(error);
  }
});

/**
 * Renew the current session. Called by the app on boot and periodically, so an
 * open tab keeps a working token and a stale one is replaced rather than
 * failing the next request the user makes.
 */
router.post('/refresh', requireAuth, (req, res) => {
  const fresh = signToken(req.user, req.sessionId);
  res.setHeader('X-Session-Token', fresh);
  res.setHeader('Access-Control-Expose-Headers', 'X-Session-Token');
  res.json({ token: fresh, user: withStats(req.user) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: { ...req.user, stats: userStats(req.userId) },
    unread_notifications: notifications.unreadCount(req.userId),
  });
});

/** Where this account is signed in. */
router.get('/sessions', requireAuth, (req, res) => {
  res.json({
    sessions: sessions.listForUser(req.userId).map((row) => presentSession(row, req.sessionId)),
  });
});

/** Sign out one device. */
router.delete('/sessions/:id', requireAuth, (req, res) => {
  const row = sessions.find(req.params.id);
  if (!row || row.user_id !== req.userId) return res.status(404).json({ error: 'Session not found' });

  sessions.revoke(row.id);
  audit(req.userId, 'auth.session_revoked', 'session', row.id, { label: row.label });

  if (row.id === req.sessionId) clearSessionCookie(res);
  res.json({ ok: true, current: row.id === req.sessionId });
});

/** Sign out everywhere (used after a password change, or to evict a device). */
router.post('/logout-all', requireAuth, (req, res) => {
  sessions.revokeAll(req.userId);
  clearSessionCookie(res);
  audit(req.userId, 'auth.logout_all', 'user', req.userId, {});
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  // Deliberately not behind requireAuth: signing out must succeed even with a
  // dead token, otherwise the browser keeps a cookie it can never clear.
  const sessionId = req.sessionId || resolveSessionId(req);
  if (sessionId) sessions.revoke(sessionId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

module.exports = router;
