const express = require('express');
const db = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const {
  getEventById, listEvents, attendeePreview, getUserById, audit,
  listTicketTypes, getTicketType, userStats,
} = require('../db/helpers');
const notifications = require('../services/notifications');
const promotions = require('../services/promotions');
const tickets = require('../services/tickets');
const money = require('../services/payments/money');

const router = express.Router();

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function viewerFlags(event, userId) {
  if (!userId) return { is_saved: false, is_following: false, my_rsvp: null, has_ticket: false, is_host: false };

  return {
    is_saved: Boolean(db.prepare('SELECT 1 FROM saves WHERE event_id = ? AND user_id = ?').get(event.id, userId)),
    is_following: Boolean(db.prepare('SELECT 1 FROM event_follows WHERE event_id = ? AND user_id = ?').get(event.id, userId)),
    my_rsvp: db.prepare('SELECT status FROM rsvps WHERE event_id = ? AND user_id = ?').get(event.id, userId)?.status || null,
    has_ticket: Boolean(db.prepare("SELECT 1 FROM tickets WHERE event_id = ? AND user_id = ? AND status IN ('valid','used')").get(event.id, userId)),
    is_host: event.host_id === userId,
  };
}

function tierPayload(eventId) {
  return listTicketTypes(eventId, { activeOnly: true }).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    price_cents: t.price_cents,
    currency: t.currency,
    price_formatted: money.format(t.price_cents, t.currency),
    quantity: t.quantity,
    sold: t.sold,
    remaining: t.remaining,
    per_user_limit: t.per_user_limit,
    is_sold_out: t.is_sold_out,
    sales_end_at: t.sales_end_at,
  }));
}

/* ------------------------------------------------------------------ *
 * Discovery
 * ------------------------------------------------------------------ */

/** GET /api/events — discovery with search / filters / sort / pagination */
router.get('/', optionalAuth, (req, res) => {
  const {
    search = '', category = '', when = '', price = '', location = '', sort = 'soon',
    page = '1', limit = '24', from = '', to = '', min_price: minPrice, max_price: maxPrice,
    host = '', promoted = '',
  } = req.query;

  const lim = Math.min(parseInt(limit, 10) || 24, 60);
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (pageNum - 1) * lim;

  const hostRecord = host ? db.prepare('SELECT id FROM users WHERE username = ?').get(String(host).toLowerCase()) : null;

  const { events, total } = listEvents({
    search: String(search).slice(0, 80),
    category: String(category),
    location: String(location).slice(0, 60),
    when: String(when),
    price: String(price),
    minPrice: minPrice !== undefined && minPrice !== '' ? Number(minPrice) : null,
    maxPrice: maxPrice !== undefined && maxPrice !== '' ? Number(maxPrice) : null,
    from: String(from),
    to: String(to),
    sort: String(sort),
    limit: lim,
    offset,
    hostId: hostRecord?.id || null,
    promoted: String(promoted) === 'true',
  });

  res.json({
    events: events.map((e) => ({ ...e, ...viewerFlags(e, req.userId) })),
    total,
    page: pageNum,
    pageSize: lim,
    pages: Math.max(1, Math.ceil(total / lim)),
  });
});

/** GET /api/events/featured — featured + promoted rail. */
router.get('/featured', optionalAuth, (req, res) => {
  const promoted = listEvents({ promoted: true, limit: 6 }).events;
  const featured = listEvents({ featured: true, limit: 8, sort: 'popular' }).events;
  const popular = listEvents({ limit: 8, sort: 'popular' }).events;

  const merged = [];
  for (const list of [promoted, featured, popular]) {
    for (const event of list) {
      if (!merged.find((e) => e.id === event.id)) merged.push(event);
    }
  }

  res.json({
    events: merged.slice(0, 8).map((e) => ({ ...e, ...viewerFlags(e, req.userId) })),
  });
});

/** GET /api/events/locations — cities with upcoming events (filter options). */
router.get('/locations', (_req, res) => {
  const { eventLocations } = require('../db/helpers');
  res.json({ locations: eventLocations() });
});

/** GET /api/events/:id — full detail */
router.get('/:id(\\d+)', optionalAuth, (req, res) => {
  const event = getEventById(req.params.id, { countView: true });
  if (!event) return res.status(404).json({ error: 'Event not found' });

  event.attendees = attendeePreview(event.id, 8);
  Object.assign(event, viewerFlags(event, req.userId));

  event.host = getUserById(event.host_id);
  if (event.host) event.host.stats = userStats(event.host_id);

  event.ticket_types = tierPayload(event.id);
  event.promotion = promotions.activeForEvent(event.id) || null;
  event.check_in_stats = event.host_id === req.userId || req.user?.role === 'admin'
    ? tickets.checkInStats(event.id)
    : undefined;

  res.json({ event });
});

/* ------------------------------------------------------------------ *
 * Create / update / delete
 * ------------------------------------------------------------------ */

/** POST /api/events — create */
router.post('/', requireAuth, (req, res) => {
  const {
    title, tagline = '', description, category_id: categoryId, venue = '', city = '', country = 'Kenya',
    starts_at: startsAt, ends_at: endsAt = '', price = 0, currency = money.DEFAULT_CURRENCY,
    capacity = 0, image_url: imageUrl = '', video_url: videoUrl = '', tags = '',
    contact_email: contactEmail = '', contact_phone: contactPhone = '', ticket_types: ticketTypes = null,
  } = req.body || {};

  if (!title || !description || !categoryId || !startsAt) {
    return res.status(400).json({ error: 'Title, description, category and start date are required' });
  }

  const currencyCode = String(currency).toUpperCase();
  const priceCents = Math.max(0, Math.round(Number(price) * 100)) || 0;
  const tagString = Array.isArray(tags) ? tags.join(',') : String(tags);

  const eventId = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO events (title, tagline, description, category_id, host_id, venue, city, country,
                          starts_at, ends_at, price_cents, currency, capacity, image_url, video_url,
                          tags, contact_email, contact_phone, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')
    `).run(
      String(title).trim().slice(0, 140),
      String(tagline).trim().slice(0, 200),
      String(description).trim(),
      Number(categoryId),
      req.userId,
      String(venue).trim().slice(0, 140),
      String(city).trim().slice(0, 80),
      String(country).trim().slice(0, 80),
      String(startsAt).slice(0, 19).replace('T', ' '),
      endsAt ? String(endsAt).slice(0, 19).replace('T', ' ') : '',
      priceCents,
      money.isSupported(currencyCode) ? currencyCode : money.DEFAULT_CURRENCY,
      Math.max(0, parseInt(capacity, 10) || 0),
      String(imageUrl).trim().slice(0, 500),
      String(videoUrl).trim().slice(0, 500),
      tagString.slice(0, 300),
      String(contactEmail).trim().slice(0, 140),
      String(contactPhone).trim().slice(0, 40)
    );

    const id = info.lastInsertRowid;

    // Ticket tiers: the organiser's list, or a single tier derived from the
    // simple price/capacity fields on the form.
    const tiers = Array.isArray(ticketTypes) && ticketTypes.length
      ? ticketTypes
      : [{
        name: priceCents > 0 ? 'General admission' : 'Free entry',
        price_cents: priceCents,
        quantity: Math.max(0, parseInt(capacity, 10) || 0),
      }];

    tiers.slice(0, 8).forEach((tier, index) => {
      const tierPrice = Math.max(0, Math.round(Number(tier.price_cents ?? tier.price ?? 0)));
      db.prepare(`
        INSERT INTO ticket_types (event_id, name, description, price_cents, currency, quantity, per_user_limit, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        String(tier.name || `Ticket ${index + 1}`).trim().slice(0, 60),
        String(tier.description || '').slice(0, 200),
        tierPrice,
        money.isSupported(currencyCode) ? currencyCode : money.DEFAULT_CURRENCY,
        Math.max(0, parseInt(tier.quantity, 10) || 0),
        Math.max(1, Math.min(parseInt(tier.per_user_limit, 10) || 10, 50)),
        index
      );
    });

    return id;
  });

  const event = getEventById(eventId);

  // Let the organiser's followers know straight away.
  const followers = db.prepare('SELECT follower_id FROM follows WHERE following_id = ? LIMIT 500').all(req.userId);
  if (followers.length) {
    notifications.notifyMany(followers.map((f) => f.follower_id), {
      type: 'event',
      title: `${req.user.name} published a new event`,
      body: event.title,
      link: `/events/${event.id}`,
      actorId: req.userId,
      eventId: event.id,
    });
  }

  audit(req.userId, 'event.created', 'event', event.id, event.title);

  res.status(201).json({ event: { ...event, ...viewerFlags(event, req.userId), ticket_types: tierPayload(event.id) } });
});

/** PUT /api/events/:id — update (host or admin) */
router.put('/:id(\\d+)', requireAuth, (req, res) => {
  const event = getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (event.host_id !== req.userId && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Only the organiser can edit this event' });
  }

  const b = req.body || {};
  const toSql = (v) => (v ? String(v).slice(0, 19).replace('T', ' ') : '');

  db.transaction(() => {
    db.prepare(`
      UPDATE events SET
        title = COALESCE(?, title),
        tagline = COALESCE(?, tagline),
        description = COALESCE(?, description),
        venue = COALESCE(?, venue),
        city = COALESCE(?, city),
        country = COALESCE(?, country),
        category_id = COALESCE(?, category_id),
        starts_at = COALESCE(?, starts_at),
        ends_at = COALESCE(?, ends_at),
        capacity = COALESCE(?, capacity),
        image_url = COALESCE(?, image_url),
        video_url = COALESCE(?, video_url),
        tags = COALESCE(?, tags),
        contact_email = COALESCE(?, contact_email),
        contact_phone = COALESCE(?, contact_phone),
        status = COALESCE(?, status)
      WHERE id = ?
    `).run(
      b.title ?? null,
      b.tagline ?? null,
      b.description ?? null,
      b.venue ?? null,
      b.city ?? null,
      b.country ?? null,
      b.category_id ? Number(b.category_id) : null,
      b.starts_at ? toSql(b.starts_at) : null,
      b.ends_at !== undefined ? toSql(b.ends_at) : null,
      b.capacity !== undefined ? Math.max(0, parseInt(b.capacity, 10) || 0) : null,
      b.image_url ?? null,
      b.video_url ?? null,
      Array.isArray(b.tags) ? b.tags.join(',') : b.tags ?? null,
      b.contact_email ?? null,
      b.contact_phone ?? null,
      ['published', 'draft', 'cancelled'].includes(b.status) ? b.status : null,
      event.id
    );

    // Replace tiers when the organiser supplies a new list (never below what
    // has already been sold).
    if (Array.isArray(b.ticket_types)) {
      const sold = db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE event_id = ? AND status IN (\'valid\',\'used\')').get(event.id).n;
      const newTotal = b.ticket_types.reduce((sum, t) => sum + (parseInt(t.quantity, 10) || 0), 0);
      if (b.ticket_types.length && newTotal < sold) {
        throw Object.assign(new Error(`You have already issued ${sold} tickets — the new capacity cannot be lower`), { status: 400 });
      }
      db.prepare('DELETE FROM ticket_types WHERE event_id = ? AND sold = 0').run(event.id);
      b.ticket_types.slice(0, 8).forEach((tier, index) => {
        db.prepare(`
          INSERT INTO ticket_types (event_id, name, description, price_cents, currency, quantity, per_user_limit, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          event.id,
          String(tier.name || `Ticket ${index + 1}`).trim().slice(0, 60),
          String(tier.description || '').slice(0, 200),
          Math.max(0, Math.round(Number(tier.price_cents ?? tier.price ?? 0))),
          event.currency,
          Math.max(0, parseInt(tier.quantity, 10) || 0),
          Math.max(1, Math.min(parseInt(tier.per_user_limit, 10) || 10, 50)),
          index
        );
      });
    }
  });

  const updated = getEventById(event.id);
  if (b.status === 'cancelled' && event.status !== 'cancelled') {
    const holders = db.prepare("SELECT DISTINCT user_id FROM tickets WHERE event_id = ? AND status IN ('valid','used')").all(event.id);
    notifications.notifyMany(holders.map((h) => h.user_id), {
      type: 'event',
      title: 'Event cancelled',
      body: `${updated.title} has been cancelled.`,
      link: `/events/${updated.id}`,
      eventId: updated.id,
    });
  }

  res.json({ event: { ...updated, ...viewerFlags(updated, req.userId), ticket_types: tierPayload(updated.id) } });
});

/** DELETE /api/events/:id */
router.delete('/:id(\\d+)', requireAuth, (req, res) => {
  const event = getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (event.host_id !== req.userId && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Only the organiser can delete this event' });
  }

  const sold = db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE event_id = ? AND status IN ('valid','used')").get(event.id).n;
  if (sold > 0) {
    return res.status(400).json({
      error: `This event has ${sold} issued ticket${sold === 1 ? '' : 's'}. Cancel it instead of deleting so attendees keep their records.`,
    });
  }

  db.prepare('DELETE FROM events WHERE id = ?').run(event.id);
  audit(req.userId, 'event.deleted', 'event', event.id, event.title);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 * Follow / save / RSVP
 * ------------------------------------------------------------------ */

/** POST /api/events/:id/follow — follow or unfollow an event. */
router.post('/:id(\\d+)/follow', requireAuth, (req, res) => {
  const event = getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const existing = db.prepare('SELECT 1 FROM event_follows WHERE event_id = ? AND user_id = ?').get(event.id, req.userId);

  if (existing) {
    db.prepare('DELETE FROM event_follows WHERE event_id = ? AND user_id = ?').run(event.id, req.userId);
  } else {
    db.prepare('INSERT INTO event_follows (event_id, user_id) VALUES (?, ?)').run(event.id, req.userId);
    notifications.create({
      userId: event.host_id,
      type: 'follow',
      title: `${req.user.name} is following your event`,
      body: event.title,
      link: `/events/${event.id}`,
      actorId: req.userId,
      eventId: event.id,
    });
  }

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM event_follows WHERE event_id = ?').get(event.id);
  res.json({ ok: true, is_following: !existing, follower_count: n });
});

/** POST /api/events/:id/save — toggle bookmark */
router.post('/:id(\\d+)/save', requireAuth, (req, res) => {
  const event = getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const existing = db.prepare('SELECT 1 FROM saves WHERE event_id = ? AND user_id = ?').get(event.id, req.userId);

  if (existing) {
    db.prepare('DELETE FROM saves WHERE event_id = ? AND user_id = ?').run(event.id, req.userId);
  } else {
    db.prepare('INSERT INTO saves (event_id, user_id) VALUES (?, ?)').run(event.id, req.userId);
  }

  res.json({ ok: true, is_saved: !existing });
});

/** POST /api/events/:id/rsvp { status: going|interested|none } */
router.post('/:id(\\d+)/rsvp', requireAuth, (req, res) => {
  const event = getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const status = String(req.body?.status || 'going');
  if (!['going', 'interested', 'none'].includes(status)) {
    return res.status(400).json({ error: 'Status must be going, interested or none' });
  }

  if (status === 'none') {
    db.prepare('DELETE FROM rsvps WHERE event_id = ? AND user_id = ?').run(event.id, req.userId);
  } else {
    db.prepare(`
      INSERT INTO rsvps (event_id, user_id, status) VALUES (?, ?, ?)
      ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status
    `).run(event.id, req.userId, status);

    if (status === 'going' && event.host_id !== req.userId) {
      notifications.create({
        userId: event.host_id,
        type: 'rsvp',
        title: `${req.user.name} is going to ${event.title}`,
        link: `/events/${event.id}`,
        actorId: req.userId,
        eventId: event.id,
      });
    }
  }

  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'going' THEN 1 ELSE 0 END) AS going,
      SUM(CASE WHEN status = 'interested' THEN 1 ELSE 0 END) AS interested
    FROM rsvps WHERE event_id = ?
  `).get(event.id);

  res.json({ ok: true, status, going_count: counts.going || 0, interested_count: counts.interested || 0 });
});

/** POST /api/events/:id/register — free registration (issues a ticket). */
router.post('/:id(\\d+)/register', requireAuth, async (req, res, next) => {
  try {
    const event = getEventById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.status === 'cancelled') return res.status(400).json({ error: 'This event has been cancelled' });
    if (event.is_past) return res.status(400).json({ error: 'This event has already taken place' });

    const existing = db.prepare("SELECT code FROM tickets WHERE event_id = ? AND user_id = ? AND status IN ('valid','used')")
      .get(event.id, req.userId);
    if (existing) {
      return res.json({ already_registered: true, ticket: await tickets.present(tickets.getByCode(existing.code)) });
    }

    const tiers = listTicketTypes(event.id, { activeOnly: true });
    const freeTier = tiers.find((t) => t.price_cents === 0 && !t.is_sold_out);
    if (tiers.length && !freeTier) {
      return res.status(402).json({ error: 'This event has no free tickets — please buy a ticket to attend' });
    }

    const payments = require('../services/payments');
    const result = payments.completeFreeRegistration({
      userId: req.userId,
      eventId: event.id,
      items: freeTier ? [{ ticket_type_id: freeTier.id, quantity: 1 }] : [],
      attendees: [{ name: req.user.name, email: req.user.email }],
    });

    db.prepare(`
      INSERT INTO rsvps (event_id, user_id, status) VALUES (?, ?, 'going')
      ON CONFLICT(event_id, user_id) DO UPDATE SET status = 'going'
    `).run(event.id, req.userId);

    const issued = db.prepare('SELECT id FROM tickets WHERE transaction_id = ?').all(result.transaction.id);
    const ticket = issued.length ? tickets.getById(issued[0].id) : null;

    res.status(201).json({
      free: true,
      transaction: result.transaction,
      ticket: ticket ? await tickets.present(ticket) : null,
    });
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ *
 * Ticket tiers (organiser)
 * ------------------------------------------------------------------ */

/** PUT /api/events/:id/tickets — manage tiers after publishing. */
router.put('/:id(\\d+)/tickets', requireAuth, (req, res, next) => {
  try {
    const event = getEventById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.host_id !== req.userId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only the organiser can manage tickets' });
    }

    const tiers = Array.isArray(req.body?.ticket_types) ? req.body.ticket_types : [];
    if (!tiers.length) return res.status(400).json({ error: 'Provide at least one ticket type' });

    db.transaction(() => {
      for (const tier of tiers) {
        const existing = tier.id ? getTicketType(tier.id) : null;
        if (existing && existing.event_id === event.id) {
          db.prepare(`
            UPDATE ticket_types
            SET name = ?, description = ?, price_cents = ?, quantity = ?, per_user_limit = ?, is_active = ?
            WHERE id = ?
          `).run(
            String(tier.name || existing.name).slice(0, 60),
            String(tier.description ?? existing.description).slice(0, 200),
            Math.max(0, Math.round(Number(tier.price_cents ?? existing.price_cents))),
            Math.max(existing.sold, parseInt(tier.quantity, 10) || 0),
            Math.max(1, Math.min(parseInt(tier.per_user_limit, 10) || existing.per_user_limit, 50)),
            tier.is_active === false ? 0 : 1,
            existing.id
          );
        } else {
          db.prepare(`
            INSERT INTO ticket_types (event_id, name, description, price_cents, currency, quantity, per_user_limit, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            event.id,
            String(tier.name || 'New ticket').slice(0, 60),
            String(tier.description || '').slice(0, 200),
            Math.max(0, Math.round(Number(tier.price_cents) || 0)),
            event.currency,
            Math.max(0, parseInt(tier.quantity, 10) || 0),
            Math.max(1, Math.min(parseInt(tier.per_user_limit, 10) || 10, 50)),
            Number(tier.sort_order) || 0
          );
        }
      }
    });

    res.json({ ticket_types: tierPayload(event.id), event: getEventById(event.id) });
  } catch (error) {
    next(error);
  }
});

/** GET /api/events/:id/attendees — organiser guest list summary. */
router.get('/:id(\\d+)/attendees', requireAuth, (req, res) => {
  const event = getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (event.host_id !== req.userId && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Only the organiser can view attendees' });
  }

  res.json({
    attendees: tickets.listForEvent(event.id),
    stats: tickets.checkInStats(event.id),
    tiers: tickets.tiersSoldSummary(event.id),
  });
});

/* ------------------------------------------------------------------ *
 * Comments
 * ------------------------------------------------------------------ */

router.get('/:id(\\d+)/comments', (req, res) => {
  const rows = db.prepare(`
    SELECT cm.*, u.name, u.username, u.avatar_url, u.role
    FROM comments cm JOIN users u ON u.id = cm.user_id
    WHERE cm.event_id = ? ORDER BY cm.created_at DESC LIMIT 100
  `).all(req.params.id);
  res.json({ comments: rows });
});

router.post('/:id(\\d+)/comments', requireAuth, (req, res) => {
  const event = getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Comment cannot be empty' });

  const info = db.prepare('INSERT INTO comments (event_id, user_id, body) VALUES (?, ?, ?)')
    .run(event.id, req.userId, body.slice(0, 1000));

  const comment = db.prepare(`
    SELECT cm.*, u.name, u.username, u.avatar_url, u.role
    FROM comments cm JOIN users u ON u.id = cm.user_id WHERE cm.id = ?
  `).get(info.lastInsertRowid);

  if (event.host_id !== req.userId) {
    notifications.create({
      userId: event.host_id,
      type: 'comment',
      title: `${req.user.name} commented on ${event.title}`,
      body: body.slice(0, 140),
      link: `/events/${event.id}`,
      actorId: req.userId,
      eventId: event.id,
    });
  }

  const io = req.app.get('io');
  if (io) io.to(`event:${event.id}`).emit('event:comment', { eventId: event.id, comment });

  res.status(201).json({ comment });
});

router.delete('/:id(\\d+)/comments/:commentId(\\d+)', requireAuth, (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ? AND event_id = ?')
    .get(req.params.commentId, req.params.id);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  if (comment.user_id !== req.userId && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'You can only delete your own comments' });
  }
  db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 * Related
 * ------------------------------------------------------------------ */

router.get('/:id(\\d+)/related', (req, res) => {
  const event = getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const { events } = listEvents({ category: event.category_slug, limit: 6 });
  const related = events.filter((e) => e.id !== event.id).slice(0, 4);

  if (related.length < 4) {
    const more = listEvents({ limit: 12 }).events.filter(
      (e) => e.id !== event.id && !related.find((r) => r.id === e.id)
    );
    related.push(...more.slice(0, 4 - related.length));
  }

  res.json({ events: related });
});

module.exports = router;
