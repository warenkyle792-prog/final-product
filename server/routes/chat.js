const express = require('express');
const { requireAuth } = require('../lib/auth');
const { nowIso, isId, isString, notify } = require('../lib/helpers');
function createChatRouter({ db, io }) {
  const router = express.Router();
  router.use('/chat', requireAuth);
  router.get('/chat/unread', (req, res) => {
    const count = db.get(`SELECT COUNT(*) AS n FROM messages m JOIN conversation_participants cp ON cp.conversation_id=m.conversation_id
      JOIN conversations c ON c.id=m.conversation_id
      WHERE cp.user_id=? AND m.sender_id!=? AND m.read_at IS NULL AND c.status='active'`, [req.auth.user.id,req.auth.user.id]).n;
    res.json({ unread: count });
  });
  router.get('/chat/conversations', (req, res) => {
    const conversations = db.all(`SELECT c.id,c.created_at,c.updated_at,
      (SELECT u.id FROM conversation_participants cp2 JOIN users u ON u.id=cp2.user_id WHERE cp2.conversation_id=c.id AND cp2.user_id!=? LIMIT 1) AS other_user_id,
      (SELECT u.name FROM conversation_participants cp2 JOIN users u ON u.id=cp2.user_id WHERE cp2.conversation_id=c.id AND cp2.user_id!=? LIMIT 1) AS other_name,
      (SELECT u.username FROM conversation_participants cp2 JOIN users u ON u.id=cp2.user_id WHERE cp2.conversation_id=c.id AND cp2.user_id!=? LIMIT 1) AS other_username,
      (SELECT u.avatar FROM conversation_participants cp2 JOIN users u ON u.id=cp2.user_id WHERE cp2.conversation_id=c.id AND cp2.user_id!=? LIMIT 1) AS other_avatar,
      (SELECT m.body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_message,
      (SELECT m.created_at FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_message_at,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.sender_id!=? AND m.read_at IS NULL) AS unread
      FROM conversations c JOIN conversation_participants cp ON cp.conversation_id=c.id
      WHERE cp.user_id=? AND c.status='active' ORDER BY COALESCE(last_message_at,c.updated_at) DESC`, [req.auth.user.id,req.auth.user.id,req.auth.user.id,req.auth.user.id,req.auth.user.id,req.auth.user.id]);
    res.json({ conversations });
  });
  router.post('/chat/conversations', (req, res) => {
    const otherId = Number(req.body?.user_id);
    if (!isId(otherId) || otherId === req.auth.user.id) return res.status(400).json({ error: 'INVALID_INPUT' });
    if (!db.get('SELECT id FROM users WHERE id=?', [otherId])) return res.status(404).json({ error: 'NOT_FOUND' });
    const existing = db.get(`SELECT c.id FROM conversations c JOIN conversation_participants a ON a.conversation_id=c.id AND a.user_id=?
      JOIN conversation_participants b ON b.conversation_id=c.id AND b.user_id=?
      WHERE (SELECT COUNT(*) FROM conversation_participants cp WHERE cp.conversation_id=c.id)=2 AND c.status!='declined' LIMIT 1`, [req.auth.user.id,otherId]);
    if (existing) return res.json({ conversation: db.get('SELECT * FROM conversations WHERE id=?', [existing.id]), created: false });
    const stamp = nowIso();
    const result = db.run("INSERT INTO conversations(created_at,updated_at,status,requester_id) VALUES(?,?, 'pending', ?)", [stamp,stamp,req.auth.user.id]);
    db.run('INSERT INTO conversation_participants(conversation_id,user_id) VALUES(?,?)', [result.lastID,req.auth.user.id]);
    db.run('INSERT INTO conversation_participants(conversation_id,user_id) VALUES(?,?)', [result.lastID,otherId]);
    notify(db, io, otherId, 'message_request', 'Message request', `${req.auth.user.name} wants to chat with you.`, 'conversation', result.lastID);
    res.status(201).json({ conversation: db.get('SELECT * FROM conversations WHERE id=?', [result.lastID]), created: true });
  });
  router.get('/chat/requests', (req, res) => {
    const requests = db.all(`SELECT c.id,c.created_at,c.requester_id,
      (SELECT u.id FROM conversation_participants cp2 JOIN users u ON u.id=cp2.user_id WHERE cp2.conversation_id=c.id AND cp2.user_id!=? LIMIT 1) AS other_user_id,
      (SELECT u.name FROM conversation_participants cp2 JOIN users u ON u.id=cp2.user_id WHERE cp2.conversation_id=c.id AND cp2.user_id!=? LIMIT 1) AS other_name,
      (SELECT u.username FROM conversation_participants cp2 JOIN users u ON u.id=cp2.user_id WHERE cp2.conversation_id=c.id AND cp2.user_id!=? LIMIT 1) AS other_username,
      (SELECT u.avatar FROM conversation_participants cp2 JOIN users u ON u.id=cp2.user_id WHERE cp2.conversation_id=c.id AND cp2.user_id!=? LIMIT 1) AS other_avatar
      FROM conversations c JOIN conversation_participants cp ON cp.conversation_id=c.id
      WHERE cp.user_id=? AND c.status='pending' ORDER BY c.created_at DESC`, [req.auth.user.id,req.auth.user.id,req.auth.user.id,req.auth.user.id,req.auth.user.id]);
    res.json({ requests: requests.map((r) => ({ ...r, from_me: r.requester_id === req.auth.user.id })) });
  });
  router.post('/chat/requests/:id/accept', (req, res) => {
    const id = Number(req.params.id);
    if (!isId(id)) return res.status(400).json({ error: 'INVALID_INPUT' });
    const conversation = db.get('SELECT * FROM conversations WHERE id=?', [id]);
    if (!conversation) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!db.get('SELECT 1 FROM conversation_participants WHERE conversation_id=? AND user_id=?', [id,req.auth.user.id])) return res.status(404).json({ error: 'NOT_FOUND' });
    if (conversation.status !== 'pending') return res.status(409).json({ error: 'NOT_PENDING' });
    db.run("UPDATE conversations SET status='active',updated_at=? WHERE id=?", [nowIso(),id]);
    if (conversation.requester_id && conversation.requester_id !== req.auth.user.id) {
      notify(db, io, conversation.requester_id, 'message_request', 'Request accepted', `${req.auth.user.name} accepted your message request.`, 'conversation', id);
    }
    res.json({ conversation: db.get('SELECT * FROM conversations WHERE id=?', [id]) });
  });
  router.post('/chat/requests/:id/decline', (req, res) => {
    const id = Number(req.params.id);
    if (!isId(id)) return res.status(400).json({ error: 'INVALID_INPUT' });
    const conversation = db.get('SELECT * FROM conversations WHERE id=?', [id]);
    if (!conversation) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!db.get('SELECT 1 FROM conversation_participants WHERE conversation_id=? AND user_id=?', [id,req.auth.user.id])) return res.status(404).json({ error: 'NOT_FOUND' });
    if (conversation.status !== 'pending') return res.status(409).json({ error: 'NOT_PENDING' });
    db.run("UPDATE conversations SET status='declined',updated_at=? WHERE id=?", [nowIso(),id]);
    if (conversation.requester_id && conversation.requester_id !== req.auth.user.id) {
      notify(db, io, conversation.requester_id, 'message_request', 'Request declined', `${req.auth.user.name} declined your message request.`, 'conversation', id);
    }
    res.json({ ok: true });
  });
  router.get('/chat/conversations/:id/messages', (req, res) => {
    const id = Number(req.params.id);
    if (!isId(id)) return res.status(400).json({ error: 'INVALID_INPUT' });
    const member = db.get('SELECT 1 FROM conversation_participants WHERE conversation_id=? AND user_id=?', [id,req.auth.user.id]);
    if (!member) return res.status(404).json({ error: 'NOT_FOUND' });
    const messages = db.all(`SELECT m.*,u.name AS sender_name,u.avatar AS sender_avatar FROM messages m JOIN users u ON u.id=m.sender_id
      WHERE m.conversation_id=? ORDER BY m.created_at,m.id LIMIT 200`, [id]);
    const stamp = nowIso();
    db.run('UPDATE messages SET read_at=? WHERE conversation_id=? AND sender_id!=? AND read_at IS NULL', [stamp,id,req.auth.user.id]);
    db.run('UPDATE conversation_participants SET last_read_at=? WHERE conversation_id=? AND user_id=?', [stamp,id,req.auth.user.id]);
    res.json({ messages });
  });
  router.post('/chat/conversations/:id/messages', (req, res) => {
    const id = Number(req.params.id);
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!isId(id) || !isString(body,1,2000)) return res.status(400).json({ error: 'INVALID_INPUT' });
    const member = db.get('SELECT 1 FROM conversation_participants WHERE conversation_id=? AND user_id=?', [id,req.auth.user.id]);
    if (!member) return res.status(404).json({ error: 'NOT_FOUND' });
    const active = db.get("SELECT status FROM conversations WHERE id=?", [id]);
    if (!active || active.status !== 'active') return res.status(403).json({ error: 'REQUEST_PENDING' });
    const stamp = nowIso();
    const result = db.run('INSERT INTO messages(conversation_id,sender_id,body,created_at) VALUES(?,?,?,?)', [id,req.auth.user.id,body,stamp]);
    db.run('UPDATE conversations SET updated_at=? WHERE id=?', [stamp,id]);
    const message = db.get('SELECT m.*,u.name AS sender_name,u.avatar AS sender_avatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?', [result.lastID]);
    io.to(`conversation:${id}`).emit('message:new', message);
    const recipients = db.all('SELECT user_id FROM conversation_participants WHERE conversation_id=? AND user_id!=?', [id,req.auth.user.id]);
    for (const recipient of recipients) notify(db, io, recipient.user_id, 'message', 'New message', `${req.auth.user.name} sent you a message.`, 'conversation', id);
    res.status(201).json({ message });
  });
  return router;
}
module.exports = { createChatRouter };
