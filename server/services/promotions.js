/**
 * Event promotion service.
 *
 * Three placements, each priced per currency and sold as a paid add-on:
 *
 *   featured   — included in the "Featured" rails on Home / Discover
 *   boost      — higher ranking in listings and category pages
 *   sponsored  — top placement + a "Sponsored" label, longest window
 *
 * A promotion is created as `pending` and only becomes `active` once the
 * linked transaction is confirmed successful by the payment service. Prices
 * are always shown to the organiser before payment.
 */
const db = require('../db');
const money = require('./payments/money');
const notifications = require('./notifications');
const { audit } = require('../db/helpers');

const PLANS = [
  {
    id: 'featured',
    label: 'Featured listing',
    tagline: 'Appear in the Featured rails on Home and Discover.',
    duration_days: 7,
    prices: { KES: 150000, USD: 1900, EUR: 1800, GBP: 1500, NGN: 2900000, ZAR: 35000 },
    perks: [
      'Featured rail on the home page',
      '“Featured” badge on your event card',
      'Included in the weekly discovery email',
    ],
  },
  {
    id: 'boost',
    label: 'Boosted ranking',
    tagline: 'Rank above standard listings in search and category pages.',
    duration_days: 14,
    prices: { KES: 280000, USD: 3500, EUR: 3300, GBP: 2800, NGN: 5400000, ZAR: 65000 },
    perks: [
      'Prioritised in search results',
      'Pinned to the top of its category',
      'Performance report for the organiser',
    ],
  },
  {
    id: 'sponsored',
    label: 'Sponsored placement',
    tagline: 'Top of the feed with a sponsored label and homepage banner.',
    duration_days: 21,
    prices: { KES: 450000, USD: 5900, EUR: 5500, GBP: 4700, NGN: 8700000, ZAR: 105000 },
    perks: [
      'Top placement across Discover',
      'Homepage spotlight slot',
      'Sponsored label with your organiser profile',
      'Priority support while the campaign runs',
    ],
  },
];

const PLAN_IDS = PLANS.map((p) => p.id);

function planPrice(planId, currency = money.DEFAULT_CURRENCY) {
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) return 0;
  if (plan.prices[currency] != null) return plan.prices[currency];
  // Fall back to the platform currency equivalent so a plan is never free.
  return plan.prices[money.DEFAULT_CURRENCY] || 0;
}

/** Public plan catalogue, priced in the requested currency. */
function listPlans(currency = money.DEFAULT_CURRENCY) {
  const code = money.isSupported(currency) ? String(currency).toUpperCase() : money.DEFAULT_CURRENCY;
  return PLANS.map((plan) => ({
    id: plan.id,
    label: plan.label,
    tagline: plan.tagline,
    duration_days: plan.duration_days,
    perks: plan.perks,
    currency: code,
    price_cents: planPrice(plan.id, code),
    price_formatted: money.format(planPrice(plan.id, code), code),
  }));
}

const PROMOTION_SELECT = `
  SELECT p.*, e.title AS event_title, e.image_url AS event_image, e.starts_at AS event_starts_at,
         e.city AS event_city, u.name AS owner_name, u.username AS owner_username,
         x.reference AS transaction_reference, x.status AS transaction_status, x.method AS transaction_method
  FROM promotions p
  JOIN events e ON e.id = p.event_id
  JOIN users u ON u.id = p.user_id
  LEFT JOIN transactions x ON x.id = p.transaction_id
`;

function decorate(row) {
  if (!row) return null;
  return {
    ...row,
    price_formatted: money.format(row.price_cents, row.currency),
    is_active: row.status === 'active' && (!row.ends_at || new Date(`${row.ends_at.replace(' ', 'T')}Z`) > new Date()),
    plan_label: PLANS.find((p) => p.id === row.plan)?.label || row.plan,
  };
}

function getById(id) {
  if (id === undefined || id === null || id === '') return null;
  return decorate(db.prepare(`${PROMOTION_SELECT} WHERE p.id = ?`).get(id));
}

function listForEvent(eventId) {
  return db.prepare(`${PROMOTION_SELECT} WHERE p.event_id = ? ORDER BY p.id DESC`).all(eventId).map(decorate);
}

function listForOwner(userId) {
  return db.prepare(`${PROMOTION_SELECT} WHERE p.user_id = ? ORDER BY p.id DESC`).all(userId).map(decorate);
}

function adminList({ status = '', limit = 80 } = {}) {
  const clause = status ? 'WHERE p.status = ?' : '';
  const params = status ? [status] : [];
  return db.prepare(`${PROMOTION_SELECT} ${clause} ORDER BY p.id DESC LIMIT ?`)
    .all(...params, Math.min(Number(limit) || 80, 200)).map(decorate);
}

/** The currently running campaign for an event, or null. */
function activeForEvent(eventId) {
  if (!eventId) return null;

  const row = db.prepare(`
    SELECT p.id FROM promotions p
    WHERE p.event_id = ? AND p.status = 'active' AND p.ends_at > datetime('now')
    ORDER BY p.id DESC LIMIT 1
  `).get(eventId);

  return row ? getById(row.id) : null;
}

/** Aggregate revenue for the admin dashboard. */
function revenueSummary() {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'active' THEN price_cents ELSE 0 END), 0) AS active_value,
      COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_count,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
      COUNT(*) AS total
    FROM promotions
  `).get();

  const settled = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS total
    FROM transactions WHERE purpose = 'promotion' AND status = 'successful'
  `).get();

  return {
    active_count: Number(row.active_count || 0),
    pending_count: Number(row.pending_count || 0),
    active_value_cents: Number(row.active_value || 0),
    settled_revenue_cents: Number(settled.total || 0),
    total: Number(row.total || 0),
  };
}

/**
 * Create a pending promotion + its payment intent.
 * The promotion stays pending until the payment service confirms success.
 */
async function purchase({ event, user, planId, method, payerPhone = '', payerEmail = '', durationDays = null }) {
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) throw Object.assign(new Error('Choose a promotion plan'), { status: 400 });
  if (event.host_id !== user.id && user.role !== 'admin') {
    throw Object.assign(new Error('Only the event organiser can promote this event'), { status: 403 });
  }
  if (event.status === 'cancelled') {
    throw Object.assign(new Error('Cancelled events cannot be promoted'), { status: 400 });
  }

  const existing = db.prepare(`
    SELECT * FROM promotions
    WHERE event_id = ? AND status = 'active' AND ends_at > datetime('now')
    ORDER BY id DESC LIMIT 1
  `).get(event.id);

  const currency = money.isSupported(event.currency) ? event.currency : money.DEFAULT_CURRENCY;
  const price = planPrice(plan.id, currency);
  const duration = Math.max(1, Math.min(Number(durationDays) || plan.duration_days, 90));

  const promotionId = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO promotions (event_id, user_id, plan, status, price_cents, currency, duration_days)
      VALUES (?, ?, ?, 'pending', ?, ?, ?)
    `).run(event.id, user.id, plan.id, price, currency, duration);

    return info.lastInsertRowid;
  });

  const payments = require('./payments');

  const { transaction, instructions, provider_mode } = await payments.createIntent({
    userId: user.id,
    purpose: 'promotion',
    amountCents: price,
    currency,
    method,
    eventId: event.id,
    promotionId,
    payerPhone,
    payerEmail,
    metadata: { promotion_id: promotionId, plan: plan.id, duration_days: duration },
    idempotencyKey: `promo-${promotionId}`,
  });

  db.prepare('UPDATE promotions SET transaction_id = ? WHERE id = ?').run(transaction.id, promotionId);

  return {
    promotion: getById(promotionId),
    transaction,
    instructions,
    provider_mode,
    replaces_active: Boolean(existing),
    plan: listPlans(currency).find((p) => p.id === plan.id),
  };
}

/**
 * Called by the payment service once a promotion payment is confirmed.
 * Only here does a promotion become active.
 */
function activateForTransaction(transaction) {
  let promotionId = transaction.promotion_id;
  if (!promotionId) {
    try {
      promotionId = JSON.parse(transaction.metadata || '{}').promotion_id;
    } catch (_) {
      promotionId = null;
    }
  }

  const promotion = promotionId ? db.prepare('SELECT * FROM promotions WHERE id = ?').get(promotionId) : null;
  if (!promotion) {
    console.warn(`[promotions] no promotion found for transaction ${transaction.reference}`);
    return null;
  }

  if (promotion.status === 'active') return getById(promotion.id);

  const now = new Date();
  const ends = new Date(now.getTime() + promotion.duration_days * 86400000);
  const toSql = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

  db.prepare(`
    UPDATE promotions
    SET status = 'active', starts_at = ?, ends_at = ?, transaction_id = ?
    WHERE id = ?
  `).run(toSql(now), toSql(ends), transaction.id, promotion.id);

  // Featured / sponsored placements also flag the event for the featured rails.
  if (promotion.plan === 'featured' || promotion.plan === 'sponsored') {
    db.prepare('UPDATE events SET is_featured = 1 WHERE id = ?').run(promotion.event_id);
  }

  const event = db.prepare('SELECT title, host_id FROM events WHERE id = ?').get(promotion.event_id);

  notifications.create({
    userId: promotion.user_id,
    type: 'promotion',
    title: `${PLANS.find((p) => p.id === promotion.plan)?.label || 'Promotion'} is live`,
    body: `${event?.title || 'Your event'} is now promoted until ${ends.toDateString()}.`,
    link: `/events/${promotion.event_id}`,
    eventId: promotion.event_id,
  });

  notifications.notifyAdmins({
    userId: promotion.user_id,
    type: 'promotion',
    title: 'Promotion purchased',
    body: `${event?.title || 'Event'} — ${promotion.plan} placement paid (${money.format(promotion.price_cents, promotion.currency)}).`,
    link: '/admin?tab=promotions',
    eventId: promotion.event_id,
  });

  audit(promotion.user_id, 'promotion.activated', 'promotion', promotion.id, { plan: promotion.plan });

  return getById(promotion.id);
}

function trackImpression(eventId) {
  db.prepare(`
    UPDATE promotions SET impressions = impressions + 1
    WHERE event_id = ? AND status = 'active' AND ends_at > datetime('now')
  `).run(eventId);
}

function trackClick(eventId) {
  db.prepare(`
    UPDATE promotions SET clicks = clicks + 1
    WHERE event_id = ? AND status = 'active' AND ends_at > datetime('now')
  `).run(eventId);
}

/** Expire promotions whose window has closed (called on each admin load). */
function expireStale() {
  const info = db.prepare(`
    UPDATE promotions SET status = 'expired'
    WHERE status = 'active' AND ends_at != '' AND ends_at <= datetime('now')
  `).run();
  return info.changes;
}

function cancel(promotionId, userId) {
  const promotion = db.prepare('SELECT * FROM promotions WHERE id = ?').get(promotionId);
  if (!promotion) throw Object.assign(new Error('Promotion not found'), { status: 404 });
  if (promotion.user_id !== userId) throw Object.assign(new Error('Not your promotion'), { status: 403 });
  if (promotion.status !== 'pending') {
    throw Object.assign(new Error('An active promotion cannot be cancelled — contact support for a refund'), { status: 400 });
  }
  db.prepare("UPDATE promotions SET status = 'cancelled' WHERE id = ?").run(promotion.id);
  return getById(promotion.id);
}

module.exports = {
  PLANS,
  PLAN_IDS,
  listPlans,
  planPrice,
  purchase,
  activateForTransaction,
  getById,
  listForEvent,
  listForOwner,
  adminList,
  activeForEvent,
  revenueSummary,
  trackImpression,
  trackClick,
  expireStale,
  cancel,
};
