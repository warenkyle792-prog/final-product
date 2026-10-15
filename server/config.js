const path = require('node:path');
require('dotenv').config();

function bool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}
function number(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function secretIsWeak(value) {
  if (typeof value !== 'string' || value.length < 32) return true;
  if (/^(.)\1+$/.test(value)) return true;
  return /development|dev[-_ ]?secret|change[-_ ]?me|example|placeholder|password|your[-_ ]/i.test(value);
}
function httpsOrigin(value, label) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`Refusing production config: ${label} must be an exact HTTPS origin.`); }
  if (parsed.protocol !== 'https:' || parsed.origin !== value || parsed.username || parsed.password) {
    throw new Error(`Refusing production config: ${label} must be an exact HTTPS origin.`);
  }
  return parsed.origin;
}
function httpsUrl(value, label) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`Refusing production config: ${label} must be an HTTPS URL.`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`Refusing production config: ${label} must be an HTTPS URL.`);
  }
  return parsed;
}
function loadConfig(env = process.env) {
  const mode = env.NODE_ENV || 'development';
  const clientUrl = env.CLIENT_URL || 'http://localhost:5173';
  const publicAppUrl = (env.PUBLIC_APP_URL || env.CLIENT_URL || 'http://localhost:5000').replace(/\/$/, '');
  const origins = (env.CORS_ORIGINS || env.CLIENT_URL || 'http://localhost:5173,http://localhost:5000')
    .split(',').map((x) => x.trim()).filter(Boolean);
  const cookieSecure = bool(env.COOKIE_SECURE, mode === 'production');
  const trustProxy = env.TRUST_PROXY == null || String(env.TRUST_PROXY).trim() === '' ? false : String(env.TRUST_PROXY).trim();
  const mpesa = {
    env: env.MPESA_ENV || 'sandbox',
    consumerKey: env.MPESA_CONSUMER_KEY || '',
    consumerSecret: env.MPESA_CONSUMER_SECRET || '',
    shortcode: env.MPESA_SHORTCODE || '',
    passkey: env.MPESA_PASSKEY || '',
    callbackUrl: env.MPESA_CALLBACK_URL || '',
    callbackToken: env.MPESA_CALLBACK_TOKEN || ''
  };
  const stripe = {
    secretKey: env.STRIPE_SECRET_KEY || '',
    publishableKey: env.STRIPE_PUBLISHABLE_KEY || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || ''
  };
  const google = {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || ''
  };

  if (mode === 'production') {
    const weak = ['JWT_SECRET', 'TICKET_SECRET'].filter((key) => secretIsWeak(env[key]));
    if (weak.length) throw new Error(`Refusing to start in production: ${weak.join(' and ')} must be set to unique random secrets of at least 32 characters.`);
    if (env.JWT_SECRET === env.TICKET_SECRET) throw new Error('Refusing to start in production: JWT_SECRET and TICKET_SECRET must be different independent secrets.');
    if (!cookieSecure) throw new Error('Refusing to start in production: COOKIE_SECURE must be true.');
    if (['true', '*', 'all'].includes(String(trustProxy).trim().toLowerCase())) throw new Error('Refusing to start in production: set TRUST_PROXY to a trusted hop count or proxy address, never trust every proxy.');

    httpsOrigin(clientUrl, 'CLIENT_URL');
    httpsUrl(publicAppUrl, 'PUBLIC_APP_URL');
    for (const origin of origins) httpsOrigin(origin, 'CORS_ORIGINS entry');

    const sessionDays = number(env.SESSION_DAYS, 30);
    const tokenDays = number(env.TOKEN_DAYS, 30);
    if (sessionDays > 30 || tokenDays > 30) throw new Error('Refusing to start in production: SESSION_DAYS and TOKEN_DAYS cannot exceed 30 days.');

    const mpesaFields = [mpesa.consumerKey, mpesa.consumerSecret, mpesa.shortcode, mpesa.passkey, mpesa.callbackUrl, mpesa.callbackToken];
    const hasAnyMpesa = mpesaFields.some(Boolean);
    if (!['sandbox', 'production'].includes(mpesa.env)) throw new Error('MPESA_ENV must be sandbox or production.');
    if (hasAnyMpesa && mpesa.env !== 'production') throw new Error('Refusing production config: sandbox M-Pesa credentials cannot be used by a production application.');
    if (mpesa.env === 'production' || hasAnyMpesa) {
      if (mpesaFields.some((value) => !value)) throw new Error('Refusing incomplete M-Pesa configuration: all live credentials, an HTTPS callback URL, and a callback token are required.');
      const callback = httpsUrl(mpesa.callbackUrl, 'MPESA_CALLBACK_URL');
      if (!callback.pathname.endsWith('/api/payments/callback/mpesa')) throw new Error('MPESA_CALLBACK_URL must end in /api/payments/callback/mpesa.');
      if (mpesa.callbackToken.length < 32 || secretIsWeak(mpesa.callbackToken)) throw new Error('MPESA_CALLBACK_TOKEN must be a unique random secret of at least 32 characters.');
    }

    const stripeFields = [stripe.secretKey, stripe.publishableKey, stripe.webhookSecret];
    if (stripeFields.some(Boolean) && stripeFields.some((value) => !value)) throw new Error('Refusing incomplete Stripe configuration: STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, and STRIPE_WEBHOOK_SECRET must all be set together.');
    if (stripe.secretKey && (!/^(sk|rk)_live_/.test(stripe.secretKey) || !/^pk_live_/.test(stripe.publishableKey))) throw new Error('Refusing production config: Stripe live secret and publishable keys are required; test keys cannot process production payments.');
    if (stripe.webhookSecret && (!/^whsec_[a-zA-Z0-9]+$/.test(stripe.webhookSecret) || stripe.webhookSecret.length < 32 || secretIsWeak(stripe.webhookSecret))) throw new Error('STRIPE_WEBHOOK_SECRET must be a provider-issued whsec_ signing secret, not a placeholder.');

    const signingSecrets = [env.JWT_SECRET, env.TICKET_SECRET, mpesa.callbackToken, stripe.webhookSecret].filter(Boolean);
    if (new Set(signingSecrets).size !== signingSecrets.length) throw new Error('Refusing production config: JWT, ticket, callback, and webhook secrets must be independent values.');
  }

  const sessionDays = number(env.SESSION_DAYS, 30);
  const tokenDays = number(env.TOKEN_DAYS, 30);
  const dataDir = path.resolve(env.DATA_DIR || path.join(process.cwd(), 'data'));
  const uploadsDir = path.resolve(env.UPLOADS_DIR || path.join(dataDir, 'uploads'));
  const dbFile = path.resolve(env.DB_FILE || path.join(dataDir, 'eventtracker.sqlite'));
  return {
    mode,
    port: Number(env.PORT || 5000),
    clientUrl,
    publicAppUrl,
    corsOrigins: origins,
    trustProxy,
    frameAncestors: env.FRAME_ANCESTORS || "'none'",
    jwtSecret: env.JWT_SECRET || 'local-development-jwt-secret-change-this-value-000000',
    ticketSecret: env.TICKET_SECRET || 'local-development-ticket-secret-change-this-value-000000',
    sessionDays,
    tokenDays,
    cookieSecure,
    limits: {
      general: number(env.RATE_LIMIT_GENERAL, 240),
      auth: number(env.RATE_LIMIT_AUTH, 12),
      uploads: number(env.RATE_LIMIT_UPLOADS, 24),
      verify: number(env.RATE_LIMIT_VERIFY, 60),
      sensitive: number(env.RATE_LIMIT_SENSITIVE, 30),
      windowMs: number(env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000)
    },
    uploadJsonLimit: env.UPLOAD_JSON_LIMIT || '2mb',
    dataDir,
    uploadsDir,
    dbFile,
    mpesa,
    stripe,
    google
  };
}

module.exports = { loadConfig, secretIsWeak, httpsOrigin, httpsUrl };
