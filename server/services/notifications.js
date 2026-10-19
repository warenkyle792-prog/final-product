/**
 * Notifications service.
 *
 * Writes are persisted first, then pushed to any registered realtime sink
 * (Socket.IO) so the bell updates without a refresh.
 */
const db = require('../db');
const { getUserById } = require('../db/helpers');

let realtime = null;

function registerRealtime(sink) {
  realtime = sink;
}

function create({ userId, type = 'system', title, body = '', link = '', actorId = null, eventId = null }) {
  if (!userId || !title) return null;

  const info = db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, link, actor_id, event_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, type, String(title).slice(0, 160), String(body).slice(0, 400), link, actorId, eventId);

  const row = db.prepare(`
    SELECT n.*, u.name AS actor_name, u.username AS actor_username, u.avatar_url AS actor_avatar
    FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
    WHERE n.id = ?
  `).get(info.lastInsertRowid);

  if (realtime) realtime.pushNotification(userId, row);
  return row;
}

function notifyMany(userIds, payload) {
  const unique = [...new Set(userIds.filter(Boolean))];
  return unique.map((id) => create({ ...payload, userId: id }));
}

function list(userId, { limit = 40, unreadOnly = false } = {}) {
  return db.prepare(`
    SELECT n.*, u.name AS actor_name, u.username AS actor_username, u.avatar_url AS actor_avatar,
           e.title AS event_title
    FROM notifications n
    LEFT JOIN users u ON u.id = n.actor_id
    LEFT JOIN events e ON e.id = n.event_id
    WHERE n.user_id = ? ${unreadOnly ? "AND n.read_at = ''" : ''}
    ORDER BY n.id DESC LIMIT ?
  `).all(userId, Math.min(Number(limit) || 40, 100));
}

function unreadCount(userId) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at = ''").get(userId);
  return row?.n || 0;
}

function markRead(userId, id = null) {
  if (id) {
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ?").run(id, userId);
  } else {
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at = ''").run(userId);
  }
  return unreadCount(userId);
}

/** Fan a notification out to every admin — used for payment/refund events. */
function notifyAdmins(payload) {
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
  return notifyMany(admins.map((a) => a.id), payload);
}

function actorSummary(actorId) {
  const actor = actorId ? getUserById(actorId) : null;
  return actor ? { id: actor.id, name: actor.name, username: actor.username, avatar_url: actor.avatar_url } : null;
}

module.exports = { create, notifyMany, notifyAdmins, list, unreadCount, markRead, registerRealtime, actorSummary };
