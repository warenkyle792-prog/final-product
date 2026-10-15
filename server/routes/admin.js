const express = require('express');
const { requireRole } = require('../lib/auth');
const { limiter } = require('../lib/rate-limits');
const { nowIso, isEmail, isId, validCurrency, audit } = require('../lib/helpers');

const editableSettings = new Set(['currency','commission_percent','service_fee_minor','support_email']);
function createAdminRouter({ db, config }) {
  const router = express.Router();
  const sensitive = limiter(config, 'sensitive', 'SENSITIVE_RATE_LIMITED');
  router.use('/admin', requireRole('admin'));

  router.get('/admin/figures', (_req, res) => {
    const aggregate = db.all(`SELECT currency,COUNT(*) AS payments,SUM(amount_minor) AS gross_minor,SUM(commission_minor) AS commission_minor
      FROM transactions WHERE status='successful' GROUP BY currency ORDER BY currency`);
    const perEvent = db.all(`SELECT e.id AS event_id,e.title,e.currency,COUNT(t.id) AS tickets_sold,
      COALESCE(SUM(tx.commission_minor),0) AS commission_minor,
      CASE WHEN COUNT(t.id)>0 THEN CAST(ROUND(SUM(tx.commission_minor)*1.0/COUNT(t.id)) AS INTEGER) ELSE 0 END AS commission_per_ticket_minor
      FROM events e LEFT JOIN transactions tx ON tx.event_id=e.id AND tx.purpose='ticket' AND tx.status='successful'
      LEFT JOIN tickets t ON t.transaction_id=tx.id GROUP BY e.id ORDER BY e.date DESC,e.id DESC`);
    const all = db.get("SELECT COUNT(*) AS tickets FROM tickets WHERE status IN ('valid','checked_in')");
    const users = db.get('SELECT COUNT(*) AS total FROM users');
    const events = db.get("SELECT COUNT(*) AS total FROM events WHERE status!='cancelled'");
    const revenue = aggregate.map((row) => ({ ...row, gross_major: row.gross_minor / 100, commission_major: row.commission_minor / 100 }));
    res.json({ total_tickets_sold: all.tickets, total_users: users.total, total_events: events.total, revenue, per_event: perEvent });
  });
  router.get('/admin/users', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const rows = q
      ? db.all('SELECT id,username,email,role,name,bio,avatar,created_at,verified_at FROM users WHERE email LIKE ? OR username LIKE ? OR name LIKE ? ORDER BY created_at DESC LIMIT 150', [`%${q}%`,`%${q}%`,`%${q}%`])
      : db.all('SELECT id,username,email,role,name,bio,avatar,created_at,verified_at FROM users ORDER BY created_at DESC LIMIT 150');
    res.json({ users: rows });
  });
  router.patch('/admin/users/:id/role', sensitive, (req, res) => {
    const id = Number(req.params.id);
    const role = String(req.body?.role || '');
    if (!isId(id) || !['attendee','organizer','admin'].includes(role)) return res.status(400).json({ error: 'INVALID_INPUT' });
    const user = db.get('SELECT id,username,email,role,name FROM users WHERE id=?', [id]);
    if (!user) return res.status(404).json({ error: 'NOT_FOUND' });
    if (id === req.auth?.user.id && role !== 'admin') return res.status(409).json({ error: 'CANNOT_DEMOTE_SELF' });
    db.run('UPDATE users SET role=?,updated_at=? WHERE id=?', [role,nowIso(),id]);
    audit(db, req.auth.user.id, 'user.role_change', 'user', id, { from: user.role, to: role });
    res.json({ user: { ...user, role } });
  });
  router.patch('/admin/users/:id/verification', sensitive, (req, res) => {
    const id = Number(req.params.id);
    const verified = req.body?.verified;
    if (!isId(id) || typeof verified !== 'boolean') return res.status(400).json({ error: 'INVALID_INPUT' });
    const user = db.get('SELECT id,verified_at FROM users WHERE id=?', [id]);
    if (!user) return res.status(404).json({ error: 'NOT_FOUND' });
    const wasVerified = Boolean(user.verified_at);
    if (wasVerified === verified) return res.json({ user: { id, verified_at: user.verified_at || null } });
    const verifiedAt = verified ? nowIso() : null;
    db.run('UPDATE users SET verified_at=?,verified_by=?,updated_at=? WHERE id=?', [verifiedAt,verified ? req.auth.user.id : null,nowIso(),id]);
    audit(db, req.auth.user.id, verified ? 'user.account_verified' : 'user.account_unverified', 'user', id, { from: wasVerified, to: verified });
    res.json({ user: { id, verified_at: verifiedAt } });
  });
  router.get('/admin/events', (req, res) => {
    const rows = db.all(`SELECT e.*,u.name AS organizer_name,c.name AS category_name,
      (SELECT COUNT(*) FROM tickets t JOIN transactions tx ON tx.id=t.transaction_id WHERE t.event_id=e.id AND tx.status='successful') AS tickets_sold,
      (SELECT COALESCE(SUM(tx.commission_minor),0) FROM transactions tx WHERE tx.event_id=e.id AND tx.status='successful') AS commission_minor
      FROM events e JOIN users u ON u.id=e.organizer_id JOIN categories c ON c.id=e.category_id ORDER BY e.created_at DESC LIMIT 200`);
    res.json({ events: rows });
  });
  router.patch('/admin/events/:id/status', sensitive, (req, res) => {
    const id = Number(req.params.id);
    const status = String(req.body?.status || '');
    if (!isId(id) || !['draft','published','cancelled'].includes(status)) return res.status(400).json({ error: 'INVALID_INPUT' });
    const event = db.get('SELECT id FROM events WHERE id=?', [id]);
    if (!event) return res.status(404).json({ error: 'NOT_FOUND' });
    db.run('UPDATE events SET status=?,updated_at=? WHERE id=?', [status,nowIso(),id]);
    audit(db, req.auth.user.id, 'event.status_change', 'event', id, { status });
    res.json({ event: db.get('SELECT * FROM events WHERE id=?', [id]) });
  });
  router.get('/admin/tickets', (req, res) => {
    const tickets = db.all(`SELECT t.id,t.status,t.created_at,t.checked_in_at,e.id AS event_id,e.title AS event_title,e.date AS event_date,u.name AS attendee_name,u.email,tx.currency,tx.amount_minor,tx.commission_minor
      FROM tickets t JOIN events e ON e.id=t.event_id JOIN users u ON u.id=t.user_id JOIN transactions tx ON tx.id=t.transaction_id ORDER BY t.created_at DESC LIMIT 300`);
    res.json({ tickets });
  });
  router.get('/admin/settings', (_req, res) => {
    const rows = db.all('SELECT key,value,updated_at FROM settings ORDER BY key');
    res.json({ settings: Object.fromEntries(rows.map((item) => [item.key, item.value])) });
  });
  router.patch('/admin/settings', sensitive, (req, res) => {
    const values = req.body?.settings;
    if (!values || typeof values !== 'object' || Array.isArray(values)) return res.status(400).json({ error: 'INVALID_SETTINGS' });
    const updates = [];
    for (const [key, raw] of Object.entries(values)) {
      if (!editableSettings.has(key)) return res.status(400).json({ error: 'INVALID_SETTINGS' });
      const value = String(raw).trim();
      if (key === 'currency' && !validCurrency(value)) return res.status(400).json({ error: 'INVALID_SETTINGS' });
      if (key === 'commission_percent' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 30)) return res.status(400).json({ error: 'INVALID_SETTINGS' });
      if (key === 'service_fee_minor' && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 1000000)) return res.status(400).json({ error: 'INVALID_SETTINGS' });
      if (key === 'support_email' && !isEmail(value)) return res.status(400).json({ error: 'INVALID_SETTINGS' });
      updates.push([key,value]);
    }
    const stamp = nowIso();
    db.transaction(() => updates.forEach(([key,value]) => db.run('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at', [key,value,stamp])));
    audit(db, req.auth.user.id, 'settings.update', 'settings', null, Object.fromEntries(updates));
    res.json({ settings: Object.fromEntries(db.all('SELECT key,value FROM settings').map((item) => [item.key,item.value])) });
  });
  router.get('/admin/audit', (req, res) => {
    const rows = db.all('SELECT a.*,u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 200');
    res.json({ audit: rows });
  });
  return router;
}
module.exports = { createAdminRouter, editableSettings };
