/**
 * /api/feed — home page payload: hero stats, promoted & featured rails,
 * upcoming events, categories and personalised blocks.
 */
const express = require('express');
const db = require('../db');
const { optionalAuth } = require('../middleware/auth');
const { listEvents, getEventById, categoryCounts, userStats } = require('../db/helpers');

const router = express.Router();

function viewerFlags(event, userId) {
  if (!userId) return { is_saved: false, is_following: false };
  return {
    is_saved: Boolean(db.prepare('SELECT 1 FROM saves WHERE event_id = ? AND user_id = ?').get(event.id, userId)),
    is_following: Boolean(db.prepare('SELECT 1 FROM event_follows WHERE event_id = ? AND user_id = ?').get(event.id, userId)),
  };
}

function withFlags(events, userId) {
  return events.map((e) => ({ ...e, ...viewerFlags(e, userId) }));
}

router.get('/', optionalAuth, (req, res) => {
  const userId = req.userId;

  const promoted = listEvents({ promoted: true, limit: 4 }).events;
  const featured = listEvents({ featured: true, limit: 8, sort: 'popular' }).events;
  const upcoming = listEvents({ sort: 'soon', limit: 8 }).events;
  const popular = listEvents({ sort: 'popular', limit: 6 }).events;

  // De-duplicate across rails so the same event never appears twice.
  const seen = new Set();
  const uniqueFor = (list) => list.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  const promotedOut = withFlags(uniqueFor(promoted), userId);
  const featuredOut = withFlags(uniqueFor(featured), userId);
  const upcomingOut = withFlags(uniqueFor(upcoming), userId);
  const popularOut = withFlags(uniqueFor(popular), userId);

  let forYou = [];
  if (userId) {
    const followIds = db.prepare('SELECT following_id FROM follows WHERE follower_id = ?').all(userId).map((r) => r.following_id);
    const followedEvents = followIds.length
      ? db.prepare(`
          SELECT id FROM events
          WHERE status = 'published' AND starts_at >= datetime('now')
            AND (host_id IN (${followIds.map(() => '?').join(',')})
              OR id IN (SELECT event_id FROM event_follows WHERE user_id = ?))
          ORDER BY starts_at ASC LIMIT 12
        `).all(...followIds, userId).map((r) => r.id)
      : db.prepare(`
          SELECT id FROM events WHERE status = 'published' AND starts_at >= datetime('now')
            AND id IN (SELECT event_id FROM event_follows WHERE user_id = ?)
          ORDER BY starts_at ASC LIMIT 12
        `).all(userId).map((r) => r.id);

    forYou = withFlags(followedEvents.map(getEventById).filter(Boolean), userId);

    // Top up with category affinity when the user follows few people.
    if (forYou.length < 4) {
      const interests = String(req.user?.interests || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (interests.length) {
        const { events } = listEvents({ category: interests.join(','), limit: 8 });
        const extra = events.filter((e) => !forYou.find((f) => f.id === e.id)).map((e) => ({ ...e, ...viewerFlags(e, userId) }));
        forYou = [...forYou, ...extra];
      }
    }
    forYou = forYou.slice(0, 8);
  }

  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM events WHERE starts_at >= datetime('now') AND status = 'published') AS upcoming_events,
      (SELECT COUNT(DISTINCT city) FROM events WHERE city != '' AND starts_at >= datetime('now')) AS cities,
      (SELECT COUNT(*) FROM tickets WHERE status IN ('valid','used')) AS tickets_issued,
      (SELECT COUNT(*) FROM users) AS members
  `).get();

  const myStats = userId ? userStats(userId) : null;

  res.json({
    stats: {
      upcoming_events: Number(stats.upcoming_events || 0),
      cities: Number(stats.cities || 0),
      tickets_issued: Number(stats.tickets_issued || 0),
      members: Number(stats.members || 0),
    },
    promoted: promotedOut,
    featured: featuredOut,
    upcoming: upcomingOut,
    popular: popularOut,
    categories: categoryCounts().slice(0, 8),
    for_you: forYou,
    my_stats: myStats,
  });
});

module.exports = router;
