const express = require('express');
const { limiter } = require('../lib/rate-limits');
const { requireAuth } = require('../lib/auth');
const { uploadMiddleware } = require('../lib/uploads');
const { nowIso } = require('../lib/helpers');
const { createAuthRouter } = require('./auth');
const { createEventsRouter } = require('./events');
const { createProfilesRouter } = require('./profiles');
const { createChatRouter } = require('./chat');
const { createPaymentRouter } = require('./payments');
const { createAdminRouter } = require('./admin');
const { paymentService } = require('../services/payments');

function createApiRouter({ db, config, io }) {
  const router = express.Router();
  const payments = paymentService({ db, config, io });
  const uploadLimit = limiter(config, 'uploads', 'UPLOAD_RATE_LIMITED');
  router.get('/health', (_req, res) => res.json({ status: 'ok', database: 'ready', uptime_seconds: Math.floor(process.uptime()) }));
  router.get('/', (_req, res) => res.json({ name: 'EventTracker API', version: '1.0.0', docs: '/api/health' }));
  router.get('/settings/public', (_req, res) => {
    const values = Object.fromEntries(db.all('SELECT key,value FROM settings WHERE key IN (?,?,?)', ['currency','service_fee_minor','support_email']).map((row) => [row.key,row.value]));
    const providers = { mpesa: payments.isMpesaConfigured(), stripe: payments.isStripeConfigured() };
    const configured = providers.mpesa || providers.stripe;
    const paymentMode = configured ? 'live' : config.mode === 'production' ? 'unavailable' : 'sandbox';
    const sandboxNotice = paymentMode === 'sandbox'
      ? 'Local sandbox mode: no provider is contacted and nothing is charged.'
      : paymentMode === 'unavailable'
        ? 'No live payment provider is configured. Paid checkout is disabled in production.'
        : 'Live provider checkout is configured. Payment confirmation is verified by the server.';
    res.json({ settings: values, providers, payment_mode: paymentMode, sandbox_notice: sandboxNotice });
  });
  router.use('/auth', createAuthRouter({ db, config }));
  router.use(createEventsRouter({ db, config, io }));
  router.use(createProfilesRouter({ db, io }));
  router.use(createChatRouter({ db, io }));
  router.use(createPaymentRouter({ db, config, io, payments }));
  router.use(createAdminRouter({ db, config }));
  const upload = uploadMiddleware(config);
  router.post('/uploads', requireAuth, uploadLimit, upload.save);
  return router;
}
module.exports = { createApiRouter };
