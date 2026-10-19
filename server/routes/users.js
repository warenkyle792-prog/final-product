const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const {
  getUserById, getUserByUsername, userStats, mapEventRow, audit,
} = require('../db/helpers');
const notifications = require('../services/notifications');
const sessions = require('../services/sessions');
const security = require('../services/security');
const tickets = require('../services/tickets');
const promotions = require('../services/promotions');
const payments = require('../services/payments');

const router = express.Router();

function profileWithStats(user, viewerId) {
  const stats = userStats(user.id);
  const is_following = viewerId
    ? Boolean(db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(viewerId, user.id))
    : false;
  return {
    ...user,
    stats,
    is_following: is_following && viewerId !== user.id,
    is_me: viewerId === user.id,
  };
}

/** GET /api/users?q= — people directory (used when starting a chat). */
router.get('/', optionalAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  const rows = q
    ? db.prepare(`
        SELECT u.id, u.name, u.username, u.avatar_url, u.bio, u.role
        FROM users u
        WHERE u.name LIKE ? OR u.username LIKE ? OR u.bio LIKE ?
        ORDER BY u.name ASC LIMIT 20
      `).all(like, like, like)
    : db.prepare('SELECT u.id, u.name, u.username, u.avatar_url, u.bio, u.role FROM users u ORDER BY u.created_at DESC LIMIT 20').all();
  res.json({ users: rows });
});

/** GET /api/users/me */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: profileWithStats(req.user, req.userId) });
});

/** PUT /api/users/me — profile editor. */
router.put('/me', requireAuth, (req, res) => {
  const { name, bio, location, phone, avatar_url: avatarUrl, cover_url: coverUrl, password, interests } = req.body || {};
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!me) return res.status(404).json({ error: 'User not found' });

  let hash = me.password_hash;
  let passwordChanged = false;
  if (password) {
    const issue = security.passwordProblem(password, { username: me.username, email: me.email, name: me.name });
    if (issue) return res.status(400).json({ error: issue });
    hash = bcrypt.hashSync(String(password), 12);
    passwordChanged = true;
  }

  const interestString = interests !== undefined
    ? (Array.isArray(interests) ? interests : String(interests).split(','))
      .map((s) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 8).join(',')
    : me.interests;

  db.prepare(`
    UPDATE users
    SET name = ?, bio = ?, location = ?, phone = ?, avatar_url = ?, cover_url = ?, interests = ?, password_hash = ?
    WHERE id = ?
  `).run(
    name !== undefined ? String(name).trim().slice(0, 80) : me.name,
    bio !== undefined ? String(bio).slice(0, 500) : me.bio,
    location !== undefined ? String(location).slice(0, 120) : me.location,
    phone !== undefined ? String(phone).slice(0, 40) : me.phone,
    avatarUrl !== undefined ? String(avatarUrl).slice(0, 500) : me.avatar_url,
    coverUrl !== undefined ? String(coverUrl).slice(0, 500) : me.cover_url,
    interestString,
    hash,
    req.userId
  );

  /**
   * Changing a password ends every other session: a stolen token or an open
   * session on someone else's device must not survive it.
   */
  if (passwordChanged) {
    sessions.revokeAll(req.userId, { exceptId: req.sessionId });
    audit(req.userId, 'account.password_changed', 'user', req.userId, {});
  }

  res.json({ user: profileWithStats(getUserById(req.userId), req.userId) });
});

/** GET /api/users/me/overview — the signed-in user's dashboard figures. */
router.get('/me/overview', requireAuth, (req, res) => {
  const hosted = db.prepare(`
    SELECT e.id, e.title, e.starts_at, e.status, e.image_url, e.currency,
           (SELECT COUNT(*) FROM tickets t WHERE t.event_id = e.id AND t.status IN ('valid','used')) AS tickets_sold,
           (SELECT COALESCE(SUM(x.amount_cents),0) FROM transactions x WHERE x.event_id = e.id AND x.status='successful') AS revenue_cents
    FROM events e WHERE e.host_id = ? ORDER BY e.starts_at DESC
  `).all(req.userId);

  res.json({
    stats: userStats(req.userId),
    tickets: tickets.listForUser(req.userId).slice(0, 50),
    transactions: payments.ledgerForUser(req.userId, 20),
    promotions: promotions.listForOwner(req.userId),
    hosted_events: hosted,
    check_in: {
      sold: hosted.reduce((sum, e) => sum + Number(e.tickets_sold || 0), 0),
      revenue_cents: hosted.reduce((sum, e) => sum + Number(e.revenue_cents || 0), 0),
    },
  });
});

/** GET /api/users/:username */
router.get('/:username', optionalAuth, (req, res) => {
  const user = getUserByUsername(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: profileWithStats(user, req.userId) });
});

/** GET /api/users/:username/events?tab=hosting|attending|saved|following */
router.get('/:username/events', optionalAuth, (req, res) => {
  const user = getUserByUsername(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const tab = req.query.tab || 'hosting';
  const { getEventById } = require('../db/helpers');
  const decorate = (e) => ({
    ...e,
    is_saved: req.userId
      ? Boolean(db.prepare('SELECT 1 FROM saves WHERE event_id = ? AND user_id = ?').get(e.id, req.userId))
      : false,
  });

  if (tab === 'saved') {
    if (req.userId !== user.id) return res.status(403).json({ error: 'Saved events are private' });
    const ids = db.prepare('SELECT event_id FROM saves WHERE user_id = ? ORDER BY rowid DESC')
      .all(user.id).map((r) => r.event_id);
    return res.json({ events: ids.map(getEventById).filter(Boolean).map(decorate) });
  }

  if (tab === 'attending') {
    const ids = db.prepare("SELECT event_id FROM rsvps WHERE user_id = ? AND status = 'going'").all(user.id).map((r) => r.event_id);
    const ticketIds = db.prepare("SELECT DISTINCT event_id FROM tickets WHERE user_id = ? AND status IN ('valid','used')")
      .all(user.id).map((r) => r.event_id);
    const all = [...new Set([...ids, ...ticketIds])];
    return res.json({ events: all.map(getEventById).filter(Boolean).map(decorate) });
  }

  if (tab === 'following') {
    if (req.userId !== user.id) return res.status(403).json({ error: 'Followed events are private' });
    const ids = db.prepare('SELECT event_id FROM event_follows WHERE user_id = ? ORDER BY created_at DESC')
      .all(user.id).map((r) => r.event_id);
    return res.json({ events: ids.map(getEventById).filter(Boolean).map(decorate) });
  }

  const events = db.prepare(`
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
           (SELECT p.plan FROM promotions p WHERE p.event_id = e.id AND p.status = 'active' AND p.ends_at > datetime('now') LIMIT 1) AS promotion_plan
    FROM events e
    JOIN categories c ON c.id = e.category_id
    JOIN users u ON u.id = e.host_id
    WHERE e.host_id = ? ORDER BY e.starts_at DESC LIMIT 100
  `).all(user.id);

  const visible = (req.userId === user.id || req.user?.role === 'admin')
    ? events
    : events.filter((event) => !['draft', 'cancelled'].includes(event.status));

  res.json({
    events: visible.map(mapEventRow).map(decorate),
    user: profileWithStats(user, req.userId),
  });
});

router.get('/:username/followers', (req, res) => {
  const user = getUserByUsername(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const rows = db.prepare(`
    SELECT u.id, u.name, u.username, u.avatar_url, u.bio FROM follows f
    JOIN users u ON u.id = f.follower_id WHERE f.following_id = ? ORDER BY f.created_at DESC LIMIT 100
  `).all(user.id);
  res.json({ users: rows });
});

router.get('/:username/following', (req, res) => {
  const user = getUserByUsername(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const rows = db.prepare(`
    SELECT u.id, u.name, u.username, u.avatar_url, u.bio FROM follows f
    JOIN users u ON u.id = f.following_id WHERE f.follower_id = ? ORDER BY f.created_at DESC LIMIT 100
  `).all(user.id);
  res.json({ users: rows });
});

/** POST /api/users/:username/follow — toggle follow. */
router.post('/:username/follow', requireAuth, (req, res) => {
  const user = getUserByUsername(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.userId) return res.status(400).json({ error: 'You cannot follow yourself' });

  const existing = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.userId, user.id);

  if (existing) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.userId, user.id);
  } else {
    db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').run(req.userId, user.id);
    notifications.create({
      userId: user.id,
      type: 'follow',
      title: `${req.user.name} started following you`,
      link: `/u/${req.user.username}`,
      actorId: req.userId,
    });
  }

  res.json({ ok: true, is_following: !existing, stats: userStats(user.id) });
});

/** PUT /api/users/me/interests — quick category preference chip editor. */
router.put('/me/interests', requireAuth, (req, res) => {
  const interests = (Array.isArray(req.body?.interests) ? req.body.interests : [])
    .map((s) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 8);
  db.prepare('UPDATE users SET interests = ? WHERE id = ?').run(interests.join(','), req.userId);
  res.json({ interests });
});

module.exports = router;
