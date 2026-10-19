/**
 * Where the app keeps its data.
 *
 * Both locations are configurable so a deployment can point them at a mounted
 * volume (Render disks, Fly volumes, a Docker bind mount, /var/lib on a VPS)
 * and survive redeploys. Defaults stay inside the repo for local use.
 */
const path = require('path');

/** SQLite file directory. */
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

/** Uploaded media (covers, avatars, videos). */
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, 'uploads');

/** The database file itself, if a deployment wants to name it. */
const DB_FILE = process.env.DB_FILE
  ? path.resolve(process.env.DB_FILE)
  : path.join(DATA_DIR, 'eventtracker.db');

module.exports = { DATA_DIR, UPLOADS_DIR, DB_FILE };
