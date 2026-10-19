const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function participantsOf(conversationId) {
  return db.prepare(`
    SELECT u.id, u.name, u.username, u.avatar_url
    FROM conversation_participants cp JOIN users u ON u.id = cp.user_id
    WHERE cp.conversation_id = ?
  `).all(conversationId);
}

function decorate(row, viewerId) {
  const participants = participantsOf(row.id).filter((p) => p.id !== viewerId);
  const last = db.prepare(`
    SELECT m.id, m.body, m.created_at, m.sender_id, u.name AS sender_name
    FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 1
  `).get(row.id);
  return { ...row, participants, last_message: last || null };
}

/** GET /api/conversations — inbox */
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT c.* FROM conversations c
    JOIN conversation_participants cp ON cp.conversation_id = c.id
    WHERE cp.user_id = ?
    ORDER BY (SELECT MAX(id) FROM messages m WHERE m.conversation_id = c.id) DESC, c.id DESC
  `).all(req.userId);
  res.json({ conversations: rows.map((r) => decorate(r, req.userId)) });
});

/** POST /api/conversations — start/find a DM { participantId } or event chat { eventId } */
router.post('/', (req, res) => {
  const { participantId, eventId } = req.body || {};

  if (eventId) {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    let conv = db.prepare("SELECT * FROM conversations WHERE type = 'event' AND event_id = ?").get(event.id);
    if (!conv) {
      const info = db.prepare("INSERT INTO conversations (type, event_id, title) VALUES ('event', ?, ?)")
        .run(event.id, event.title);
      conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
    }
    const member = db.prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?')
      .get(conv.id, req.userId);
    if (!member) {
      db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)')
        .run(conv.id, req.userId);
    }
    return res.status(201).json({ conversation: decorate(conv, req.userId) });
  }

  const otherId = Number(participantId);
  if (!otherId) return res.status(400).json({ error: 'participantId or eventId is required' });
  if (otherId === req.userId) return res.status(400).json({ error: 'You cannot message yourself' });
  const other = db.prepare('SELECT id FROM users WHERE id = ?').get(otherId);
  if (!other) return res.status(404).json({ error: 'User not found' });

  // Reuse an existing DM between the two users
  let conv = db.prepare(`
    SELECT c.* FROM conversations c
    JOIN conversation_participants a ON a.conversation_id = c.id AND a.user_id = ?
    JOIN conversation_participants b ON b.conversation_id = c.id AND b.user_id = ?
    WHERE c.type = 'dm' LIMIT 1
  `).get(req.userId, otherId);

  if (!conv) {
    const info = db.prepare("INSERT INTO conversations (type) VALUES ('dm')").run();
    conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
    const insert = db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)');
    insert.run(conv.id, req.userId);
    insert.run(conv.id, otherId);
  }
  res.status(201).json({ conversation: decorate(conv, req.userId) });
});

/** GET /api/conversations/:id/messages */
router.get('/:id(\\d+)/messages', (req, res) => {
  const convId = Number(req.params.id);
  const member = db.prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?')
    .get(convId, req.userId);
  if (!member) return res.status(403).json({ error: 'You are not part of this conversation' });
  const messages = db.prepare(`
    SELECT m.*, u.name, u.username, u.avatar_url
    FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ? ORDER BY m.id ASC LIMIT 500
  `).all(convId);
  res.json({ messages });
});

/** POST /api/conversations/:id/messages (REST fallback for socket chat) */
router.post('/:id(\\d+)/messages', (req, res) => {
  const convId = Number(req.params.id);
  const member = db.prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?')
    .get(convId, req.userId);
  if (!member) return res.status(403).json({ error: 'You are not part of this conversation' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message cannot be empty' });

  const info = db.prepare('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)')
    .run(convId, req.userId, body.slice(0, 2000));
  const message = db.prepare(`
    SELECT m.*, u.name, u.username, u.avatar_url
    FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
  `).get(info.lastInsertRowid);

  // Notify live participants via socket if the app server attached the io instance
  const io = req.app.get('io');
  if (io) io.to(`conv:${convId}`).emit('message:new', { conversationId: convId, message });

  res.status(201).json({ message });
});

module.exports = router;
