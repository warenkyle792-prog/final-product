/**
 * EventTracker — SQLite database layer (sql.js)
 *
 * sql.js is a pure-JavaScript build of SQLite: no native compilation step,
 * which keeps `npm install` reliable on any Node version. The whole database
 * lives in memory and is flushed to disk after every write (writes inside
 * `db.transaction()` are batched into a single flush).
 */

require('dotenv').config({
  path: require('path').join(__dirname, '..', '..', '.env')
});

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const { DATA_DIR, DB_FILE } = require('../paths');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let database = null;
let txDepth = 0;

function saveDatabase() {
  if (!database || txDepth > 0) return;
  const data = database.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

function normalizeParams(params) {
  if (params.length === 1 && Array.isArray(params[0])) {
    return params[0];
  }

  return params;
}

function createStatement(sql) {
  return {
    get(...args) {
      const params = normalizeParams(args);
      const stmt = database.prepare(sql);

      try {
        stmt.bind(params);

        if (!stmt.step()) {
          return undefined;
        }

        return stmt.getAsObject();
      } finally {
        stmt.free();
      }
    },

    all(...args) {
      const params = normalizeParams(args);
      const stmt = database.prepare(sql);
      const rows = [];

      try {
        stmt.bind(params);

        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }

        return rows;
      } finally {
        stmt.free();
      }
    },

    run(...args) {
      const params = normalizeParams(args);
      const stmt = database.prepare(sql);

      try {
        stmt.bind(params);
        stmt.step();
      } finally {
        stmt.free();
      }

      // Read the insert id / affected rows *before* flushing, because
      // sql.js `export()` reopens the database and resets both counters.
      let lastInsertRowid = 0;
      let changes = 0;

      try {
        const result = database.exec('SELECT last_insert_rowid() AS id, changes() AS c');

        if (result.length && result[0].values.length) {
          lastInsertRowid = Number(result[0].values[0][0]);
          changes = Number(result[0].values[0][1]);
        }
      } catch (_) {
        lastInsertRowid = 0;
        changes = 0;
      }

      saveDatabase();

      return { changes, lastInsertRowid };
    }
  };
}

const db = {
  prepare(sql) {
    if (!database) {
      throw new Error('Database is not initialized. Call initializeDatabase() first.');
    }

    return createStatement(sql);
  },

  exec(sql) {
    if (!database) {
      throw new Error('Database is not initialized. Call initializeDatabase() first.');
    }

    const result = database.exec(sql);
    saveDatabase();
    return result;
  },

  /** Run several writes as one atomic unit with a single disk flush. */
  transaction(fn) {
    if (!database) {
      throw new Error('Database is not initialized. Call initializeDatabase() first.');
    }

    txDepth += 1;
    database.exec('BEGIN');

    try {
      const result = fn();
      database.exec('COMMIT');
      txDepth -= 1;
      saveDatabase();
      return result;
    } catch (error) {
      txDepth -= 1;

      try {
        database.exec('ROLLBACK');
      } catch (_) {
        /* already rolled back */
      }

      throw error;
    }
  },

  pragma() {
    return undefined;
  }
};

/* ------------------------------------------------------------------ *
 * Schema
 * ------------------------------------------------------------------ */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    bio TEXT DEFAULT '',
    location TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    cover_url TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user',
    interests TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    icon TEXT DEFAULT 'sparkles',
    color TEXT DEFAULT '#1c1c20',
    gradient TEXT DEFAULT 'linear-gradient(135deg,#1c1c20,#4a4a52)'
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    tagline TEXT DEFAULT '',
    description TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    venue TEXT DEFAULT '',
    city TEXT DEFAULT '',
    country TEXT DEFAULT '',
    starts_at TEXT NOT NULL,
    ends_at TEXT DEFAULT '',
    price_cents INTEGER DEFAULT 0,
    currency TEXT DEFAULT 'KES',
    capacity INTEGER DEFAULT 0,
    image_url TEXT DEFAULT '',
    video_url TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    contact_email TEXT DEFAULT '',
    contact_phone TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'published',
    is_featured INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ticket_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'KES',
    quantity INTEGER NOT NULL DEFAULT 0,
    sold INTEGER NOT NULL DEFAULT 0,
    per_user_limit INTEGER NOT NULL DEFAULT 10,
    sales_end_at TEXT DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    promotion_id INTEGER,
    purpose TEXT NOT NULL DEFAULT 'ticket',
    amount_cents INTEGER NOT NULL DEFAULT 0,
    -- platform commission kept on this transaction (service fee on tickets)
    fee_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'KES',
    method TEXT NOT NULL DEFAULT 'mpesa',
    provider TEXT NOT NULL DEFAULT 'mpesa',
    provider_reference TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    payer_phone TEXT DEFAULT '',
    payer_email TEXT DEFAULT '',
    failure_reason TEXT DEFAULT '',
    receipt TEXT DEFAULT '',
    metadata TEXT DEFAULT '',
    provider_payload TEXT DEFAULT '',
    idempotency_key TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticket_type_id INTEGER REFERENCES ticket_types(id) ON DELETE SET NULL,
    transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    holder_name TEXT DEFAULT '',
    holder_email TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'valid',
    issued_at TEXT NOT NULL DEFAULT (datetime('now')),
    checked_in_at TEXT DEFAULT '',
    checked_in_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'featured',
    transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    price_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'KES',
    duration_days INTEGER NOT NULL DEFAULT 7,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    starts_at TEXT DEFAULT '',
    ends_at TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'system',
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    link TEXT DEFAULT '',
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
    read_at TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS event_follows (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (event_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS rsvps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'going',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (event_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS saves (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (event_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (follower_id, following_id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'dm',
    event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
    title TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    label TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    ip TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    ip TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    succeeded INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, created_at);

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT DEFAULT '',
    target_id TEXT DEFAULT '',
    meta TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_events_category ON events(category_id);
  CREATE INDEX IF NOT EXISTS idx_events_host ON events(host_id);
  CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at);
  CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
  CREATE INDEX IF NOT EXISTS idx_ticket_types_event ON ticket_types(event_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets(event_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_txn ON tickets(transaction_id);
  CREATE INDEX IF NOT EXISTS idx_txn_user ON transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_txn_status ON transactions(status);
  CREATE INDEX IF NOT EXISTS idx_promotions_event ON promotions(event_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
  CREATE INDEX IF NOT EXISTS idx_rsvps_event ON rsvps(event_id);
  CREATE INDEX IF NOT EXISTS idx_rsvps_user ON rsvps(user_id);
  CREATE INDEX IF NOT EXISTS idx_comments_event ON comments(event_id);
  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
`;

/** Columns added after the first release — applied to existing databases. */
const MIGRATIONS = [
  ['users', 'role', "TEXT NOT NULL DEFAULT 'user'"],
  ['users', 'phone', "TEXT DEFAULT ''"],
  ['users', 'interests', "TEXT DEFAULT ''"],
  ['events', 'video_url', "TEXT DEFAULT ''"],
  ['events', 'contact_email', "TEXT DEFAULT ''"],
  ['events', 'contact_phone', "TEXT DEFAULT ''"],
  ['events', 'status', "TEXT NOT NULL DEFAULT 'published'"],
  ['events', 'views', 'INTEGER DEFAULT 0'],
  ['events', 'currency', "TEXT DEFAULT 'KES'"],
  ['transactions', 'fee_cents', 'INTEGER NOT NULL DEFAULT 0']
];

function columnExists(table, column) {
  const result = database.exec(`PRAGMA table_info(${table})`);

  if (!result.length) return false;

  const nameIndex = result[0].columns.indexOf('name');
  return result[0].values.some((row) => row[nameIndex] === column);
}

function applyMigrations() {
  for (const [table, column, definition] of MIGRATIONS) {
    if (!columnExists(table, column)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  // Existing installs created events before KES became the platform default.
  database.exec(`
    UPDATE events SET currency = 'KES'
    WHERE currency IS NULL OR currency = '' OR currency = 'USD'
  `);
}

async function initializeDatabase() {
  if (database) return db;

  const SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file)
  });

  if (fs.existsSync(DB_FILE)) {
    const buffer = fs.readFileSync(DB_FILE);
    database = new SQL.Database(buffer);
  } else {
    database = new SQL.Database();
  }

  database.run('PRAGMA foreign_keys = ON');
  database.exec(SCHEMA);
  applyMigrations();
  saveDatabase();

  return db;
}

module.exports = db;
module.exports.initializeDatabase = initializeDatabase;
module.exports.saveDatabase = saveDatabase;
