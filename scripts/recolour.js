/**
 * Recolour an existing install.
 *
 * Category colours live in the database and the cover/avatar artwork was
 * generated with the old palette, so switching to the graphite theme would
 * otherwise leave orange behind on an install that already has data. This
 * rewrites both in place — no data is dropped and it is safe to run twice.
 *
 *   npm run recolour
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const db = require('../server/db');
const { initializeDatabase, saveDatabase } = require('../server/db');

const { UPLOADS_DIR: UPLOADS } = require('../server/paths');

/** Copper-era hex → graphite equivalent, per generated artwork family. */
const COLOUR_MAP = {
  // cover gradients, per category
  '#2a1220': '#141416', '#552040': '#2c2c31',   // music
  '#191919': '#101012', '#3a3a3a': '#242428',   // technology
  '#1f2110': '#17171a', '#454c22': '#313137',   // sports
  '#221a14': '#121214', '#453427': '#27272c',   // business
  '#2b1a0c': '#1a1a1d', '#5e3413': '#333339',   // food
  '#2a1210': '#151517', '#5c231c': '#2e2e33',   // arts
  '#141f10': '#131315', '#2b4520': '#292a2e',   // community
  '#11201c': '#18181b', '#26453c': '#34343a',   // wellness
  // avatar backgrounds
  '#4a4a4a': '#2f2f35', '#7a4a2a': '#43434b', '#3f7a68': '#54545c',
  '#a3541c': '#38383e', '#96325f': '#4d4d55', '#6b5540': '#2a2a30',
  '#8a4a17': '#1c1c20', '#427a34': '#3a3a41', '#6c7326': '#616169',
  '#9c3b32': '#232328',
};

const CATEGORY_COLOURS = {
  music: ['#1c1c20', 'linear-gradient(135deg,#1c1c20,#3a3a41)'],
  technology: ['#2f2f35', 'linear-gradient(135deg,#2f2f35,#4d4d55)'],
  sports: ['#43434b', 'linear-gradient(135deg,#43434b,#616169)'],
  business: ['#54545c', 'linear-gradient(135deg,#54545c,#6e6e76)'],
  food: ['#232328', 'linear-gradient(135deg,#232328,#414149)'],
  arts: ['#3a3a41', 'linear-gradient(135deg,#3a3a41,#55555d)'],
  community: ['#2a2a30', 'linear-gradient(135deg,#2a2a30,#4a4a52)'],
  wellness: ['#4d4d55', 'linear-gradient(135deg,#4d4d55,#6a6a72)'],
};

const HEX = /#[0-9a-fA-F]{6}\b/g;

function recolourFile(file) {
  const before = fs.readFileSync(file, 'utf8');
  let touched = 0;

  const after = before.replace(HEX, (match) => {
    const replacement = COLOUR_MAP[match.toLowerCase()];
    if (!replacement) return match;
    touched += 1;
    return replacement;
  });

  if (!touched) return 0;
  fs.writeFileSync(file, after);
  return touched;
}

function recolourArtwork() {
  if (!fs.existsSync(UPLOADS)) return { files: 0, colours: 0 };

  let files = 0;
  let colours = 0;

  for (const dir of fs.readdirSync(UPLOADS, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const full = path.join(UPLOADS, dir.name);

    for (const entry of fs.readdirSync(full)) {
      if (!entry.toLowerCase().endsWith('.svg')) continue;   // only generated art
      const changed = recolourFile(path.join(full, entry));
      if (changed) {
        files += 1;
        colours += changed;
      }
    }
  }

  return { files, colours };
}

async function main() {
  await initializeDatabase();

  let categories = 0;
  for (const [slug, [color, gradient]] of Object.entries(CATEGORY_COLOURS)) {
    const info = db.prepare('UPDATE categories SET color = ?, gradient = ? WHERE slug = ?')
      .run(color, gradient, slug);
    categories += info.changes || 0;
  }

  const artwork = recolourArtwork();
  saveDatabase();

  console.log(`  categories recoloured : ${categories}`);
  console.log(`  artwork files rewritten: ${artwork.files} (${artwork.colours} colour values)`);

  const left = db.prepare('SELECT COUNT(*) AS n FROM categories WHERE color LIKE ?').get('#%');
  console.log(`  categories with a colour: ${left.n}`);
  console.log('\n  Done. Restart the server so its in-memory copy of the database is fresh.\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
