/**
 * /api/tickets — issued tickets, QR payloads and organiser check-in.
 */
const express = require('express');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getEventById } = require('../db/helpers');
const tickets = require('../services/tickets');

const router = express.Router();

/** GET /api/tickets — tickets I hold, split by upcoming / past. */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const all = tickets.listForUser(req.userId);
    const now = Date.now();
    const withQr = req.query.include_qr !== 'false';

    const decorated = await Promise.all(all.map((t) => tickets.present(t, { includeQr: withQr })));

    res.json({
      tickets: decorated,
      upcoming: decorated.filter((t) => new Date(`${String(t.event.starts_at).replace(' ', 'T')}Z`).getTime() >= now - 6 * 3600_000),
      past: decorated.filter((t) => new Date(`${String(t.event.starts_at).replace(' ', 'T')}Z`).getTime() < now - 6 * 3600_000),
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/tickets/:code — single ticket with QR. */
router.get('/:code', requireAuth, async (req, res, next) => {
  try {
    const ticket = tickets.getByCode(req.params.code);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const isHolder = ticket.user_id === req.userId;
    const isOrganiser = ticket.event.host_id === req.userId || req.user.role === 'admin';
    if (!isHolder && !isOrganiser) return res.status(404).json({ error: 'Ticket not found' });

    res.json({ ticket: await tickets.present(ticket, { includeQr: isHolder || isOrganiser }) });
  } catch (error) {
    next(error);
  }
});

/** GET /api/tickets/event/:eventId — guest list for organisers. */
router.get('/event/:eventId', requireAuth, (req, res, next) => {
  try {
    const event = getEventById(req.params.eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.host_id !== req.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the organiser can view the guest list' });
    }

    res.json({
      event: { id: event.id, title: event.title, starts_at: event.starts_at, available: event.available },
      tickets: tickets.listForEvent(event.id),
      stats: tickets.checkInStats(event.id),
      tiers: tickets.tiersSoldSummary(event.id),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/tickets/verify — scan/enter a code at the door.
 * Body: { code | payload, check_in: true }
 */
router.post('/verify', requireAuth, (req, res, next) => {
  try {
    const { code, payload, check_in: checkIn = true } = req.body || {};

    let resolved = code;
    if (!resolved && payload) {
      const inspected = tickets.inspectPayload(payload);
      if (inspected.status === 'invalid') {
        return res.json({ status: 'invalid', message: 'This QR code is not a valid EventTracker ticket.' });
      }
      resolved = inspected.code;
    }
    if (!resolved) return res.status(400).json({ error: 'Provide a ticket code or QR payload' });

    const result = tickets.verify(resolved, { verifierId: req.userId, checkIn });
    res.json({
      status: result.status,
      message: result.message,
      ticket: result.ticket
        ? {
          code: result.ticket.code,
          status: result.ticket.status,
          holder: result.ticket.holder,
          ticket_type: result.ticket.ticket_type,
          checked_in_at: result.ticket.checked_in_at,
          event: result.ticket.event,
        }
        : null,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
