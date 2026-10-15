const crypto = require('node:crypto');

const nowIso = () => new Date().toISOString();
const slugify = (value) => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'event';
const publicUser = (user) => user ? ({
  id: user.id,
  username: user.username,
  email: user.email,
  role: user.role,
  name: user.name,
  bio: user.bio || '',
  avatar: user.avatar || '',
  created_at: user.created_at,
  verified_at: user.verified_at || null
}) : null;
const safeJson = (value, fallback = {}) => {
  try { return JSON.parse(value || ''); } catch { return fallback; }
};
const isString = (value, min = 1, max = 5000) => typeof value === 'string' && value.trim().length >= min && value.length <= max;
const isEmail = (value) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
const isId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const toMinor = (amount) => Math.round(Number(amount) * 100);
const fromMinor = (amount) => Number(amount || 0) / 100;
const randomKey = () => crypto.randomUUID();
function makeSlugUnique(db, base, omitId = null) {
  let slug = slugify(base);
  let suffix = 2;
  while (db.get('SELECT id FROM events WHERE slug = ? AND (? IS NULL OR id != ?)', [slug, omitId, omitId])) {
    slug = `${slugify(base)}-${suffix++}`;
  }
  return slug;
}
function notify(db, io, userId, type, title, body, entityType = '', entityId = null) {
  const createdAt = nowIso();
  const result = db.run(
    'INSERT INTO notifications(user_id,type,title,body,entity_type,entity_id,created_at) VALUES(?,?,?,?,?,?,?)',
    [userId, type, title, body, entityType, entityId, createdAt]
  );
  const notification = db.get('SELECT * FROM notifications WHERE id = ?', [result.lastID]);
  io?.to(`user:${userId}`).emit('notification:new', notification);
  return notification;
}
function audit(db, actorId, action, entityType = '', entityId = null, detail = {}) {
  db.run('INSERT INTO audit_log(actor_id,action,entity_type,entity_id,detail,created_at) VALUES(?,?,?,?,?,?)', [
    actorId || null, action, entityType, entityId, JSON.stringify(detail), nowIso()
  ]);
}
function pagination(query, defaultLimit = 20, maxLimit = 60) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}
function parseBoolean(value) { return value === true || value === 'true' || value === '1' || value === 1; }
function validCurrency(value) { return ['KES', 'USD', 'EUR', 'GBP', 'NGN', 'ZAR'].includes(String(value || '').toUpperCase()); }
module.exports = { nowIso, slugify, publicUser, safeJson, isString, isEmail, isId, toMinor, fromMinor, randomKey, makeSlugUnique, notify, audit, pagination, parseBoolean, validCurrency };
