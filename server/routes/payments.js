/**
 * /api/payments — payment intents, status polling, sandbox simulation,
 * my transactions, and provider webhooks.
 *
 * Card data and provider secrets never pass through these handlers: the
 * client receives a client secret / STK prompt and the outcome always comes
 * back from the provider (or the sandbox simulator) to the server.
 */
const express = require('express');

const db = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { getEventById, listTicketTypes, getSetting } = require('../db/helpers');
const payments = require('../services/payments');
const tickets = require('../services/tickets');
const money = require('../services/payments/money');

const router = express.Router();

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Commission rate — owned by the payment service so pricing and reports agree. */
const serviceFeePercent = payments.serviceFeePercent;

/**
 * Build a validated cart from the client's selection.
 * Prices and totals are always recomputed on the server.
 */
function buildCart({ eventId, items, userId }) {
  const event = getEventById(eventId);
  if (!event) throw Object.assign(new Error('Event not found'), { status: 404 });
  if (event.status === 'cancelled') throw Object.assign(new Error('This event has been cancelled'), { status: 400 });
  if (event.is_past) throw Object.assign(new Error('This event has already taken place'), { status: 400 });

  const requested = (Array.isArray(items) ? items : []).map((i) => ({
    ticket_type_id: Number(i.ticket_type_id || i.id),
    quantity: Math.max(0, Math.min(Number(i.quantity) || 0, 20)),
  })).filter((i) => i.ticket_type_id && i.quantity > 0);

  if (!requested.length) throw Object.assign(new Error('Select at least one ticket'), { status: 400 });

  let fallback = null;
  const tiers = listTicketTypes(event.id, { activeOnly: true });

  const lines = requested.map((item) => {
    let tier = tiers.find((t) => t.id === item.ticket_type_id);

    if (!tier && tiers.length === 1) tier = tiers[0]; // single-tier convenience
    if (!tier && !tiers.length) {
      // Legacy event with no explicit tiers: treat the event price as one tier.
      fallback = fallback || db.prepare(`
        INSERT INTO ticket_types (event_id, name, description, price_cents, currency, quantity, sort_order)
        VALUES (?, 'General admission', '', ?, ?, ?, 0)
      `).run(event.id, event.base_price_cents || 0, event.currency || money.DEFAULT_CURRENCY, event.capacity || 0);
      tier = listTicketTypes(event.id, { activeOnly: true })[0];
    }
    if (!tier) throw Object.assign(new Error('That ticket type is no longer available'), { status: 400 });
    if (!tier.is_active) throw Object.assign(new Error(`${tier.name} is not on sale`), { status: 400 });

    const quantity = Math.min(item.quantity, tier.per_user_limit || 20);
    return { tier, quantity };
  });

  // Merge duplicates and respect per-user limits.
  const merged = new Map();
  for (const line of lines) {
    const current = merged.get(line.tier.id);
    if (current) current.quantity += line.quantity;
    else merged.set(line.tier.id, { ...line });
  }

  for (const line of merged.values()) {
    const limit = line.tier.per_user_limit || 20;
    if (line.quantity > limit) {
      throw Object.assign(new Error(`You can buy up to ${limit} × ${line.tier.name} per order`), { status: 400 });
    }
    if (line.tier.quantity > 0) {
      // How many tickets for this tier the buyer already holds.
      const held = db.prepare(`
        SELECT COUNT(*) AS reserved FROM tickets
        WHERE user_id = ? AND ticket_type_id = ? AND status IN ('valid','used')
      `).get(userId, line.tier.id).reserved;

      if (userId && held + line.quantity > limit) {
        throw Object.assign(new Error(`You already hold ${held} × ${line.tier.name} (limit ${limit})`), { status: 400 });
      }
      if (line.tier.remaining < line.quantity) {
        throw Object.assign(
          new Error(line.tier.remaining > 0
            ? `Only ${line.tier.remaining} × ${line.tier.name} left`
            : `${line.tier.name} is sold out`),
          { status: 409 }
        );
      }
    }
  }

  const currency = event.currency || money.DEFAULT_CURRENCY;
  const linesOut = [...merged.values()].map(({ tier, quantity }) => ({
    ticket_type_id: tier.id,
    name: tier.name,
    unit_price_cents: tier.price_cents,
    quantity,
    line_total_cents: tier.price_cents * quantity,
  }));

  const subtotal = linesOut.reduce((sum, l) => sum + l.line_total_cents, 0);
  const feePercent = serviceFeePercent();
  const fee = Math.round(subtotal * (feePercent / 100));
  const total = subtotal + fee;

  return {
    event,
    currency,
    lines: linesOut,
    subtotal_cents: subtotal,
    service_fee_cents: fee,
    service_fee_percent: feePercent,
    total_cents: total,
    is_free: total === 0,
    used_fallback_tier: Boolean(fallback),
  };
}

/* ------------------------------------------------------------------ *
 * Catalogue + quoting
 * ------------------------------------------------------------------ */

/** GET /api/payments/methods — what can be paid with, and in which mode. */
router.get('/methods', (_req, res) => {
  res.json({
    methods: payments.methodAvailability(),
    provider_modes: payments.providerModes(),
    default_currency: money.DEFAULT_CURRENCY,
    service_fee_percent: serviceFeePercent(),
    sandbox: payments.methodAvailability().some((m) => m.mode === 'simulation'),
  });
});

/** POST /api/payments/quote — server-side price for a selection. */
router.post('/quote', optionalAuth, (req, res, next) => {
  try {
    const { event_id: eventId, items } = req.body || {};
    const cart = buildCart({ eventId, items, userId: req.userId });
    res.json({
      quote: {
        event_id: cart.event.id,
        currency: cart.currency,
        lines: cart.lines,
        subtotal_cents: cart.subtotal_cents,
        service_fee_cents: cart.service_fee_cents,
        service_fee_percent: cart.service_fee_percent,
        total_cents: cart.total_cents,
        is_free: cart.is_free,
        available: cart.event.available,
        formatted: {
          subtotal: money.format(cart.subtotal_cents, cart.currency),
          fee: money.format(cart.service_fee_cents, cart.currency),
          total: money.format(cart.total_cents, cart.currency),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ *
 * Intents
 * ------------------------------------------------------------------ */

/** POST /api/payments/intents — start a ticket purchase. */
router.post('/intents', requireAuth, async (req, res, next) => {
  try {
    const {
      event_id: eventId, items, method, phone = '', email = '',
      attendees = [], idempotency_key: idempotencyKey = '',
    } = req.body || {};

    const cart = buildCart({ eventId, items, userId: req.userId });

    if (cart.is_free) {
      const result = payments.completeFreeRegistration({
        userId: req.userId,
        eventId: cart.event.id,
        items: cart.lines.map((l) => ({ ticket_type_id: l.ticket_type_id, quantity: l.quantity })),
        attendees,
      });
      const issued = db.prepare('SELECT id FROM tickets WHERE transaction_id = ?')
        .all(result.transaction.id).map((row) => tickets.getById(row.id));

      return res.status(201).json({
        free: true,
        transaction: result.transaction,
        tickets: await Promise.all(issued.map((t) => tickets.present(t))),
      });
    }

    const intent = await payments.createIntent({
      userId: req.userId,
      purpose: 'ticket',
      amountCents: cart.total_cents,
      currency: cart.currency,
      method,
      eventId: cart.event.id,
      feeCents: cart.service_fee_cents,
      payerPhone: phone,
      payerEmail: email || req.user?.email,
      metadata: {
        items: cart.lines.map((l) => ({ ticket_type_id: l.ticket_type_id, quantity: l.quantity })),
        attendees,
        notes: `subtotal=${cart.subtotal_cents};fee=${cart.service_fee_cents}`,
      },
      idempotencyKey: idempotencyKey || `tickets-${req.userId}-${cart.event.id}`,
    });

    res.status(201).json({
      transaction: intent.transaction,
      instructions: intent.instructions,
      provider_mode: intent.provider_mode,
      quote: {
        subtotal_cents: cart.subtotal_cents,
        service_fee_cents: cart.service_fee_cents,
        total_cents: cart.total_cents,
        currency: cart.currency,
      },
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/payments — my transaction history. */
router.get('/', requireAuth, (req, res) => {
  res.json({
    transactions: payments.ledgerForUser(req.userId, Number(req.query.limit) || 40),
    currency: money.DEFAULT_CURRENCY,
  });
});

/** GET /api/payments/:reference — poll status (server queries the provider). */
router.get('/:reference', requireAuth, async (req, res, next) => {
  try {
    const transaction = await payments.syncStatus(req.params.reference, { userId: req.userId });

    let issuedTickets = [];
    if (transaction.status === 'successful' && transaction.purpose === 'ticket') {
      issuedTickets = db.prepare('SELECT id FROM tickets WHERE transaction_id = ?')
        .all(transaction.id)
        .map((row) => tickets.getById(row.id))
        .filter(Boolean);
    }

    const event = transaction.event_id ? getEventById(transaction.event_id) : null;

    res.json({
      transaction,
      tickets: issuedTickets,
      event: event ? { id: event.id, title: event.title, image_url: event.image_url, starts_at: event.starts_at } : null,
      sandbox: transaction.metadata?.simulate === true,
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/payments/:reference/simulate — sandbox only. */
router.post('/:reference/simulate', requireAuth, async (req, res, next) => {
  try {
    const transaction = await payments.simulate(req.params.reference, {
      outcome: String(req.body?.outcome || 'successful'),
      userId: req.userId,
    });

    let issuedTickets = [];
    if (transaction.status === 'successful' && transaction.purpose === 'ticket') {
      issuedTickets = db.prepare('SELECT id FROM tickets WHERE transaction_id = ?')
        .all(transaction.id)
        .map((row) => tickets.getById(row.id))
        .filter(Boolean);
    }
    res.json({ transaction, tickets: issuedTickets, sandbox: true });
  } catch (error) {
    next(error);
  }
});

/** POST /api/payments/:reference/cancel — user abandons a pending intent. */
router.post('/:reference/cancel', requireAuth, (req, res, next) => {
  try {
    const txn = payments.findByReference(req.params.reference);
    if (!txn || (txn.user_id !== req.userId && req.user.role !== 'admin')) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    if (!['pending', 'processing'].includes(txn.status)) {
      return res.status(400).json({ error: 'Only pending payments can be cancelled' });
    }
    payments.applyProviderResult(txn, { status: 'cancelled', failure_reason: 'Cancelled by customer' }, { source: 'user' });
    if (txn.promotion_id) {
      db.prepare("UPDATE promotions SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(txn.promotion_id);
    }
    res.json({ transaction: payments.publicTransaction(payments.findByReference(req.params.reference)) });
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ *
 * Webhooks (public — authenticity is enforced inside the providers)
 * ------------------------------------------------------------------ */

/** POST /api/payments/webhooks/mpesa — Daraja STK callback. */
router.post('/webhooks/mpesa', async (req, res) => {
  try {
    const mpesa = payments.providers.find((p) => p.id === 'mpesa');
    if (!mpesa.callbackAllowed(req)) {
      return res.status(403).json({ ResultCode: 1, ResultDesc: 'Rejected' });
    }
    const result = await payments.handleProviderCallback('mpesa', req.body, { source: 'mpesa_callback' });
    // Daraja expects a 200 with an acknowledgement body.
    res.json({ ResultCode: 0, ResultDesc: result.ok ? 'Accepted' : 'Ignored' });
  } catch (error) {
    console.error('[payments] mpesa callback error:', error.message);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

/** POST /api/payments/webhooks/card — Stripe-compatible webhook (signed). */
router.post('/webhooks/card', (req, res) => {
  try {
    const card = payments.providers.find((p) => p.id === 'card');
    const rawBody = req.rawBody || JSON.stringify(req.body || {});

    if (card.isConfigured()) {
      const check = card.verifySignature(rawBody, req.get('stripe-signature'));
      if (!check.ok) {
        return res.status(400).json({ error: `Webhook rejected: ${check.error}` });
      }
    }

    payments.handleProviderCallback('card', req.body, { source: 'card_webhook' })
      .then(() => res.json({ received: true }))
      .catch((error) => {
        console.error('[payments] card webhook error:', error.message);
        res.json({ received: true });
      });
  } catch (error) {
    console.error('[payments] card webhook error:', error.message);
    res.status(200).json({ received: true });
  }
});

module.exports = router;
