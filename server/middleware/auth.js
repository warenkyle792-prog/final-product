/**
 * Authentication middleware.
 *
 * A request is authenticated by, in order of preference:
 *   1. `Authorization: Bearer <token>` — what the SPA sends;
 *   2. an httpOnly session cookie — how a browser reloads into its session
 *      even when site storage is blocked, cleared or partitioned;
 *   3. `?token=` — used by scanner links that cannot set headers.
 *
 * Cookies and query tokens are only accepted for read-only requests; anything
 * that changes state needs a bearer token or the `X-Requested-With` header,
 * which a cross-site form cannot set. That keeps cookie sessions safe from CSRF.
 *
 * Every token carries the id of a server-side session, so it can be renewed
 * while it is in use and revoked the moment it should stop working.
 */
const jwt = require('jsonwebtoken');
const { getUserById } = require('../db/helpers');
const sessions = require('../services/sessions');

const JWT_SECRET = process.env.JWT_SECRET || 'eventtracker-dev-secret-change-me';
const JWT_ISSUER = 'eventtracker';
const JWT_AUDIENCE = 'eventtracker-web';
const COOKIE_NAME = 'et_session';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const isProduction = () => process.env.NODE_ENV === 'production';
const cookieSecure = () => {
  if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === 'true';
  return isProduction();
};

function signToken(user, sessionId) {
  return jwt.sign(
    { id: user.id, username: user.username, sid: sessionId },
    JWT_SECRET,
    {
      expiresIn: `${sessions.TOKEN_DAYS}d`,
      algorithm: 'HS256',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

/* ------------------------------------------------------------------ cookies */

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    path: '/',
    maxAge: sessions.SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    path: '/',
  });
}

/**
 * Start a fresh session for a user: create the row, sign the token, hand the
 * browser its cookie, and return the token for clients that prefer headers.
 */
function startSession(user, req, res) {
  const session = sessions.create(user.id, req);
  const token = signToken(user, session.id);
  if (res) setSessionCookie(res, token);
  return { token, sessionId: session.id };
}

/* ------------------------------------------------------------------ reading */

function readBearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function readCookie(req) {
  const jar = req.headers.cookie;
  if (!jar) return null;
  for (const part of jar.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Pick the credential for this request. Returns { token, source } where source
 * is 'bearer' | 'cookie' | 'query'.
 */
function readCredential(req) {
  const bearer = readBearer(req);
  if (bearer) return { token: bearer, source: 'bearer' };

  const mutating = !SAFE_METHODS.has(req.method);
  const markedAsApp = String(req.headers['x-requested-with'] || '').toLowerCase() === 'eventtracker';

  const cookie = readCookie(req);
  if (cookie && (!mutating || markedAsApp)) return { token: cookie, source: 'cookie' };

  if (!mutating && typeof req.query?.token === 'string') {
    return { token: req.query.token, source: 'query' };
  }

  return { token: null, source: null };
}

/**
 * Resolve a token into a user. Returns null when the token, the session behind
 * it, or the account is no longer valid.
 */
function resolveUser(req, token) {
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return null;
  }

  const user = getUserById(payload.id);
  if (!user) return null;

  // Tokens issued before sessions existed are upgraded on first use.
  const session = payload.sid ? sessions.find(payload.sid) : null;
  if (payload.sid && !sessions.isUsable(session)) return null;

  return { user, payload, session };
}

/** Slide the session, and hand back a fresh token when the current one ages. */
function renewIfAging(req, res, user, payload) {
  const session = payload.sid ? sessions.touch(sessions.find(payload.sid)) : null;

  const issued = payload.iat ? payload.iat * 1000 : 0;
  const aging = payload.exp ? (payload.exp * 1000 - Date.now()) / 1000 < sessions.TOKEN_DAYS * 86400 - sessions.RENEW_AFTER_SECONDS : true;

  if (session && aging) {
    const token = signToken(user, session.id);
    setSessionCookie(res, token);
    // Lets the SPA refresh its stored token without a second round trip.
    res.setHeader('X-Session-Token', token);
    res.setHeader('Access-Control-Expose-Headers', 'X-Session-Token');
  }

  return session;
}

function requireAuth(req, res, next) {
  const { token } = readCredential(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const resolved = resolveUser(req, token);
  if (!resolved) return res.status(401).json({ error: 'Your session has ended' });

  const { user, payload } = resolved;

  // A token without a session id predates server-side sessions; start tracking
  // it now instead of signing the person out.
  if (!payload.sid) {
    const { token: fresh } = startSession(user, req, res);
    res.setHeader('X-Session-Token', fresh);
    res.setHeader('Access-Control-Expose-Headers', 'X-Session-Token');
    req.sessionId = null;
  } else {
    const session = renewIfAging(req, res, user, payload);
    req.sessionId = session?.id || payload.sid;
  }

  req.userId = user.id;
  req.username = user.username;
  req.user = user;
  next();
}

function optionalAuth(req, _res, next) {
  const { token } = readCredential(req);
  if (token) {
    const resolved = resolveUser(req, token);
    if (resolved) {
      req.userId = resolved.user.id;
      req.username = resolved.user.username;
      req.user = resolved.user;
      req.sessionId = resolved.payload.sid || null;
    }
  }
  next();
}

/** Session id behind the current request, without demanding a valid one. */
function resolveSessionId(req) {
  const { token } = readCredential(req);
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    return payload.sid || null;
  } catch {
    return null;
  }
}

module.exports = {
  COOKIE_NAME,
  resolveSessionId,
  JWT_SECRET,
  signToken,
  verifyToken,
  setSessionCookie,
  clearSessionCookie,
  startSession,
  requireAuth,
  optionalAuth,
};
