/**
 * /api/notifications — the in-app notification centre.
 */
const express = require('express');

const { requireAuth } = require('../middleware/auth');
const notifications = require('../services/notifications');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const unreadOnly = String(req.query.unread) === 'true';
  res.json({
    notifications: notifications.list(req.userId, {
      unreadOnly,
      limit: Number(req.query.limit) || 40,
    }),
    unread: notifications.unreadCount(req.userId),
  });
});

router.get('/unread', (req, res) => {
  res.json({ unread: notifications.unreadCount(req.userId) });
});

/** POST /api/notifications/read { id? } — mark one or all as read. */
router.post('/read', (req, res) => {
  const id = req.body?.id ? Number(req.body.id) : null;
  res.json({ unread: notifications.markRead(req.userId, id) });
});

module.exports = router;
