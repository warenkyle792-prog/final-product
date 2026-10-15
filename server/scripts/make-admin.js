const { loadConfig } = require('../config');
const { openDatabase } = require('../db/database');
const { nowIso } = require('../lib/helpers');

async function main() {
  const args = process.argv.slice(2).filter((value) => value !== '--');
  const config = loadConfig();
  const db = await openDatabase(config.dbFile);
  try {
    if (args.includes('--list')) {
      const users = db.all('SELECT id,email,username,name,role,created_at FROM users ORDER BY created_at,id');
      if (!users.length) {
        console.log('No accounts exist yet. Sign up in EventTracker, then run: npm run make-admin -- you@example.com');
        return;
      }
      console.log('ID  ROLE       EMAIL                         USERNAME');
      for (const user of users) console.log(`${String(user.id).padEnd(3)} ${user.role.padEnd(10)} ${user.email.padEnd(29)} ${user.username}`);
      return;
    }
    const identifier = args.find((item) => !item.startsWith('--'));
    if (!identifier) {
      console.log('Usage: npm run make-admin -- you@example.com [--demote] | npm run make-admin -- --list');
      return;
    }
    const user = db.get('SELECT id,email,username,name,role FROM users WHERE lower(email)=lower(?) OR lower(username)=lower(?)', [identifier,identifier]);
    if (!user) {
      console.log(`No account matches “${identifier}”. Sign up first; no accounts found is not an error. Use --list to view existing accounts.`);
      return;
    }
    const demote = args.includes('--demote');
    const role = demote ? 'attendee' : 'admin';
    db.run('UPDATE users SET role=?,updated_at=? WHERE id=?', [role,nowIso(),user.id]);
    db.run('INSERT INTO audit_log(actor_id,action,entity_type,entity_id,detail,created_at) VALUES(NULL,?,?,?,?,?)', [demote ? 'cli.user.demote' : 'cli.user.promote','user',user.id,JSON.stringify({ email:user.email, role }),nowIso()]);
    console.log(`${user.email} (${user.username}) is now ${role}.`);
  } finally { db.close(); }
}
main().catch((error) => { console.error(error?.message || 'Unable to update account role.'); process.exitCode = 1; });
