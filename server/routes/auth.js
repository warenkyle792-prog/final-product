const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { limiter } = require('../lib/rate-limits');
const { requireAuth, createSession, setSessionCookie, clearSessionCookie, signForSession } = require('../lib/auth');
const { nowIso, isEmail, publicUser, slugify, audit } = require('../lib/helpers');

function passwordValid(value) { return typeof value === 'string' && value.length >= 8 && value.length <= 72 && /[A-Za-z]/.test(value) && /\d/.test(value); }
function createAuthRouter({ db, config }) {
  const router = express.Router();
  const authLimit = limiter(config, 'auth', 'AUTH_RATE_LIMITED');
  const sensitive = limiter(config, 'sensitive', 'SENSITIVE_RATE_LIMITED');

  // Count only account-creation and credential-check attempts. Session restore,
  // refresh, and logout are routine app traffic and must not exhaust this budget.
  router.post('/register', authLimit, async (req, res, next) => {
    try {
      const body = req.body || {};
      const email = String(body.email || '').trim().toLowerCase();
      const username = String(body.username || '').trim().toLowerCase();
      const name = String(body.name || '').trim();
      const password = body.password;
      const fields = {};
      if (name.length < 2 || name.length > 80) fields.name = 'Enter a name between 2 and 80 characters.';
      if (!/^[a-z0-9_]{3,24}$/.test(username)) fields.username = 'Use 3–24 letters, numbers, or underscores for your username.';
      if (!isEmail(email)) fields.email = 'Enter a valid email address.';
      if (!passwordValid(password)) fields.password = 'Use 8–72 characters, including at least one letter and one number.';
      if (Object.keys(fields).length) return res.status(400).json({ error: 'INVALID_INPUT', fields });
      if (db.get('SELECT id FROM users WHERE email = ? OR username = ?', [email, username])) return res.status(409).json({ error: 'ACCOUNT_EXISTS' });
      const role = body.role === 'organizer' ? 'organizer' : 'attendee';
      const stamp = nowIso();
      const hash = await bcrypt.hash(password, 12);
      const result = db.run('INSERT INTO users(username,email,password_hash,role,name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', [username, email, hash, role, name, stamp, stamp]);
      const user = db.get('SELECT id,username,email,role,name,bio,avatar,created_at,verified_at FROM users WHERE id = ?', [result.lastID]);
      const session = await createSession(db, user, config);
      setSessionCookie(res, session.token, config);
      res.setHeader('x-session-token', session.token);
      res.status(201).json({ user: publicUser(user), token: session.token });
    } catch (error) { next(error); }
  });

  router.post('/login', authLimit, async (req, res, next) => {
    try {
      const identifier = String(req.body?.identifier || req.body?.email || '').trim().toLowerCase();
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!identifier || identifier.length > 254 || !password || password.length > 72) return res.status(400).json({ error: 'INVALID_INPUT' });
      const ip = String(req.ip || '').slice(0, 64);
      const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      db.run('DELETE FROM login_attempts WHERE created_at < ?', [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()]);
      const locked = db.get(`SELECT COUNT(*) AS n FROM login_attempts WHERE successful = 0 AND created_at >= ? AND (email = ? OR ip = ?)`, [windowStart, identifier, ip]).n;
      if (locked >= 5) return res.status(429).json({ error: 'SIGN_IN_TEMPORARILY_BLOCKED' });
      const user = db.get('SELECT * FROM users WHERE email = ? OR username = ?', [identifier, identifier]);
      const valid = await bcrypt.compare(password, user?.password_hash || '$2a$12$invalidhashinvalidhashinvalidhashinvalidhashinvalidhashinvalid');
      const stamp = nowIso();
      db.run('INSERT INTO login_attempts(email,ip,successful,created_at) VALUES(?,?,?,?)', [identifier, ip, user && valid ? 1 : 0, stamp]);
      if (!user || !valid) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      db.run('DELETE FROM login_attempts WHERE email = ? AND successful = 0', [identifier]);
      // Hygiene: drop this account's expired or long-revoked sessions.
      db.run('DELETE FROM sessions WHERE user_id = ? AND (expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?))', [user.id, stamp, new Date(Date.now() - 30 * 86400000).toISOString()]);
      const session = await createSession(db, user, config);
      setSessionCookie(res, session.token, config);
      res.setHeader('x-session-token', session.token);
      res.json({ user: publicUser(user), token: session.token });
    } catch (error) { next(error); }
  });

  router.post('/logout', (req, res) => {
    if (req.auth?.sessionId) db.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [nowIso(), req.auth.sessionId]);
    clearSessionCookie(res, config);
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req, res) => {
    const user = req.auth.user;
    const stats = db.get(`SELECT
      (SELECT COUNT(*) FROM follows WHERE followed_id = ?) AS followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following,
      (SELECT COUNT(*) FROM events WHERE organizer_id = ? AND status != 'cancelled') AS events,
      (SELECT COUNT(*) FROM tickets WHERE user_id = ?) AS tickets`, [user.id, user.id, user.id, user.id]);
    res.json({ user: publicUser(user), stats });
  });

  // Google sign-in: fail-closed. Without provider credentials the start
  // endpoint reports GOOGLE_NOT_CONFIGURED and the callback bounces to login.
  router.get('/google', (req, res) => {
    if (!config.google.clientId) return res.status(503).json({ error: 'GOOGLE_NOT_CONFIGURED' });
    const state = jwt.sign({ nonce: crypto.randomUUID(), purpose: 'google-oauth' }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '10m' });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', config.google.clientId);
    url.searchParams.set('redirect_uri', `${config.publicAppUrl}/api/auth/google/callback`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    res.json({ url: url.toString() });
  });

  router.get('/google/callback', async (req, res, next) => {
    try {
      if (!config.google.clientId || !config.google.clientSecret) return res.redirect('/login?google=not-configured');
      const code = String(req.query.code || '');
      const state = String(req.query.state || '');
      if (!code) return res.redirect('/login?google=denied');
      try { jwt.verify(state, config.jwtSecret, { algorithms: ['HS256'] }); } catch { return res.redirect('/login?google=state'); }
      const redirectUri = `${config.publicAppUrl}/api/auth/google/callback`;
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' })
      });
      if (!tokenResponse.ok) return res.redirect('/login?google=exchange');
      const tokens = await tokenResponse.json();
      if (!tokens?.access_token) return res.redirect('/login?google=exchange');
      const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      if (!profileResponse.ok) return res.redirect('/login?google=profile');
      const profile = await profileResponse.json();
      const email = String(profile.email || '').trim().toLowerCase();
      if (profile.email_verified !== true || !isEmail(email)) return res.redirect('/login?google=invalid');
      let user = db.get('SELECT * FROM users WHERE email = ?', [email]);
      if (!user) {
        const stamp = nowIso();
        const base = (slugify(email.split('@')[0]).replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'google');
        let username = base;
        let suffix = 2;
        while (db.get('SELECT id FROM users WHERE username = ?', [username])) username = `${base}${suffix++}`;
        const hash = await bcrypt.hash(crypto.randomUUID(), 12);
        const result = db.run('INSERT INTO users(username,email,password_hash,role,name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', [username, email, hash, 'attendee', String(profile.name || email).slice(0, 80), stamp, stamp]);
        user = db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
      }
      const session = await createSession(db, user, config);
      setSessionCookie(res, session.token, config);
      res.redirect('/');
    } catch (error) { next(error); }
  });

  router.post('/refresh', requireAuth, (req, res) => {
    const stamp = nowIso();
    const expiresAt = new Date(Date.now() + config.sessionDays * 86400000).toISOString();
    const token = signForSession(req.auth.user, req.auth.sessionId, config);
    db.run('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?', [expiresAt, stamp, req.auth.sessionId]);
    setSessionCookie(res, token, config);
    res.setHeader('x-session-token', token);
    res.json({ user: publicUser(req.auth.user), token });
  });

  // Self-service password change: verifies the current password, applies the
  // policy, and revokes every other session so stale devices are signed out.
  router.post('/password', requireAuth, sensitive, async (req, res, next) => {
    try {
      const current = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
      const nextPassword = req.body?.new_password;
      if (!current || current.length > 72 || !passwordValid(nextPassword)) return res.status(400).json({ error: 'INVALID_INPUT' });
      const user = db.get('SELECT * FROM users WHERE id = ?', [req.auth.user.id]);
      if (!user) return res.status(401).json({ error: 'SIGN_IN_REQUIRED' });
      const okay = await bcrypt.compare(current, user.password_hash || '');
      if (!okay) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      const hash = await bcrypt.hash(nextPassword, 12);
      db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, nowIso(), user.id]);
      db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', [user.id, req.auth.sessionId]);
      audit(db, user.id, 'user.password_change', 'user', user.id);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  return router;
}
module.exports = { createAuthRouter, passwordValid };
