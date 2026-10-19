const express = require('express');
const db = require('../db');
const { categoryCounts, listEvents } = require('../db/helpers');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

/** GET /api/categories — all categories with live event counts. */
router.get('/', (_req, res) => {
  res.json({ categories: categoryCounts() });
});

/** GET /api/categories/:slug — category detail plus its upcoming events. */
router.get('/:slug', optionalAuth, (req, res) => {
  const categories = categoryCounts();
  const category = categories.find((c) => c.slug === req.params.slug);
  if (!category) return res.status(404).json({ error: 'Category not found' });

  const { events, total } = listEvents({
    category: category.slug,
    sort: String(req.query.sort || 'soon'),
    limit: Math.min(Number(req.query.limit) || 12, 48),
    offset: ((Number(req.query.page) || 1) - 1) * (Number(req.query.limit) || 12),
  });

  const withFlags = events.map((e) => ({
    ...e,
    is_saved: req.userId
      ? Boolean(db.prepare('SELECT 1 FROM saves WHERE event_id = ? AND user_id = ?').get(e.id, req.userId))
      : false,
    is_following: req.userId
      ? Boolean(db.prepare('SELECT 1 FROM event_follows WHERE event_id = ? AND user_id = ?').get(e.id, req.userId))
      : false,
  }));

  res.json({ category, events: withFlags, total, related: categories.filter((c) => c.slug !== category.slug).slice(0, 6) });
});

module.exports = router;
