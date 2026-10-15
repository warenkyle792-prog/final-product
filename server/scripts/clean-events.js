// Removes all events and every event-derived row (tiers, transactions, tickets,
// promotions, RSVPs, saves, follows, comments and event/ticket notifications).
// Categories, accounts, settings and conversations are kept.
const { loadConfig } = require('../config');
const { openDatabase } = require('../db/database');

async function main() {
  const config = loadConfig();
  if (config.mode === 'production') throw new Error('Refusing to clean data in production.');
  const db = await openDatabase(config.dbFile);
  try {
    db.transaction(() => {
      db.run('DELETE FROM comments');
      db.run('DELETE FROM rsvps');
      db.run('DELETE FROM saves');
      db.run('DELETE FROM event_follows');
      db.run('DELETE FROM tickets');
      db.run('DELETE FROM promotions');
      db.run('DELETE FROM transactions');
      db.run('DELETE FROM ticket_types');
      db.run('DELETE FROM events');
      db.run("DELETE FROM notifications WHERE entity_type IN ('event','ticket')");
    });
    const count = (table) => db.get(`SELECT COUNT(*) AS n FROM ${table}`).n;
    console.log(`Cleaned. events=${count('events')} ticket_types=${count('ticket_types')} transactions=${count('transactions')} tickets=${count('tickets')} promotions=${count('promotions')} rsvps=${count('rsvps')} saves=${count('saves')} comments=${count('comments')}`);
    console.log(`Kept. categories=${count('categories')} users=${count('users')} settings=${count('settings')}`);
  } finally {
    db.close();
  }
}
main().catch((error) => { console.error(error?.message || 'Clean failed.'); process.exitCode = 1; });
