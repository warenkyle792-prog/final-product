const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');

const migrations = [
  {
    id: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'attendee' CHECK(role IN ('attendee','organizer','admin')),
        name TEXT NOT NULL,
        bio TEXT NOT NULL DEFAULT '',
        avatar TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        cover TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '#222222',
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organizer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES categories(id),
        title TEXT NOT NULL,
        slug TEXT NOT NULL,
        description TEXT NOT NULL,
        date TEXT NOT NULL,
        time TEXT NOT NULL DEFAULT '18:00',
        end_time TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL,
        venue TEXT NOT NULL DEFAULT '',
        price_minor INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'KES',
        capacity INTEGER NOT NULL DEFAULT 100,
        cover_image TEXT NOT NULL DEFAULT '',
        video_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft','published','cancelled')),
        featured INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ticket_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price_minor INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'KES',
        quantity INTEGER NOT NULL DEFAULT 100,
        sold INTEGER NOT NULL DEFAULT 0,
        sale_starts_at TEXT,
        sale_ends_at TEXT
      );
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        event_id INTEGER REFERENCES events(id),
        ticket_type_id INTEGER REFERENCES ticket_types(id),
        provider TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','processing','successful','failed','cancelled','refunded')),
        provider_reference TEXT NOT NULL DEFAULT '',
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        commission_minor INTEGER NOT NULL DEFAULT 0,
        purpose TEXT NOT NULL DEFAULT 'ticket',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        confirmed_at TEXT,
        UNIQUE(user_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        event_id INTEGER NOT NULL REFERENCES events(id),
        ticket_type_id INTEGER REFERENCES ticket_types(id),
        code TEXT NOT NULL UNIQUE,
        signed_payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'valid' CHECK(status IN ('valid','checked_in','refunded','cancelled')),
        checked_in_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS promotions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        placement TEXT NOT NULL CHECK(placement IN ('featured','boost','sponsored')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','expired','cancelled')),
        transaction_id INTEGER REFERENCES transactions(id),
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        starts_at TEXT,
        ends_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        entity_type TEXT NOT NULL DEFAULT '',
        entity_id INTEGER,
        read_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS event_follows (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(user_id,event_id)
      );
      CREATE TABLE IF NOT EXISTS rsvps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'going' CHECK(status IN ('going','cancelled')),
        created_at TEXT NOT NULL,
        UNIQUE(user_id,event_id)
      );
      CREATE TABLE IF NOT EXISTS saves (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(user_id,event_id)
      );
      CREATE TABLE IF NOT EXISTS follows (
        follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(follower_id,followed_id),
        CHECK(follower_id != followed_id)
      );
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_participants (
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_read_at TEXT,
        PRIMARY KEY(conversation_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        ip TEXT NOT NULL,
        successful INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL DEFAULT '',
        entity_id INTEGER,
        detail TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_date ON events(status,date);
      CREATE INDEX IF NOT EXISTS idx_events_category ON events(category_id,status);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,read_at,created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id,created_at);
      CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id,created_at);
      CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets(event_id,status);
      CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(email,ip,created_at);
      CREATE INDEX IF NOT EXISTS idx_promotions_event ON promotions(event_id,status,placement);
    `
  },
  {
    id: 2,
    sql: `
      UPDATE categories SET cover=REPLACE(cover,'.svg','.jpg')
        WHERE cover IN ('/covers/music.svg','/covers/technology.svg','/covers/sports.svg','/covers/business.svg','/covers/food.svg','/covers/arts.svg','/covers/community.svg','/covers/wellness.svg');
      UPDATE events SET cover_image=REPLACE(cover_image,'.svg','.jpg')
        WHERE cover_image IN ('/covers/music.svg','/covers/technology.svg','/covers/sports.svg','/covers/business.svg','/covers/food.svg','/covers/arts.svg','/covers/community.svg','/covers/wellness.svg');
    `
  },
  {
    id: 3,
    sql: `
      ALTER TABLE users ADD COLUMN verified_at TEXT;
      ALTER TABLE users ADD COLUMN verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_users_verified ON users(verified_at,created_at);
    `
  },
  {
    id: 4,
    sql: `
      ALTER TABLE conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('pending','active','declined'));
      ALTER TABLE conversations ADD COLUMN requester_id INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
    `
  }
];

class Database {
  constructor(SQL, file) {
    this.SQL = SQL;
    this.file = file;
    this.suppressWrites = 0;
    this.dirty = false;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (fs.existsSync(file)) {
      fs.chmodSync(file, 0o600);
      this.raw = new SQL.Database(new Uint8Array(fs.readFileSync(file)));
    } else {
      this.raw = new SQL.Database();
    }
    this.raw.run('PRAGMA foreign_keys = ON');
    this.migrate();
  }
  migrate() {
    this.raw.run('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const migration of migrations) {
      const present = this.get('SELECT id FROM schema_migrations WHERE id = ?', [migration.id]);
      if (!present) {
        this.suppressWrites++;
        try {
          this.raw.run('BEGIN');
          this.raw.exec(migration.sql);
          this.raw.run('INSERT INTO schema_migrations(id,applied_at) VALUES(?,?)', [migration.id, new Date().toISOString()]);
          this.raw.run('COMMIT');
        } catch (error) {
          this.raw.run('ROLLBACK');
          throw error;
        } finally {
          this.suppressWrites--;
        }
      }
    }
    this.persist();
  }
  run(sql, params = []) {
    const statement = this.raw.prepare(sql);
    try {
      statement.bind(params);
      while (statement.step()) { /* consume result rows for statements with RETURNING */ }
    } finally { statement.free(); }
    const changes = this.raw.getRowsModified();
    const last = this.get('SELECT last_insert_rowid() AS id');
    this.markDirty();
    return { changes, lastID: last?.id || 0 };
  }
  get(sql, params = []) {
    const statement = this.raw.prepare(sql);
    try {
      statement.bind(params);
      return statement.step() ? statement.getAsObject() : undefined;
    } finally { statement.free(); }
  }
  all(sql, params = []) {
    const statement = this.raw.prepare(sql);
    try {
      statement.bind(params);
      const rows = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally { statement.free(); }
  }
  exec(sql) {
    this.raw.exec(sql);
    this.markDirty();
  }
  transaction(work) {
    this.suppressWrites++;
    this.raw.run('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.raw.run('COMMIT');
      this.dirty = true;
      return result;
    } catch (error) {
      this.raw.run('ROLLBACK');
      throw error;
    } finally {
      this.suppressWrites--;
      if (!this.suppressWrites && this.dirty) this.persist();
    }
  }
  markDirty() {
    this.dirty = true;
    if (!this.suppressWrites) this.persist();
  }
  persist() {
    if (!this.dirty && fs.existsSync(this.file)) return;
    const bytes = Buffer.from(this.raw.export());
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, bytes, { mode: 0o600 });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, this.file);
    fs.chmodSync(this.file, 0o600);
    this.dirty = false;
  }
  close() {
    this.persist();
    this.raw.close();
  }
}

async function openDatabase(file) {
  const SQL = await initSqlJs({ locateFile: (filename) => require.resolve(`sql.js/dist/${filename}`) });
  return new Database(SQL, file);
}
module.exports = { Database, openDatabase, migrations };
