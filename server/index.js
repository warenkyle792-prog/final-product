/**
 * EventTracker API server — Express + Socket.IO + sql.js
 *
 * Serves the JSON API, uploads, realtime sockets and (in production) the
 * built React client from client/dist.
 */

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const db = require('./db');
const { initializeDatabase, saveDatabase } = require('./db');
const { applySecurity, limiters } = require('./middleware/security');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Refuse to run in production with the development signing keys. Booting with
 * a guessable secret would let anyone mint a token for any account, so this is
 * a hard stop rather than a warning.
 */
function preflight() {
  const secret = process.env.JWT_SECRET || '';
  const weak = !secret || secret === 'eventtracker-dev-secret-change-me'
    || secret === 'change-me-to-a-long-random-string' || secret.length < 32;

  if (weak && IS_PRODUCTION) {
    console.error('\n  EventTracker will not start: JWT_SECRET is missing or too short.\n'
      + '  Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
      + '  then set it as JWT_SECRET in the environment.\n');
    process.exit(1);
  }

  if (weak) {
    console.warn('  ! Using the development JWT secret. Set JWT_SECRET before deploying.');
  }
  if (!process.env.TICKET_SECRET && IS_PRODUCTION) {
    console.warn('  ! TICKET_SECRET is not set — ticket QR codes will be signed with the JWT secret.');
  }

  // Sessions are rows in SQLite; a runaway table is what usually fills a disk.
  if (IS_PRODUCTION && !process.env.SESSION_DAYS) {
    console.warn('  ! SESSION_DAYS not set — sessions last 30 days by default.');
  }
}

async function startServer() {
  await initializeDatabase();

  const { attachSockets, createRealtimeSink } = require('./sockets');
  const notifications = require('./services/notifications');

  const { corsOptions } = require('./middleware/security');
  const io = new Server(server, {
    cors: { ...corsOptions(), origin: corsOptions().origin },
    maxHttpBufferSize: 1e6,
  });

  app.set('io', io);
  attachSockets(io);
  notifications.registerRealtime(createRealtimeSink(io));

  const clientDist = path.join(__dirname, '..', 'client', 'dist');

  // Helmet, CORS, compression, body limits and the API-wide rate limit.
  applySecurity(app, { clientDist });

  // Keep the raw body for webhook signature verification, then parse JSON.
  app.use(express.json({
    limit: process.env.UPLOAD_JSON_LIMIT || '12mb',
    verify: (req, _res, buf) => {
      if (req.originalUrl.includes('/webhooks/')) req.rawBody = buf.toString('utf8');
    },
  }));

  const { UPLOADS_DIR: uploadsDir } = require('./paths');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  app.use('/uploads', express.static(uploadsDir, {
    maxAge: '7d',
    setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  }));

  /* ---- API routes ------------------------------------------------ */
  app.use('/api/auth', limiters.auth, require('./routes/auth'));
  app.use('/api/users', require('./routes/users'));
  // Password changes and account edits are sensitive; bound them separately.
  app.use('/api/users/me', limiters.sensitive);
  app.use('/api/categories', require('./routes/categories'));
  app.use('/api/events', require('./routes/events'));
  app.use('/api/feed', require('./routes/feed'));
  app.use('/api/conversations', require('./routes/chat'));
  app.use('/api/uploads', limiters.uploads, require('./routes/uploads'));
  app.use('/api/payments', require('./routes/payments'));
  app.use('/api/tickets', limiters.verify, require('./routes/tickets'));
  app.use('/api/promotions', require('./routes/promotions'));
  app.use('/api/notifications', require('./routes/notifications'));
  app.use('/api/admin', require('./routes/admin'));

  app.get('/api/health', (_req, res) => {
    const payments = require('./services/payments');
    let database = 'ok';
    try {
      db.prepare('SELECT 1 AS ok').get();
    } catch {
      database = 'unavailable';
    }

    res.status(database === 'ok' ? 200 : 503).json({
      ok: database === 'ok',
      name: 'EventTracker API',
      version: require('../package.json').version,
      environment: process.env.NODE_ENV || 'development',
      database,
      time: new Date().toISOString(),
      payment_providers: payments.providerModes(),
    });
  });

  /* ---- Static client (production build) -------------------------- */
  if (fs.existsSync(clientDist)) {
    // Vite fingerprints asset filenames, so they can be cached hard; the shell
    // that points at them must never be.
    app.use(express.static(clientDist, {
      maxAge: '1y',
      immutable: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }));

    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) {
        return next();
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  /* ---- Errors ---------------------------------------------------- */
  app.use((err, _req, res, _next) => {
    if (err?.message?.includes('Unexpected end of JSON')) {
      return res.status(400).json({ error: 'Malformed request body' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'That file or payload is too large' });
    }

    const status = err?.status || err?.statusCode || 500;
    if (status >= 500) console.error(err);

    // Client errors keep their message (they are written for users); server
    // errors are described generically so internals never reach the browser.
    res.status(status).json({
      error: status < 500 ? (err?.message || 'Request failed') : 'Something went wrong on our side',
    });
  });

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // Housekeeping: drop sessions and login attempts that can no longer matter.
  const sessions = require('./services/sessions');
  sessions.prune();
  setInterval(() => sessions.prune(), 12 * 60 * 60 * 1000).unref();

  server.listen(PORT, '0.0.0.0', () => {
    const payments = require('./services/payments');
    const modes = payments.providerModes()
      .map((p) => `${p.label}: ${p.mode}`)
      .join(' · ');

    console.log(`\n  EventTracker API  → http://localhost:${PORT}`);
    console.log(`  Payments          → ${modes}`);
    console.log(fs.existsSync(clientDist)
      ? '  Client            → serving build from client/dist\n'
      : `  Client (Vite dev) → ${CLIENT_URL}\n`);
  });
}

/**
 * Shut down cleanly: stop accepting connections, then flush the database so a
 * redeploy never loses the last write.
 */
function shutdown(signal) {
  console.log(`\n  ${signal} received — shutting down`);
  server.close(() => {
    try {
      saveDatabase();
    } catch (error) {
      console.error('Could not flush the database:', error.message);
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

preflight();

startServer().catch((error) => {
  console.error('\nEventTracker failed to start:\n', error);
  process.exit(1);
});

module.exports = { app, server };
