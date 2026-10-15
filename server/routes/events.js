const express = require('express');
const { requireAuth, requireRole } = require('../lib/auth');
const { nowIso, slugify, isId, isString, validCurrency, makeSlugUnique, notify, audit, pagination, fromMinor } = require('../lib/helpers');
const { limiter } = require('../lib/rate-limits');

const EVENT_SELECT = `SELECT e.*,u.name AS organizer_name,u.username AS organizer_username,u.avatar AS organizer_avatar,
  c.name AS category_name,c.slug AS category_slug,
  (SELECT p.placement FROM promotions p WHERE p.event_id=e.id AND p.placement='sponsored' AND p.status='active' AND (p.ends_at IS NULL OR p.ends_at > ?) LIMIT 1) AS sponsored_placement,
  (SELECT COUNT(*) FROM rsvps r WHERE r.event_id=e.id AND r.status='going') AS rsvp_count,
  (SELECT COUNT(*) FROM tickets t WHERE t.event_id=e.id AND t.status IN ('valid','checked_in')) AS ticket_count
  FROM events e JOIN users u ON u.id=e.organizer_id JOIN categories c ON c.id=e.category_id`;
function dateValid(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }
const LOCAL_IMAGE_PATH = /^\/(uploads|covers)\/[a-z0-9-]+\.(jpg|jpeg|png|webp|gif)$/i;
const LOCAL_VIDEO_PATH = /^\/uploads\/[a-z0-9-]+\.(mp4|webm|mov)$/i;
function coverImageValid(value) { return typeof value === 'string' && value.length <= 400 && (value === '' || LOCAL_IMAGE_PATH.test(value)); }
function videoUrlValid(value) { return typeof value === 'string' && value.length <= 400 && (value === '' || LOCAL_VIDEO_PATH.test(value)); }
function cleanEventInput(body, partial = false) {
  const result = {};
  if (!partial || body.title !== undefined) result.title = String(body.title || '').trim();
  if (!partial || body.description !== undefined) result.description = String(body.description || '').trim();
  if (!partial || body.category_id !== undefined) result.category_id = Number(body.category_id);
  if (!partial || body.date !== undefined) result.date = String(body.date || '').trim();
  if (!partial || body.time !== undefined) result.time = String(body.time || '').trim();
  if (!partial || body.end_time !== undefined) result.end_time = String(body.end_time || '').trim();
  if (!partial || body.location !== undefined) result.location = String(body.location || '').trim();
  if (!partial || body.venue !== undefined) result.venue = String(body.venue || '').trim();
  if (!partial || body.price !== undefined || body.price_minor !== undefined) {
    result.price_minor = body.price_minor !== undefined ? Number(body.price_minor) : Math.round(Number(body.price || 0) * 100);
  }
  if (!partial || body.currency !== undefined) result.currency = String(body.currency || 'KES').toUpperCase();
  if (!partial || body.capacity !== undefined) result.capacity = Number(body.capacity || 100);
  if (!partial || body.cover_image !== undefined) result.cover_image = String(body.cover_image || '').trim();
  if (!partial || body.video_url !== undefined) result.video_url = String(body.video_url || '').trim();
  if (!partial || body.status !== undefined) result.status = body.status === 'draft' ? 'draft' : 'published';
  return result;
}
function validEvent(data, partial = false) {
  const checks = [
    ['title', isString(data.title, 3, 120)], ['description', isString(data.description, 12, 5000)],
    ['category_id', isId(data.category_id)], ['date', dateValid(data.date)],
    ['time', /^\d{2}:\d{2}$/.test(data.time || '')], ['location', isString(data.location, 2, 100)],
    ['venue', (data.venue || '').length <= 120], ['price', Number.isSafeInteger(data.price_minor) && data.price_minor >= 0 && data.price_minor <= 100000000],
    ['currency', validCurrency(data.currency)], ['capacity', Number.isInteger(data.capacity) && data.capacity > 0 && data.capacity <= 1000000],
    ['cover_image', coverImageValid(data.cover_image)], ['video_url', videoUrlValid(data.video_url)]
  ];
  if (partial) return checks.filter(([key]) => Object.prototype.hasOwnProperty.call(data, key)).every(([, okay]) => okay);
  return checks.every(([, okay]) => okay);
}
function createEventsRouter({ db, config, io }) {
  const router = express.Router();
  const sensitive = limiter(config, 'sensitive', 'SENSITIVE_RATE_LIMITED');

  router.get('/categories', (_req, res) => res.json({ categories: db.all('SELECT id,name,slug,description,cover,color,sort_order FROM categories ORDER BY sort_order,name') }));
  router.get('/categories/:slug', (req, res) => {
    const category = db.get('SELECT * FROM categories WHERE slug = ?', [String(req.params.slug).slice(0, 90)]);
    if (!category) return res.status(404).json({ error: 'NOT_FOUND' });
    const events = db.all(`${EVENT_SELECT} WHERE e.status='published' AND c.id=? ORDER BY e.date,e.time LIMIT 100`, [nowIso(), category.id]);
    res.json({ category, events });
  });
  router.get('/feed', (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const params = [nowIso(), today];
    const upcoming = db.all(`${EVENT_SELECT} WHERE e.status='published' AND e.date >= ? ORDER BY CASE WHEN sponsored_placement='sponsored' THEN 0 ELSE 1 END, e.date,e.time LIMIT 12`, params);
    const featured = db.all(`${EVENT_SELECT} WHERE e.status='published' AND e.date >= ? AND (e.featured=1 OR EXISTS(SELECT 1 FROM promotions p WHERE p.event_id=e.id AND p.status='active' AND p.placement IN ('featured','sponsored') AND (p.ends_at IS NULL OR p.ends_at > ?))) ORDER BY CASE WHEN sponsored_placement='sponsored' THEN 0 ELSE 1 END,e.date,e.time LIMIT 8`, [nowIso(), today, nowIso()]);
    const categories = db.all('SELECT id,name,slug,description,cover,color FROM categories ORDER BY sort_order,name');
    res.json({ featured, upcoming, categories });
  });
  router.get('/events', (req, res) => {
    const { page, limit, offset } = pagination(req.query, 16, 60);
    const where = ["e.status='published'"];
    const params = [];
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    if (q) { where.push('(e.title LIKE ? OR e.description LIKE ? OR e.location LIKE ? OR u.name LIKE ?)'); const term = `%${q}%`; params.push(term, term, term, term); }
    const category = typeof req.query.category === 'string' ? req.query.category.slice(0, 90) : '';
    if (category) { where.push('(c.slug=? OR CAST(c.id AS TEXT)=?)'); params.push(category, category); }
    if (typeof req.query.dateFrom === 'string' && dateValid(req.query.dateFrom)) { where.push('e.date>=?'); params.push(req.query.dateFrom); }
    if (typeof req.query.dateTo === 'string' && dateValid(req.query.dateTo)) { where.push('e.date<=?'); params.push(req.query.dateTo); }
    if (typeof req.query.location === 'string' && req.query.location.trim()) { where.push('(e.location LIKE ? OR e.venue LIKE ?)'); const location = `%${req.query.location.trim().slice(0, 80)}%`; params.push(location, location); }
    if (req.query.price === 'free') where.push('e.price_minor=0');
    if (req.query.price === 'paid') where.push('e.price_minor>0');
    if (req.query.maxPrice && Number.isFinite(Number(req.query.maxPrice)) && Number(req.query.maxPrice) >= 0) { where.push('e.price_minor<=?'); params.push(Math.round(Number(req.query.maxPrice) * 100)); }
    const whereSql = where.join(' AND ');
    const total = db.get(`SELECT COUNT(*) AS n FROM events e JOIN users u ON u.id=e.organizer_id JOIN categories c ON c.id=e.category_id WHERE ${whereSql}`, params).n;
    const sort = req.query.sort === 'newest' ? 'e.created_at DESC' : req.query.sort === 'price' ? 'e.price_minor,e.date' : req.query.sort === 'date' ? 'e.date,e.time' : "CASE WHEN sponsored_placement='sponsored' THEN 0 ELSE 1 END, CASE WHEN EXISTS(SELECT 1 FROM promotions p WHERE p.event_id=e.id AND p.status='active' AND p.placement='boost' AND (p.ends_at IS NULL OR p.ends_at>?)) THEN 0 ELSE 1 END,e.featured DESC,e.date,e.time";
    const countParams = [nowIso(), ...params];
    const events = db.all(`${EVENT_SELECT} WHERE ${whereSql} ORDER BY ${sort} LIMIT ? OFFSET ?`, [...countParams, ...(sort.includes('?') ? [nowIso()] : []), limit, offset]);
    res.json({ events: events.map((event) => ({ ...event, price_major: fromMinor(event.price_minor) })), page, limit, total, pages: Math.ceil(total / limit) });
  });

  router.get('/events/:id/:slug?', (req, res) => {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'INVALID_INPUT' });
    const event = db.get(`${EVENT_SELECT} WHERE e.id=?`, [nowIso(), Number(req.params.id)]);
    if (!event || (event.status !== 'published' && req.auth?.user.id !== event.organizer_id && req.auth?.user.role !== 'admin')) return res.status(404).json({ error: 'NOT_FOUND' });
    const ticketTypes = db.all('SELECT id,event_id,name,description,price_minor,currency,quantity,sold FROM ticket_types WHERE event_id=? ORDER BY price_minor,id', [event.id]);
    const comments = db.all(`SELECT c.id,c.event_id,c.body,c.created_at,u.id AS user_id,u.name AS user_name,u.username,u.avatar FROM comments c JOIN users u ON u.id=c.user_id WHERE c.event_id=? ORDER BY c.created_at DESC LIMIT 40`, [event.id]);
    const viewer = req.auth?.user.id;
    event.viewer_following = viewer ? Boolean(db.get('SELECT 1 FROM event_follows WHERE user_id=? AND event_id=?', [viewer, event.id])) : false;
    event.viewer_saved = viewer ? Boolean(db.get('SELECT 1 FROM saves WHERE user_id=? AND event_id=?', [viewer, event.id])) : false;
    event.viewer_rsvp = viewer ? Boolean(db.get("SELECT 1 FROM rsvps WHERE user_id=? AND event_id=? AND status='going'", [viewer, event.id])) : false;
    res.json({ event, ticketTypes, comments });
  });

  router.post('/events', requireAuth, (req, res, next) => {
    try {
      const input = cleanEventInput(req.body || {});
      if (!validEvent(input) || !db.get('SELECT id FROM categories WHERE id=?', [input.category_id])) return res.status(400).json({ error: 'INVALID_EVENT' });
      if (input.date < new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'EVENT_DATE_IN_PAST' });
      const tiers = Array.isArray(req.body.ticket_tiers) ? req.body.ticket_tiers.slice(0, 8) : [];
      if (req.body.ticket_tiers && (!Array.isArray(req.body.ticket_tiers) || req.body.ticket_tiers.length > 8 || tiers.some((t) => !isString(t.name, 2, 60) || !Number.isFinite(Number(t.price)) || Number(t.price) < 0 || !Number.isInteger(Number(t.quantity)) || Number(t.quantity) < 1))) return res.status(400).json({ error: 'INVALID_TICKET_TIERS' });
      const stamp = nowIso();
      const slug = makeSlugUnique(db, input.title);
      const result = db.run(`INSERT INTO events(organizer_id,category_id,title,slug,description,date,time,end_time,location,venue,price_minor,currency,capacity,cover_image,video_url,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [req.auth.user.id, input.category_id, input.title, slug, input.description, input.date, input.time, input.end_time, input.location, input.venue, input.price_minor, input.currency, input.capacity, input.cover_image, input.video_url, input.status, stamp, stamp]);
      const eventId = result.lastID;
      for (const tier of tiers) db.run('INSERT INTO ticket_types(event_id,name,description,price_minor,currency,quantity) VALUES(?,?,?,?,?,?)', [eventId, String(tier.name).trim(), String(tier.description || '').slice(0, 180), Math.round(Number(tier.price) * 100), input.currency, Number(tier.quantity)]);
      const event = db.get('SELECT * FROM events WHERE id=?', [eventId]);
      audit(db, req.auth.user.id, 'event.create', 'event', eventId, { title: input.title });
      res.status(201).json({ event });
    } catch (error) { next(error); }
  });

  router.patch('/events/:id', requireAuth, (req, res) => {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'INVALID_INPUT' });
    const current = db.get('SELECT * FROM events WHERE id=?', [Number(req.params.id)]);
    if (!current) return res.status(404).json({ error: 'NOT_FOUND' });
    if (current.organizer_id !== req.auth.user.id && req.auth.user.role !== 'admin') return res.status(403).json({ error: 'NOT_ALLOWED' });
    const input = cleanEventInput(req.body || {}, true);
    const merged = { ...current, ...input };
    if (!validEvent(merged) || (input.category_id && !db.get('SELECT id FROM categories WHERE id=?', [input.category_id]))) return res.status(400).json({ error: 'INVALID_EVENT' });
    const stamp = nowIso();
    db.run(`UPDATE events SET category_id=?,title=?,description=?,date=?,time=?,end_time=?,location=?,venue=?,price_minor=?,currency=?,capacity=?,cover_image=?,video_url=?,status=?,updated_at=? WHERE id=?`, [merged.category_id, merged.title, merged.description, merged.date, merged.time, merged.end_time, merged.location, merged.venue, merged.price_minor, merged.currency, merged.capacity, merged.cover_image, merged.video_url, merged.status, stamp, current.id]);
    res.json({ event: db.get('SELECT * FROM events WHERE id=?', [current.id]) });
  });

  router.delete('/events/:id', requireAuth, (req, res) => {
    const event = db.get('SELECT * FROM events WHERE id=?', [Number(req.params.id)]);
    if (!event) return res.status(404).json({ error: 'NOT_FOUND' });
    if (event.organizer_id !== req.auth.user.id && req.auth.user.role !== 'admin') return res.status(403).json({ error: 'NOT_ALLOWED' });
    db.run("UPDATE events SET status='cancelled',updated_at=? WHERE id=?", [nowIso(), event.id]);
    audit(db, req.auth.user.id, 'event.cancel', 'event', event.id);
    res.json({ ok: true });
  });

  router.post('/events/:id/follow', requireAuth, (req, res) => {
    const event = db.get('SELECT id,organizer_id,title FROM events WHERE id=? AND status="published"', [Number(req.params.id)]);
    if (!event) return res.status(404).json({ error: 'NOT_FOUND' });
    const prior = db.get('SELECT 1 AS yes FROM event_follows WHERE user_id=? AND event_id=?', [req.auth.user.id, event.id]);
    if (prior) db.run('DELETE FROM event_follows WHERE user_id=? AND event_id=?', [req.auth.user.id, event.id]);
    else {
      db.run('INSERT INTO event_follows(user_id,event_id,created_at) VALUES(?,?,?)', [req.auth.user.id, event.id, nowIso()]);
      if (event.organizer_id !== req.auth.user.id) notify(db, io, event.organizer_id, 'follow', 'Someone is following your event', `${req.auth.user.name} is following ${event.title}.`, 'event', event.id);
    }
    res.json({ following: !prior });
  });
  router.post('/events/:id/save', requireAuth, (req, res) => {
    const event = db.get('SELECT id FROM events WHERE id=? AND status="published"', [Number(req.params.id)]);
    if (!event) return res.status(404).json({ error: 'NOT_FOUND' });
    const prior = db.get('SELECT 1 AS yes FROM saves WHERE user_id=? AND event_id=?', [req.auth.user.id, event.id]);
    if (prior) db.run('DELETE FROM saves WHERE user_id=? AND event_id=?', [req.auth.user.id, event.id]);
    else db.run('INSERT INTO saves(user_id,event_id,created_at) VALUES(?,?,?)', [req.auth.user.id, event.id, nowIso()]);
    res.json({ saved: !prior });
  });
  router.post('/events/:id/rsvp', requireAuth, (req, res) => {
    const event = db.get('SELECT * FROM events WHERE id=? AND status="published"', [Number(req.params.id)]);
    if (!event) return res.status(404).json({ error: 'NOT_FOUND' });
    if (event.price_minor > 0) return res.status(409).json({ error: 'PAYMENT_REQUIRED' });
    const existing = db.get('SELECT * FROM rsvps WHERE user_id=? AND event_id=?', [req.auth.user.id, event.id]);
    const stamp = nowIso();
    if (existing?.status === 'going') {
      db.run("UPDATE rsvps SET status='cancelled' WHERE user_id=? AND event_id=?", [req.auth.user.id, event.id]);
      return res.json({ registered: false });
    }
    if (existing) db.run("UPDATE rsvps SET status='going',created_at=? WHERE user_id=? AND event_id=?", [stamp, req.auth.user.id, event.id]);
    else db.run("INSERT INTO rsvps(user_id,event_id,status,created_at) VALUES(?,?,'going',?)", [req.auth.user.id, event.id, stamp]);
    if (event.organizer_id !== req.auth.user.id) notify(db, io, event.organizer_id, 'rsvp', 'New registration', `${req.auth.user.name} registered for ${event.title}.`, 'event', event.id);
    res.status(201).json({ registered: true });
  });

  router.get('/comments', (req, res) => {
    const eventId = Number(req.query.event_id);
    if (!isId(eventId)) return res.status(400).json({ error: 'INVALID_INPUT' });
    const comments = db.all('SELECT c.*,u.name AS user_name,u.username,u.avatar FROM comments c JOIN users u ON u.id=c.user_id WHERE c.event_id=? ORDER BY c.created_at DESC LIMIT 60', [eventId]);
    res.json({ comments });
  });
  router.post('/comments', requireAuth, (req, res) => {
    const eventId = Number(req.body?.event_id);
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const event = db.get('SELECT id,organizer_id,title FROM events WHERE id=? AND status="published"', [eventId]);
    if (!isId(eventId) || !event || !isString(body, 2, 1200)) return res.status(400).json({ error: 'INVALID_COMMENT' });
    const result = db.run('INSERT INTO comments(event_id,user_id,body,created_at) VALUES(?,?,?,?)', [eventId, req.auth.user.id, body, nowIso()]);
    const comment = db.get('SELECT c.*,u.name AS user_name,u.username,u.avatar FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?', [result.lastID]);
    if (event.organizer_id !== req.auth.user.id) notify(db, io, event.organizer_id, 'comment', 'New event comment', `${req.auth.user.name} commented on ${event.title}.`, 'event', eventId);
    res.status(201).json({ comment });
  });

  router.get('/admin/categories', requireRole('admin'), (_req, res) => res.json({ categories: db.all('SELECT * FROM categories ORDER BY sort_order,name') }));
  router.post('/admin/categories', requireRole('admin'), sensitive, (req, res) => {
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim().slice(0, 280);
    if (!isString(name, 2, 40) || db.get('SELECT id FROM categories WHERE name=?', [name])) return res.status(400).json({ error: 'INVALID_CATEGORY' });
    const result = db.run('INSERT INTO categories(name,slug,description,color,sort_order) VALUES(?,?,?,?,?)', [name, slugify(name), description, '#222222', Number(req.body.sort_order) || 99]);
    res.status(201).json({ category: db.get('SELECT * FROM categories WHERE id=?', [result.lastID]) });
  });
  router.patch('/admin/categories/:id', requireRole('admin'), sensitive, (req, res) => {
    const id = Number(req.params.id);
    const old = db.get('SELECT * FROM categories WHERE id=?', [id]);
    if (!old) return res.status(404).json({ error: 'NOT_FOUND' });
    const name = req.body?.name === undefined ? old.name : String(req.body.name).trim();
    const description = req.body?.description === undefined ? old.description : String(req.body.description).trim().slice(0, 280);
    if (!isString(name, 2, 40)) return res.status(400).json({ error: 'INVALID_CATEGORY' });
    db.run('UPDATE categories SET name=?,slug=?,description=?,sort_order=? WHERE id=?', [name, slugify(name), description, Number.isInteger(Number(req.body.sort_order)) ? Number(req.body.sort_order) : old.sort_order, id]);
    res.json({ category: db.get('SELECT * FROM categories WHERE id=?', [id]) });
  });
  router.delete('/admin/categories/:id', requireRole('admin'), sensitive, (req, res) => {
    const id = Number(req.params.id);
    if (db.get('SELECT id FROM events WHERE category_id=?', [id])) return res.status(409).json({ error: 'CATEGORY_HAS_EVENTS' });
    db.run('DELETE FROM categories WHERE id=?', [id]);
    res.json({ ok: true });
  });

  return router;
}
module.exports = { createEventsRouter, EVENT_SELECT, cleanEventInput, validEvent };
