/**
 * EventTracker seed — demo dataset.
 *
 *   npm run seed        (skips when data already exists)
 *   npm run reset-db    (wipes and re-seeds)
 *
 * Everything is generated locally: cover art and avatars are written as SVG
 * files into server/uploads, so the app looks complete with zero external
 * assets or network access.
 *
 * Prices are in Kenyan Shillings (KES) and payments use the same ledger the
 * live M-Pesa / card integrations write to.
 */
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');

/**
 * Platform commission on ticket sales, in percent of the ticket subtotal.
 * Mirrors the `service_fee_percent` setting the payment flow reads, so the
 * seeded ledger carries the same fee an organiser would pay live.
 */
const SERVICE_FEE_PERCENT = 5;
const DB_FILE = path.join(DATA_DIR, 'eventtracker.db');

if (process.argv.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_FILE + suffix, { force: true });
  console.log('· existing database removed');
}

const db = require('./db');
const ticketService = require('./services/tickets');

async function main() {
  await require('./db').initializeDatabase();

  const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (existing > 0) {
  console.log('Database already contains data. Use "npm run reset-db" to wipe and re-seed.');
  process.exit(0);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const { UPLOADS_DIR: UPLOADS } = require('./paths');
const COVERS = path.join(UPLOADS, 'covers');
const AVATARS = path.join(UPLOADS, 'avatars');
const VIDEOS = path.join(UPLOADS, 'videos');
for (const dir of [UPLOADS, COVERS, AVATARS, VIDEOS]) fs.mkdirSync(dir, { recursive: true });

const sqlTime = (date) => new Date(date).toISOString().slice(0, 19).replace('T', ' ');

/** Future date helper — `days` from now, at a given hour. */
function at(days, hour = 19, minutes = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minutes, 0, 0);
  return d;
}

function pick(list, index) {
  return list[index % list.length];
}

/**
 * Editorial cover art: a muted duotone base, one geometric motif and a
 * restrained corner wordmark. Deliberately low-contrast so event photos and
 * text sit comfortably on top.
 */
function coverSVG({ from, to, motif = 'waves', label = '', tone = 'dark' }) {
  const text = String(label).toUpperCase().slice(0, 22);
  const ink = tone === 'dark' ? '#ffffff' : '#141414';
  const inkOpacity = tone === 'dark' ? 0.62 : 0.55;

  const motifs = {
    waves: `
      <path d="M0 430 Q 300 370 600 430 T 1200 430" stroke="${ink}" stroke-opacity="0.14" stroke-width="1.5" fill="none"/>
      <path d="M0 480 Q 300 420 600 480 T 1200 480" stroke="${ink}" stroke-opacity="0.10" stroke-width="1.5" fill="none"/>
      <path d="M0 530 Q 300 470 600 530 T 1200 530" stroke="${ink}" stroke-opacity="0.07" stroke-width="1.5" fill="none"/>`,
    rings: `
      <g fill="none" stroke="${ink}" stroke-opacity="0.12">
        <circle cx="880" cy="250" r="150" stroke-width="1.5"/>
        <circle cx="880" cy="250" r="105" stroke-width="1.5"/>
        <circle cx="880" cy="250" r="62" stroke-width="1.5"/>
      </g>`,
    grid: `
      <g stroke="${ink}" stroke-opacity="0.08" stroke-width="1">
        ${Array.from({ length: 9 }, (_, i) => `<line x1="${140 + i * 110}" y1="120" x2="${140 + i * 110}" y2="560"/>`).join('')}
        ${Array.from({ length: 5 }, (_, i) => `<line x1="120" y1="${140 + i * 100}" x2="1080" y2="${140 + i * 100}"/>`).join('')}
      </g>`,
    steps: `
      <g fill="${ink}" fill-opacity="0.07">
        <rect x="150" y="380" width="150" height="180"/>
        <rect x="330" y="320" width="150" height="240"/>
        <rect x="510" y="260" width="150" height="300"/>
        <rect x="690" y="200" width="150" height="360"/>
        <rect x="870" y="150" width="150" height="410"/>
      </g>`,
    arcs: `
      <g fill="none" stroke="${ink}" stroke-opacity="0.13" stroke-width="1.5">
        <path d="M120 560 A 300 300 0 0 1 420 260"/>
        <path d="M320 560 A 300 300 0 0 1 620 260"/>
        <path d="M520 560 A 300 300 0 0 1 820 260"/>
      </g>`,
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
    <linearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="45%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.42"/>
    </linearGradient>
    <radialGradient id="sheen" cx="0.22" cy="0.18" r="0.75">
      <stop offset="0%" stop-color="#fff" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="675" fill="url(#base)"/>
  <rect width="1200" height="675" fill="url(#sheen)"/>
  ${motifs[motif] || motifs.waves}
  <rect width="1200" height="675" fill="url(#veil)"/>
  ${text ? `<text x="72" y="596" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-size="30" letter-spacing="7" fill="${ink}" fill-opacity="${inkOpacity}">${text}</text>` : ''}
</svg>`;
}

/** Profile artwork: initials on a muted field. */
function avatarSVG(initials, bg, fg = '#ffffff') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="${bg}"/>
  <circle cx="196" cy="60" r="86" fill="#ffffff" fill-opacity="0.07"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
        font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-size="96" font-weight="600"
        fill="${fg}" fill-opacity="0.92">${initials}</text>
</svg>`;
}

function writeCover(file, svg) {
  fs.writeFileSync(path.join(COVERS, file), svg);
  return `/uploads/covers/${file}`;
}

function writeAvatar(file, svg) {
  fs.writeFileSync(path.join(AVATARS, file), svg);
  return `/uploads/avatars/${file}`;
}

/* ------------------------------------------------------------------ *
 * Categories
 * ------------------------------------------------------------------ */

const CATEGORIES = [
  { name: 'Music', slug: 'music', icon: 'music', color: '#1c1c20', gradient: 'linear-gradient(135deg,#1c1c20,#3a3a41)', description: 'Live bands, DJ sets, listening rooms and festivals.' },
  { name: 'Technology', slug: 'technology', icon: 'cpu', color: '#2f2f35', gradient: 'linear-gradient(135deg,#2f2f35,#4d4d55)', description: 'Meetups, hackathons, workshops and product launches.' },
  { name: 'Sports', slug: 'sports', icon: 'activity', color: '#43434b', gradient: 'linear-gradient(135deg,#43434b,#616169)', description: 'Runs, rides, tournaments and training sessions.' },
  { name: 'Business', slug: 'business', icon: 'briefcase', color: '#54545c', gradient: 'linear-gradient(135deg,#54545c,#6e6e76)', description: 'Founder meetups, pitch nights and finance clinics.' },
  { name: 'Food', slug: 'food', icon: 'utensils', color: '#232328', gradient: 'linear-gradient(135deg,#232328,#414149)', description: 'Supper clubs, markets, tastings and cooking classes.' },
  { name: 'Arts', slug: 'arts', icon: 'palette', color: '#3a3a41', gradient: 'linear-gradient(135deg,#3a3a41,#55555d)', description: 'Exhibitions, theatre, film and spoken word.' },
  { name: 'Community', slug: 'community', icon: 'users', color: '#2a2a30', gradient: 'linear-gradient(135deg,#2a2a30,#4a4a52)', description: 'Clean-ups, volunteer days, camps and neighbourhood meetups.' },
  { name: 'Wellness', slug: 'wellness', icon: 'heart', color: '#4d4d55', gradient: 'linear-gradient(135deg,#4d4d55,#6a6a72)', description: 'Yoga, breathwork, sound baths and retreats.' },
];

const CATEGORY_COVERS = {
  music: { from: '#141416', to: '#2c2c31', motif: 'waves' },
  technology: { from: '#101012', to: '#242428', motif: 'grid' },
  sports: { from: '#17171a', to: '#313137', motif: 'arcs' },
  business: { from: '#121214', to: '#27272c', motif: 'steps' },
  food: { from: '#1a1a1d', to: '#333339', motif: 'rings' },
  arts: { from: '#151517', to: '#2e2e33', motif: 'rings' },
  community: { from: '#131315', to: '#292a2e', motif: 'waves' },
  wellness: { from: '#18181b', to: '#34343a', motif: 'arcs' },
};

{
  const insert = db.prepare(`
    INSERT INTO categories (name, slug, description, icon, color, gradient) VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const c of CATEGORIES) insert.run(c.name, c.slug, c.description, c.icon, c.color, c.gradient);
}
const categoryId = Object.fromEntries(
  db.prepare('SELECT id, slug FROM categories').all().map((r) => [r.slug, r.id])
);
console.log(`· ${CATEGORIES.length} categories`);

/* ------------------------------------------------------------------ *
 * Users
 * ------------------------------------------------------------------ */

const PASSWORD = 'password123';
const passwordHash = bcrypt.hashSync(PASSWORD, 10);

const USERS = [
  { key: 'admin', name: 'Amina Wanjiru', username: 'amina', email: 'admin@eventtracker.app', role: 'admin', location: 'Nairobi, Kenya', bio: 'Platform operations at EventTracker. Here to help organisers ship great events.', interests: 'technology,business,community' },
  { key: 'daniel', name: 'Daniel Mwangi', username: 'daniel', email: 'daniel@eventtracker.app', role: 'organizer', location: 'Nairobi, Kenya', bio: 'Promoter and sound engineer. 60+ shows across Nairobi since 2016.', interests: 'music,arts' },
  { key: 'zawadi', name: 'Zawadi Achieng', username: 'zawadi', email: 'zawadi@eventtracker.app', role: 'organizer', location: 'Kisumu, Kenya', bio: 'Community organiser. Markets, clean-ups and lakefront art walks.', interests: 'community,arts,food' },
  { key: 'kamau', name: 'Peter Kamau', username: 'kamau', email: 'kamau@eventtracker.app', role: 'organizer', location: 'Nairobi, Kenya', bio: 'Race director. Weekend runs and trail rides around the Rift.', interests: 'sports,wellness' },
  { key: 'fatuma', name: 'Fatuma Hassan', username: 'fatuma', email: 'fatuma@eventtracker.app', role: 'organizer', location: 'Mombasa, Kenya', bio: 'Chef and coastal food curator. Swahili suppers, spice markets.', interests: 'food,community' },
  { key: 'njeri', name: 'Njeri Karanja', username: 'njeri', email: 'njeri@eventtracker.app', role: 'user', location: 'Nairobi, Kenya', bio: 'Product designer. Rarely misses a workshop or a gallery opening.', interests: 'technology,arts' },
  { key: 'brian', name: 'Brian Otieno', username: 'brian', email: 'brian@eventtracker.app', role: 'user', location: 'Nairobi, Kenya', bio: 'Backend engineer. Runs at 6am, ships at 9.', interests: 'technology,sports' },
  { key: 'wanjiku', name: 'Grace Wanjiku', username: 'wanjiku', email: 'wanjiku@eventtracker.app', role: 'user', location: 'Nakuru, Kenya', bio: 'Yoga teacher in training and full-time coffee person.', interests: 'wellness,food' },
  { key: 'omar', name: 'Omar Yusuf', username: 'omar', email: 'omar@eventtracker.app', role: 'user', location: 'Mombasa, Kenya', bio: 'Photographer. Usually at the coast, occasionally on a matatu upcountry.', interests: 'arts,community' },
  { key: 'lucia', name: 'Lucia Mwende', username: 'lucia', email: 'lucia@eventtracker.app', role: 'organizer', location: 'Nairobi, Kenya', bio: 'Founder community lead. Breakfasts, pitch nights and finance clinics.', interests: 'business,technology' },
];

const AVATAR_COLORS = ['#2f2f35', '#43434b', '#54545c', '#38383e', '#4d4d55', '#2a2a30', '#1c1c20', '#3a3a41', '#616169', '#232328'];
const userId = {};

USERS.forEach((u, index) => {
  const initials = u.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const avatarUrl = writeAvatar(`${u.username}.svg`, avatarSVG(initials, AVATAR_COLORS[index % AVATAR_COLORS.length]));

  const info = db.prepare(`
    INSERT INTO users (name, username, email, password_hash, bio, location, phone, avatar_url, role, interests)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    u.name, u.username, u.email, passwordHash, u.bio, u.location,
    `+2547${String(10000000 + index * 111111).slice(0, 8)}`,
    avatarUrl, u.role, u.interests
  );
  userId[u.key] = info.lastInsertRowid;
});
console.log(`· ${USERS.length} users`);

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

const EVENTS = [
  {
    title: 'Jazz at the Arboretum',
    tagline: 'An evening of live jazz under the fig trees',
    category: 'music', host: 'daniel', days: 6, hour: 18, durationHours: 4,
    venue: 'Nairobi Arboretum, Main Lawn', city: 'Nairobi', country: 'Kenya',
    description: 'Five bands, one lawn, and the best sunset in Nairobi. Bring a blanket and arrive early — the main stage fills up quickly. Food and drinks are available on site, and the acoustic tent opens at 17:30 for anyone who prefers to sit close to the strings.\n\nGates close at 21:00. Under-16s are welcome with a guardian.',
    tags: 'jazz,live music,outdoors',
    capacity: 1200,
    tiers: [
      { name: 'Early bird', price: 150000, quantity: 300, limit: 4, description: 'Sold out on the previous edition in three days.' },
      { name: 'Standard entry', price: 250000, quantity: 700, limit: 8 },
      { name: 'Lawn table (4 guests)', price: 1200000, quantity: 50, limit: 2, description: 'Reserved table, four chairs and a welcome platter.' },
    ],
  },
  {
    title: 'Founders Breakfast #12',
    tagline: 'Small-room conversations with people building in Nairobi',
    category: 'business', host: 'lucia', days: 3, hour: 7, durationHours: 3,
    venue: 'The Alchemist, Westlands', city: 'Nairobi', country: 'Kenya',
    description: 'Twelve founders, one long table, no slides. Each breakfast has a single question we work through together, then open discussion over coffee.\n\nThis month: "What did you get badly wrong in your first year — and what fixed it?"',
    tags: 'startups,networking,breakfast',
    capacity: 60,
    tiers: [
      { name: 'General seat', price: 0, quantity: 40, limit: 2 },
      { name: 'Table host (includes breakfast)', price: 250000, quantity: 12, limit: 1, description: 'Host a table of six and help steer the conversation.' },
    ],
  },
  {
    title: 'Rift Valley Trail Ride',
    tagline: '42 km of gravel above the escarpment',
    category: 'sports', host: 'kamau', days: 12, hour: 6, durationHours: 7,
    venue: 'Naivasha Country Club (start)', city: 'Naivasha', country: 'Kenya',
    description: 'A supported 42 km ride on gravel and farm roads, with two water points, a mechanic van and a sag wagon. Two distances: 42 km for the full loop or 22 km for the gentle version.\n\nHelmets are compulsory. Bikes can be hired on site if you register at least three days ahead.',
    tags: 'cycling,gravel,outdoors',
    capacity: 300,
    tiers: [
      { name: '22 km entry', price: 180000, quantity: 120, limit: 4 },
      { name: '42 km entry', price: 280000, quantity: 150, limit: 4 },
      { name: 'Team of four (42 km)', price: 980000, quantity: 20, limit: 1 },
    ],
  },
  {
    title: 'Street Food Night Market',
    tagline: 'Thirty vendors, one car park, every Friday',
    category: 'food', host: 'zawadi', days: 1, hour: 17, durationHours: 5,
    venue: 'Kenyatta Avenue Car Park', city: 'Nairobi', country: 'Kenya',
    description: 'Smokies, mishkaki, biryani, mandazi and a rotating list of guest kitchens. Live DJ from 19:00, seating for 400, and a kids corner with two minders.\n\nEntry is free — pay the vendors directly. Bring cash or your mobile wallet.',
    tags: 'street food,market,family',
    capacity: 2000,
    tiers: [{ name: 'Free entry', price: 0, quantity: 2000, limit: 10 }],
  },
  {
    title: 'Kisumu Lakeside Art Walk',
    tagline: 'Twelve studios open along the lakefront',
    category: 'arts', host: 'zawadi', days: 9, hour: 10, durationHours: 8,
    venue: 'Dunga Beach & Lakefront Studios', city: 'Kisumu', country: 'Kenya',
    description: 'A self-guided walk between twelve working studios, with three guided departures from Dunga Beach at 10:00, 12:30 and 15:00. Painters, ceramicists, photographers and one very loud printmaker.\n\nTickets include a printed map and a boat ride back across the bay.',
    tags: 'art,walk,lakefront',
    capacity: 400,
    tiers: [
      { name: 'Standard', price: 80000, quantity: 300, limit: 6 },
      { name: 'Guided walk + boat', price: 150000, quantity: 100, limit: 4 },
    ],
  },
  {
    title: 'Yoga at Sunrise: Karura Forest',
    tagline: 'Sixty minutes of slow movement before the city wakes',
    category: 'wellness', host: 'wanjiku', days: 4, hour: 6, durationHours: 2,
    venue: 'Karura Forest, River Café Deck', city: 'Nairobi', country: 'Kenya',
    description: 'A gentle vinyasa practice on the deck, followed by tea and fruit. Mats are provided but feel free to bring your own. All levels welcome — the first twenty minutes stay close to the ground.\n\nWe finish by 07:30 so you can beat the traffic.',
    tags: 'yoga,wellness,sunrise',
    capacity: 80,
    tiers: [
      { name: 'Mat included', price: 120000, quantity: 60, limit: 3 },
      { name: 'Bring your own mat', price: 80000, quantity: 20, limit: 3 },
    ],
  },
  {
    title: 'Pitch Night: Cohort 7',
    tagline: 'Eight teams, five minutes each, one honest audience',
    category: 'business', host: 'lucia', days: 8, hour: 17, durationHours: 4,
    venue: 'iHub, Senteu Plaza', city: 'Nairobi', country: 'Kenya',
    description: 'The closing night of our seventh incubation cohort. Eight teams pitch to investors, operators and anyone curious about what is being built in Nairobi right now.\n\nDoors 17:00, pitches 18:00, networking until late. Drinks and snacks included.',
    tags: 'pitch,investors,startups',
    capacity: 350,
    tiers: [
      { name: 'Community (free)', price: 0, quantity: 250, limit: 4 },
      { name: 'Front row + investor mixer', price: 200000, quantity: 60, limit: 2 },
    ],
  },
  {
    title: 'Design Systems Workshop',
    tagline: 'A full day building a component library that survives contact with product',
    category: 'technology', host: 'njeri', days: 16, hour: 9, durationHours: 9,
    venue: 'Moringa School, Ngong Road', city: 'Nairobi', country: 'Kenya',
    description: 'Hands-on, laptop required. We cover tokens, layout primitives, accessible components, documentation and the governance question nobody enjoys: who owns the library?\n\nYou leave with a working starter repository and a written migration plan for your own product.',
    tags: 'design,engineering,workshop',
    capacity: 40,
    tiers: [
      { name: 'Individual', price: 650000, quantity: 25, limit: 2 },
      { name: 'Team pass (3 seats)', price: 1650000, quantity: 5, limit: 1, description: 'Three seats plus a 45-minute team review after the workshop.' },
    ],
  },
  {
    title: 'Swahili Coastal Supper',
    tagline: 'A seven-course tasting menu from Lamu to Zanzibar',
    category: 'food', host: 'fatuma', days: 11, hour: 19, durationHours: 3,
    venue: 'Forodhani Courtyard', city: 'Mombasa', country: 'Kenya',
    description: 'One long table in a courtyard off the old town. Seven courses tracing the coastal trade routes — coconut, tamarind, cardamom, grilled fish and a dessert you will think about for weeks.\n\nTwenty-eight seats only. Tell us about allergies when you book.',
    tags: 'supper club,tasting menu,coastal',
    capacity: 28,
    tiers: [
      { name: 'Dinner seat', price: 750000, quantity: 22, limit: 2 },
      { name: 'Dinner + wine pairing', price: 1050000, quantity: 6, limit: 2 },
    ],
  },
  {
    title: 'Mombasa Beach Clean-Up',
    tagline: 'Two hours of work, one very good sundowner',
    category: 'community', host: 'fatuma', days: 5, hour: 15, durationHours: 5,
    venue: 'Pirates Beach, Bamburi', city: 'Mombasa', country: 'Kenya',
    description: 'Gloves, bags and grabbers provided — we just need hands. We clear roughly 400 m of shoreline, weigh what we collect and log it with the county team.\n\nStick around afterwards: there is a sundowner and a short talk from the marine conservation unit.',
    tags: 'volunteer,beach,environment',
    capacity: 250,
    tiers: [{ name: 'Free registration', price: 0, quantity: 250, limit: 6 }],
  },
  {
    title: 'Blankets & Wine: Karura Sessions',
    tagline: 'The long-running Sunday picnic concert',
    category: 'music', host: 'daniel', days: 20, hour: 13, durationHours: 7,
    venue: 'Karura Forest, Main Field', city: 'Nairobi', country: 'Kenya',
    description: 'Four acts across two stages, food trucks around the perimeter and a strictly enforced "no rushing" policy. Bring a blanket, a hat and your people.\n\nChildren under 12 enter free. Re-entry is allowed with your wristband.',
    tags: 'festival,picnic,live music',
    capacity: 3000,
    tiers: [
      { name: 'Early bird', price: 280000, quantity: 600, limit: 6 },
      { name: 'Advance', price: 350000, quantity: 1800, limit: 8 },
      { name: 'Gate', price: 450000, quantity: 600, limit: 8 },
    ],
  },
  {
    title: 'Nakuru Rift Half Marathon',
    tagline: '21 km, 10 km and a 5 km family loop',
    category: 'sports', host: 'kamau', days: 26, hour: 6, durationHours: 6,
    venue: 'Nakuru Athletic Club', city: 'Nakuru', country: 'Kenya',
    description: 'A fast, flat course starting at the athletic club and looping around the lake basin. Chip timing, four water points, physio at the finish and a very serious breakfast.\n\nRace pack collection opens the day before at the club pavilion.',
    tags: 'running,marathon,family',
    capacity: 2500,
    tiers: [
      { name: '5 km fun run', price: 120000, quantity: 800, limit: 6 },
      { name: '10 km', price: 180000, quantity: 900, limit: 4 },
      { name: 'Half marathon', price: 250000, quantity: 800, limit: 4 },
    ],
  },
  {
    title: 'Breathwork & Sound Bath',
    tagline: 'Ninety minutes of guided breath and deep rest',
    category: 'wellness', host: 'wanjiku', days: 2, hour: 18, durationHours: 2,
    venue: 'The Sanctuary, Kilimani', city: 'Nairobi', country: 'Kenya',
    description: 'A short guided breath practice followed by a sound bath with singing bowls, gongs and a very large drum. You lie down for most of it — bring socks and a layer.\n\nNot suitable during pregnancy or with a history of seizure; message us and we will suggest an alternative session.',
    tags: 'breathwork,sound bath,rest',
    capacity: 45,
    tiers: [{ name: 'Session ticket', price: 200000, quantity: 45, limit: 2 }],
  },
  {
    title: 'SME Finance Clinic',
    tagline: 'Bring your books, leave with a plan',
    category: 'business', host: 'zawadi', days: 14, hour: 14, durationHours: 4,
    venue: 'Lakeview Business Hub', city: 'Kisumu', country: 'Kenya',
    description: 'Four advisors from a local SACCO, a bank and two accounting firms run twenty-minute clinics. Bring last year’s books, your loan question and your registration certificate.\n\nFree to attend, but slots are limited and confirmed by email.',
    tags: 'finance,sme,clinic',
    capacity: 120,
    tiers: [{ name: 'Free clinic slot', price: 0, quantity: 120, limit: 2 }],
  },
  {
    title: 'Short Films Night',
    tagline: 'Nine Kenyan shorts, one jury, and you',
    category: 'arts', host: 'omar', days: 7, hour: 18, durationHours: 4,
    venue: 'Alliance Française, Auditorium', city: 'Nairobi', country: 'Kenya',
    description: 'Nine short films from emerging Kenyan directors, followed by a Q&A and the audience award. Two programmes: the main slate at 18:30 and a late experimental set at 21:00.\n\nSubtitles in English and Kiswahili on every film.',
    tags: 'film,cinema,shorts',
    capacity: 300,
    tiers: [
      { name: 'Main slate', price: 100000, quantity: 220, limit: 4 },
      { name: 'Full pass (both programmes)', price: 160000, quantity: 80, limit: 4 },
    ],
  },
  {
    title: 'Community Health Camp',
    tagline: 'Free screenings, dental checks and maternal care',
    category: 'community', host: 'amina', days: 17, hour: 8, durationHours: 8,
    venue: 'Nakuru Community Grounds', city: 'Nakuru', country: 'Kenya',
    description: 'A full day of free services: blood pressure and sugar checks, eye tests, dental screening for children, maternal health consultations and a pharmacy counter with basic medication.\n\nNo appointment needed. Registration is only used to plan the queue.',
    tags: 'health,community,free',
    capacity: 1500,
    tiers: [{ name: 'Free registration', price: 0, quantity: 1500, limit: 10 }],
  },
  {
    title: 'Nairobi Product Meetup',
    tagline: 'Three case studies on shipping in constrained environments',
    category: 'technology', host: 'njeri', days: 10, hour: 18, durationHours: 3,
    venue: 'Senteu Plaza, 4th Floor', city: 'Nairobi', country: 'Kenya',
    description: 'Three product teams walk through what they shipped, what broke and how they decided what to cut. No vendor pitches, no recruiting talks — just the work.\n\nRefreshments from 18:00, talks start at 18:30.',
    tags: 'product,meetup,engineering',
    capacity: 150,
    tiers: [{ name: 'Free ticket', price: 0, quantity: 150, limit: 3 }],
  },
  {
    title: 'Rooftop Sundowner Sessions',
    tagline: 'Deep house, city lights and a very long sunset',
    category: 'music', host: 'daniel', days: 22, hour: 17, durationHours: 6,
    venue: 'Westlands Rooftop, 7th Floor', city: 'Nairobi', country: 'Kenya',
    description: 'Three DJs, two bars and a rooftop looking west over the city. Capacity is deliberately small so there is always room to dance.\n\nStrictly 21+. Smart casual — no slippers after 20:00.',
    tags: 'dj,house,rooftop',
    capacity: 220,
    tiers: [
      { name: 'Advance', price: 150000, quantity: 180, limit: 4 },
      { name: 'Table of four', price: 900000, quantity: 10, limit: 1 },
    ],
  },
  // Past events — keep the platform from looking empty on day one.
  {
    title: 'Nairobi Coffee Expo',
    tagline: 'Three days of roasters, cuppings and very good espresso',
    category: 'food', host: 'fatuma', days: -18, hour: 9, durationHours: 8,
    venue: 'Sarit Expo Centre', city: 'Nairobi', country: 'Kenya',
    description: 'A weekend of Kenyan and East African roasters, cupping tables, latte art throwdowns and a serious filter bar. Thank you to everyone who came through.',
    tags: 'coffee,expo,tasting',
    capacity: 900,
    tiers: [
      { name: 'Day pass', price: 90000, quantity: 500, limit: 6 },
      { name: 'Weekend pass', price: 150000, quantity: 400, limit: 4 },
    ],
  },
  {
    title: 'Lake Victoria Fish Festival',
    tagline: 'Two days of lake fish, boats and a very competitive grill-off',
    category: 'community', host: 'zawadi', days: -34, hour: 10, durationHours: 9,
    venue: 'Dunga Beach', city: 'Kisumu', country: 'Kenya',
    description: 'Fisherfolk, chefs and boat crews from across the lake. The grill-off final went to a tiebreak. See you next season.',
    tags: 'festival,lake,food',
    capacity: 1800,
    tiers: [{ name: 'Entry', price: 50000, quantity: 1800, limit: 8 }],
  },
];

function hostKeyFor(key) {
  return userId[key] ? key : 'njeri';
}

const eventIds = [];

EVENTS.forEach((event, index) => {
  const slug = event.category;
  const cover = CATEGORY_COVERS[slug] || CATEGORY_COVERS.music;
  const variant = index % 3;
  const from = variant === 0 ? cover.from : variant === 1 ? cover.to : cover.from;
  const imageUrl = writeCover(
    `event-${String(index + 1).padStart(2, '0')}-${slug}.svg`,
    coverSVG({ from, to: cover.to, motif: cover.motif, label: CATEGORIES.find((c) => c.slug === slug)?.name })
  );

  const starts = at(event.days, event.hour);
  const ends = new Date(starts.getTime() + (event.durationHours || 3) * 3600_000);
  const minPrice = Math.min(...event.tiers.map((t) => t.price));

  const info = db.prepare(`
    INSERT INTO events (title, tagline, description, category_id, host_id, venue, city, country,
                        starts_at, ends_at, price_cents, currency, capacity, image_url, video_url,
                        tags, contact_email, contact_phone, status, is_featured, views, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'KES', ?, ?, '', ?, ?, ?, 'published', ?, ?, ?)
  `).run(
    event.title,
    event.tagline,
    event.description,
    categoryId[slug],
    userId[hostKeyFor(event.host)],
    event.venue,
    event.city,
    event.country,
    sqlTime(starts),
    sqlTime(ends),
    minPrice,
    event.capacity,
    imageUrl,
    event.tags,
    `events@${event.city.toLowerCase()}.ke`,
    '+254 700 000 000',
    index % 5 === 0 ? 1 : 0,
    400 + index * 37,
    sqlTime(new Date(Date.now() - (30 - index) * 86400_000))
  );

  const eventId = info.lastInsertRowid;
  eventIds.push(eventId);

  const insertTier = db.prepare(`
    INSERT INTO ticket_types (event_id, name, description, price_cents, currency, quantity, sold, per_user_limit, sort_order)
    VALUES (?, ?, ?, ?, 'KES', ?, 0, ?, ?)
  `);

  event.tiers.forEach((tier, tierIndex) => {
    insertTier.run(
      eventId, tier.name, tier.description || '', tier.price, tier.quantity,
      tier.limit || 8, tierIndex
    );
  });
});
console.log(`· ${EVENTS.length} events with ticket tiers`);

/* ------------------------------------------------------------------ *
 * Social graph: follows, RSVPs, saves, event follows, comments
 * ------------------------------------------------------------------ */

{
  const insert = db.prepare('INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)');
  const graph = [
    ['njeri', 'daniel'], ['njeri', 'lucia'], ['njeri', 'zawadi'],
    ['brian', 'lucia'], ['brian', 'daniel'], ['brian', 'njeri'],
    ['wanjiku', 'kamau'], ['wanjiku', 'zawadi'],
    ['omar', 'fatuma'], ['omar', 'zawadi'],
    ['zawadi', 'fatuma'], ['fatuma', 'omar'],
    ['lucia', 'njeri'], ['kamau', 'wanjiku'], ['daniel', 'zawadi'],
    ['njeri', 'kamau'], ['wanjiku', 'fatuma'],
  ];
  for (const [a, b] of graph) insert.run(userId[a], userId[b]);
}

const RSVPS = [
  [0, 'njeri', 'going'], [0, 'brian', 'going'], [0, 'omar', 'interested'], [0, 'wanjiku', 'going'],
  [1, 'njeri', 'going'], [1, 'brian', 'going'],
  [2, 'wanjiku', 'going'], [2, 'brian', 'going'], [2, 'njeri', 'interested'],
  [3, 'njeri', 'going'], [3, 'brian', 'going'], [3, 'omar', 'going'], [3, 'wanjiku', 'interested'],
  [4, 'omar', 'going'], [4, 'njeri', 'interested'],
  [5, 'wanjiku', 'going'], [5, 'njeri', 'going'],
  [6, 'brian', 'going'], [6, 'njeri', 'going'],
  [7, 'njeri', 'going'], [7, 'brian', 'interested'],
  [8, 'omar', 'going'], [8, 'wanjiku', 'interested'],
  [9, 'omar', 'going'], [9, 'njeri', 'going'],
  [10, 'njeri', 'going'], [10, 'brian', 'going'], [10, 'wanjiku', 'going'], [10, 'omar', 'interested'],
  [11, 'wanjiku', 'going'], [11, 'brian', 'going'],
  [12, 'wanjiku', 'going'], [12, 'njeri', 'interested'],
  [13, 'brian', 'going'], [13, 'njeri', 'going'],
  [14, 'omar', 'going'], [14, 'njeri', 'going'],
  [16, 'brian', 'going'], [16, 'njeri', 'going'],
  [17, 'njeri', 'going'], [17, 'brian', 'going'],
];

{
  const insert = db.prepare('INSERT OR IGNORE INTO rsvps (event_id, user_id, status) VALUES (?, ?, ?)');
  for (const [idx, who, status] of RSVPS) insert.run(eventIds[idx], userId[who], status);
}

{
  const insert = db.prepare('INSERT OR IGNORE INTO saves (event_id, user_id) VALUES (?, ?)');
  const saved = [[0, 'njeri'], [2, 'brian'], [7, 'njeri'], [10, 'wanjiku'], [11, 'brian'], [14, 'nijeri'], [16, 'njeri']];
  for (const [idx, who] of saved) {
    if (userId[who]) insert.run(eventIds[idx], userId[who]);
  }
}

{
  const insert = db.prepare('INSERT OR IGNORE INTO event_follows (event_id, user_id) VALUES (?, ?)');
  const following = [
    [0, 'njeri'], [0, 'brian'], [0, 'wanjiku'], [0, 'omar'],
    [1, 'brian'], [1, 'njeri'],
    [7, 'brian'], [7, 'njeri'], [7, 'lucia'],
    [10, 'njeri'], [10, 'brian'], [10, 'wanjiku'], [10, 'omar'], [10, 'fatuma'],
    [11, 'wanjiku'], [16, 'njeri'],
  ];
  for (const [idx, who] of following) insert.run(eventIds[idx], userId[who]);
}

const COMMENTS = [
  [0, 'njeri', 'Went to the last one — the acoustic tent is the real highlight. Bring a blanket.'],
  [0, 'brian', 'Is there parking at the main gate or should we use the KFE gate?'],
  [0, 'omar', 'Shooting this one. Anyone up for a group photo at the second set?'],
  [1, 'brian', 'The question this month is uncomfortably relevant. See you at 7.'],
  [1, 'njeri', 'Coming for the first time — is it alright to arrive a little late?'],
  [2, 'wanjiku', 'Signed up for the 22 km. Anyone want to share a lift from Nairobi?'],
  [2, 'brian', 'In for the 42. Last year the gravel after the turn was brutal.'],
  [3, 'njeri', 'Which vendors are back this week? The biryani stand sold out by 7.'],
  [4, 'omar', 'The printmaker on the third studio is worth the whole walk.'],
  [5, 'njeri', 'Perfect way to start the week. Is the deck sheltered if it rains?'],
  [6, 'brian', 'Any chance the cohort pitches are recorded? I cannot make the 18:00 slot.'],
  [7, 'brian', 'Please cover component governance — every team I have worked on gets this wrong.'],
  [8, 'wanjiku', 'Booked the wine pairing. Tell me there is dessert before the dessert.'],
  [9, 'njeri', 'Volunteering with my running club. We will be there by 14:30.'],
  [10, 'njeri', 'Last year was the best Sunday of my year. Not missing this.'],
  [11, 'brian', 'Is the 10 km course the same as last season? That hill at 7 km was something.'],
  [14, 'omar', 'The audience award is the best part of the night. Submitting my vote early.'],
  [16, 'brian', 'Great lineup this month — the cut discussion was genuinely useful.'],
];

{
  const insert = db.prepare('INSERT INTO comments (event_id, user_id, body, created_at) VALUES (?, ?, ?, ?)');
  COMMENTS.forEach(([idx, who, body], i) => {
    const when = new Date(Date.now() - (i * 7 + 4) * 3600_000);
    insert.run(eventIds[idx], userId[who], body, sqlTime(when));
  });
}
console.log('· follows, RSVPs, saves and comments');

/* ------------------------------------------------------------------ *
 * Transactions, tickets, promotions
 * ------------------------------------------------------------------ */

/**
 * Ticket issuing mirrors the live flow: a transaction is marked successful
 * first, then the ticket service issues the tickets.
 */
function issueSeededTickets({ buyer, eventIdx, tierIdx, quantity, method, status, daysAgo, receipt, payerPhone = '' }) {
  const eventId = eventIds[eventIdx];
  const tiers = db.prepare('SELECT * FROM ticket_types WHERE event_id = ? ORDER BY sort_order').all(eventId);
  const tier = tiers[tierIdx] || tiers[0];
  if (!tier) return null;

  const event = db.prepare('SELECT currency FROM events WHERE id = ?').get(eventId);

  // The buyer pays the ticket subtotal plus the platform service fee, exactly
  // as buildCart does in the live flow — so commission is a real ledger figure.
  const subtotal = tier.price_cents * quantity;
  const fee = method === 'free' ? 0 : Math.round(subtotal * (SERVICE_FEE_PERCENT / 100));
  const amount = subtotal + fee;
  const created = at(-daysAgo, 10, 30);
  const reference = `ET-TIX-${String(Math.random().toString(36).slice(2, 7)).toUpperCase()}${daysAgo}`;

  const info = db.prepare(`
    INSERT INTO transactions (reference, user_id, event_id, purpose, amount_cents, fee_cents, currency, method, provider,
                              provider_reference, status, payer_phone, receipt, metadata, completed_at, created_at, updated_at)
    VALUES (?, ?, ?, 'ticket', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reference,
    userId[buyer],
    eventId,
    amount,
    fee,
    event?.currency || 'KES',
    method,
    method === 'mpesa' ? 'mpesa' : method === 'free' ? 'internal' : 'card',
    method === 'mpesa' ? `ws_CO_${Date.now()}${String(Math.floor(Math.random() * 900) + 100)}` : `pi_seed_${Math.random().toString(36).slice(2, 10)}`,
    status,
    payerPhone,
    receipt,
    JSON.stringify({
      items: [{ ticket_type_id: tier.id, quantity }],
      attendees: [],
      notes: `subtotal=${subtotal};fee=${fee}`,
    }),
    status === 'successful' ? sqlTime(created) : '',
    sqlTime(created),
    sqlTime(created)
  );

  if (status !== 'successful') return null;

  const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid);
  const created2 = ticketService.issueForTransaction(txn);

  // Backdate so the activity reads naturally.
  for (const ticket of created2) {
    db.prepare('UPDATE tickets SET issued_at = ? WHERE id = ?').run(sqlTime(created), ticket.id);
  }
  return created2;
}

const seededTickets = [];

// Paid + free orders across upcoming events.
seededTickets.push(...(issueSeededTickets({ buyer: 'njeri', eventIdx: 0, tierIdx: 1, quantity: 2, method: 'mpesa', status: 'successful', daysAgo: 9, receipt: 'SJI4MK9Q2L', payerPhone: '254712345678' }) || []));
seededTickets.push(...(issueSeededTickets({ buyer: 'brian', eventIdx: 0, tierIdx: 0, quantity: 1, method: 'mpesa', status: 'successful', daysAgo: 11, receipt: 'SJI3PL7X1B', payerPhone: '254722334455' }) || []));
seededTickets.push(...(issueSeededTickets({ buyer: 'wanjiku', eventIdx: 0, tierIdx: 2, quantity: 1, method: 'card', status: 'successful', daysAgo: 7, receipt: 'ch_3PqF2kDsw' }) || []));
seededTickets.push(...(issueSeededTickets({ buyer: 'njeri', eventIdx: 1, tierIdx: 1, quantity: 1, method: 'mpesa', status: 'successful', daysAgo: 4, receipt: 'SJI8QW2M4T', payerPhone: '254712345678' }) || []));
seededTickets.push(...(issueSeededTickets({ buyer: 'brian', eventIdx: 2, tierIdx: 1, quantity: 1, method: 'mpesa', status: 'successful', daysAgo: 6, receipt: 'SJI5RT8N7K', payerPhone: '254722334455' }) || []));
seededTickets.push(...(issueSeededTickets({ buyer: 'wanjiku', eventIdx: 2, tierIdx: 0, quantity: 2, method: 'mpesa', status: 'successful', daysAgo: 5, receipt: 'SJI6YU3P8D', payerPhone: '254733221100' }) || []));
seededTickets.push(...(issueSeededTickets({ buyer: 'njeri', eventIdx: 5, tierIdx: 0, quantity: 1, method: 'mpesa', status: 'successful', daysAgo: 2, receipt: 'SJI9AC5V2F', payerPhone: '254712345678' }) || []));
seededTickets.push(...(issueSeededTickets({ buyer: 'omar', eventIdx: 8, tierIdx: 1, quantity: 2, method: 'card', status: 'successful', daysAgo: 3, receipt: 'ch_3PrX8sKda' }) || []));
seededTickets.push(...(issueSeededTickets({ buyer: 'njeri', eventIdx: 7, tierIdx: 0, quantity: 1, method: 'card', status: 'successful', daysAgo: 1, receipt: 'ch_3PsQ1mHda' }) || []));
seededTickets.push(...(issueSeededTickets({ buyer: 'brian', eventIdx: 10, tierIdx: 1, quantity: 4, method: 'mpesa', status: 'successful', daysAgo: 8, receipt: 'SJI2ED6R9G', payerPhone: '254722334455' }) || []));
seededTickets.push(...(issueSeededTickets({ buyer: 'wanjiku', eventIdx: 11, tierIdx: 2, quantity: 1, method: 'mpesa', status: 'successful', daysAgo: 10, receipt: 'SJI7TF4B3H', payerPhone: '254733221100' }) || []));
seededTickets.push(...(issueSeededTickets({ buyer: 'njeri', eventIdx: 14, tierIdx: 0, quantity: 2, method: 'mpesa', status: 'successful', daysAgo: 4, receipt: 'SJI1GH9L5C', payerPhone: '254712345678' }) || []));
seededTickets.push(...(issueSeededTickets({ buyer: 'omar', eventIdx: 16, tierIdx: 0, quantity: 1, method: 'mpesa', status: 'successful', daysAgo: 6, receipt: 'SJI0JK2W7M', payerPhone: '254799887766' }) || []));

// Free registrations — recorded in the ledger with a zero-value confirmation.
function seedFreeRegistration(buyer, eventIdx, tierIdx, daysAgo) {
  const eventId = eventIds[eventIdx];
  const tiers = db.prepare('SELECT * FROM ticket_types WHERE event_id = ? ORDER BY sort_order').all(eventId);
  const tier = tiers[tierIdx];
  if (!tier) return [];
  return issueSeededTickets({ buyer, eventIdx, tierIdx, quantity: 1, method: 'free', status: 'successful', daysAgo, receipt: `FREE-${Math.random().toString(36).slice(2, 8).toUpperCase()}` }) || [];
}

seededTickets.push(...seedFreeRegistration('brian', 1, 0, 5));
seededTickets.push(...seedFreeRegistration('njeri', 6, 0, 3));
seededTickets.push(...seedFreeRegistration('wanjiku', 9, 0, 4));
seededTickets.push(...seedFreeRegistration('omar', 13, 0, 6));
seededTickets.push(...seedFreeRegistration('brian', 3, 0, 2));
seededTickets.push(...seedFreeRegistration('njeri', 3, 0, 1));

// Past-event attendance, some already checked in.
seededTickets.push(...(issueSeededTickets({ buyer: 'njeri', eventIdx: 18, tierIdx: 1, quantity: 2, method: 'mpesa', status: 'successful', daysAgo: 30, receipt: 'SHZ8KD3M2Q', payerPhone: '254712345678' }) || []));
seededTickets.push(...(issueSeededTickets({ buyer: 'omar', eventIdx: 19, tierIdx: 0, quantity: 1, method: 'mpesa', status: 'successful', daysAgo: 40, receipt: 'SHX4LM7P1R', payerPhone: '254799887766' }) || []));

// A few tickets checked in at the gate during past events.
for (const ticket of seededTickets.slice(-3)) {
  db.prepare("UPDATE tickets SET status = 'used', checked_in_at = datetime('now','-14 days'), checked_in_by = ? WHERE id = ?")
    .run(userId.fatuma, ticket.id);
}

// Non-successful ledger entries so admin filters have something to show.
const LEDGER_NOISE = [
  { buyer: 'njeri', eventIdx: 12, tierIdx: 0, method: 'mpesa', status: 'pending', daysAgo: 0, phone: '254712345678' },
  { buyer: 'brian', eventIdx: 2, tierIdx: 1, method: 'mpesa', status: 'failed', daysAgo: 1, phone: '254722334455', reason: 'Insufficient funds' },
  { buyer: 'wanjiku', eventIdx: 8, tierIdx: 0, method: 'card', status: 'cancelled', daysAgo: 2, reason: 'Customer cancelled the request' },
  { buyer: 'omar', eventIdx: 0, tierIdx: 1, method: 'mpesa', status: 'refunded', daysAgo: 12, phone: '254799887766', reason: 'Duplicate purchase — refunded by admin' },
  { buyer: 'njeri', eventIdx: 11, tierIdx: 0, method: 'card', status: 'failed', daysAgo: 3, reason: 'Card declined' },
];

for (const entry of LEDGER_NOISE) {
  const eventId = eventIds[entry.eventIdx];
  const eventTiers = db.prepare('SELECT * FROM ticket_types WHERE event_id = ? ORDER BY sort_order').all(eventId);
  // A payment that never went through should still be about a real price: the
  // noise rows are all paid attempts, so skip any free tier on that event.
  const tier = eventTiers.find((t) => t.price_cents > 0) || eventTiers[0];
  if (!tier) continue;
  const created = at(-entry.daysAgo, 11, 15);
  const fee = Math.round(tier.price_cents * (SERVICE_FEE_PERCENT / 100));

  db.prepare(`
    INSERT INTO transactions (reference, user_id, event_id, purpose, amount_cents, fee_cents, currency, method, provider,
                              provider_reference, status, payer_phone, failure_reason, metadata, created_at, updated_at)
    VALUES (?, ?, ?, 'ticket', ?, ?, 'KES', ?, ?, ?, ?, ?, ?, '{}', ?, ?)
  `).run(
    `ET-TIX-${String(Math.random().toString(36).slice(2, 7)).toUpperCase()}${entry.daysAgo}`,
    userId[entry.buyer],
    eventId,
    tier.price_cents + fee,
    fee,
    entry.method,
    entry.method === 'mpesa' ? 'mpesa' : 'card',
    entry.method === 'mpesa' ? `ws_CO_NOISE_${entry.daysAgo}` : `pi_noise_${entry.daysAgo}`,
    entry.status,
    entry.phone || '',
    entry.reason || '',
    sqlTime(created),
    sqlTime(created)
  );
}

// Promotion campaigns: one active, one pending, one expired.
function seedPromotion({ eventIdx, owner, plan, status, price, durationDays, daysAgo, transactionStatus }) {
  const eventId = eventIds[eventIdx];
  const created = at(-daysAgo, 9, 0);
  const starts = new Date(created);
  const ends = new Date(created.getTime() + durationDays * 86400_000);

  const txnInfo = db.prepare(`
    INSERT INTO transactions (reference, user_id, event_id, purpose, amount_cents, currency, method, provider,
                              provider_reference, status, receipt, metadata, completed_at, created_at, updated_at)
    VALUES (?, ?, ?, 'promotion', ?, 'KES', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `ET-PRO-${String(Math.random().toString(36).slice(2, 7)).toUpperCase()}${daysAgo}`,
    userId[owner],
    eventId,
    price,
    'mpesa',
    'mpesa',
    `ws_CO_PROMO_${daysAgo}`,
    transactionStatus,
    transactionStatus === 'successful' ? `SJK${Math.floor(Math.random() * 900000) + 100000}` : '',
    JSON.stringify({ plan }),
    transactionStatus === 'successful' ? sqlTime(created) : '',
    sqlTime(created),
    sqlTime(created)
  );

  db.prepare(`
    INSERT INTO promotions (event_id, user_id, plan, transaction_id, status, price_cents, currency,
                            duration_days, impressions, clicks, starts_at, ends_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'KES', ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    userId[owner],
    plan,
    txnInfo.lastInsertRowid,
    status,
    price,
    durationDays,
    status === 'active' ? 1840 + eventIdx * 23 : 0,
    status === 'active' ? 96 + eventIdx * 3 : 0,
    status === 'active' ? sqlTime(created) : '',
    status === 'active' ? sqlTime(ends) : '',
    sqlTime(created)
  );
}

seedPromotion({ eventIdx: 0, owner: 'daniel', plan: 'sponsored', status: 'active', price: 450000, durationDays: 21, daysAgo: 3, transactionStatus: 'successful' });
seedPromotion({ eventIdx: 10, owner: 'daniel', plan: 'featured', status: 'active', price: 150000, durationDays: 7, daysAgo: 2, transactionStatus: 'successful' });
seedPromotion({ eventIdx: 7, owner: 'njeri', plan: 'boost', status: 'pending', price: 280000, durationDays: 14, daysAgo: 0, transactionStatus: 'pending' });
seedPromotion({ eventIdx: 18, owner: 'fatuma', plan: 'featured', status: 'expired', price: 150000, durationDays: 7, daysAgo: 30, transactionStatus: 'successful' });

const ticketCount = db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n;
const txnCount = db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;
console.log(`· ${txnCount} transactions · ${ticketCount} tickets · 4 promotions`);

/* ------------------------------------------------------------------ *
 * Notifications
 * ------------------------------------------------------------------ */

function seedNotification(user, { type, title, body, link, actor, eventIdx, hoursAgo = 2, read = false }) {
  const when = new Date(Date.now() - hoursAgo * 3600_000);
  db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, link, actor_id, event_id, read_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId[user], type, title, body, link,
    actor ? userId[actor] : null,
    eventIdx != null ? eventIds[eventIdx] : null,
    read ? sqlTime(when) : '',
    sqlTime(when)
  );
}

seedNotification('njeri', { type: 'ticket', title: 'Your ticket is confirmed', body: `${EVENTS[0].title} — see you on the lawn.`, link: '/tickets', eventIdx: 0, hoursAgo: 1 });
seedNotification('njeri', { type: 'follow', title: 'Daniel Mwangi published a new event', body: EVENTS[10].title, link: `/events/${eventIds[10]}`, actor: 'daniel', eventIdx: 10, hoursAgo: 5 });
seedNotification('njeri', { type: 'comment', title: 'Omar Yusuf commented on Jazz at the Arboretum', body: 'Shooting this one. Anyone up for a group photo?', link: `/events/${eventIds[0]}`, actor: 'omar', eventIdx: 0, hoursAgo: 9 });
seedNotification('njeri', { type: 'promotion', title: 'Workshop seats are filling up', body: 'Design Systems Workshop is 80% booked.', link: `/events/${eventIds[7]}`, eventIdx: 7, hoursAgo: 26, read: true });
seedNotification('brian', { type: 'event', title: 'Rift Valley Trail Ride start times confirmed', body: 'Wave A departs at 06:15.', link: `/events/${eventIds[2]}`, eventIdx: 2, hoursAgo: 4 });
seedNotification('wanjiku', { type: 'payment', title: 'Payment received', body: 'KES 90,000 confirmed — reference ET-TIX-4821.', link: '/tickets', hoursAgo: 12 });
seedNotification('daniel', { type: 'promotion', title: 'Sponsored placement is live', body: `${EVENTS[0].title} is now promoted until the campaign window closes.`, link: `/events/${eventIds[0]}`, hoursAgo: 72 });
seedNotification('daniel', { type: 'rsvp', title: '3 people are going to Blankets & Wine', body: 'Keep the guest list moving.', link: `/events/${eventIds[10]}`, eventIdx: 10, hoursAgo: 20 });
seedNotification('admin', { type: 'promotion', title: 'Promotion purchased', body: `${EVENTS[7].title} — boost placement pending payment.`, link: '/admin?tab=promotions', hoursAgo: 1 });
seedNotification('admin', { type: 'payment', title: 'Payout review', body: '4 transactions settled in the last 24 hours.', link: '/admin?tab=transactions', hoursAgo: 3 });

console.log('· notifications');

/* ------------------------------------------------------------------ *
 * Chat
 * ------------------------------------------------------------------ */

function makeDm(a, b, messages) {
  const info = db.prepare("INSERT INTO conversations (type) VALUES ('dm')").run();
  const convId = info.lastInsertRowid;
  const add = db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)');
  add.run(convId, userId[a]);
  add.run(convId, userId[b]);

  const msg = db.prepare('INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)');
  let hoursAgo = messages.length * 3 + 5;
  for (const [who, body] of messages) {
    msg.run(convId, userId[who], body, sqlTime(new Date(Date.now() - hoursAgo * 3600_000)));
    hoursAgo -= 3;
  }
  return convId;
}

function makeEventChat(eventIdx, messages) {
  const info = db.prepare("INSERT INTO conversations (type, event_id, title) VALUES ('event', ?, ?)")
    .run(eventIds[eventIdx], EVENTS[eventIdx].title);
  const convId = info.lastInsertRowid;
  const add = db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)');
  const msg = db.prepare('INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)');

  let hoursAgo = messages.length * 2 + 3;
  const seen = new Set();
  for (const [who, body] of messages) {
    if (!seen.has(who)) { add.run(convId, userId[who]); seen.add(who); }
    msg.run(convId, userId[who], body, sqlTime(new Date(Date.now() - hoursAgo * 3600_000)));
    hoursAgo -= 2;
  }
  return convId;
}

makeDm('njeri', 'daniel', [
  ['njeri', 'Are the early bird tickets really gone for Jazz at the Arboretum?'],
  ['daniel', 'Completely. I have put two standard aside for you at the door though.'],
  ['njeri', 'Perfect — bringing my sister, she has never been.'],
  ['daniel', 'Nice. Come through gate B, it is much quicker after 18:30.'],
]);

makeDm('brian', 'kamau', [
  ['brian', 'Is the 42 km route the same as last season?'],
  ['kamau', 'Mostly. We cut the farm section after the rains and added 4 km of gravel.'],
  ['brian', 'Good. I will register the team this week.'],
]);

makeDm('wanjiku', 'fatuma', [
  ['wanjiku', 'Any dairy-free options at the coastal supper?'],
  ['fatuma', 'Yes — the coconut courses are all dairy free. I will note it on your booking.'],
  ['wanjiku', 'Thank you. Counting down already.'],
]);

makeDm('njeri', 'lucia', [
  ['njeri', 'Is pitch night open to designers or just investors?'],
  ['lucia', 'Absolutely open. Half the room is usually product and design people.'],
  ['njeri', 'Great, I will come with two colleagues.'],
]);

makeEventChat(0, [
  ['daniel', 'Welcome everyone. Gates open at 17:30, music starts at 18:00.'],
  ['njeri', 'Is the acoustic tent first-come or do we need to book?'],
  ['daniel', 'First come — it seats about 120 so arrive early if you want a spot.'],
  ['brian', 'Parking situation at the KFE gate?'],
  ['daniel', 'Plenty of space until about 19:00, then it starts to fill.'],
]);

makeEventChat(2, [
  ['kamau', 'Route notes will go out to registered riders on Thursday.'],
  ['brian', 'Is there a mechanic at the second water point?'],
  ['kamau', 'Yes, plus a van that can carry two bikes and four people.'],
  ['wanjiku', 'Doing the 22 km — is it fine on a gravel bike with 38mm tyres?'],
  ['kamau', 'That is the ideal setup for the short loop.'],
]);

console.log('· chat conversations');

// Platform settings the payment flow reads at runtime. The service fee here is
// the same rate the seeded commission was calculated with.
db.prepare(`
  INSERT INTO settings (key, value) VALUES ('service_fee_percent', ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`).run(String(SERVICE_FEE_PERCENT));
console.log(`· platform settings (service fee ${SERVICE_FEE_PERCENT}%)`);

console.log('\nSeed complete.');
console.log('  Sign in with admin@eventtracker.app (admin) or any demo account below.');
console.log('  Demo accounts: admin@ · daniel@ · zawadi@ · kamau@ · fatuma@ · njeri@ · brian@ · wanjiku@ · omar@ · lucia@  (eventtracker.app)');
console.log(`  Password for all: ${PASSWORD}\n`);
}

main().catch((error) => {
  console.error('\nSeed failed:\n', error.stack || error);
  process.exit(1);
});
