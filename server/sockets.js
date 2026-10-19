/**
 * Socket.IO realtime layer — chat, typing indicators, presence,
 * notification pushes and live ticket updates.
 */
const jwt = require('jsonwebtoken');
const db = require('./db');
const { JWT_SECRET } = require('./middleware/auth');

const online = new Map(); // userId -> Set<socketId>

function attachSockets(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = jwt.verify(token, JWT_SECRET);
      socket.userId = payload.id;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;

    if (!online.has(userId)) online.set(userId, new Set());
    online.get(userId).add(socket.id);

    // Personal room: notifications and ticket updates land here.
    socket.join(`user:${userId}`);
    socket.emit('presence:update', { userId, online: true });
    io.emit('presence:update', { userId, online: true });

    socket.on('conversation:join', (conversationId) => {
      const member = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, userId);
      if (member) socket.join(`conv:${conversationId}`);
    });

    socket.on('conversation:leave', (conversationId) => socket.leave(`conv:${conversationId}`));

    socket.on('event:join', (eventId) => socket.join(`event:${eventId}`));
    socket.on('event:leave', (eventId) => socket.leave(`event:${eventId}`));

    socket.on('message:send', ({ conversationId, body }, ack) => {
      const text = String(body || '').trim().slice(0, 2000);
      if (!text) return;

      const member = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, userId);
      if (!member) return;

      const info = db.prepare('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)')
        .run(conversationId, userId, text);

      const message = db.prepare(`
        SELECT m.*, u.name, u.username, u.avatar_url
        FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
      `).get(info.lastInsertRowid);

      io.to(`conv:${conversationId}`).emit('message:new', { conversationId, message });
      if (typeof ack === 'function') ack({ ok: true, message });
    });

    socket.on('typing:start', ({ conversationId }) => {
      socket.to(`conv:${conversationId}`).emit('typing:start', { conversationId, userId });
    });

    socket.on('typing:stop', ({ conversationId }) => {
      socket.to(`conv:${conversationId}`).emit('typing:stop', { conversationId, userId });
    });

    socket.on('disconnect', () => {
      const set = online.get(userId);
      if (!set) return;
      set.delete(socket.id);
      if (set.size === 0) {
        online.delete(userId);
        io.emit('presence:update', { userId, online: false });
      }
    });
  });
}

function isOnline(userId) {
  return online.has(userId);
}

/**
 * Realtime sink used by the notification service and the payment service so
 * server-side events reach the browser instantly.
 */
function createRealtimeSink(io) {
  return {
    pushNotification(userId, notification) {
      io.to(`user:${userId}`).emit('notification:new', notification);
    },
    pushTicketUpdate(userId, payload) {
      io.to(`user:${userId}`).emit('ticket:update', payload);
    },
    pushTransaction(userId, transaction) {
      io.to(`user:${userId}`).emit('payment:update', transaction);
    },
  };
}

module.exports = { attachSockets, isOnline, createRealtimeSink };
