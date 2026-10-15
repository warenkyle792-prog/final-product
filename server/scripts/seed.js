const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { loadConfig } = require('../config');
const { openDatabase } = require('../db/database');
const { nowIso } = require('../lib/helpers');
const { paymentService } = require('../services/payments');

const categories = [
  ['Music','music','Live sound, intimate rooms and the voices shaping the city.','#292929'],
  ['Technology','technology','People building useful things, together.','#333333'],
  ['Sports','sports','Movement, competition and a good reason to show up.','#262626'],
  ['Business','business','Ideas and conversations that move work forward.','#3a3a3a'],
  ['Food','food','Tables worth gathering around.','#303030'],
  ['Arts','arts','New work, independent makers and shared points of view.','#202020'],
  ['Community','community','Neighbourhood projects, meet-ups and civic life.','#3d3d3d'],
  ['Wellness','wellness','Time to reset, move and make space for yourself.','#2d2d2d']
];
const demoUsers = [
  { username: 'eventtracker', email: 'admin@eventtracker.app', role: 'admin', name: 'EventTracker Admin', bio: 'Keeping good things happening.' },
  { username: 'njeri', email: 'njeri@eventtracker.app', role: 'attendee', name: 'Njeri Wanjiku', bio: 'Always looking for a good room and a better conversation.' },
  { username: 'kamaucreates', email: 'kamau@eventtracker.app', role: 'organizer', name: 'Kamau Muriuki', bio: 'Small rooms, big sound. Nairobi-based organiser.' },
  { username: 'wambuiworks', email: 'wambui@eventtracker.app', role: 'organizer', name: 'Wambui Njoroge', bio: 'Building community around design, food and ideas.' },
  { username: 'brianm', email: 'brian@eventtracker.app', role: 'attendee', name: 'Brian Mwangi', bio: 'Weekend runner and occasional front-row guest.' },
  { username: 'amina', email: 'amina@eventtracker.app', role: 'attendee', name: 'Amina Hassan', bio: 'Here for art, conversation and new places.' }
];
const eventSeeds = [
  { title: 'A Night of New Kenyan Jazz', category: 'Music', organizer: 'kamaucreates', days: 4, time: '19:30', location: 'Nairobi', venue: 'The Alchemist, Westlands', price: 1800, currency: 'KES', cap: 120, cover: 'music', desc: 'An intimate night of original sets from Nairobi’s next generation of jazz musicians. Come early for a short opening set and stay for an open late-night session.' },
  { title: 'Build for the Everyday', category: 'Technology', organizer: 'wambuiworks', days: 7, time: '09:00', location: 'Nairobi', venue: 'iHub, Senteu Plaza', price: 0, currency: 'KES', cap: 90, cover: 'technology', desc: 'A practical morning for product people, engineers and designers making tools for real life. Short talks, honest case studies and time to meet the people behind the work.' },
  { title: 'Karura Sunday Run Club', category: 'Sports', organizer: 'kamaucreates', days: 10, time: '07:00', location: 'Nairobi', venue: 'Karura Forest, Gate A', price: 500, currency: 'KES', cap: 60, cover: 'sports', desc: 'An easy-going 5K loop through the forest with a relaxed pace group and coffee afterwards. All levels welcome; bring water and arrive ten minutes before the start.' },
  { title: 'The Independent Work Table', category: 'Business', organizer: 'wambuiworks', days: 12, time: '17:30', location: 'Nairobi', venue: 'Ikigai, Lavington', price: 1200, currency: 'KES', cap: 48, cover: 'business', desc: 'A small, useful evening for independent founders and creative operators. Three short prompts, one shared table and enough room for the conversations to continue.' },
  { title: 'Sunday Lunch: Coast to Highlands', category: 'Food', organizer: 'wambuiworks', days: 15, time: '12:30', location: 'Nairobi', venue: 'Kilele Nyama, Kilimani', price: 3200, currency: 'KES', cap: 40, cover: 'food', desc: 'A seasonal shared lunch tracing ingredients from the coast to the highlands. The kitchen will talk through each course, with vegetarian plates available by request.' },
  { title: 'Open Studio: After the Rain', category: 'Arts', organizer: 'kamaucreates', days: 18, time: '16:00', location: 'Nairobi', venue: 'Circle Art Gallery', price: 800, currency: 'KES', cap: 70, cover: 'arts', desc: 'Meet the artists behind a new group show about memory, weather and the things a city leaves behind. The afternoon includes a guided walk-through and an informal Q&A.' },
  { title: 'Neighbourhood Garden Day', category: 'Community', organizer: 'wambuiworks', days: 22, time: '10:00', location: 'Nairobi', venue: 'Muthangari Community Garden', price: 0, currency: 'KES', cap: 80, cover: 'community', desc: 'Bring a pair of gloves and spend a Saturday morning planting, sharing seedlings and learning what grows well in a small urban space. Tools and tea provided.' },
  { title: 'A Quiet Hour: Breath and Sound', category: 'Wellness', organizer: 'kamaucreates', days: 26, time: '08:00', location: 'Nairobi', venue: 'The Practice Space, Karen', price: 1500, currency: 'KES', cap: 24, cover: 'wellness', desc: 'A gentle guided practice combining breathwork and live acoustic sound. The session is designed for beginners; mats, tea and a little time to settle are included.' },
  { title: 'Nairobi Makers After Hours', category: 'Arts', organizer: 'wambuiworks', days: 31, time: '18:00', location: 'Nairobi', venue: 'The Foundry, Gigiri', price: 1000, currency: 'KES', cap: 100, cover: 'arts', desc: 'An after-hours market of independent ceramics, print, textiles and home objects. Meet the makers, hear the stories behind the work and find something made to last.' },
  { title: 'East Africa Product Breakfast', category: 'Technology', organizer: 'kamaucreates', days: 38, time: '08:30', location: 'Nairobi', venue: 'Nairobi Garage, Westlands', price: 900, currency: 'KES', cap: 55, cover: 'technology', desc: 'A useful breakfast conversation on building products across East African markets, with a focus on trust, distribution and the small decisions that matter.' },
  { title: 'The Long Table: Stories of Home', category: 'Food', organizer: 'wambuiworks', days: 47, time: '18:30', location: 'Nairobi', venue: 'Cultiva, Karen', price: 4200, currency: 'KES', cap: 32, cover: 'food', desc: 'A long-table supper shaped by family recipes and the stories that travel with them. Four courses, a welcome drink and a room full of people who like to linger.' },
  { title: 'Sunday Five-a-side', category: 'Sports', organizer: 'kamaucreates', days: 54, time: '09:00', location: 'Nairobi', venue: 'Ligi Ndogo, Spring Valley', price: 400, currency: 'KES', cap: 30, cover: 'sports', desc: 'Friendly five-a-side for anyone who misses playing. Mixed teams, short matches and a relaxed finish; no club experience required.' }
];
function futureDate(days) { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0,10); }
async function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();
  if (config.mode === 'production') throw new Error('The demo seed utility is disabled in production. Create accounts through the app and promote the first administrator with make-admin.');
  if (args.includes('--reset')) {
    for (const file of [config.dbFile, `${config.dbFile}-journal`, `${config.dbFile}-wal`, `${config.dbFile}-shm`]) if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    if (fs.existsSync(config.uploadsDir)) fs.rmSync(config.uploadsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  const db = await openDatabase(config.dbFile);
  try {
    const stamp = nowIso();
    if (args.includes('--recolour')) {
      categories.forEach(([,slug,,color], index) => db.run('UPDATE categories SET color=?,sort_order=? WHERE slug=?', [color,index+1,slug]));
      db.run("UPDATE categories SET color='#303030' WHERE lower(color) NOT IN ('#202020','#262626','#292929','#2d2d2d','#303030','#333333','#3a3a3a','#3d3d3d')");
      console.log('Existing category colors rewritten to the neutral palette.');
      return;
    }
    db.transaction(() => {
      categories.forEach(([name,slug,description,color], index) => {
        db.run('INSERT OR IGNORE INTO categories(name,slug,description,cover,color,sort_order) VALUES(?,?,?,?,?,?)', [name,slug,description,`/covers/${slug}.jpg`,color,index+1]);
      });
      demoUsers.forEach((user) => {
        const existing = db.get('SELECT id FROM users WHERE email=?', [user.email]);
        if (!existing) {
          const hash = bcrypt.hashSync('password123', 12);
          db.run('INSERT INTO users(username,email,password_hash,role,name,bio,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', [user.username,user.email,hash,user.role,user.name,user.bio,stamp,stamp]);
        }
      });
    });
    if (db.get('SELECT COUNT(*) AS n FROM events').n === 0) {
      for (const [index,event] of eventSeeds.entries()) {
        const category = db.get('SELECT id FROM categories WHERE slug=?', [event.category.toLowerCase()]);
        const organizer = db.get('SELECT id FROM users WHERE username=?', [event.organizer]);
        const date = futureDate(event.days);
        const slug = `${event.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}-${index+1}`;
        const result = db.run(`INSERT INTO events(organizer_id,category_id,title,slug,description,date,time,end_time,location,venue,price_minor,currency,capacity,cover_image,status,featured,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [organizer.id,category.id,event.title,slug,event.desc,date,event.time,'',event.location,event.venue,event.price*100,event.currency,event.cap,`/covers/${event.cover}.jpg`,'published',index < 3 ? 1 : 0,stamp,stamp]);
        db.run('INSERT INTO ticket_types(event_id,name,description,price_minor,currency,quantity) VALUES(?,?,?,?,?,?)', [result.lastID,'General admission','Standard entry',event.price*100,event.currency,event.cap]);
        if (index === 0) db.run('INSERT INTO ticket_types(event_id,name,description,price_minor,currency,quantity) VALUES(?,?,?,?,?,?)', [result.lastID,'Front row','Limited close-up seating',event.price*150,event.currency,24]);
      }
      const njeri = db.get('SELECT id FROM users WHERE username="njeri"');
      const firstEvent = db.get('SELECT e.id,e.price_minor,e.currency,tt.id AS ticket_type_id FROM events e JOIN ticket_types tt ON tt.event_id=e.id WHERE e.title=? ORDER BY tt.id LIMIT 1', ['A Night of New Kenyan Jazz']);
      if (firstEvent && njeri) {
        const transactionId = db.run(`INSERT INTO transactions(user_id,event_id,ticket_type_id,provider,status,provider_reference,amount_minor,currency,idempotency_key,commission_minor,purpose,metadata,created_at,updated_at)
          VALUES(?,?,?,'stripe','pending','sandbox-seed-1',?,?,'seed-ticket-njeri',?, 'ticket',?, ?, ?)`, [njeri.id,firstEvent.id,firstEvent.ticket_type_id,firstEvent.price_minor,firstEvent.currency,Math.round(firstEvent.price_minor*0.05),JSON.stringify({mode:'sandbox',description:'Seeded demo ticket'}),stamp,stamp]).lastID;
        const service = paymentService({ db, config, io: null });
        service.finalize(transactionId,'successful','seed');
        db.run('INSERT OR IGNORE INTO rsvps(user_id,event_id,status,created_at) VALUES(?,?,?,?)', [njeri.id,firstEvent.id,'going',stamp]);
      }
      const njeriForChat = db.get('SELECT id FROM users WHERE username="njeri"');
      const host = db.get('SELECT id FROM users WHERE username="kamaucreates"');
      if (njeriForChat && host) {
        const convo = db.run('INSERT INTO conversations(created_at,updated_at) VALUES(?,?)', [stamp,stamp]).lastID;
        db.run('INSERT INTO conversation_participants(conversation_id,user_id) VALUES(?,?)', [convo,njeriForChat.id]);
        db.run('INSERT INTO conversation_participants(conversation_id,user_id) VALUES(?,?)', [convo,host.id]);
        db.run('INSERT INTO messages(conversation_id,sender_id,body,created_at) VALUES(?,?,?,?)', [convo,host.id,'Hi Njeri — glad you are coming. The doors open at 7:00 pm.',stamp]);
      }
      const admin = db.get('SELECT id FROM users WHERE role="admin" LIMIT 1');
      if (admin) db.run('INSERT INTO notifications(user_id,type,title,body,created_at) VALUES(?,?,?,?,?)', [admin.id,'system','Your space is ready','Review the seeded events and update your settings when you are ready.',stamp]);
    }
    console.log(`Seed complete. ${db.get('SELECT COUNT(*) AS n FROM categories').n} categories, ${db.get('SELECT COUNT(*) AS n FROM users').n} accounts, ${db.get('SELECT COUNT(*) AS n FROM events').n} events.`);
    console.log('Demo password: password123 (admin@eventtracker.app, njeri@eventtracker.app, kamau@eventtracker.app, wambui@eventtracker.app, brian@eventtracker.app, amina@eventtracker.app)');
  } finally { db.close(); }
}
main().catch((error) => { console.error(error?.message || 'Seed failed.'); process.exitCode = 1; });
