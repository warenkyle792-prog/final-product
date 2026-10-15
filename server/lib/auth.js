const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const DAY_SECONDS = 86400;

function cookieName(config) {
  return config.cookieSecure ? '__Host-et_session' : 'et_session';
}
function sessionMaxAgeSeconds(config) {
  return Math.max(1, Number(config.sessionDays) || 1) * DAY_SECONDS;
}
function tokenLifetimeSeconds(config) {
  return Math.max(1, Number(config.tokenDays) || 1) * DAY_SECONDS;
}

// HS256 bearer token bound to a persisted server-side session row. The optional
// iat override exists so tests and tooling can mint tokens at a past issue time.
function signForSession(user, sessionId, config, iat = Math.floor(Date.now() / 1000)) {
  return jwt.sign(
    { sub: user.id, sid: sessionId, iat, exp: iat + tokenLifetimeSeconds(config) },
    config.jwtSecret,
    { algorithm: 'HS256' }
  );
}

async function createSession(db, user, config) {
  const id = crypto.randomUUID();
  const stamp = new Date().toISOString();
  const expiresAt = new Date(Date.now() + sessionMaxAgeSeconds(config) * 1000).toISOString();
  db.run('INSERT INTO sessions(id,user_id,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?)', [id, user.id, expiresAt, stamp, stamp]);
  return { id, user_id: user.id, expires_at: expiresAt, revoked_at: null, created_at: stamp, last_seen_at: stamp, token: signForSession(user, id, config) };
}

function cookieAttributes(config, maxAgeSeconds) {
  const parts = [`Max-Age=${maxAgeSeconds}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Priority=High'];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}
function setSessionCookie(res, token, config) {
  res.setHeader('Set-Cookie', `${cookieName(config)}=${encodeURIComponent(token)}; ${cookieAttributes(config, sessionMaxAgeSeconds(config))}`);
}
function clearSessionCookie(res, config) {
  res.setHeader('Set-Cookie', `${cookieName(config)}=; ${cookieAttributes(config, 0)}`);
}

function parseCookies(header = '') {
  const cookies = {};
  for (const piece of header.split(/;\s*/)) {
    const index = piece.indexOf('=');
    if (index > 0) cookies[piece.slice(0, index)] = decodeURIComponent(piece.slice(index + 1));
  }
  return cookies;
}
function tokenFrom(req, config) {
  const match = /^Bearer\s+([A-Za-z0-9._-]+)$/i.exec(String(req.get('authorization') || '').trim());
  if (match) return match[1];
  const cookies = parseCookies(req.get('cookie'));
  return cookies[cookieName(config)] || cookies['__Host-et_session'] || cookies['et_session'] || '';
}

function loadAuth(db, config, token) {
  let claims;
  try {
    claims = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  const session = db.get('SELECT * FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL', [claims.sid, Number(claims.sub)]);
  if (!session || Date.parse(session.expires_at) <= Date.now()) return null;
  const user = db.get('SELECT id,username,email,role,name,bio,avatar,created_at,verified_at FROM users WHERE id = ?', [Number(claims.sub)]);
  if (!user) return null;
  return { user, session, claims };
}

function authMiddleware(db, config) {
  return (req, res, next) => {
    const token = tokenFrom(req, config);
    if (!token) return next();
    const auth = loadAuth(db, config, token);
    if (!auth) return next();
    req.auth = { user: auth.user, sessionId: auth.session.id };
    // Silent renewal after the token half-life: same persistent session, fresh token.
    const age = Math.floor(Date.now() / 1000) - Number(auth.claims.iat || 0);
    if (age > tokenLifetimeSeconds(config) / 2) {
      const stamp = new Date().toISOString();
      const expiresAt = new Date(Date.now() + sessionMaxAgeSeconds(config) * 1000).toISOString();
      db.run('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?', [expiresAt, stamp, auth.session.id]);
      res.setHeader('x-session-token', signForSession(auth.user, auth.session.id, config));
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (req.auth?.user) return next();
  return res.status(401).json({ error: 'SIGN_IN_REQUIRED' });
}
function requireRole(role) {
  return (req, res, next) => {
    if (!req.auth?.user) return res.status(401).json({ error: 'SIGN_IN_REQUIRED' });
    if (req.auth.user.role !== role) return res.status(403).json({ error: 'NOT_ALLOWED' });
    return next();
  };
}

module.exports = { signForSession, createSession, setSessionCookie, clearSessionCookie, tokenFrom, authMiddleware, requireAuth, requireRole };
