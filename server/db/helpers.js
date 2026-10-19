/**
 * Shared data-access helpers used by the route modules.
 * Keeps SQL in one place so routes stay thin.
 */
const db = require('./index');

const USER_PUBLIC = `u.id, u.name, u.username, u.email, u.bio, u.location, u.phone, u.avatar_url, u.cover_url, u.role, u.interests, u.created_at`;

function getUserById(id) {
  return db.prepare(`SELECT ${USER_PUBLIC} FROM users u WHERE u.id = ?`).get(id);
}

function getUserByUsername(username) {
  return db.prepare(`SELECT ${USER_PUBLIC} FROM users u WHERE u.username = ?`)
    .get(String(username).toLowerCase());
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
}

function getUserWithPassword(email) {
  return db.prepare('SELECT * FROM users WHERE email = ? OR username = ?')
    .get(String(email).toLowerCase(), String(email).toLowerCase());
}

function isAdmin(userId) {
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
  return row?.role === 'admin';
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

const EVENT_SELECT = `
  SELECT e.*, c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon,
         c.gradient AS category_gradient, c.color AS category_color,
         u.name AS host_name, u.username AS host_username, u.avatar_url AS host_avatar,
         (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS going_count,
         (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'interested') AS interested_count,
         (SELECT COUNT(*) FROM comments cm WHERE cm.event_id = e.id) AS comment_count,
         (SELECT COUNT(*) FROM event_follows f WHERE f.event_id = e.id) AS follower_count,
         (SELECT COUNT(*) FROM tickets t WHERE t.event_id = e.id AND t.status IN ('valid','used')) AS ticket_count,
         (SELECT COALESCE(SUM(tt.quantity), 0) FROM ticket_types tt WHERE tt.event_id = e.id AND tt.is_active = 1) AS tier_quantity,
         (SELECT COALESCE(SUM(tt.sold), 0) FROM ticket_types tt WHERE tt.event_id = e.id AND tt.is_active = 1) AS tier_sold,
         (SELECT MIN(tt.price_cents) FROM ticket_types tt WHERE tt.event_id = e.id AND tt.is_active = 1) AS tier_min_price,
         (SELECT COUNT(*) FROM ticket_types tt WHERE tt.event_id = e.id AND tt.is_active = 1) AS tier_count,
         (SELECT p.plan FROM promotions p
            WHERE p.event_id = e.id AND p.status = 'active' AND p.ends_at > datetime('now')
            ORDER BY CASE p.plan WHEN 'sponsored' THEN 2 WHEN 'featured' THEN 1 ELSE 0 END DESC
            LIMIT 1) AS promotion_plan
  FROM events e
  JOIN categories c ON c.id = e.category_id
  JOIN users u ON u.id = e.host_id
`;

/** Availability + price helpers shared by every event payload. */
function mapEventRow(row) {
  if (!row) return null;

  const tierQuantity = Number(row.tier_quantity || 0);
  const tierSold = Number(row.tier_sold || 0);
  const tierCount = Number(row.tier_count || 0);
  const capacity = Number(row.capacity || 0);
  const issued = Number(row.ticket_count || 0);

  let available = null;
  if (tierCount > 0 && tierQuantity > 0) {
    available = Math.max(0, tierQuantity - tierSold);
  } else if (capacity > 0) {
    available = Math.max(0, capacity - issued);
  }

  const priceFrom = tierCount > 0 && row.tier_min_price != null
    ? Number(row.tier_min_price)
    : Number(row.price_cents || 0);

  return {
    ...row,
    tags: row.tags ? String(row.tags).split(',').map((t) => t.trim()).filter(Boolean) : [],
    is_featured: Boolean(row.is_featured),
    price_cents: priceFrom,
    base_price_cents: Number(row.price_cents || 0),
    currency: row.currency || 'KES',
    is_free: priceFrom === 0,
    has_tiers: tierCount > 0,
    capacity,
    sold: tierCount > 0 ? tierSold : issued,
    available,
    is_sold_out: available !== null && available <= 0,
    is_past: Boolean(row.starts_at) && new Date(String(row.starts_at).replace(' ', 'T')) < new Date(),
    is_promoted: Boolean(row.promotion_plan),
    promotion_plan: row.promotion_plan || '',
    status: row.status || 'published',
  };
}

function getEventById(id, { countView = false } = {}) {
  if (countView) {
    db.prepare('UPDATE events SET views = COALESCE(views, 0) + 1 WHERE id = ?').run(id);
  }
  return mapEventRow(db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).get(id));
}

const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  .toISOString().slice(0, 19).replace('T', ' ');

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Rich event query used by Discover / Events / Categories.
 * Supported: search, category, location, when, price, min/max price,
 * date range, sort, pagination, host, ids, featured, promoted.
 */
function listEvents({
  search = '',
  category = '',
  location = '',
  when = '',
  price = '',
  minPrice = null,
  maxPrice = null,
  from = '',
  to = '',
  sort = 'soon',
  limit = 24,
  offset = 0,
  hostId = null,
  ids = null,
  featured = false,
  promoted = false,
  status = 'published',
  includePast = false,
} = {}) {
  const where = [];
  const params = [];

  if (search) {
    where.push('(e.title LIKE ? OR e.tagline LIKE ? OR e.description LIKE ? OR e.tags LIKE ? OR e.city LIKE ? OR e.venue LIKE ? OR c.name LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q, q, q, q);
  }
  if (category) {
    const slugs = String(category).split(',').map((s) => s.trim()).filter(Boolean);
    where.push(`c.slug IN (${slugs.map(() => '?').join(',')})`);
    params.push(...slugs);
  }
  if (location) {
    where.push('(e.city LIKE ? OR e.venue LIKE ? OR e.country LIKE ?)');
    const l = `%${location}%`;
    params.push(l, l, l);
  }
  if (featured) where.push('e.is_featured = 1');
  if (status) {
    where.push('e.status = ?');
    params.push(status);
  }
  if (promoted) {
    where.push(`EXISTS (SELECT 1 FROM promotions p WHERE p.event_id = e.id
      AND p.status = 'active' AND p.ends_at > datetime('now'))`);
  }
  if (hostId) {
    where.push('e.host_id = ?');
    params.push(hostId);
  }
  if (ids && ids.length) {
    where.push(`e.id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }

  const now = new Date();

  if (from) {
    where.push('e.starts_at >= ?');
    params.push(`${String(from).slice(0, 10)} 00:00:00`);
  }
  if (to) {
    where.push('e.starts_at <= ?');
    params.push(`${String(to).slice(0, 10)} 23:59:59`);
  }

  if (when === 'today') {
    where.push('e.starts_at >= ? AND e.starts_at <= ?');
    params.push(iso(startOfToday()), iso(endOfDay(now)));
  } else if (when === 'tomorrow') {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    where.push('e.starts_at >= ? AND e.starts_at <= ?');
    params.push(iso(startOfTodayOf(t)), iso(endOfDay(t)));
  } else if (when === 'weekend') {
    const day = now.getDay();
    const start = new Date(now);
    if (day === 6) start.setDate(now.getDate());           // Saturday: today
    else if (day === 0) start.setDate(now.getDate() - 1);  // Sunday: back to Saturday
    else start.setDate(now.getDate() + (5 - day));         // Weekday: upcoming Friday
    const end = new Date(start);
    end.setDate(start.getDate() + 1);                      // through Sunday
    where.push('e.starts_at >= ? AND e.starts_at <= ?');
    params.push(iso(startOfTodayOf(start)), iso(endOfDay(end)));
  } else if (when === 'week') {
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    where.push('e.starts_at >= ? AND e.starts_at <= ?');
    params.push(iso(now), iso(end));
  } else if (when === 'month') {
    const end = new Date(now);
    end.setMonth(end.getMonth() + 1);
    where.push('e.starts_at >= ? AND e.starts_at <= ?');
    params.push(iso(now), iso(end));
  } else if (when === 'past') {
    where.push('e.starts_at < ?');
    params.push(iso(now));
  } else if (!from && !to && !includePast) {
    where.push('e.starts_at >= ?');
    params.push(iso(now));
  }

  if (price === 'free') where.push('e.price_cents = 0');
  if (price === 'paid') where.push('e.price_cents > 0');
  if (minPrice != null) {
    where.push('e.price_cents >= ?');
    params.push(Number(minPrice));
  }
  if (maxPrice != null) {
    where.push('e.price_cents <= ?');
    params.push(Number(maxPrice));
  }

  let orderBy = 'e.starts_at ASC';
  if (sort === 'new') orderBy = 'e.created_at DESC';
  if (sort === 'popular') orderBy = 'going_count DESC, e.starts_at ASC';
  if (sort === 'price_asc') orderBy = 'e.price_cents ASC, e.starts_at ASC';
  if (sort === 'price_desc') orderBy = 'e.price_cents DESC, e.starts_at ASC';
  if (sort === 'soon') orderBy = 'e.starts_at ASC';

  // Promoted (paid) placements surface first, then the requested ordering.
  const promotionOrder = 'CASE WHEN promotion_plan IS NULL THEN 1 ELSE 0 END, ';

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`${EVENT_SELECT} ${clause} ORDER BY ${promotionOrder}${orderBy} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM events e
    JOIN categories c ON c.id = e.category_id
    JOIN users u ON u.id = e.host_id ${clause}`).get(...params);

  const events = rows.map(mapEventRow);
  if (events.length) {
    const eventIds = events.map((e) => e.id);
    const attRows = db.prepare(`
      SELECT r.event_id, u.id, u.name, u.username, u.avatar_url
      FROM rsvps r JOIN users u ON u.id = r.user_id
      WHERE r.status = 'going' AND r.event_id IN (${eventIds.map(() => '?').join(',')})
      ORDER BY r.created_at DESC
    `).all(...eventIds);
    const byEvent = new Map();
    for (const row of attRows) {
      if (!byEvent.has(row.event_id)) byEvent.set(row.event_id, []);
      const list = byEvent.get(row.event_id);
      if (list.length < 6) list.push(row);
    }
    for (const e of events) e.attendees = byEvent.get(e.id) || [];
  }

  return { events, total };
}

function startOfTodayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Distinct cities that currently have events — powers the location filter. */
function eventLocations(limit = 40) {
  return db.prepare(`
    SELECT city, country, COUNT(*) AS event_count
    FROM events
    WHERE city != '' AND starts_at >= datetime('now') AND status = 'published'
    GROUP BY city, country
    ORDER BY event_count DESC, city ASC
    LIMIT ?
  `).all(limit);
}

function attendeePreview(eventId, limit = 8) {
  return db.prepare(`
    SELECT u.id, u.name, u.username, u.avatar_url, r.status
    FROM rsvps r JOIN users u ON u.id = r.user_id
    WHERE r.event_id = ? ORDER BY r.created_at DESC LIMIT ?
  `).all(eventId, limit);
}

function categoryCounts() {
  return db.prepare(`
    SELECT c.*, COUNT(e.id) AS event_count
    FROM categories c
    LEFT JOIN events e ON e.category_id = c.id AND e.starts_at >= datetime('now') AND e.status = 'published'
    GROUP BY c.id ORDER BY event_count DESC, c.name ASC
  `).all();
}

function userStats(userId) {
  const events = db.prepare('SELECT COUNT(*) AS n FROM events WHERE host_id = ?').get(userId).n;
  const followers = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE following_id = ?').get(userId).n;
  const following = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?').get(userId).n;
  const attending = db.prepare("SELECT COUNT(*) AS n FROM rsvps WHERE user_id = ? AND status = 'going'").get(userId).n;
  const tickets = db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE user_id = ? AND status IN ('valid','used')").get(userId).n;
  const following_events = db.prepare('SELECT COUNT(*) AS n FROM event_follows WHERE user_id = ?').get(userId).n;
  return { events, followers, following, attending, tickets, following_events };
}

/* ------------------------------------------------------------------ *
 * Ticket tiers
 * ------------------------------------------------------------------ */

function listTicketTypes(eventId, { activeOnly = false } = {}) {
  const rows = db.prepare(`
    SELECT * FROM ticket_types
    WHERE event_id = ? ${activeOnly ? 'AND is_active = 1' : ''}
    ORDER BY sort_order ASC, price_cents ASC, id ASC
  `).all(eventId);

  return rows.map((t) => ({
    ...t,
    currency: t.currency || 'KES',
    is_active: Boolean(t.is_active),
    remaining: Math.max(0, Number(t.quantity || 0) - Number(t.sold || 0)),
    is_sold_out: Number(t.quantity || 0) > 0 && Number(t.sold || 0) >= Number(t.quantity || 0),
  }));
}

function getTicketType(id) {
  const row = db.prepare('SELECT * FROM ticket_types WHERE id = ?').get(id);
  if (!row) return null;
  return {
    ...row,
    remaining: Math.max(0, Number(row.quantity || 0) - Number(row.sold || 0)),
  };
}

/** Ensures every event has at least one purchasable tier. */
function defaultTicketTypeFor(event) {
  return listTicketTypes(event.id, { activeOnly: true })[0] || null;
}

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function audit(actorId, action, targetType = '', targetId = '', meta = '') {
  db.prepare(`
    INSERT INTO audit_log (actor_id, action, target_type, target_id, meta)
    VALUES (?, ?, ?, ?, ?)
  `).run(actorId || null, action, String(targetType), String(targetId), typeof meta === 'string' ? meta : JSON.stringify(meta));
}

module.exports = {
  db,
  USER_PUBLIC,
  getUserById,
  getUserByUsername,
  getUserByEmail,
  getUserWithPassword,
  isAdmin,
  mapEventRow,
  getEventById,
  listEvents,
  eventLocations,
  attendeePreview,
  categoryCounts,
  userStats,
  listTicketTypes,
  getTicketType,
  defaultTicketTypeFor,
  getSetting,
  setSetting,
  audit,
  iso,
};
