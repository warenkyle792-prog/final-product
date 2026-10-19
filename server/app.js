const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { loadConfig } = require('./config');
const { openDatabase } = require('./db/database');
const { limiter } = require('./lib/rate-limits');
const { tokenFrom } = require('./lib/auth');
const { createApiRouter } = require('./routes/api');

function previewOrigin(origin) {
  try { return new URL(origin).hostname.endsWith('.e2b.app'); } catch { return false; }
}
function originAllowed(origin, config) {
  if (!origin) return true;
  const loopbackDev = config.mode !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  const previewDev = config.mode !== 'production' && previewOrigin(origin);
  return config.corsOrigins.includes(origin) || loopbackDev || previewDev;
}
function hasSessionCookie(header = '') { return /(?:^|;\s*)(?:__Host-et_session|et_session)=/i.test(header); }
function isUnsafeMethod(method) { return !['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase()); }
const DEMO_IDENTIFIERS = ['admin@eventtracker.app', 'njeri@eventtracker.app', 'kamau@eventtracker.app', 'wambui@eventtracker.app', 'brian@eventtracker.app', 'amina@eventtracker.app', 'eventtracker', 'njeri', 'kamaucreates', 'wambuiworks', 'brianm', 'amina'];
function hasDemoAccounts(db) {
  const placeholders = DEMO_IDENTIFIERS.map(() => '?').join(',');
  return Boolean(db.get(`SELECT id FROM users WHERE email IN (${placeholders}) OR username IN (${placeholders}) LIMIT 1`, [...DEMO_IDENTIFIERS, ...DEMO_IDENTIFIERS]));
}
function parseTrustProxy(value) {
  if (value === true || String(value).toLowerCase() === 'true') return true;
  if (value === false || String(value).toLowerCase() === 'false' || value === '') return false;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : value;
}

async function createApplication(options = {}) {
  const config = options.config || loadConfig(options.env || process.env);
  if (options.dbFile) config.dbFile = path.resolve(options.dbFile);
  if (options.uploadsDir) config.uploadsDir = path.resolve(options.uploadsDir);
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(config.uploadsDir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(config.dataDir, 0o700); fs.chmodSync(config.uploadsDir, 0o700); } catch (error) { if (config.mode === 'production') throw error; }
  const db = options.db || await openDatabase(config.dbFile);
  if (config.mode === 'production' && hasDemoAccounts(db)) {
    if (!options.db) db.close();
    throw new Error('Refusing production startup: remove the built-in demo accounts and their sessions before deployment.');
  }
  const stamp = new Date().toISOString();
  for (const [key, value] of Object.entries({ currency: 'KES', commission_percent: '5', service_fee_minor: '0', support_email: 'support@eventtracker.app' })) {
    db.run('INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES(?,?,?)', [key, value, stamp]);
  }
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy(config.trustProxy));
  app.locals.db = db;
  app.locals.config = config;

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:', 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: config.mode === 'production' ? ["'self'", `wss://${new URL(config.publicAppUrl).host}`] : ["'self'", 'ws:', 'wss:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: String(config.frameAncestors || "'none'").split(/\s+/),
        ...(config.mode === 'production' ? { upgradeInsecureRequests: [] } : {})
      }
    },
    crossOriginEmbedderPolicy: false,
    // Framing is governed by the CSP frame-ancestors directive above.
    xFrameOptions: false,
    hsts: config.mode === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false
  }));
  app.use(compression());
  // Feature lockdown: the app only needs the camera (QR door tools / capture flow).
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=self, microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    next();
  });
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
      if (!originAllowed(origin, config)) {
        if (config.mode !== 'test') console.warn('[security] origin rejected', req.method, req.path, origin);
        return res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Expose-Headers', 'x-session-token');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Idempotency-Key,X-MPESA-CALLBACK-TOKEN');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  app.use('/api', limiter(config, 'general'));
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store, max-age=0'); res.setHeader('Pragma', 'no-cache'); next(); });
  app.use(express.json({ limit: config.uploadJsonLimit, verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use((req, res, next) => {
    const cookieOnlyMutation = isUnsafeMethod(req.method) && hasSessionCookie(req.get('cookie')) && !/^Bearer\s+\S+/i.test(req.get('authorization') || '');
    const origin = req.get('origin');
    if (cookieOnlyMutation && (!origin || !originAllowed(origin, config))) {
      if (config.mode !== 'test') console.warn('[security] CSRF rejected', req.method, req.path, origin || 'no-origin');
      return res.status(403).json({ error: 'CSRF_REJECTED' });
    }
    next();
  });
  app.use('/api', require('./lib/auth').authMiddleware(db, config));

  const io = new Server({
    serveClient: false,
    cors: { origin: (origin, callback) => callback(null, originAllowed(origin, config)), credentials: true },
    allowRequest: (req, callback) => callback(null, originAllowed(req.headers.origin, config)),
    maxHttpBufferSize: 64 * 1024,
    transports: ['websocket', 'polling']
  });
  io.use((socket, next) => {
    const req = {
      get: (name) => socket.handshake.headers[String(name).toLowerCase()],
      headers: socket.handshake.headers,
      res: undefined
    };
    const authToken = socket.handshake.auth?.token || tokenFrom(req, config);
    if (!authToken) return next(new Error('unauthorized'));
    try {
      const claims = jwt.verify(authToken, config.jwtSecret, { algorithms: ['HS256'] });
      const session = db.get('SELECT * FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL', [claims.sid, Number(claims.sub)]);
      if (!session || Date.parse(session.expires_at) <= Date.now()) return next(new Error('unauthorized'));
      const user = db.get('SELECT id,username,email,role,name,avatar FROM users WHERE id = ?', [Number(claims.sub)]);
      if (!user) return next(new Error('unauthorized'));
      // Abuse resistance: cap concurrent realtime connections per account.
      let activeConnections = 0;
      for (const existing of io.of('/').sockets.values()) {
        if (existing.connected && existing.data.user?.id === user.id) activeConnections++;
      }
      if (activeConnections >= 6) return next(new Error('too-many-connections'));
      socket.data.user = user;
      socket.data.sessionId = claims.sid;
      next();
    } catch { next(new Error('unauthorized')); }
  });
  const socketMessageTimes = new Map();
  io.on('connection', (socket) => {
    const userId = socket.data.user.id;
    socket.join(`user:${userId}`);
    socket.use((_packet, next) => {
      const session = db.get('SELECT expires_at FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL', [socket.data.sessionId, userId]);
      if (!session || Date.parse(session.expires_at) <= Date.now()) {
        socket.disconnect(true);
        return next(new Error('SESSION_EXPIRED'));
      }
      next();
    });
    socket.on('conversation:join', (conversationId, acknowledge) => {
      const respond = typeof acknowledge === 'function' ? acknowledge : () => {};
      const id = Number(conversationId);
      const member = db.get('SELECT 1 AS ok FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [id, userId]);
      if (!member) return respond({ error: 'NOT_ALLOWED' });
      socket.join(`conversation:${id}`);
      db.run('UPDATE conversation_participants SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?', [new Date().toISOString(), id, userId]);
      respond({ ok: true });
    });
    socket.on('message:send', (payload, acknowledge) => {
      const respond = typeof acknowledge === 'function' ? acknowledge : () => {};
      const data = payload && typeof payload === 'object' ? payload : {};
      const conversationId = Number(data.conversationId);
      const body = typeof data.body === 'string' ? data.body.trim() : '';
      if (!Number.isSafeInteger(conversationId) || !body || body.length > 2000) return respond({ error: 'INVALID_INPUT' });
      const now = Date.now();
      let attempts = socketMessageTimes.get(userId) || [];
      attempts = attempts.filter((time) => time > now - 60_000);
      if (attempts.length >= 30) return respond({ error: 'RATE_LIMITED' });
      attempts.push(now); socketMessageTimes.set(userId, attempts);
      if (socketMessageTimes.size > 5000) {
        for (const [id, times] of socketMessageTimes) if (!times.some((time) => time > now - 60_000)) socketMessageTimes.delete(id);
      }
      const member = db.get('SELECT 1 AS ok FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [conversationId, userId]);
      if (!member) return respond({ error: 'NOT_ALLOWED' });
      const convoStatus = db.get('SELECT status FROM conversations WHERE id = ?', [conversationId]);
      if (!convoStatus || convoStatus.status !== 'active') return respond({ error: 'REQUEST_PENDING' });
      const createdAt = new Date().toISOString();
      const result = db.run('INSERT INTO messages(conversation_id,sender_id,body,created_at) VALUES(?,?,?,?)', [conversationId, userId, body, createdAt]);
      db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [createdAt, conversationId]);
      const message = db.get('SELECT m.*,u.name AS sender_name,u.avatar AS sender_avatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id = ?', [result.lastID]);
      socket.to(`conversation:${conversationId}`).emit('message:new', message);
      const recipients = db.all('SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ?', [conversationId, userId]);
      for (const recipient of recipients) {
        const { notify } = require('./lib/helpers');
        notify(db, io, recipient.user_id, 'message', 'New message', `${socket.data.user.name} sent you a message.`, 'conversation', conversationId);
      }
      respond({ ok: true, message });
    });
  });

  const apiRouter = createApiRouter({ db, config, io });
  app.use('/api', apiRouter);
  app.use('/uploads', express.static(config.uploadsDir, {
    fallthrough: false,
    maxAge: config.mode === 'production' ? '7d' : 0,
    setHeaders: (res, file) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (/\.(mp4|webm|mov)$/i.test(file)) res.setHeader('Content-Disposition', 'inline');
    }
  }));
  const dist = path.resolve(__dirname, '../client/dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: config.mode === 'production' ? '1h' : 0 }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  }
  app.use((req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  app.use((error, req, res, _next) => {
    if (res.headersSent) return;
    if (config.mode !== 'test') console.error('[request-error]', req.method, req.path, error?.message || 'unknown');
    const status = Number(error?.status);
    if (status >= 400 && status < 500) return res.status(status).json({ error: error.code || 'INVALID_REQUEST' });
    if (status === 503 && error.code === 'PAYMENT_PROVIDER_NOT_CONFIGURED') return res.status(503).json({ error: 'PAYMENT_PROVIDER_NOT_CONFIGURED' });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  });

  const server = http.createServer(app);
  server.headersTimeout = 15_000;
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 5_000;
  io.attach(server);
  return {
    app, server, io, db, config,
    async close() {
      await new Promise((resolve) => io.close(() => resolve()));
      db.close();
    }
  };
}
module.exports = { createApplication, originAllowed, hasDemoAccounts };
