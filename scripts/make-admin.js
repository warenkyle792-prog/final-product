/**
 * Grant administrator rights to an account.
 *
 * A fresh deployment has no admin, and the admin routes require one, so the
 * first administrator has to be appointed from the command line (or by seeding
 * the demo data, which creates one).
 *
 *   npm run make-admin -- you@example.com
 *   npm run make-admin -- --list          # show current roles
 *   npm run make-admin -- --demote you@example.com
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db = require('../server/db');
const { initializeDatabase, saveDatabase } = require('../server/db');

const ROLES = ['attendee', 'organizer', 'admin'];

function listAccounts() {
  const rows = db.prepare('SELECT id, username, email, role FROM users ORDER BY id').all();
  if (!rows.length) {
    console.log('\n  No accounts yet. Register one in the app, or run `npm run seed`.');
    return;
  }
  console.log('\n  Accounts:');
  for (const row of rows) {
    console.log(`    ${String(row.role).padEnd(10)} ${row.email}  (@${row.username})`);
  }
  console.log('');
}

async function main() {
  await initializeDatabase();

  const args = process.argv.slice(2).filter(Boolean);
  const demote = args.includes('--demote');
  const target = args.find((a) => !a.startsWith('--'));

  if (!target) {
    listAccounts();
    if (!args.includes('--list')) {
      console.log('  Usage: npm run make-admin -- <email or username> [--demote]\n');
    }
    return;
  }

  const user = db.prepare('SELECT id, username, email, role FROM users WHERE lower(email) = lower(?) OR lower(username) = lower(?)')
    .get(target, target);

  if (!user) {
    console.error(`\n  No account matches "${target}".`);
    listAccounts();
    process.exit(1);
  }

  const role = demote ? 'attendee' : 'admin';
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);

  // Any session that user holds keeps working, but the role is read per
  // request, so the change takes effect immediately.
  saveDatabase();

  console.log(`\n  ${user.email} is now ${role.toUpperCase()} (@${user.username}).`);
  if (!demote) {
    console.log('  Sign out and back in if the admin area does not appear right away.\n');
  } else {
    console.log('');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
