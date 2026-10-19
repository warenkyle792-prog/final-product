/**
 * /api/admin — platform management.
 * Every route requires an authenticated user with role = 'admin'.
 */
const express = require('express');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getEventById, getUserById, audit, getSetting, setSetting } = require('../db/helpers');
const payments = require('../services/payments');
const promotions = require('../services/promotions');
const tickets = require('../services/tickets');
const notifications = require('../services/notifications');
const money = require('../services/payments/money');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator access required' });
  }
  next();
}

router.use(requireAuth, requireAdmin);

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

router.get('/overview', (_req, res) => {
  promotions.expireStale();

  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM users WHERE created_at >= datetime('now','-7 days')) AS new_users,
      (SELECT COUNT(*) FROM events) AS events,
      (SELECT COUNT(*) FROM events WHERE starts_at >= datetime('now') AND status = 'published') AS upcoming_events,
      (SELECT COUNT(*) FROM tickets WHERE status IN ('valid','used')) AS tickets,
      (SELECT COUNT(*) FROM tickets WHERE status = 'used') AS checked_in,
      (SELECT COUNT(*) FROM tickets WHERE status = 'refunded') AS tickets_refunded,
      (SELECT COUNT(*) FROM promotions WHERE status = 'active' AND ends_at > datetime('now')) AS active_promotions,
      (SELECT COUNT(*) FROM transactions) AS transactions,
      (SELECT COUNT(*) FROM transactions WHERE status = 'pending') AS pending_transactions
  `).get();

  const revenue = payments.platformRevenue();
  const promotionRevenue = promotions.revenueSummary();
  const commission = payments.platformCommission();

  /**
   * Tickets sold: every ticket that reached a holder, split into paid orders
   * and free registrations so the paid figure is never inflated by free RSVPs.
   */
  const ticketsSold = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COUNT(CASE WHEN t.status = 'used' THEN 1 END) AS checked_in,
      COUNT(CASE WHEN t.status = 'refunded' THEN 1 END) AS refunded,
      COUNT(CASE WHEN x.id IS NOT NULL AND x.method != 'free' THEN 1 END) AS paid,
      COUNT(CASE WHEN x.id IS NULL OR x.method = 'free' THEN 1 END) AS free
    FROM tickets t
    LEFT JOIN transactions x ON x.id = t.transaction_id
  `).get();

  /** Commission and ticket sales per event — what every ticket earned us. */
  const commissionByEvent = db.prepare(`
    SELECT e.id, e.title, e.city, e.starts_at,
           (SELECT COUNT(*) FROM tickets t
             WHERE t.event_id = e.id AND t.status IN ('valid','used')) AS tickets_sold,
           (SELECT COUNT(*) FROM tickets t
             WHERE t.event_id = e.id AND t.status = 'refunded') AS tickets_refunded,
           (SELECT COALESCE(SUM(x.amount_cents), 0) FROM transactions x
             WHERE x.event_id = e.id AND x.status = 'successful' AND x.purpose = 'ticket') AS gross_cents,
           (SELECT COALESCE(SUM(x.fee_cents), 0) FROM transactions x
             WHERE x.event_id = e.id AND x.status = 'successful' AND x.purpose = 'ticket') AS commission_cents,
           (SELECT COALESCE(SUM(x.fee_cents), 0) FROM transactions x
             WHERE x.event_id = e.id AND x.status = 'refunded' AND x.purpose = 'ticket') AS commission_refunded_cents
    FROM events e
    WHERE (SELECT COUNT(*) FROM tickets t WHERE t.event_id = e.id) > 0
    ORDER BY commission_cents DESC, tickets_sold DESC
    LIMIT 12
  `).all().map((row) => ({
    ...row,
    gross_formatted: money.format(row.gross_cents, money.DEFAULT_CURRENCY),
    commission_formatted: money.format(row.commission_cents, money.DEFAULT_CURRENCY),
    commission_refunded_formatted: money.format(row.commission_refunded_cents, money.DEFAULT_CURRENCY),
    net_formatted: money.format(row.gross_cents - row.commission_cents, money.DEFAULT_CURRENCY),
  }));

  const daily = db.prepare(`
    SELECT date(created_at) AS day,
           COALESCE(SUM(CASE WHEN status = 'successful' THEN amount_cents ELSE 0 END), 0) AS amount,
           COUNT(*) AS count
    FROM transactions
    WHERE created_at >= datetime('now','-14 days')
    GROUP BY day ORDER BY day ASC
  `).all();

  const byMethod = db.prepare(`
    SELECT method, COUNT(*) AS count,
           COALESCE(SUM(CASE WHEN status = 'successful' THEN amount_cents ELSE 0 END), 0) AS amount
    FROM transactions GROUP BY method ORDER BY amount DESC
  `).all();

  const topEvents = db.prepare(`
    SELECT e.id, e.title, e.starts_at, e.city,
           (SELECT COUNT(*) FROM tickets t WHERE t.event_id = e.id AND t.status IN ('valid','used')) AS tickets,
           (SELECT COALESCE(SUM(x.amount_cents),0) FROM transactions x
             WHERE x.event_id = e.id AND x.status = 'successful') AS revenue_cents,
           (SELECT COALESCE(SUM(x.fee_cents),0) FROM transactions x
             WHERE x.event_id = e.id AND x.status = 'successful' AND x.purpose = 'ticket') AS commission_cents
    FROM events e ORDER BY tickets DESC, revenue_cents DESC LIMIT 6
  `).all().map((row) => ({
    ...row,
    commission_formatted: money.format(row.commission_cents, money.DEFAULT_CURRENCY),
  }));

  const recent = db.prepare(`
    SELECT x.*, u.name AS user_name, u.username AS user_username, e.title AS event_title
    FROM transactions x
    JOIN users u ON u.id = x.user_id
    LEFT JOIN events e ON e.id = x.event_id
    ORDER BY x.id DESC LIMIT 8
  `).all().map(payments.publicTransaction);

  res.json({
    counts,
    revenue: {
      ...revenue,
      settled_formatted: money.format(revenue.settled, money.DEFAULT_CURRENCY),
      last_30_days_formatted: money.format(revenue.last_30_days, money.DEFAULT_CURRENCY),
      refunded_formatted: money.format(revenue.refunded, money.DEFAULT_CURRENCY),
      pending_formatted: money.format(revenue.pending, money.DEFAULT_CURRENCY),
    },
    tickets_sold: {
      ...ticketsSold,
      paid_formatted: String(ticketsSold.paid),
    },
    commission: {
      ...commission,
      percent: payments.serviceFeePercent(),
      settled_formatted: money.format(commission.settled, money.DEFAULT_CURRENCY),
      last_30_days_formatted: money.format(commission.last_30_days, money.DEFAULT_CURRENCY),
      pending_formatted: money.format(commission.pending, money.DEFAULT_CURRENCY),
      refunded_formatted: money.format(commission.refunded, money.DEFAULT_CURRENCY),
      average_per_transaction_cents: commission.settled_count
        ? Math.round(commission.settled / commission.settled_count)
        : 0,
    },
    commission_by_event: commissionByEvent,
    promotion_revenue: {
      ...promotionRevenue,
      settled_formatted: money.format(promotionRevenue.settled_revenue_cents, money.DEFAULT_CURRENCY),
    },
    providers: payments.providerModes(),
    daily,
    by_method: byMethod,
    top_events: topEvents,
    recent_transactions: recent,
  });
});

/* ------------------------------------------------------------------ *
 * Transactions
 * ------------------------------------------------------------------ */

router.get('/transactions', (req, res) => {
  const result = payments.listTransactions({
    status: String(req.query.status || ''),
    method: String(req.query.method || ''),
    purpose: String(req.query.purpose || ''),
    search: String(req.query.q || ''),
    limit: Number(req.query.limit) || 50,
    offset: Number(req.query.offset) || 0,
  });

  res.json({
    ...result,
    totals_formatted: {
      settled: money.format(result.totals.settled, money.DEFAULT_CURRENCY),
      pending: money.format(result.totals.pending, money.DEFAULT_CURRENCY),
      refunded: money.format(result.totals.refunded, money.DEFAULT_CURRENCY),
      commission: money.format(result.totals.commission, money.DEFAULT_CURRENCY),
      commission_pending: money.format(result.totals.commission_pending, money.DEFAULT_CURRENCY),
      commission_refunded: money.format(result.totals.commission_refunded, money.DEFAULT_CURRENCY),
    },
  });
});

router.get('/transactions/:reference', (req, res) => {
  const txn = payments.findByReference(req.params.reference);
  if (!txn) return res.status(404).json({ error: 'Transaction not found' });

  const user = getUserById(txn.user_id);
  const event = txn.event_id ? getEventById(txn.event_id) : null;
  const issued = db.prepare('SELECT code, status, holder_name, checked_in_at FROM tickets WHERE transaction_id = ?').all(txn.id);

  res.json({
    transaction: payments.publicTransaction(txn),
    user,
    event: event ? { id: event.id, title: event.title, starts_at: event.starts_at } : null,
    tickets: issued,
    provider_payload: txn.provider_payload || '',
  });
});

router.post('/transactions/:reference/refund', (req, res, next) => {
  try {
    const transaction = payments.refund(req.params.reference, {
      adminId: req.userId,
      reason: String(req.body?.reason || ''),
    });
    res.json({ transaction });
  } catch (error) {
    next(error);
  }
});

/** Server-side re-check of a payment with the provider. */
router.post('/transactions/:reference/sync', async (req, res, next) => {
  try {
    const transaction = await payments.syncStatus(req.params.reference, { userId: req.userId, minIntervalMs: 0 });
    res.json({ transaction });
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

router.get('/events', (req, res) => {
  const status = String(req.query.status || '');
  const search = String(req.query.q || '');
  const where = [];
  const params = [];

  if (status) { where.push('e.status = ?'); params.push(status); }
  if (search) { where.push('(e.title LIKE ? OR u.name LIKE ? OR e.city LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  const rows = db.prepare(`
    SELECT e.id, e.title, e.starts_at, e.city, e.venue, e.status, e.is_featured, e.image_url,
           e.currency, e.price_cents, e.created_at,
           u.name AS host_name, u.username AS host_username, u.id AS host_id,
           c.name AS category_name,
           (SELECT COUNT(*) FROM tickets t WHERE t.event_id = e.id AND t.status IN ('valid','used')) AS tickets,
           (SELECT COALESCE(SUM(x.amount_cents),0) FROM transactions x WHERE x.event_id = e.id AND x.status='successful') AS revenue_cents,
           (SELECT p.plan FROM promotions p WHERE p.event_id = e.id AND p.status = 'active' AND p.ends_at > datetime('now') LIMIT 1) AS promotion_plan
    FROM events e
    JOIN users u ON u.id = e.host_id
    JOIN categories c ON c.id = e.category_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY e.starts_at DESC LIMIT 200
  `).all(...params);

  res.json({ events: rows });
});

router.post('/events/:id/feature', (req, res) => {
  const event = getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const featured = req.body?.featured === undefined ? !event.is_featured : Boolean(req.body.featured);
  db.prepare('UPDATE events SET is_featured = ? WHERE id = ?').run(featured ? 1 : 0, event.id);
  audit(req.userId, featured ? 'event.featured' : 'event.unfeatured', 'event', event.id);

  res.json({ event: getEventById(event.id) });
});

router.post('/events/:id/status', (req, res) => {
  const event = getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const status = String(req.body?.status || '');
  if (!['published', 'draft', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Status must be published, draft or cancelled' });
  }

  db.prepare('UPDATE events SET status = ? WHERE id = ?').run(status, event.id);
  audit(req.userId, `event.${status}`, 'event', event.id);

  if (status === 'cancelled') {
    const holders = db.prepare("SELECT DISTINCT user_id FROM tickets WHERE event_id = ? AND status IN ('valid','used')").all(event.id);
    notifications.notifyMany(holders.map((h) => h.user_id), {
      type: 'event',
      title: 'Event cancelled',
      body: `${event.title} has been cancelled by the organiser. If you paid, a refund will follow.`,
      link: `/events/${event.id}`,
      eventId: event.id,
    });
  }

  res.json({ event: getEventById(event.id) });
});

router.delete('/events/:id', (req, res) => {
  const event = getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  db.prepare('DELETE FROM events WHERE id = ?').run(event.id);
  audit(req.userId, 'event.deleted', 'event', event.id, event.title);
  res.json({ ok: true });
});

/** Guest list + check-in stats for any event. */
router.get('/events/:id/tickets', (req, res) => {
  const event = getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json({
    tickets: tickets.listForEvent(event.id),
    stats: tickets.checkInStats(event.id),
    tiers: tickets.tiersSoldSummary(event.id),
  });
});

/* ------------------------------------------------------------------ *
 * Users
 * ------------------------------------------------------------------ */

router.get('/users', (req, res) => {
  const search = String(req.query.q || '');
  const role = String(req.query.role || '');
  const where = [];
  const params = [];

  if (search) { where.push('(u.name LIKE ? OR u.username LIKE ? OR u.email LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (role) { where.push('u.role = ?'); params.push(role); }

  const users = db.prepare(`
    SELECT u.id, u.name, u.username, u.email, u.role, u.location, u.avatar_url, u.created_at,
           (SELECT COUNT(*) FROM events e WHERE e.host_id = u.id) AS events_hosted,
           (SELECT COUNT(*) FROM tickets t WHERE t.user_id = u.id AND t.status IN ('valid','used')) AS tickets,
           (SELECT COALESCE(SUM(x.amount_cents),0) FROM transactions x WHERE x.user_id = u.id AND x.status='successful') AS spend_cents
    FROM users u
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY u.created_at DESC LIMIT 200
  `).all(...params);

  res.json({ users });
});

router.post('/users/:id/role', (req, res) => {
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const role = String(req.body?.role || '');
  if (!['user', 'organizer', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Role must be user, organizer or admin' });
  }
  if (user.id === req.userId && role !== 'admin') {
    return res.status(400).json({ error: 'You cannot remove your own admin access' });
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  audit(req.userId, 'user.role_changed', 'user', user.id, { role });
  notifications.create({
    userId: user.id,
    type: 'system',
    title: 'Account role updated',
    body: `Your EventTracker role is now "${role}".`,
    link: `/u/${user.username}`,
  });

  res.json({ user: getUserById(user.id) });
});

/* ------------------------------------------------------------------ *
 * Promotions
 * ------------------------------------------------------------------ */

router.get('/promotions', (req, res) => {
  promotions.expireStale();
  res.json({
    promotions: promotions.adminList({ status: String(req.query.status || '') }),
    summary: promotions.revenueSummary(),
  });
});

router.post('/promotions/:id/end', (req, res) => {
  const id = Number(req.params.id);
  db.prepare("UPDATE promotions SET status = 'cancelled', ends_at = datetime('now') WHERE id = ?").run(id);
  audit(req.userId, 'promotion.ended', 'promotion', id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 * Platform settings
 * ------------------------------------------------------------------ */

router.get('/settings', (_req, res) => {
  res.json({
    settings: {
      service_fee_percent: getSetting('service_fee_percent', '5'),
      support_email: getSetting('support_email', 'support@eventtracker.app'),
      platform_currency: getSetting('platform_currency', money.DEFAULT_CURRENCY),
      payouts_enabled: getSetting('payouts_enabled', 'false'),
    },
    providers: payments.providerModes(),
  });
});

router.put('/settings', (req, res) => {
  const allowed = ['service_fee_percent', 'support_email', 'platform_currency'];
  const updated = {};

  for (const key of allowed) {
    if (req.body?.[key] !== undefined) {
      setSetting(key, req.body[key]);
      updated[key] = String(req.body[key]);
    }
  }

  audit(req.userId, 'settings.updated', 'settings', '', updated);
  res.json({ settings: updated });
});

router.get('/audit', (_req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.name AS actor_name, u.username AS actor_username
    FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
    ORDER BY a.id DESC LIMIT 100
  `).all();
  res.json({ entries: rows });
});

module.exports = router;
