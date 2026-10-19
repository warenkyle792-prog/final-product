/**
 * Transport-level hardening: security headers, CORS, body limits and rate
 * limits. Everything is configurable from the environment so a deployment can
 * tighten it without touching code.
 *
 * Notes on two deliberate choices:
 *   · The inline theme bootstrap in index.html is allowed by hash, not by
 *     'unsafe-inline', so a script injected into the page still cannot run.
 *   · frame-ancestors is configurable because the app is previewed inside an
 *     iframe in some hosting setups. It defaults to same-origin, which is what
 *     a real deployment wants.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Local development, test runs and health checks come from loopback. They are
 * not throttled, so working on the app (or a CI suite) never locks itself out;
 * deployments, where every request arrives over a real address, stay strict.
 */
const isLoopback = (req) => {
  const ip = (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
};

const skipTrustedLocal = (req) => !isProduction() && isLoopback(req);

/* ------------------------------------------------------------------ config */

function originList() {
  const raw = [process.env.CLIENT_URL, process.env.CORS_ORIGINS]
    .filter(Boolean)
    .join(',');
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Allow same-origin requests plus anything explicitly configured. */
function corsOptions() {
  const allowed = originList();
  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin) return callback(null, true);              // curl, same-origin, server-side
      if (allowed.includes(origin)) return callback(null, true);
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
      // Sandbox previews are served from a per-session *.e2b.app host that is
      // not known when the app boots. Only loosen this outside production.
      if (!isProduction() && /^https:\/\/[a-z0-9-]+\.e2b\.app$/.test(origin)) return callback(null, true);
      return callback(null, false);
    },
  };
}

/* ------------------------------------------------------------------ CSP */

/** Hash every inline script in the built HTML so no 'unsafe-inline' is needed. */
function inlineScriptHashes(clientDist) {
  const indexFile = path.join(clientDist, 'index.html');
  if (!fs.existsSync(indexFile)) return [];

  const html = fs.readFileSync(indexFile, 'utf8');
  const hashes = [];

  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1].trim();
    if (!body) continue;
    hashes.push(`'sha256-${crypto.createHash('sha256').update(body).digest('base64')}'`);
  }

  return hashes;
}

function contentSecurityPolicy(clientDist) {
  const frameAncestors = (process.env.FRAME_ANCESTORS || "'self'")
    .split(/[\s,]+/).filter(Boolean);

  const scriptSrc = ["'self'", ...inlineScriptHashes(clientDist)];
  const directives = {
    defaultSrc: ["'self'"],
    scriptSrc,
    // React writes inline style attributes, so style-src keeps 'unsafe-inline'.
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:'],
    mediaSrc: ["'self'", 'blob:', 'data:'],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'", 'ws:', 'wss:'],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors,
    ...(isProduction() ? { upgradeInsecureRequests: [] } : {}),
  };

  return { useDefaults: false, directives };
}

/* ------------------------------------------------------------------ limits */

const json = (opts = {}) => require('express').json({ limit: '256kb', ...opts });

const limiters = {
  /** Broad safety net for the whole API. */
  api: rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_PER_MINUTE) || 600,
    skip: skipTrustedLocal,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests — slow down for a moment.' },
  }),

  /** Sign-in, registration and session renewal. */
  auth: rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_AUTH) || 120,
    skip: skipTrustedLocal,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many attempts from this address. Please wait a few minutes.' },
  }),

  /** Uploads are expensive; keep them bounded per user. */
  uploads: rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_UPLOADS) || 60,
    skip: skipTrustedLocal,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many uploads — try again shortly.' },
  }),

  /** Ticket codes are short, so guessing them must be slow and countable. */
  verify: rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_VERIFY) || 30,
    skip: skipTrustedLocal,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many verification attempts — wait a moment.' },
  }),

  /** Password changes and other sensitive account actions. */
  sensitive: rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_SENSITIVE) || 20,
    skip: skipTrustedLocal,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many attempts — please wait before trying again.' },
  }),
};

/* ------------------------------------------------------------------ setup */

function applySecurity(app, { clientDist } = {}) {
  // Behind a platform proxy (Render, Fly, nginx) the client IP arrives in
  // X-Forwarded-For; without this, rate limiting would bucket everyone together.
  if (process.env.TRUST_PROXY !== 'false') {
    app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
  }

  app.disable('x-powered-by');

  const ancestors = (process.env.FRAME_ANCESTORS || "'self'").trim();
  app.use(helmet({
    contentSecurityPolicy: contentSecurityPolicy(clientDist),
    // X-Frame-Options cannot express a wildcard; when embedding is explicitly
    // allowed, frame-ancestors (above) is the control that applies.
    frameguard: ancestors === "'self'" ? { action: 'sameorigin' } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: isProduction() ? { maxAge: 15552000, includeSubDomains: true } : false,
  }));

  app.use(compression());
  app.use(cors(corsOptions()));

  // Uploads carry base64 camera captures, so that route gets its own, larger
  // ceiling; body-parser skips a body that has already been parsed.
  app.use('/api/uploads', json({ limit: process.env.UPLOAD_JSON_LIMIT || '12mb' }));
  app.use(json());
  app.use(require('express').urlencoded({ extended: false, limit: '256kb' }));

  app.use('/api', limiters.api);
}

module.exports = { applySecurity, limiters, corsOptions, inlineScriptHashes };
