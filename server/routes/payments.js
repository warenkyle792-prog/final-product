const crypto = require('node:crypto');
const express = require('express');
const { requireAuth, requireRole } = require('../lib/auth');
const { limiter } = require('../lib/rate-limits');
const { nowIso, isId, isString, safeJson, validCurrency, notify, audit } = require('../lib/helpers');

const PLACEMENTS = ['featured', 'boost', 'sponsored'];
const PROVIDERS = ['mpesa', 'stripe'];

function timingSafeCompare(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function sandboxLike(transaction) {
  return safeJson(transaction.metadata).mode === 'sandbox' || String(transaction.provider_reference || '').startsWith('sandbox-');
}
function sandboxMessage(mode) {
  return mode === 'sandbox'
    ? 'Local sandbox mode: no provider is contacted and there is no charge.'
    : 'Live checkout started. The ticket is issued once the provider confirms payment.';
}

const TICKET_SELECT = `SELECT t.*,e.title AS event_title,e.date AS event_date,e.time AS event_time,e.location AS event_location,e.venue AS event_venue,
  tt.name AS ticket_name,u.name AS organizer_name,e.organizer_id AS organizer_id,att.name AS attendee_name
  FROM tickets t JOIN events e ON e.id=t.event_id LEFT JOIN ticket_types tt ON tt.id=t.ticket_type_id JOIN users u ON u.id=e.organizer_id JOIN users att ON att.id=t.user_id`;

function createPaymentRouter({ db, config, io, payments }) {
  const router = express.Router();
  const verifyLimit = limiter(config, 'verify', 'VERIFY_RATE_LIMITED');

  router.get('/promotions/pricing', (_req, res) => {
    const pricing = {};
    for (const [currency, placements] of Object.entries(payments.promotionPrices)) {
      pricing[currency] = Object.fromEntries(Object.entries(placements).map(([placement, amountMinor]) => [placement, { amount_minor: amountMinor, amount_major: amountMinor / 100 }]));
    }
    res.json({ currencies: Object.keys(payments.promotionPrices), pricing });
  });

  router.post('/payments', requireAuth, async (req, res) => {
    const body = req.body || {};
    const eventId = Number(body.event_id);
    const provider = String(body.provider || '');
    const currency = String(body.currency || '').toUpperCase();
    const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : '';
    if (!isId(eventId) || !PROVIDERS.includes(provider) || !validCurrency(currency) || !isString(idempotencyKey, 8, 120)) {
      return res.status(400).json({ error: 'INVALID_PAYMENT' });
    }
    try {
      const outcome = await payments.createPayment({
        userId: req.auth.user.id,
        eventId,
        ticketTypeId: body.ticket_type_id !== undefined ? Number(body.ticket_type_id) : undefined,
        provider,
        currency,
        idempotencyKey,
        purpose: 'ticket',
        phone: typeof body.phone === 'string' ? body.phone : ''
      });
      const status = outcome.duplicate ? 200 : 201;
      res.status(status).json({
        payment: outcome.transaction,
        duplicate: Boolean(outcome.duplicate),
        mode: outcome.mode,
        message: sandboxMessage(outcome.mode),
        checkout_url: outcome.checkoutUrl || undefined,
        publishable_key: outcome.publishableKey || undefined
      });
    } catch (error) {
      const status = Number(error?.status) >= 400 ? Number(error.status) : 500;
      res.status(status).json({ error: error?.code || 'INTERNAL_ERROR' });
    }
  });

  router.post('/promotions', requireAuth, async (req, res) => {
    const body = req.body || {};
    const eventId = Number(body.event_id);
    const placement = String(body.placement || '');
    const provider = String(body.provider || '');
    const currency = String(body.currency || '').toUpperCase();
    const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : '';
    if (!isId(eventId) || !PLACEMENTS.includes(placement) || !PROVIDERS.includes(provider) || !validCurrency(currency) || !isString(idempotencyKey, 8, 120)) {
      return res.status(400).json({ error: 'INVALID_INPUT' });
    }
    const event = db.get('SELECT id,organizer_id,title FROM events WHERE id=?', [eventId]);
    if (!event) return res.status(404).json({ error: 'NOT_FOUND' });
    if (event.organizer_id !== req.auth.user.id && req.auth.user.role !== 'admin') return res.status(403).json({ error: 'NOT_ALLOWED' });
    try {
      const outcome = await payments.createPayment({ userId: req.auth.user.id, eventId, provider, currency, idempotencyKey, purpose: 'promotion', placement });
      const promotion = outcome.promotionId ? db.get('SELECT * FROM promotions WHERE id=?', [outcome.promotionId]) : null;
      res.status(201).json({
        promotion,
        payment: outcome.transaction,
        duplicate: Boolean(outcome.duplicate),
        mode: outcome.mode,
        message: sandboxMessage(outcome.mode),
        checkout_url: outcome.checkoutUrl || undefined,
        publishable_key: outcome.publishableKey || undefined
      });
    } catch (error) {
      const status = Number(error?.status) >= 400 ? Number(error.status) : 500;
      res.status(status).json({ error: error?.code || 'INTERNAL_ERROR' });
    }
  });

  router.get('/payments', requireAuth, (req, res) => {
    const rows = req.auth.user.role === 'admin'
      ? db.all('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 200')
      : db.all('SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 100', [req.auth.user.id]);
    res.json({ payments: rows });
  });

  router.get('/payments/callback/mpesa', (req, res) => res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }));
  router.post('/payments/callback/mpesa', (req, res) => {
    const expected = config.mpesa.callbackToken;
    const supplied = req.get('x-mpesa-callback-token') || String(req.query.token || '');
    if (!expected || !supplied || !timingSafeCompare(supplied, expected)) return res.status(401).json({ error: 'CALLBACK_UNAUTHORIZED' });
    const transactionId = Number(req.query.ref);
    const transaction = db.get('SELECT * FROM transactions WHERE id=?', [transactionId]);
    if (!transaction || transaction.provider !== 'mpesa') return res.status(404).json({ error: 'NOT_FOUND' });
    const callback = req.body?.Body?.stkCallback;
    if (!callback || typeof callback !== 'object') return res.status(400).json({ error: 'INVALID_CALLBACK' });
    if (callback.CheckoutRequestID && callback.CheckoutRequestID !== transaction.provider_reference) return res.status(400).json({ error: 'CALLBACK_MISMATCH' });
    if (callback.ResultCode !== 0) {
      payments.finalize(transaction.id, 'failed', 'mpesa-callback');
      return res.json({ ok: true, status: 'failed' });
    }
    const items = Array.isArray(callback.CallbackMetadata?.Item) ? callback.CallbackMetadata.Item : [];
    const amountItem = items.find((item) => item?.Name === 'Amount');
    if (amountItem !== undefined && Math.round(Number(amountItem.Value) * 100) !== transaction.amount_minor) {
      return res.status(400).json({ error: 'CALLBACK_AMOUNT_MISMATCH' });
    }
    payments.finalize(transaction.id, 'successful', 'mpesa-callback');
    res.json({ ok: true, status: 'successful' });
  });

  router.post('/payments/callback/stripe', (req, res) => {
    const secret = config.stripe.webhookSecret;
    const header = String(req.get('stripe-signature') || '');
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
    if (!secret || !header) return res.status(401).json({ error: 'CALLBACK_UNAUTHORIZED' });
    const parts = header.split(',').map((piece) => piece.trim());
    const timestamp = parts.find((piece) => piece.startsWith('t='))?.slice(2);
    const signatures = parts.filter((piece) => piece.startsWith('v1=')).map((piece) => piece.slice(3));
    if (!timestamp || !signatures.length || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 600) {
      return res.status(401).json({ error: 'CALLBACK_UNAUTHORIZED' });
    }
    const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
    const verified = signatures.some((signature) => {
      const supplied = Buffer.from(signature, 'hex');
      return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    });
    if (!verified) return res.status(401).json({ error: 'CALLBACK_UNAUTHORIZED' });
    const payload = req.body || {};
    if (payload.type !== 'checkout.session.completed') return res.json({ ok: true, ignored: true });
    const object = payload.data?.object || {};
    const transactionId = Number(object.metadata?.transaction_id) || db.get('SELECT id FROM transactions WHERE provider_reference=?', [String(object.id || '')])?.id;
    const transaction = db.get('SELECT * FROM transactions WHERE id=?', [transactionId]);
    if (!transaction || transaction.provider !== 'stripe') return res.json({ ok: true, ignored: true });
    if (transaction.status !== 'pending' && transaction.status !== 'processing') return res.json({ ok: true });
    const amountMatches = Number(object.amount_total) === Number(transaction.amount_minor);
    const currencyMatches = String(object.currency || '').toUpperCase() === String(transaction.currency).toUpperCase();
    if (object.payment_status !== 'paid' || !amountMatches || !currencyMatches) {
      return res.status(400).json({ error: 'CALLBACK_MISMATCH' });
    }
    payments.finalize(transaction.id, 'successful', 'stripe-webhook');
    res.json({ ok: true, status: 'successful' });
  });

  function paymentGuard(req, res) {
    const id = Number(req.params.id);
    if (!isId(id)) return res.status(400).json({ error: 'INVALID_INPUT' });
    const payment = db.get('SELECT * FROM transactions WHERE id=?', [id]);
    if (!payment) return res.status(404).json({ error: 'NOT_FOUND' });
    if (payment.user_id !== req.auth.user.id && req.auth.user.role !== 'admin') return res.status(403).json({ error: 'NOT_ALLOWED' });
    return payment;
  }
  router.get('/payments/:id', requireAuth, (req, res) => {
    const payment = paymentGuard(req, res);
    if (payment?.id) res.json({ payment });
  });
  router.get('/payments/:id/status', requireAuth, async (req, res) => {
    const payment = paymentGuard(req, res);
    if (!payment?.id) return;
    const synced = await payments.syncStatus(payment.id);
    res.json({ payment: synced, sandbox: sandboxLike(synced) });
  });

  router.get('/promotions', requireAuth, (req, res) => {
    const rows = req.auth.user.role === 'admin'
      ? db.all('SELECT * FROM promotions ORDER BY created_at DESC LIMIT 200')
      : db.all('SELECT * FROM promotions WHERE user_id=? ORDER BY created_at DESC LIMIT 100', [req.auth.user.id]);
    res.json({ promotions: rows });
  });

  router.get('/tickets', requireAuth, (req, res) => {
    const tickets = db.all(`${TICKET_SELECT} WHERE t.user_id=? ORDER BY e.date,e.time,t.created_at DESC`, [req.auth.user.id]);
    res.json({ tickets });
  });

  function ticketGuard(req, res) {
    const id = Number(req.params.id);
    if (!isId(id)) return res.status(400).json({ error: 'INVALID_INPUT' });
    const ticket = db.get(`${TICKET_SELECT} WHERE t.id=?`, [id]);
    if (!ticket) return res.status(404).json({ error: 'NOT_FOUND' });
    if (ticket.user_id !== req.auth.user.id && ticket.organizer_id !== req.auth.user.id && req.auth.user.role !== 'admin') {
      return res.status(403).json({ error: 'NOT_ALLOWED' });
    }
    return ticket;
  }
  router.get('/tickets/:id', requireAuth, (req, res) => {
    const ticket = ticketGuard(req, res);
    if (ticket?.id) res.json({ ticket });
  });
  router.get('/tickets/:id/qr', requireAuth, async (req, res) => {
    const ticket = ticketGuard(req, res);
    if (!ticket?.id) return;
    const qr = await payments.qrData(ticket.id);
    if (!qr) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ qr, payload: ticket.signed_payload });
  });

  router.post('/verify', requireAuth, verifyLimit, (req, res) => {
    if (!['organizer', 'admin'].includes(req.auth.user.role)) return res.status(403).json({ error: 'NOT_ALLOWED' });
    const signedPayload = typeof req.body?.signed_payload === 'string' ? req.body.signed_payload.trim() : '';
    if (!signedPayload) return res.status(400).json({ error: 'INVALID_TICKET_CODE', valid: false });
    const result = payments.verifyTicket(signedPayload);
    if (!result.valid) return res.status(400).json({ valid: false, error: 'INVALID_TICKET_CODE' });
    const ticket = result.ticket;
    if (req.auth.user.role !== 'admin') {
      const event = db.get('SELECT organizer_id FROM events WHERE id=?', [ticket.event_id]);
      if (!event || event.organizer_id !== req.auth.user.id) return res.status(403).json({ error: 'NOT_ALLOWED' });
    }
    let checkedIn = ticket.status === 'checked_in';
    if (req.body?.check_in && ticket.status === 'valid') {
      db.run('UPDATE tickets SET status=?, checked_in_at=? WHERE id=?', ['checked_in', nowIso(), ticket.id]);
      checkedIn = true;
    }
    const fresh = db.get(`${TICKET_SELECT} WHERE t.id=?`, [ticket.id]);
    res.json({ valid: true, ticket: fresh, checked_in: checkedIn });
  });

  router.post('/admin/payments/:id/refund', requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    if (!isId(id)) return res.status(400).json({ error: 'INVALID_INPUT' });
    const payment = db.get('SELECT * FROM transactions WHERE id=?', [id]);
    if (!payment) return res.status(404).json({ error: 'NOT_FOUND' });
    if (payment.status !== 'successful') return res.status(409).json({ error: 'NOT_REFUNDABLE' });
    db.transaction(() => {
      payments.finalize(payment.id, 'refunded', 'admin-refund');
      const ticket = db.get('SELECT * FROM tickets WHERE transaction_id=?', [payment.id]);
      if (ticket && ticket.status !== 'refunded') {
        db.run("UPDATE tickets SET status='refunded' WHERE id=?", [ticket.id]);
        if (ticket.ticket_type_id) db.run('UPDATE ticket_types SET sold = MAX(0, sold - 1) WHERE id=?', [ticket.ticket_type_id]);
      }
      audit(db, req.auth.user.id, 'payment.refund', 'transaction', payment.id, { amount_minor: payment.amount_minor, currency: payment.currency });
    });
    notify(db, io, payment.user_id, 'payment', 'Payment refunded', `Your payment for ${payment.amount_minor / 100} ${payment.currency} was refunded.`, 'transaction', payment.id);
    res.json({ payment: db.get('SELECT * FROM transactions WHERE id=?', [id]) });
  });

  return router;
}
module.exports = { createPaymentRouter };
