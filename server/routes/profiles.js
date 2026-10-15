const express = require('express');
const { requireAuth } = require('../lib/auth');
const { nowIso, isId, isString, publicUser, notify, pagination } = require('../lib/helpers');
const { EVENT_SELECT } = require('./events');
function localMedia(value) { return typeof value === 'string' && (value === '' || /^\/uploads\/[a-z0-9-]+\.(jpg|jpeg|png|webp|gif)$/i.test(value)); }
function createProfilesRouter({ db, io }) {
  const router = express.Router();
  router.get('/users/search', requireAuth, (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 1 || q.length > 40) return res.status(400).json({ error: 'INVALID_INPUT' });
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const users = db.all(`SELECT id,username,name,avatar,role FROM users
      WHERE (name LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\') AND id != ?
      ORDER BY name LIMIT 8`, [like, like, req.auth.user.id]);
    res.json({ users });
  });
  router.get('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!isId(id)) return res.status(400).json({ error: 'INVALID_INPUT' });
    const user = db.get('SELECT id,username,role,name,bio,avatar,created_at,verified_at FROM users WHERE id=?', [id]);
    if (!user) return res.status(404).json({ error: 'NOT_FOUND' });
    const stats = db.get(`SELECT
      (SELECT COUNT(*) FROM follows WHERE followed_id=?) AS followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id=?) AS following,
      (SELECT COUNT(*) FROM events WHERE organizer_id=? AND status='published') AS events`, [id,id,id]);
    user.viewer_following = req.auth?.user.id ? Boolean(db.get('SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?', [req.auth.user.id,id])) : false;
    const events = db.all(`${EVENT_SELECT} WHERE e.organizer_id=? AND e.status='published' ORDER BY e.date,e.time LIMIT 20`, [nowIso(),id]);
    res.json({ user, stats, events });
  });
  router.get('/users/:id/followers', (req, res) => {
    const id = Number(req.params.id);
    if (!isId(id)) return res.status(400).json({ error: 'INVALID_INPUT' });
    const rows = db.all('SELECT u.* FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.followed_id=? ORDER BY f.created_at DESC LIMIT 24', [id]);
    res.json({ users: rows.map(publicUser) });
  });
  router.get('/users/:id/following', (req, res) => {
    const id = Number(req.params.id);
    if (!isId(id)) return res.status(400).json({ error: 'INVALID_INPUT' });
    const rows = db.all('SELECT u.* FROM follows f JOIN users u ON u.id=f.followed_id WHERE f.follower_id=? ORDER BY f.created_at DESC LIMIT 24', [id]);
    res.json({ users: rows.map(publicUser) });
  });
  router.post('/users/:id/follow', requireAuth, (req, res) => {
    const targetId = Number(req.params.id);
    if (!isId(targetId) || targetId === req.auth.user.id) return res.status(400).json({ error: 'INVALID_INPUT' });
    const target = db.get('SELECT id,name FROM users WHERE id=?', [targetId]);
    if (!target) return res.status(404).json({ error: 'NOT_FOUND' });
    const prior = db.get('SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?', [req.auth.user.id,targetId]);
    if (prior) db.run('DELETE FROM follows WHERE follower_id=? AND followed_id=?', [req.auth.user.id,targetId]);
    else {
      db.run('INSERT INTO follows(follower_id,followed_id,created_at) VALUES(?,?,?)', [req.auth.user.id,targetId,nowIso()]);
      notify(db, io, targetId, 'follow', 'New follower', `${req.auth.user.name} started following you.`, 'user', req.auth.user.id);
    }
    res.json({ following: !prior });
  });
  router.put('/me/profile', requireAuth, (req, res) => {
    const name = req.body?.name === undefined ? req.auth.user.name : String(req.body.name).trim();
    const bio = req.body?.bio === undefined ? req.auth.user.bio : String(req.body.bio).trim();
    const avatar = req.body?.avatar === undefined ? req.auth.user.avatar : String(req.body.avatar).trim();
    if (!isString(name, 2, 80) || typeof bio !== 'string' || bio.length > 500 || !localMedia(avatar)) return res.status(400).json({ error: 'INVALID_PROFILE' });
    db.run('UPDATE users SET name=?,bio=?,avatar=?,updated_at=? WHERE id=?', [name,bio,avatar,nowIso(),req.auth.user.id]);
    res.json({ user: publicUser(db.get('SELECT id,username,email,role,name,bio,avatar,created_at,verified_at FROM users WHERE id=?', [req.auth.user.id])) });
  });
  router.get('/me/events', requireAuth, (req, res) => {
    const events = db.all(`${EVENT_SELECT} WHERE e.organizer_id=? ORDER BY e.date DESC,e.time DESC LIMIT 60`, [nowIso(),req.auth.user.id]);
    res.json({ events });
  });
  router.get('/me/saved', requireAuth, (req, res) => {
    const events = db.all(`${EVENT_SELECT} JOIN saves s ON s.event_id=e.id WHERE s.user_id=? ORDER BY s.created_at DESC`, [nowIso(),req.auth.user.id]);
    res.json({ events });
  });
  router.get('/me/notifications', requireAuth, (req, res) => {
    const { limit } = pagination(req.query, 40, 100);
    const notifications = db.all('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT ?', [req.auth.user.id,limit]);
    const unread = db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL', [req.auth.user.id]).n;
    res.json({ notifications, unread });
  });
  router.patch('/me/notifications/read', requireAuth, (req, res) => {
    const id = req.body?.id;
    if (id !== undefined && !isId(id)) return res.status(400).json({ error: 'INVALID_INPUT' });
    if (id) db.run('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?', [nowIso(),Number(id),req.auth.user.id]);
    else db.run('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL', [nowIso(),req.auth.user.id]);
    res.json({ ok: true, unread: db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL', [req.auth.user.id]).n });
  });
  return router;
}
module.exports = { createProfilesRouter, localMedia };
