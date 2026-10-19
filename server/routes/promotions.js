/**
 * /api/promotions — promotion plans, purchases and campaign reporting.
 */
const express = require('express');

const db = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { getEventById } = require('../db/helpers');
const promotions = require('../services/promotions');
const money = require('../services/payments/money');

const router = express.Router();

/** GET /api/promotions/plans?currency=KES — public price list. */
router.get('/plans', optionalAuth, (req, res) => {
  const currency = String(req.query.currency || money.DEFAULT_CURRENCY).toUpperCase();
  res.json({ plans: promotions.listPlans(currency), currency });
});

/** GET /api/promotions/mine — my campaigns. */
router.get('/mine', requireAuth, (req, res) => {
  res.json({ promotions: promotions.listForOwner(req.userId) });
});

/** GET /api/promotions/event/:eventId — campaigns for one event. */
router.get('/event/:eventId', requireAuth, (req, res) => {
  const event = getEventById(req.params.eventId);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (event.host_id !== req.userId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only the organiser can view these campaigns' });
  }
  res.json({ promotions: promotions.listForEvent(event.id) });
});

/**
 * POST /api/promotions — buy a placement.
 * Body: { event_id, plan, method, phone, email, duration_days? }
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { event_id: eventId, plan, method = 'mpesa', phone = '', email = '', duration_days: durationDays } = req.body || {};

    const event = getEventById(eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const result = await promotions.purchase({
      event,
      user: req.user,
      planId: plan,
      method,
      payerPhone: phone,
      payerEmail: email || req.user.email,
      durationDays,
    });

    res.status(201).json({
      promotion: result.promotion,
      transaction: result.transaction,
      instructions: result.instructions,
      provider_mode: result.provider_mode,
      plan: result.plan,
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/promotions/:id/cancel — cancel a pending campaign. */
router.post('/:id/cancel', requireAuth, (req, res, next) => {
  try {
    const promotion = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id);
    if (!promotion) return res.status(404).json({ error: 'Promotion not found' });
    if (promotion.user_id !== req.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not your promotion' });
    }
    res.json({ promotion: promotions.cancel(promotion.id, promotion.user_id) });
  } catch (error) {
    next(error);
  }
});

/** POST /api/promotions/:id/track — impression / click reporting. */
router.post('/:id/track', optionalAuth, (req, res) => {
  const promotion = db.prepare('SELECT event_id FROM promotions WHERE id = ?').get(req.params.id);
  if (!promotion) return res.status(404).json({ error: 'Promotion not found' });
  if (String(req.body?.type) === 'click') promotions.trackClick(promotion.event_id);
  else promotions.trackImpression(promotion.event_id);
  res.json({ ok: true });
});

module.exports = router;
