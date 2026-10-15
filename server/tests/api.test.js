const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { io: socketClient } = require('socket.io-client');
const { createApplication } = require('../app');
const { loadConfig } = require('../config');
const { signForSession } = require('../lib/auth');
const { openDatabase } = require('../db/database');
const { nowIso } = require('../lib/helpers');

let system;
let base;
let tempDir;
let checkCount = 0;
const checks = [];
function check(value, message) {
  checkCount++;
  checks.push(message);
  assert.ok(value, `check ${checkCount}: ${message}`);
}
function equal(actual, expected, message) {
  checkCount++;
  checks.push(message);
  assert.equal(actual, expected, `check ${checkCount}: ${message}`);
}
async function request(pathname, { method = 'GET', token, body, headers = {}, raw = false } = {}) {
  const requestHeaders = { ...headers };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body !== undefined && !(body instanceof FormData) && !raw) {
    requestHeaders['Content-Type'] ||= 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${base}${pathname}`, { method, headers: requestHeaders, body: payload });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, status: response.status, data, headers: response.headers };
}
async function register({ name, username, email, password = 'passWord1234', role = 'attendee' }) {
  const result = await request('/auth/register', { method: 'POST', body: { name, username, email, password, role } });
  if (result.status !== 201) throw new Error(`Test registration failed: ${result.status} ${JSON.stringify(result.data)}`);
  return { ...result.data, cookie: result.headers.get('set-cookie') };
}
function bearer(token) { return { Authorization: `Bearer ${token}` }; }

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventtracker-api-'));
  const env = {
    NODE_ENV: 'test', PORT: '0', DATA_DIR: path.join(tempDir, 'data'), UPLOADS_DIR: path.join(tempDir, 'uploads'), DB_FILE: path.join(tempDir, 'database.sqlite'),
    JWT_SECRET: 'api-suite-jwt-secret-4f2c6742b53e4c5c9ed3', TICKET_SECRET: 'api-suite-ticket-secret-1427210f3b0a4b578edb',
    COOKIE_SECURE: 'false', CLIENT_URL: 'http://localhost:5173', CORS_ORIGINS: 'http://localhost:5173',
    RATE_LIMIT_GENERAL: '1000', RATE_LIMIT_AUTH: '1000', RATE_LIMIT_UPLOADS: '1000', RATE_LIMIT_VERIFY: '1000', RATE_LIMIT_SENSITIVE: '1000'
  };
  system = await createApplication({ env });
  await new Promise((resolve, reject) => {
    system.server.once('error', reject);
    system.server.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${system.server.address().port}/api`;
});
after(async () => {
  if (system) await system.close();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test('production configuration fails closed', () => {
  const baseEnv = {
    NODE_ENV: 'production',
    JWT_SECRET: 'r4ndom-jwt-signing-key-74c4b1d3155f3c2a-gamma',
    TICKET_SECRET: 'ticket-signing-key-62eb4ca762e051e3-rho',
    CLIENT_URL: 'https://events.example.test',
    PUBLIC_APP_URL: 'https://events.example.test',
    CORS_ORIGINS: 'https://events.example.test',
    COOKIE_SECURE: 'true'
  };
  assert.equal(loadConfig(baseEnv).cookieSecure, true, 'valid HTTPS production baseline loads');
  assert.throws(() => loadConfig({ ...baseEnv, COOKIE_SECURE: 'false' }), /COOKIE_SECURE must be true/);
  assert.throws(() => loadConfig({ ...baseEnv, CLIENT_URL: 'http://events.example.test' }), /CLIENT_URL must be an exact HTTPS origin/);
  assert.throws(() => loadConfig({ ...baseEnv, CORS_ORIGINS: 'https://events.example.test,http://other.example.test' }), /CORS_ORIGINS entry must be an exact HTTPS origin/);
  assert.throws(() => loadConfig({ ...baseEnv, JWT_SECRET: baseEnv.TICKET_SECRET }), /must be different independent secrets/);
  assert.throws(() => loadConfig({ ...baseEnv, TRUST_PROXY: 'true' }), /set TRUST_PROXY to a trusted hop count or proxy address/);
  assert.throws(() => loadConfig({ ...baseEnv, SESSION_DAYS: '31' }), /cannot exceed 30 days/);
  assert.throws(() => loadConfig({ ...baseEnv, STRIPE_SECRET_KEY: 'sk_live_fake' }), /must all be set together/);
  assert.throws(() => loadConfig({ ...baseEnv, STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_PUBLISHABLE_KEY: 'pk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_fake-provider-value-long-enough-12345' }), /Stripe live secret and publishable keys are required/);
  assert.throws(() => loadConfig({ ...baseEnv, MPESA_ENV: 'production' }), /all live credentials/);
});

test('production startup refuses built-in demo accounts', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eventtracker-production-guard-'));
  const config = loadConfig({
    NODE_ENV: 'production',
    JWT_SECRET: 'r4ndom-jwt-signing-key-74c4b1d3155f3c2a-gamma',
    TICKET_SECRET: 'ticket-signing-key-62eb4ca762e051e3-rho',
    CLIENT_URL: 'https://events.example.test',
    PUBLIC_APP_URL: 'https://events.example.test',
    CORS_ORIGINS: 'https://events.example.test',
    COOKIE_SECURE: 'true',
    DATA_DIR: path.join(directory, 'data'),
    UPLOADS_DIR: path.join(directory, 'uploads'),
    DB_FILE: path.join(directory, 'eventtracker.sqlite')
  });
  const db = await openDatabase(config.dbFile);
  try {
    db.run('INSERT INTO users(username,email,password_hash,role,name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', ['eventtracker', 'admin@eventtracker.app', 'not-a-real-hash', 'admin', 'Seeded Admin', nowIso(), nowIso()]);
    await assert.rejects(createApplication({ config, db }), /remove the built-in demo accounts/);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('EventTracker API end-to-end: auth, events, uploads, chat, payments, tickets, promotions and admin', async () => {
  // Security headers and public boot paths.
  let result = await request('/health');
  equal(result.status, 200, 'health route returns 200');
  equal(result.data.status, 'ok', 'health route reports ready');
  equal(result.data.database, 'ready', 'database initialized on an empty database');
  equal(fs.statSync(system.config.dbFile).mode & 0o777, 0o600, 'SQLite database file is private to the service account');
  equal(fs.statSync(system.config.dataDir).mode & 0o777, 0o700, 'database directory is private to the service account');
  equal(fs.statSync(system.config.uploadsDir).mode & 0o777, 0o700, 'uploads directory is private to the service account');
  equal(result.headers.get('cache-control'), 'no-store, max-age=0', 'API responses are not cacheable');
  check(result.headers.get('content-security-policy')?.includes("default-src 'self'"), 'CSP defaults to self');
  check(result.headers.get('content-security-policy')?.includes("script-src 'self'"), 'CSP keeps scripts self-only');
  check(result.headers.get('content-security-policy')?.includes("object-src 'none'"), 'CSP blocks object embeds');
  check(result.headers.get('content-security-policy')?.includes("base-uri 'self'"), 'CSP restricts base URI');
  check(result.headers.get('content-security-policy')?.includes("form-action 'self'"), 'CSP restricts form destinations');
  check(result.headers.get('permissions-policy')?.includes('camera=self'), 'Permissions-Policy allows only the camera feature same-origin');
  check(result.headers.get('permissions-policy')?.includes('payment=()'), 'Permissions-Policy disables payment capability');
  equal((await fetch(`${base.replace('/api','')}/`).then((r)=>r.status)), 200, 'SPA route is served by the same origin');
  equal((await fetch(`${base.replace('/api','')}/fonts/etracker-sans.woff2`).then((r)=>r.status)), 200, 'self-hosted font is served');
  const lightBackground=await fetch(`${base.replace('/api','')}/backgrounds/light-mode-background.jpeg`);
  equal(lightBackground.status,200,'user-selected light-mode background is served locally');
  check(lightBackground.headers.get('content-type')?.includes('image/jpeg'),'light-mode background is a local JPEG');
  for (const cover of ['music','technology','sports','business','food','arts','community','wellness']) {
    const image = await fetch(`${base.replace('/api','')}/covers/${cover}.jpg`);
    equal(image.status, 200, `${cover} photographic cover is served locally`);
    check(image.headers.get('content-type')?.includes('image/jpeg'), `${cover} cover has a JPEG content type`);
  }

  // Every invalid sign-up shape is rejected before an account is created.
  result = await request('/auth/register', { method: 'POST', body: { name: 'A', username: 'ab', email: 'not-email', password: 'lettersOnly', role: 'admin' } });
  equal(result.status, 400, 'weak password and invalid sign-up are rejected');
  equal(result.data.error, 'INVALID_INPUT', 'invalid sign-up uses a stable error code');
  check(result.data.fields.password.includes('letter and one number'), 'sign-up explains the password requirement that failed');
  check(result.data.fields.username.includes('underscores'), 'sign-up identifies an invalid username');
  result = await request('/auth/register', { method: 'POST', body: { name: 'Valid Person', username: 'validperson', email: 'bad@', password: 'passWord1234' } });
  equal(result.status, 400, 'malformed email is rejected');
  result = await request('/auth/register', { method: 'POST', body: { name: 'Valid Person', username: 'x!', email: 'valid@example.test', password: 'passWord1234' } });
  equal(result.status, 400, 'invalid username characters are rejected');
  result = await request('/auth/register', { method: 'POST', body: { name: 'X', username: 'validperson', email: 'valid@example.test', password: 'passWord1234' } });
  equal(result.status, 400, 'short display name is rejected');

  // Create real attendee, organizer and admin accounts; no seed dependency.
  const attendee = await register({ name: 'Avery Attendee', username: 'avery', email: 'avery@example.test' });
  const organizer = await register({ name: 'Morgan Organizer', username: 'morgan', email: 'morgan@example.test', role: 'organizer' });
  const admin = await register({ name: 'Riley Admin', username: 'riley', email: 'riley@example.test' });
  const second = await register({ name: 'Jordan Guest', username: 'jordan', email: 'jordan@example.test' });
  system.db.run("UPDATE users SET role='admin' WHERE id=?", [admin.user.id]);
  admin.user.role = 'admin';
  equal(attendee.user.role, 'attendee', 'new accounts default to attendee');
  equal(organizer.user.role, 'organizer', 'organizer role is available at registration');
  equal(admin.user.role, 'admin', 'admin role is only granted outside public registration');
  check(Boolean(attendee.token), 'registration returns a bearer token');
  check(attendee.cookie.includes('HttpOnly'), 'session cookie is HttpOnly');
  check(attendee.cookie.includes('SameSite=Lax'), 'session cookie uses SameSite=Lax');
  check(attendee.cookie.includes('Priority=High'), 'session cookie receives high browser eviction priority');
  check(attendee.cookie.includes('Max-Age=2592000'), 'session cookie has a 30-day lifetime');
  const attendeeCookieHeader = attendee.cookie.split(';')[0];
  result = await request('/auth/me', { headers: { Cookie: attendeeCookieHeader, Origin: 'http://localhost:5173' } });
  equal(result.status, 200, 'same-origin approved session cookie authenticates without browser storage');
  result = await request('/auth/logout', { method: 'POST', headers: { Cookie: attendeeCookieHeader }, body: {} });
  equal(result.status, 403, 'cookie-authenticated mutation without an approved Origin is rejected');
  equal(result.data.error, 'CSRF_REJECTED', 'cookie-authenticated mutation uses a stable CSRF error');
  result = await request('/auth/register', { method: 'POST', body: { name: 'Avery Attendee', username: 'avery', email: 'avery@example.test', password: 'passWord1234' } });
  equal(result.status, 409, 'duplicate email or username is rejected');
  result = await request('/auth/me', { token: attendee.token });
  equal(result.status, 200, 'registered bearer token authenticates');
  equal(result.data.user.id, attendee.user.id, 'auth/me returns the signed-in user');
  check(!Object.hasOwn(result.data.user, 'password_hash'), 'password hash is never returned');
  result = await request('/auth/me');
  equal(result.status, 401, 'private route denies missing credentials');
  equal(result.data.error, 'SIGN_IN_REQUIRED', 'unauthenticated API uses a stable session contract code');

  result = await request('/auth/login', { method: 'POST', body: { identifier: attendee.user.email, password: 'passWord1234' } });
  equal(result.status, 200, 'login accepts email');
  check(Boolean(result.data.token), 'login returns a signed token');
  check(result.headers.get('set-cookie')?.includes('HttpOnly'), 'login sets the session cookie');
  result = await request('/auth/login', { method: 'POST', body: { identifier: attendee.user.username, password: 'passWord1234' } });
  equal(result.status, 200, 'login accepts username');
  result = await request('/auth/login', { method: 'POST', body: { identifier: attendee.user.email, password: 'wrongPass123' } });
  equal(result.status, 401, 'wrong password is rejected');
  equal(result.data.error, 'INVALID_CREDENTIALS', 'login errors do not leak account existence');
  result = await request('/auth/login', { method: 'POST', body: { identifier: '', password: '' } });
  equal(result.status, 400, 'empty login fields are rejected');

  // Persistent server-side sessions and silent token renewal after the half-life.
  const claims = JSON.parse(Buffer.from(attendee.token.split('.')[1], 'base64url').toString());
  check(Boolean(system.db.get('SELECT id FROM sessions WHERE id=? AND user_id=?', [claims.sid, attendee.user.id])), 'session id is persisted server-side');
  const oldIat = Math.floor(Date.now() / 1000) - Math.floor(system.config.tokenDays * 86400 * 0.6);
  const oldToken = signForSession(attendee.user, claims.sid, system.config, oldIat);
  result = await request('/auth/me', { token: oldToken });
  equal(result.status, 200, 'a still-valid token past its half-life is renewed silently');
  check(Boolean(result.headers.get('x-session-token')), 'renewed token is returned on the response header');
  const renewedClaims = JSON.parse(Buffer.from(result.headers.get('x-session-token').split('.')[1], 'base64url').toString());
  equal(renewedClaims.sid, claims.sid, 'silent renewal keeps the persistent session id');
  check(Date.parse(system.db.get('SELECT expires_at FROM sessions WHERE id=?', [claims.sid]).expires_at) > Date.now() + 20 * 86400000, 'renewal extends the server-side session expiry');
  result = await request('/auth/refresh', { method: 'POST', token: attendee.token, body: {} });
  equal(result.status, 200, 'explicit silent refresh endpoint succeeds');
  check(Boolean(result.data.token), 'refresh returns the new token for bearer clients');
  result = await request('/auth/me', { token: 'not.a.valid.token' });
  equal(result.status, 401, 'invalid JWT is rejected');

  // Self-service password change revokes other sessions and keeps the policy.
  const pwuser = await register({ name: 'Pw Change', username: 'pwuser', email: 'pwuser@example.test' });
  result = await request('/auth/password', { method: 'POST', token: pwuser.token, body: { current_password: 'wrongCurrent1', new_password: 'newPassWord123' } });
  equal(result.status, 401, 'password change rejects a wrong current password');
  result = await request('/auth/password', { method: 'POST', token: pwuser.token, body: { current_password: 'passWord1234', new_password: 'weak' } });
  equal(result.status, 400, 'password change enforces the password policy');
  const pwFirstToken = pwuser.token;
  result = await request('/auth/login', { method: 'POST', body: { identifier: 'pwuser@example.test', password: 'passWord1234' } });
  const pwSecondToken = result.data.token;
  result = await request('/auth/password', { method: 'POST', token: pwSecondToken, body: { current_password: 'passWord1234', new_password: 'newPassWord123' } });
  equal(result.status, 200, 'password change succeeds with the correct current password');
  result = await request('/auth/me', { token: pwFirstToken });
  equal(result.status, 401, 'password change revokes other sessions');
  result = await request('/auth/login', { method: 'POST', body: { identifier: 'pwuser@example.test', password: 'newPassWord123' } });
  equal(result.status, 200, 'login works with the new password');

  // Eight seeded categories are required by the product surface; check their values and local artwork.
  result = await request('/categories');
  equal(result.status, 200, 'categories route returns successfully');
  equal(result.data.categories.length, 0, 'empty database has no seeded category accounts');
  const categoryNames = ['Music','Technology','Sports','Business','Food','Arts','Community','Wellness'];
  for (const [index, name] of categoryNames.entries()) {
    const category = system.db.run('INSERT INTO categories(name,slug,description,cover,color,sort_order) VALUES(?,?,?,?,?,?)', [name,name.toLowerCase(),`${name} events and gatherings.`,`/covers/${name.toLowerCase()}.jpg`,['#292929','#333333','#262626','#3a3a3a','#303030','#202020','#3d3d3d','#2d2d2d'][index],index+1]);
    check(category.lastID > 0, `${name} category has a persisted id`);
  }
  result = await request('/categories');
  equal(result.data.categories.length, 8, 'the complete eight-category set is available');
  for (const [index, category] of result.data.categories.entries()) {
    check(categoryNames.includes(category.name), `category ${index+1} uses an approved name`);
    check(category.slug === category.name.toLowerCase(), `category ${category.name} has a stable slug`);
    check(/^#[0-9a-f]{6}$/i.test(category.color), `category ${category.name} has a neutral hex token`);
    check(category.cover.startsWith('/covers/'), `category ${category.name} uses local artwork`);
    check(category.sort_order === index+1, `category ${category.name} has a deterministic sort position`);
  }
  result = await request('/categories/music');
  equal(result.status, 200, 'category detail route resolves by slug');
  equal(result.data.category.name, 'Music', 'category detail returns the requested category');
  equal((await request('/categories/does-not-exist')).status, 404, 'unknown category returns not found');

  // Create events through the public API with full fields and ticket tiers.
  const future = (days) => { const d=new Date(Date.now()+days*86400000); return d.toISOString().slice(0,10); };
  const categoryId = result.data?.category?.id || system.db.get('SELECT id FROM categories WHERE slug=?', ['music']).id;
  const eventBody = {
    title: 'A Carefully Made Evening', category_id: categoryId, description: 'A long-form evening with good music, a thoughtful host and space to meet someone new.',
    date: future(14), time: '18:30', end_time: '21:00', location: 'Nairobi', venue: 'The Assembly, Kilimani', price: 1200, currency: 'KES', capacity: 70,
    cover_image: '/covers/music.jpg', status: 'published', ticket_tiers: [{ name:'General admission', description:'Standard entry', price:1200, quantity:50 }, { name:'Front row', description:'Close-up seating', price:2000, quantity:20 }]
  };
  result = await request('/events', { method:'POST', token:organizer.token, body:eventBody });
  equal(result.status, 201, 'organizer can create an event');
  const event = result.data.event;
  check(event.id > 0, 'created event has a database id');
  check(event.slug.startsWith('a-carefully-made-evening'), 'event slug is derived safely');
  equal(event.organizer_id, organizer.user.id, 'event ownership is server-assigned');
  equal(event.status, 'published', 'event status is published');
  equal(event.price_minor, 120000, 'event price is stored in minor units');
  equal(event.currency, 'KES', 'event currency is retained');
  equal(event.capacity, 70, 'event capacity is persisted');
  equal(event.cover_image, '/covers/music.jpg', 'event cover is a local media path');
  check(Boolean(system.db.get('SELECT id FROM ticket_types WHERE event_id=?', [event.id])), 'ticket tiers persist with the event');
  equal((await request(`/events/${event.id}`)).status, 200, 'event detail is publicly discoverable');
  const details = await request(`/events/${event.id}`);
  equal(details.data.event.title, eventBody.title, 'event detail returns the submitted title');
  equal(details.data.ticketTypes.length, 2, 'event detail includes both ticket tiers');
  equal(details.data.ticketTypes[0].name, 'General admission', 'ticket tiers retain their names');
  equal(details.data.ticketTypes[1].price_minor, 200000, 'tier price is stored in minor units');
  equal(details.data.event.organizer_name, organizer.user.name, 'event detail includes organizer identity');
  result = await request(`/events/${event.id}/not-a-real-slug`);
  equal(result.status, 200, 'optional slug does not prevent id-based event lookup');
  result = await request('/events/999999');
  equal(result.status, 404, 'unknown event returns not found');
  result = await request('/events', { method:'POST', token:attendee.token, body:{ ...eventBody, title:'x', date:'y' } });
  equal(result.status, 400, 'invalid event payload is rejected');
  result = await request('/events', { method:'POST', body:eventBody });
  equal(result.status, 401, 'event creation requires a signed-in user');
  result = await request('/events', { method:'POST', token:organizer.token, body:{ ...eventBody, title:'External Cover Probe', cover_image:'https://evil.example/x.jpg' } });
  equal(result.status, 400, 'external cover image URLs are rejected');
  result = await request('/events', { method:'POST', token:organizer.token, body:{ ...eventBody, title:'Script Cover Probe', cover_image:'javascript:alert(1)' } });
  equal(result.status, 400, 'non-path cover values are rejected');

  // Add a free event for RSVP tests.
  result = await request('/events', { method:'POST', token:organizer.token, body:{ ...eventBody, title:'Open Neighbourhood Table', date:future(18), price:0, ticket_tiers:[{name:'Free place',price:0,quantity:40}] } });
  equal(result.status, 201, 'a free event can be published');
  const freeEvent = result.data.event;
  equal(freeEvent.price_minor, 0, 'free event is stored with zero minor units');

  // Search, filter and ordering all use the live event table.
  result = await request('/events?limit=20&sort=date');
  equal(result.status, 200, 'event index loads');
  check(result.data.total >= 2, 'event index counts published events');
  check(result.data.events[0].date <= result.data.events[1].date, 'event index is ordered by date');
  result = await request(`/events?q=${encodeURIComponent('Carefully Made')}`);
  equal(result.data.events.length, 1, 'keyword search finds a matching event');
  equal(result.data.events[0].id, event.id, 'keyword search returns the correct event');
  result = await request(`/events?category=music`);
  check(result.data.events.some((item)=>item.id===event.id), 'category filter returns matching event');
  result = await request('/events?location=Kilimani');
  check(result.data.events.some((item)=>item.id===event.id), 'location filter searches venue and city');
  result = await request('/events?price=paid');
  check(result.data.events.length > 0 && result.data.events.every((item)=>item.price_minor>0), 'paid filter excludes free events');
  result = await request('/events?price=free');
  check(result.data.events.some((item)=>item.id===freeEvent.id), 'free filter includes free registrations');
  result = await request(`/events?dateFrom=${future(10)}&dateTo=${future(16)}`);
  check(result.data.events.some((item)=>item.id===event.id), 'date range filter includes the target event');
  result = await request('/events?maxPrice=13');
  check(result.data.events.every((item)=>item.price_minor<=1300), 'maximum price filter uses the displayed currency amount');
  result = await request('/events?q=%27%20OR%201%3D1--');
  check(result.status===200 && result.data.events.length<1000, 'search input is treated as a bound parameter');
  result = await request(`/categories/music`);
  check(result.data.events.some((item)=>item.id===event.id), 'category landing lists its upcoming events');
  result = await request('/feed');
  equal(result.status, 200, 'home feed loads');
  check(Array.isArray(result.data.featured), 'feed contains a featured rail');
  check(Array.isArray(result.data.upcoming), 'feed contains upcoming events');
  check(result.data.upcoming[0].date <= result.data.upcoming.at(-1).date, 'upcoming feed remains date ordered');
  equal(result.data.categories.length, 8, 'home feed contains all category tiles');

  // Comments, event follows, saves, profiles and free RSVPs.
  result = await request('/comments', { method:'POST', token:attendee.token, body:{ event_id:event.id, body:'Looking forward to this. Is there seating?' } });
  equal(result.status, 201, 'attendee can post an event comment');
  check(result.data.comment.id > 0, 'comment receives a persistent id');
  equal(result.data.comment.user_name, attendee.user.name, 'comment author is taken from the session');
  result = await request('/comments', { method:'POST', token:attendee.token, body:{ event_id:event.id, body:'x' } });
  equal(result.status, 400, 'comment body length is validated');
  result = await request(`/comments?event_id=${event.id}`);
  equal(result.data.comments.length, 1, 'comments list is persisted and readable');
  result = await request(`/events/${event.id}/follow`, { method:'POST', token:attendee.token, body:{} });
  equal(result.status, 200, 'attendee can follow an event');
  equal(result.data.following, true, 'first follow turns the state on');
  result = await request(`/events/${event.id}/follow`, { method:'POST', token:attendee.token, body:{} });
  equal(result.data.following, false, 'second follow toggles the state off');
  result = await request(`/events/${event.id}/save`, { method:'POST', token:attendee.token, body:{} });
  equal(result.data.saved, true, 'attendee can save an event');
  result = await request('/me/saved', { token:attendee.token });
  check(result.data.events.some((item)=>item.id===event.id), 'saved list includes the event');
  result = await request(`/events/${event.id}/save`, { method:'POST', token:attendee.token, body:{} });
  equal(result.data.saved, false, 'saved event can be removed');
  result = await request(`/events/${freeEvent.id}/rsvp`, { method:'POST', token:attendee.token, body:{} });
  equal(result.status, 201, 'attendee can register for a free event');
  equal(result.data.registered, true, 'free RSVP is confirmed');
  result = await request(`/events/${event.id}/rsvp`, { method:'POST', token:attendee.token, body:{} });
  equal(result.status, 409, 'paid events cannot bypass checkout with an RSVP');
  result = await request('/me/events', { token:organizer.token });
  equal(result.data.events.length, 2, 'organizer profile lists owned events');
  result = await request(`/users/${organizer.user.id}`);
  equal(result.status, 200, 'public profile route returns an organizer');
  equal(result.data.events.length, 2, 'profile includes public events');
  result = await request(`/users/${organizer.user.id}/follow`, { method:'POST', token:attendee.token, body:{} });
  equal(result.data.following, true, 'attendee can follow a person');
  result = await request(`/users/${organizer.user.id}`);
  equal(result.data.stats.followers, 1, 'follower count reflects the live follow table');
  result = await request(`/users/${organizer.user.id}/followers`);
  equal(result.status, 200, 'followers list endpoint is public');
  check(result.data.users.some((u) => u.id === attendee.user.id), 'followers list includes the new follower');
  result = await request(`/users/${attendee.user.id}/following`);
  equal(result.status, 200, 'following list endpoint is public');
  check(result.data.users.some((u) => u.id === organizer.user.id), 'following list includes the followed organizer');
  result = await request('/users/nope/followers');
  equal(result.status, 400, 'followers list rejects a bad id');
  result = await request(`/users/${attendee.user.id}/follow`, { method:'POST', token:attendee.token, body:{} });
  equal(result.status, 400, 'self-follow is rejected');
  result = await request('/me/profile', { method:'PUT', token:attendee.token, body:{ name:'Avery N.', bio:'I like small rooms and useful plans.', avatar:'' } });
  equal(result.status, 200, 'attendee can update profile details');
  equal(result.data.user.name, 'Avery N.', 'profile name update persists');
  equal(result.data.user.bio, 'I like small rooms and useful plans.', 'profile bio update persists');
  check(!Object.hasOwn(result.data.user, 'password_hash'), 'profile responses omit credential data');
  result = await request('/me/notifications', { token:organizer.token });
  check(result.data.notifications.length >= 2, 'comment, follow and RSVP create organizer notifications');
  check(result.data.unread >= 2, 'notification response includes an unread count');
  result = await request('/me/notifications/read', { method:'PATCH', token:organizer.token, body:{} });
  equal(result.data.unread, 0, 'mark-all-read clears the notification badge count');

  // People search powers the "start a chat" entry points.
  result = await request('/users/search?q=morg');
  equal(result.status, 401, 'people search requires a signed-in user');
  result = await request('/users/search?q=', { token: attendee.token });
  equal(result.status, 400, 'people search rejects an empty query');
  result = await request('/users/search?q=morg', { token: attendee.token });
  equal(result.status, 200, 'people search works for signed-in users');
  check(result.data.users.some((u) => u.id === organizer.user.id), 'people search finds members by username');
  check(!result.data.users.some((u) => 'email' in u), 'people search never exposes email addresses');
  result = await request('/users/search?q=Avery', { token: attendee.token });
  check(!result.data.users.some((u) => u.id === attendee.user.id), 'people search excludes the searcher');

  // Chat is 1:1, persisted over HTTP, and pushed in real time over Socket.IO.
  result = await request('/chat/conversations', { method:'POST', token:attendee.token, body:{ user_id:organizer.user.id } });
  equal(result.status, 201, 'attendee can create a one-to-one conversation');
  const conversation = result.data.conversation;
  equal(result.data.conversation.status, 'pending', 'new conversations begin as pending message requests');
  result = await request(`/chat/conversations/${conversation.id}/messages`, { method:'POST', token:attendee.token, body:{ body:'Too early.' } });
  equal(result.status, 403, 'messages are locked while the request is pending');
  result = await request('/chat/requests', { token:organizer.token });
  check(result.data.requests.some((r)=>r.id===conversation.id && !r.from_me), 'recipient sees the incoming message request');
  result = await request('/chat/requests', { token:attendee.token });
  check(result.data.requests.some((r)=>r.id===conversation.id && r.from_me), 'sender sees their outgoing request as pending');
  result = await request(`/chat/requests/${conversation.id}/accept`, { method:'POST', token:organizer.token, body:{} });
  equal(result.status, 200, 'recipient can accept a message request');
  equal(result.data.conversation.status, 'active', 'accepted requests become active conversations');
  result = await request('/chat/conversations', { method:'POST', token:attendee.token, body:{ user_id:organizer.user.id } });
  equal(result.status, 200, 'starting the same one-to-one chat is idempotent');
  equal(result.data.conversation.id, conversation.id, 'existing conversation is reused');
  result = await request('/chat/conversations', { method:'POST', token:attendee.token, body:{ user_id:attendee.user.id } });
  equal(result.status, 400, 'a user cannot create a conversation with themselves');
  result = await request('/chat/conversations', { token:attendee.token });
  check(result.data.conversations.some((item)=>item.id===conversation.id), 'conversation list includes the accepted chat');
  // Decline flow: a declined request never becomes a chat.
  result = await request('/chat/conversations', { method:'POST', token:attendee.token, body:{ user_id:second.user.id } });
  const declinedId = result.data.conversation.id;
  result = await request(`/chat/requests/${declinedId}/decline`, { method:'POST', token:second.token, body:{} });
  equal(result.status, 200, 'recipient can decline a message request');
  result = await request(`/chat/conversations/${declinedId}/messages`, { method:'POST', token:attendee.token, body:{ body:'Should not land.' } });
  equal(result.status, 403, 'declined requests cannot receive messages');
  result = await request('/chat/requests', { token:second.token });
  check(!result.data.requests.some((r)=>r.id===declinedId), 'declined requests leave the request list');
  result = await request(`/chat/conversations/${conversation.id}/messages`, { method:'POST', token:attendee.token, body:{ body:'Hello, I have a question about doors.' } });
  equal(result.status, 201, 'chat message can be sent and persisted');
  equal(result.data.message.sender_id, attendee.user.id, 'chat sender is session-bound');
  result = await request(`/chat/conversations/${conversation.id}/messages`, { token:organizer.token });
  equal(result.data.messages.length, 1, 'recipient can read the persisted message');
  equal(result.data.messages[0].body, 'Hello, I have a question about doors.', 'chat body is preserved');
  result = await request('/chat/unread', { token:organizer.token });
  equal(result.data.unread, 0, 'opening the conversation clears message unread count');
  result = await request(`/chat/conversations/${conversation.id}/messages`, { token:second.token });
  equal(result.status, 404, 'non-participant cannot read a private conversation');
  result = await request(`/chat/conversations/${conversation.id}/messages`, { method:'POST', token:attendee.token, body:{ body:'' } });
  equal(result.status, 400, 'empty chat messages are rejected');

  // Actual Socket.IO delivery between authenticated participants.
  const socketConversation = await request('/chat/conversations', { method:'POST', token:second.token, body:{ user_id:organizer.user.id } });
  const liveConversationId = socketConversation.data.conversation.id;
  const socketA = socketClient(base.replace('/api',''), { auth:{ token:second.token }, transports:['websocket'], forceNew:true, reconnection:false });
  const socketB = socketClient(base.replace('/api',''), { auth:{ token:organizer.token }, transports:['websocket'], forceNew:true, reconnection:false });
  await Promise.all([new Promise((resolve,reject)=>{socketA.once('connect',resolve);socketA.once('connect_error',reject);}),new Promise((resolve,reject)=>{socketB.once('connect',resolve);socketB.once('connect_error',reject);})]);
  const roomA = await new Promise((resolve)=>socketA.emit('conversation:join',liveConversationId,resolve));
  const roomB = await new Promise((resolve)=>socketB.emit('conversation:join',liveConversationId,resolve));
  check(roomA.ok, 'sender socket joins an authorized conversation');
  check(roomB.ok, 'recipient socket joins an authorized conversation');
  const gated = await new Promise((resolve)=>socketA.emit('message:send',{conversationId:liveConversationId,body:'Too soon.'},resolve));
  check(gated.error === 'REQUEST_PENDING', 'the live channel honors pending message requests');
  await request(`/chat/requests/${liveConversationId}/accept`, { method:'POST', token:organizer.token, body:{} });
  const incoming = new Promise((resolve)=>socketB.once('message:new',resolve));
  const ack = await new Promise((resolve)=>socketA.emit('message:send',{conversationId:liveConversationId,body:'This arrived over the live channel.'},resolve));
  check(ack.ok && ack.message?.id, 'Socket.IO acknowledges a persisted message');
  const pushedMessage = await incoming;
  equal(pushedMessage.body, 'This arrived over the live channel.', 'Socket.IO pushes a message to the other participant');
  socketB.disconnect();

  // Uploads require auth, use an allowlisted MIME/extension pair and serve from local storage.
  const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=','base64');
  const form = new FormData();form.append('kind','avatar');form.append('file',new Blob([pngBytes],{type:'image/png'}),'tiny.png');
  result = await request('/uploads',{method:'POST',token:attendee.token,body:form});
  equal(result.status,201,'authenticated user can upload an allowed local image');
  check(/^\/uploads\/[a-f0-9-]+\.png$/.test(result.data.url),'upload path is generated and traversal-safe');
  equal(fs.statSync(path.join(system.config.uploadsDir,result.data.name)).mode & 0o777,0o600,'uploaded media file is private on disk');
  equal((await request(result.data.url.replace('/uploads','/uploads'))).status,404,'upload file is not exposed through the API route');
  const staticUpload = await fetch(`${base.replace('/api','')}${result.data.url}`);
  equal(staticUpload.status,200,'uploaded file is served from the local uploads directory');
  const badForm = new FormData();badForm.append('file',new Blob(['not an image'],{type:'text/plain'}),'script.txt');
  result = await request('/uploads',{method:'POST',token:attendee.token,body:badForm});
  equal(result.status,400,'unsupported MIME and extension are rejected');
  const spoofedForm = new FormData();spoofedForm.append('file',new Blob(['not really a png'],{type:'image/png'}),'spoofed.png');
  result = await request('/uploads',{method:'POST',token:attendee.token,body:spoofedForm});
  equal(result.status,400,'image signature must match the declared MIME type and extension');
  equal(result.data.error,'INVALID_UPLOAD','spoofed file signatures return a safe upload error');
  result = await request('/uploads',{method:'POST',body:form});
  equal(result.status,401,'upload route requires authentication');

  // Provider settings do not disclose secrets; sandbox status is queried server-side.
  result = await request('/settings/public');
  equal(result.status,200,'public payment settings load');
  equal(result.data.payment_mode,'sandbox','unconfigured test providers are explicitly in sandbox mode');
  check(result.data.sandbox_notice.includes('nothing is charged'),'sandbox notice states that no money is charged');
  equal(result.data.providers.mpesa,false,'public settings only report M-Pesa readiness, not credentials');
  equal(result.data.providers.stripe,false,'public settings only report Stripe readiness, not credentials');
  check(!JSON.stringify(result.data).includes('consumer_secret'),'Safaricom secret is never exposed to the client');
  check(!JSON.stringify(result.data).includes('secret_key'),'Stripe secret is never exposed to the client');
  check((await request('/promotions/pricing')).data.currencies.length===6,'promotion price list covers all supported currencies');
  const prices = await request('/promotions/pricing');
  for(const currency of ['KES','USD','EUR','GBP','NGN','ZAR']){
    check(Boolean(prices.data.pricing[currency]),`${currency} promotion pricing exists`);
    for(const placement of ['featured','boost','sponsored'])check(prices.data.pricing[currency][placement].amount_minor>0,`${currency} ${placement} has a positive price`);
  }
  const paymentBody={event_id:event.id,ticket_type_id:details.data.ticketTypes[0].id,provider:'mpesa',currency:'KES',idempotency_key:'api-ticket-intent-1'};
  result = await request('/payments',{method:'POST',token:attendee.token,body:{...paymentBody,currency:'USD',idempotency_key:'api-mpesa-non-kes'}});
  equal(result.status,400,'M-Pesa checkout refuses non-KES currencies');
  result = await request('/payments',{method:'POST',token:attendee.token,body:paymentBody});
  equal(result.status,201,'attendee can create a payment intent');
  equal(result.data.payment.status,'pending','payment intent begins pending');
  equal(result.data.mode,'sandbox','payment intent states sandbox mode');
  check(result.data.message.includes('no charge'),'payment response tells the guest that sandbox is not charged');
  check(result.data.payment.amount_minor===120000,'payment amount is stored in minor units');
  check(result.data.payment.commission_minor===6000,'default commission is five percent');
  check(result.data.payment.provider_reference.startsWith('sandbox-mpesa-'),'sandbox provider reference is server generated');
  check(!JSON.stringify(result.data).includes('consumer_secret'),'payment response contains no provider secret');
  const mpesaConfig={...system.config.mpesa};
  system.config.mpesa={env:'sandbox',consumerKey:'test-consumer-key',consumerSecret:'test-consumer-secret',shortcode:'174379',passkey:'test-passkey',callbackUrl:'https://events.example.test/api/payments/callback/mpesa?source=safaricom',callbackToken:'provider-callback-test-token'};
  let stkPayload;
  const fetchBeforeMpesa=global.fetch;
  global.fetch=async(url,options={})=>{
    if(String(url).startsWith(base))return fetchBeforeMpesa(url,options);
    if(String(url).includes('/oauth/v1/generate'))return new Response(JSON.stringify({access_token:'api-test-access-token'}),{status:200,headers:{'content-type':'application/json'}});
    if(String(url).includes('/mpesa/stkpush/v1/processrequest')){stkPayload=JSON.parse(options.body);return new Response(JSON.stringify({ResponseCode:'0',CheckoutRequestID:'ws-generated-checkout',MerchantRequestID:'merchant-test'}),{status:200,headers:{'content-type':'application/json'}});}
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try{
    const liveIntent=await request('/payments',{method:'POST',token:attendee.token,body:{...paymentBody,idempotency_key:'api-mpesa-provider-intent',phone:'254700000000'}});
    equal(liveIntent.data.mode,'live','configured M-Pesa credentials create a live provider intent');
    const callbackUrl=new URL(stkPayload.CallBackURL);
    equal(callbackUrl.searchParams.get('ref'),String(liveIntent.data.payment.id),'M-Pesa callback carries the transaction reference');
    equal(callbackUrl.searchParams.get('token'),'provider-callback-test-token','M-Pesa callback includes its server-only shared verification token');
    equal(callbackUrl.searchParams.get('source'),'safaricom','existing callback URL parameters are preserved');
  }finally{global.fetch=fetchBeforeMpesa;system.config.mpesa=mpesaConfig;}
  result = await request('/payments',{method:'POST',token:attendee.token,body:paymentBody});
  equal(result.status,200,'same idempotency key returns the prior intent');
  equal(result.data.duplicate,true,'duplicate intent is identified');
  equal(result.data.payment.id,system.db.get('SELECT id FROM transactions WHERE user_id=? AND idempotency_key=?',[attendee.user.id,'api-ticket-intent-1']).id,'idempotent request keeps the same transaction');
  equal((await request('/tickets',{token:attendee.token})).data.tickets.length,0,'pending payment does not issue a ticket');
  result = await request(`/payments/${result.data.payment.id}/status`,{token:attendee.token});
  equal(result.status,200,'server status query is available to the owner');
  equal(result.data.payment.status,'successful','sandbox provider status query confirms payment on the server');
  equal(result.data.sandbox,true,'status response labels the sandbox environment');
  result = await request('/tickets',{token:attendee.token});
  equal(result.data.tickets.length,1,'confirmed payment issues exactly one ticket');
  const ticket=result.data.tickets[0];
  check(Boolean(ticket.signed_payload),'issued ticket contains a signed QR payload');
  check(ticket.signed_payload.split('.').length===2,'QR payload includes a body and signature');
  equal(ticket.transaction_id,system.db.get('SELECT id FROM transactions WHERE id=?',[ticket.transaction_id]).id,'ticket is linked to its transaction');
  result = await request(`/tickets/${ticket.id}`,{token:attendee.token});
  equal(result.status,200,'ticket owner can open ticket details');
  equal(result.data.ticket.event_title,event.title,'ticket detail names the purchased event');
  result = await request(`/tickets/${ticket.id}/qr`,{token:attendee.token});
  equal(result.status,200,'ticket QR can be generated');
  check(result.data.qr.startsWith('data:image/png;base64,'),'QR image is generated locally as a data URI');
  equal(result.data.payload,ticket.signed_payload,'QR image encodes the signed payload');
  result = await request(`/tickets/${ticket.id}`,{token:second.token});
  equal(result.status,403,'another attendee cannot read the ticket');
  result = await request('/verify',{method:'POST',token:attendee.token,body:{signed_payload:ticket.signed_payload}});
  equal(result.status,403,'attendee cannot access organizer verification');
  result = await request('/verify',{method:'POST',token:organizer.token,body:{signed_payload:ticket.signed_payload.replace(/\.[^.]+$/,'.tampered')}});
  equal(result.status,400,'tampered signed QR code is rejected');
  equal(result.data.valid,false,'tampered code response is explicitly invalid');
  result = await request('/verify',{method:'POST',token:organizer.token,body:{signed_payload:'just-a-random-code'}});
  equal(result.status,400,'unsigned manual code is rejected');
  result = await request('/verify',{method:'POST',token:organizer.token,body:{signed_payload:ticket.signed_payload}});
  equal(result.status,200,'event organizer can verify a signed guest ticket');
  equal(result.data.valid,true,'valid signed payload verifies');
  equal(result.data.ticket.attendee_name,'Avery N.','verification returns the live attendee name');
  result = await request('/verify',{method:'POST',token:organizer.token,body:{signed_payload:ticket.signed_payload,check_in:true}});
  equal(result.status,200,'organizer can check a valid ticket in');
  equal(result.data.checked_in,true,'check-in is persisted');
  result = await request('/verify',{method:'POST',token:organizer.token,body:{signed_payload:ticket.signed_payload}});
  equal(result.data.ticket.status,'checked_in','repeat validation reports checked-in status');
  result = await request(`/payments/${ticket.transaction_id}/status`,{method:'POST',token:attendee.token,body:{status:'successful'}});
  equal(result.status,404,'frontend cannot post a successful payment status');

  // Promotion is pending until the server queries/validates payment status.
  result = await request('/promotions',{method:'POST',token:organizer.token,body:{event_id:event.id,placement:'sponsored',currency:'KES',provider:'stripe',idempotency_key:'api-promotion-1'}});
  equal(result.status,201,'event owner can request a sponsored promotion');
  equal(result.data.promotion.status,'pending','promotion starts pending');
  check(!system.db.get('SELECT id FROM promotions WHERE event_id=? AND status="active"',[event.id]),'promotion is not active before payment confirmation');
  check(result.data.payment.amount_minor===500000,'sponsored placement shows its KES price in minor units');
  check(result.data.message.includes('no charge'),'promotion sandbox UI contract is explicit');
  result = await request(`/payments/${result.data.payment.id}/status`,{token:organizer.token});
  equal(result.data.payment.status,'successful','promotion payment is confirmed by a provider status query');
  const promotion = system.db.get('SELECT * FROM promotions WHERE transaction_id=?',[result.data.payment.id]);
  equal(promotion.status,'active','promotion activates only after confirmed payment');
  check(Boolean(promotion.starts_at)&&Boolean(promotion.ends_at),'active promotion has an activation window');
  result = await request(`/events/${event.id}`);
  equal(result.data.event.sponsored_placement,'sponsored','sponsored event receives a sponsored label in listings');
  result = await request('/promotions',{method:'POST',token:attendee.token,body:{event_id:event.id,placement:'boost',currency:'KES',provider:'stripe',idempotency_key:'intruder-promo'}});
  equal(result.status,403,'non-owner cannot buy promotion for someone else’s event');
  result = await request('/promotions',{method:'POST',token:organizer.token,body:{event_id:event.id,placement:'neon',currency:'KES',provider:'stripe',idempotency_key:'bad-promo'}});
  equal(result.status,400,'unsupported promotion placement is rejected');

  // Provider status lookup failures are non-terminal: payment remains pending.
  const outageTx = system.db.run(`INSERT INTO transactions(user_id,event_id,ticket_type_id,provider,status,provider_reference,amount_minor,currency,idempotency_key,commission_minor,purpose,metadata,created_at,updated_at)
    VALUES(?,?,NULL,'stripe','pending','cs_outage_reference',1200,'KES','provider-outage-1',60,'ticket',?,?,?)`, [attendee.user.id,event.id,JSON.stringify({mode:'live'}),nowIso(),nowIso()]).lastID;
  const priorFetch=global.fetch;global.fetch=async(url,...args)=>{if(String(url).startsWith(base))return priorFetch(url,...args);throw new Error('simulated provider network outage');};
  try{
    result=await request(`/payments/${outageTx}/status`,{token:attendee.token});
    equal(result.data.payment.status,'pending','provider status lookup failure leaves payment pending');
  }finally{global.fetch=priorFetch;}

  // Provider callbacks are signed; a verified callback can finalize a live payment.
  system.config.stripe.webhookSecret='api-test-webhook-secret';
  const stripeTx=system.db.run(`INSERT INTO transactions(user_id,event_id,ticket_type_id,provider,status,provider_reference,amount_minor,currency,idempotency_key,commission_minor,purpose,metadata,created_at,updated_at)
    VALUES(?,?,NULL,'stripe','pending','cs_verified_reference',1500,'KES','stripe-webhook-1',75,'ticket',?,?,?)`,[attendee.user.id,event.id,JSON.stringify({mode:'live'}),nowIso(),nowIso()]).lastID;
  const eventPayload={type:'checkout.session.completed',data:{object:{id:'cs_verified_reference',payment_status:'paid',amount_total:1500,currency:'kes',metadata:{transaction_id:String(stripeTx)}}}};
  const rawBody=JSON.stringify(eventPayload);const timestamp=Math.floor(Date.now()/1000);const signature=crypto.createHmac('sha256',system.config.stripe.webhookSecret).update(`${timestamp}.${rawBody}`).digest('hex');
  const wrongAmountPayload={...eventPayload,data:{object:{...eventPayload.data.object,amount_total:1}}};
  const wrongAmountBody=JSON.stringify(wrongAmountPayload);const wrongAmountSignature=crypto.createHmac('sha256',system.config.stripe.webhookSecret).update(`${timestamp}.${wrongAmountBody}`).digest('hex');
  result=await fetch(`${base}/payments/callback/stripe`,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':`t=${timestamp},v1=${wrongAmountSignature}`},body:wrongAmountBody});
  equal(result.status,400,'signed Stripe callback with a mismatched amount is rejected');
  equal(system.db.get('SELECT status FROM transactions WHERE id=?',[stripeTx]).status,'pending','Stripe amount mismatch does not confirm payment');
  result=await fetch(`${base}/payments/callback/stripe`,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':`t=${timestamp},v1=invalid,v1=${signature}`},body:rawBody});
  equal(result.status,200,'valid Stripe webhook signature is accepted from multiple signature values');
  equal(system.db.get('SELECT status FROM transactions WHERE id=?',[stripeTx]).status,'successful','verified Stripe callback confirms the payment');
  check(Boolean(system.db.get('SELECT id FROM tickets WHERE transaction_id=?',[stripeTx])),'verified live payment also issues a signed ticket');
  result=await fetch(`${base}/payments/callback/stripe`,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':`t=${timestamp},v1=invalid`},body:rawBody});
  equal(result.status,401,'invalid Stripe webhook signature is rejected');
  system.config.mpesa.callbackToken='api-test-mpesa-token';
  const mpesaTx=system.db.run(`INSERT INTO transactions(user_id,event_id,ticket_type_id,provider,status,provider_reference,amount_minor,currency,idempotency_key,commission_minor,purpose,metadata,created_at,updated_at)
    VALUES(?,?,NULL,'mpesa','pending','ws-test-reference',1000,'KES','mpesa-callback-1',50,'ticket',?,?,?)`,[attendee.user.id,event.id,JSON.stringify({mode:'live'}),nowIso(),nowIso()]).lastID;
  result=await request(`/payments/callback/mpesa?ref=${mpesaTx}`,{method:'POST',body:{Body:{stkCallback:{ResultCode:0,CheckoutRequestID:'ws-test-reference'}}}});
  equal(result.status,401,'M-Pesa callback without shared verification token is rejected');
  result=await request(`/payments/callback/mpesa?ref=${mpesaTx}`,{method:'POST',headers:{'X-MPESA-CALLBACK-TOKEN':'é'.repeat('api-test-mpesa-token'.length)},body:{Body:{stkCallback:{ResultCode:0,CheckoutRequestID:'ws-test-reference'}}}});
  equal(result.status,401,'multibyte callback-token mismatch is rejected cleanly');
  result=await request(`/payments/callback/mpesa?ref=${mpesaTx}`,{method:'POST',headers:{'X-MPESA-CALLBACK-TOKEN':'api-test-mpesa-token'},body:{Body:{stkCallback:{ResultCode:0,CheckoutRequestID:'ws-test-reference',CallbackMetadata:{Item:[{Name:'Amount',Value:9}]}}}}});
  equal(result.status,400,'M-Pesa callback with a mismatched amount is rejected');
  equal(system.db.get('SELECT status FROM transactions WHERE id=?',[mpesaTx]).status,'pending','amount mismatch does not confirm a ticket payment');
  result=await request(`/payments/callback/mpesa?ref=${mpesaTx}`,{method:'POST',headers:{'X-MPESA-CALLBACK-TOKEN':'api-test-mpesa-token'},body:{Body:{stkCallback:{ResultCode:0,CheckoutRequestID:'ws-test-reference',CallbackMetadata:{Item:[{Name:'Amount',Value:10}]}}}}});
  equal(result.status,200,'authenticated M-Pesa callback with the expected amount is accepted');
  equal(system.db.get('SELECT status FROM transactions WHERE id=?',[mpesaTx]).status,'successful','verified M-Pesa callback confirms payment');

  // Notifications, tickets and admin figures are reconciled against database rows.
  result=await request('/tickets',{token:attendee.token});
  check(result.data.tickets.length>=3,'all confirmed payment paths issue tickets');
  result=await request('/me/notifications',{token:attendee.token});
  check(result.data.notifications.some((item)=>item.type==='ticket'),'ticket issue creates an attendee notification');
  result=await request('/admin/figures',{token:attendee.token});
  equal(result.status,403,'non-admin cannot access figures');
  result=await request('/admin/figures',{token:admin.token});
  equal(result.status,200,'administrator can view live figures');
  const ticketRows=system.db.get("SELECT COUNT(*) AS n FROM tickets WHERE status IN ('valid','checked_in')").n;
  equal(result.data.total_tickets_sold,ticketRows,'admin ticket count matches the live tickets table');
  const liveTicketCommission=system.db.get("SELECT COALESCE(SUM(commission_minor),0) AS n FROM transactions WHERE status='successful' AND purpose='ticket'").n;
  const eventRow=result.data.per_event.find((row)=>row.event_id===event.id);
  check(Boolean(eventRow),'admin event breakdown includes the purchased event');
  equal(eventRow.tickets_sold,system.db.get("SELECT COUNT(*) AS n FROM tickets t JOIN transactions tx ON tx.id=t.transaction_id WHERE t.event_id=? AND tx.status='successful' AND tx.purpose='ticket'",[event.id]).n,'per-event ticket count matches successful ticket transactions');
  equal(eventRow.commission_minor,system.db.get("SELECT COALESCE(SUM(commission_minor),0) AS n FROM transactions WHERE event_id=? AND status='successful' AND purpose='ticket'",[event.id]).n,'per-event commission excludes promotion revenue');
  check(result.data.revenue.some((row)=>row.commission_minor>0),'aggregate commission includes confirmed transactions');
  check(liveTicketCommission>0,'ticket commissions are recorded in minor units');
  for(const row of result.data.revenue){
    const expected=system.db.get("SELECT COUNT(*) AS payments,COALESCE(SUM(amount_minor),0) AS gross_minor,COALESCE(SUM(commission_minor),0) AS commission_minor FROM transactions WHERE status='successful' AND currency=?",[row.currency]);
    equal(row.payments,expected.payments,`${row.currency} confirmed payment count is aggregated independently`);
    equal(row.gross_minor,expected.gross_minor,`${row.currency} gross volume matches the confirmed ledger`);
    equal(row.commission_minor,expected.commission_minor,`${row.currency} total commission matches the confirmed ledger`);
  }
  result=await request('/admin/users',{token:admin.token});
  equal(result.status,200,'admin can list accounts');
  check(result.data.users.length>=4,'admin account list reflects new accounts');
  check(result.data.users.some((user)=>user.id===second.user.id&&user.verified_at===null),'admin account list exposes the unverified state');
  result=await request(`/admin/users/${second.user.id}/verification`,{method:'PATCH',token:attendee.token,body:{verified:true}});
  equal(result.status,403,'non-admin cannot verify an account');
  result=await request(`/admin/users/${second.user.id}/verification`,{method:'PATCH',token:admin.token,body:{verified:'true'}});
  equal(result.status,400,'account verification requires a strict boolean');
  result=await request(`/admin/users/${second.user.id}/verification`,{method:'PATCH',token:admin.token,body:{verified:true}});
  equal(result.status,200,'admin can verify an account');
  check(Boolean(result.data.user.verified_at),'account verification records a timestamp');
  equal(system.db.get('SELECT verified_by FROM users WHERE id=?',[second.user.id]).verified_by,admin.user.id,'account verification records the reviewing admin');
  const verifiedAt=result.data.user.verified_at;
  result=await request(`/users/${second.user.id}`);
  equal(result.data.user.verified_at,verifiedAt,'public profile carries the verified-account badge state');
  result=await request(`/admin/users/${second.user.id}/verification`,{method:'PATCH',token:admin.token,body:{verified:true}});
  equal(result.data.user.verified_at,verifiedAt,'repeated verification is idempotent');
  result=await request(`/admin/users/${second.user.id}/verification`,{method:'PATCH',token:admin.token,body:{verified:false}});
  equal(result.status,200,'admin can revoke a verification');
  equal(result.data.user.verified_at,null,'revoking verification clears the public status');
  equal(system.db.get('SELECT verified_by FROM users WHERE id=?',[second.user.id]).verified_by,null,'revoking verification clears the reviewer pointer');
  equal(system.db.get("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type='user' AND entity_id=? AND action IN ('user.account_verified','user.account_unverified')",[second.user.id]).n,2,'verify and revoke actions are both audit logged');
  result=await request(`/admin/users/${second.user.id}/role`,{method:'PATCH',token:admin.token,body:{role:'organizer'}});
  equal(result.status,200,'admin can change a role');
  equal(result.data.user.role,'organizer','role change persists');
  result=await request(`/admin/users/${admin.user.id}/role`,{method:'PATCH',token:admin.token,body:{role:'attendee'}});
  equal(result.status,409,'admin cannot accidentally demote their own active account');
  result=await request('/admin/users',{token:organizer.token});
  equal(result.status,403,'organizer cannot list admin accounts');
  result=await request('/admin/settings',{token:admin.token});
  equal(result.status,200,'admin can read platform settings');
  equal(result.data.settings.commission_percent,'5','commission defaults to five percent');
  equal(result.data.settings.currency,'KES','platform currency defaults to KES');
  result=await request('/admin/settings',{method:'PATCH',token:admin.token,body:{settings:{commission_percent:'6.5',service_fee_minor:'75',currency:'EUR',support_email:'help@example.test'}}});
  equal(result.status,200,'admin can update configurable platform settings');
  equal(result.data.settings.commission_percent,'6.5','commission update is persisted');
  equal(result.data.settings.service_fee_minor,'75','service fee is persisted in minor units');
  equal(result.data.settings.currency,'EUR','default currency change is persisted');
  equal(result.data.settings.support_email,'help@example.test','support address is persisted');
  result=await request('/admin/settings',{method:'PATCH',token:admin.token,body:{settings:{stripe_secret_key:'sk_test_not_allowed'}}});
  equal(result.status,400,'secret-bearing setting names cannot be added through the settings API');
  result=await request('/admin/settings',{method:'PATCH',token:admin.token,body:{settings:{commission_percent:'99'}}});
  equal(result.status,400,'commission cap is validated');
  result=await request('/admin/events',{token:admin.token});
  check(result.data.events.some((row)=>row.id===event.id),'admin event management lists live events');
  result=await request(`/admin/events/${event.id}/status`,{method:'PATCH',token:admin.token,body:{status:'draft'}});
  equal(result.status,200,'admin can manage event publication');
  equal(result.data.event.status,'draft','admin status update persists');
  await request(`/admin/events/${event.id}/status`,{method:'PATCH',token:admin.token,body:{status:'published'}});
  result=await request('/admin/categories',{token:admin.token});
  equal(result.data.categories.length,8,'admin can manage the category list');
  result=await request('/admin/categories',{method:'POST',token:admin.token,body:{name:'Reading Room',description:'Book talks and small readings.'}});
  equal(result.status,201,'admin can add a category');
  equal(result.data.category.slug,'reading-room','new category receives a normalized slug');
  result=await request(`/admin/categories/${result.data.category.id}`,{method:'PATCH',token:admin.token,body:{description:'Independent publishing and readings.'}});
  equal(result.status,200,'admin can update a category');
  equal(result.data.category.description,'Independent publishing and readings.','category update is persisted');
  result=await request('/admin/categories',{token:attendee.token});
  equal(result.status,403,'non-admin cannot manage categories');
  result=await request('/admin/tickets',{token:admin.token});
  check(result.data.tickets.length>=3,'admin ticket reconciliation lists all issued tickets');
  result=await request('/admin/audit',{token:admin.token});
  check(result.status===200,'admin audit log is readable');

  // Authorization, CORS, logout revocation and account lockout contract.
  result=await request('/api/health');
  equal(result.status,404,'API prefix is not accidentally doubled');
  result=await fetch(`${base}/health`,{headers:{Origin:'https://not-allowed.example'}});
  equal(result.status,403,'unapproved CORS origin is rejected');
  result=await request('/auth/logout',{method:'POST',token:second.token,body:{}});
  equal(result.status,200,'logout is successful');
  equal(result.headers.get('set-cookie')?.includes('Max-Age=0'),true,'logout clears the session cookie');
  result=await request('/auth/me',{token:second.token});
  equal(result.status,401,'logout revokes the persisted bearer session');
  const socketDisconnected=new Promise((resolve)=>socketA.once('disconnect',resolve));
  socketA.emit('conversation:join',liveConversationId,()=>{});
  const disconnectReason=await Promise.race([socketDisconnected,new Promise((resolve)=>setTimeout(()=>resolve('timeout'),1000))]);
  equal(disconnectReason,'io server disconnect','revoked session is disconnected on the next Socket.IO packet');
  // This is intentionally last among login attempts because lockout is per-window and per-IP.
  for(let i=0;i<4;i++){
    result=await request('/auth/login',{method:'POST',body:{identifier:'avery@example.test',password:'wrongPass123'}});
    check(result.status===401||result.status===429,`repeated bad sign-in attempt ${i+1} is rejected`);
  }
  result=await request('/auth/login',{method:'POST',body:{identifier:'avery@example.test',password:'passWord1234'}});
  equal(result.status,429,'repeated failures trigger a temporary sign-in lockout');

  // Routine session restore and lifecycle requests must not spend the
  // sign-in/sign-up burst budget, while those entry points remain throttled.
  const limiterTempDir=fs.mkdtempSync(path.join(os.tmpdir(),'eventtracker-auth-limit-'));
  let limiterSystem;
  try{
    limiterSystem=await createApplication({env:{
      NODE_ENV:'production',PORT:'0',DATA_DIR:path.join(limiterTempDir,'data'),UPLOADS_DIR:path.join(limiterTempDir,'uploads'),DB_FILE:path.join(limiterTempDir,'auth-limit.sqlite'),
      JWT_SECRET:'auth-limiter-production-jwt-secret-6ea122efed8f4c',TICKET_SECRET:'auth-limiter-production-ticket-secret-38909f',
      CLIENT_URL:'https://events.example.test',PUBLIC_APP_URL:'https://events.example.test',CORS_ORIGINS:'https://events.example.test',
      COOKIE_SECURE:'true',RATE_LIMIT_GENERAL:'100',RATE_LIMIT_AUTH:'1',RATE_LIMIT_WINDOW_MS:'60000'
    }});
    await new Promise((resolve,reject)=>{limiterSystem.server.once('error',reject);limiterSystem.server.listen(0,'127.0.0.1',resolve);});
    const limiterBase=`http://127.0.0.1:${limiterSystem.server.address().port}/api`;
    let productionHealth=await fetch(`${limiterBase}/health`);
    const productionCsp=productionHealth.headers.get('content-security-policy')||'';
    check(productionHealth.headers.get('strict-transport-security')?.includes('max-age=31536000'),'production emits one-year HSTS');
    check(productionCsp.includes("connect-src 'self' wss://events.example.test"),'production CSP limits websocket connections to the app host');
    let limited=await fetch(`${limiterBase}/settings/public`);
    const publicPayments=await limited.json();
    equal(publicPayments.payment_mode,'unavailable','production reports missing live payment providers as unavailable, not sandbox');
    check(publicPayments.sandbox_notice.includes('disabled'),'production payment notice does not imply a sandbox charge');
    limited=await fetch(`${limiterBase}/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Limit Test',username:'limittest',email:'limit@example.test',password:'LimitPass123',role:'attendee'})});
    equal(limited.status,201,'auth limiter permits the first account-creation request');
    const productionCookie=limited.headers.get('set-cookie')||'';
    check(productionCookie.includes('__Host-et_session='),'production session uses the __Host- cookie prefix');
    check(productionCookie.includes('Path=/')&&productionCookie.includes('Secure'),'production session cookie is Secure and root-scoped');
    const created=await limited.json();
    const productionCookieHeader=productionCookie.split(';')[0];
    let cookieRestore=await fetch(`${limiterBase}/auth/me`,{headers:{Cookie:productionCookieHeader,Origin:'https://events.example.test'}});
    equal(cookieRestore.status,200,'production restores a session through the Secure HttpOnly cookie from an allowed Origin');
    let csrfAttempt=await fetch(`${limiterBase}/auth/logout`,{method:'POST',headers:{Cookie:productionCookieHeader,'Content-Type':'application/json'},body:'{}'});
    equal(csrfAttempt.status,403,'production rejects cookie-authenticated state changes without an Origin');
    equal((await csrfAttempt.json()).error,'CSRF_REJECTED','production CSRF rejection is explicit');
    const authHeaders={Authorization:`Bearer ${created.token}`};
    limited=await fetch(`${limiterBase}/auth/me`,{headers:authHeaders});
    equal(limited.status,200,'session restoration does not consume the sign-in/sign-up limit');
    limited=await fetch(`${limiterBase}/auth/refresh`,{method:'POST',headers:authHeaders});
    equal(limited.status,200,'session renewal does not consume the sign-in/sign-up limit');
    const categoryId=limiterSystem.db.run('INSERT INTO categories(name,slug,description,cover,color,sort_order) VALUES(?,?,?,?,?,?)',['Release','release','Test event category','','#303030',1]).lastID;
    const eventId=limiterSystem.db.run(`INSERT INTO events(organizer_id,category_id,title,slug,description,date,time,end_time,location,venue,price_minor,currency,capacity,cover_image,status,featured,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[created.user.id,categoryId,'Production Guard Event','production-guard-event','A production payment guard check.','2035-01-01','18:00','','Nairobi','Test venue',1200,'KES',20,'','published',0,nowIso(),nowIso()]).lastID;
    limited=await fetch(`${limiterBase}/payments`,{method:'POST',headers:{...authHeaders,'Content-Type':'application/json'},body:JSON.stringify({event_id:eventId,provider:'stripe',currency:'KES',idempotency_key:'production-provider-missing'})});
    equal(limited.status,503,'production refuses paid checkouts when the selected provider is not configured');
    equal((await limited.json()).error,'PAYMENT_PROVIDER_NOT_CONFIGURED','unconfigured production payments use an explicit error code');
    const legacySandboxId=limiterSystem.db.run(`INSERT INTO transactions(user_id,event_id,ticket_type_id,provider,status,provider_reference,amount_minor,currency,idempotency_key,commission_minor,purpose,metadata,created_at,updated_at)
      VALUES(?,?,NULL,'stripe','pending','sandbox-stripe-legacy',1200,'KES','legacy-sandbox-status',60,'ticket',?,?,?)`,[created.user.id,eventId,JSON.stringify({mode:'sandbox'}),nowIso(),nowIso()]).lastID;
    limited=await fetch(`${limiterBase}/payments/${legacySandboxId}/status`,{headers:authHeaders});
    equal(limited.status,200,'legacy sandbox status remains readable in production');
    equal((await limited.json()).payment.status,'pending','production never upgrades an old sandbox payment to successful');
    limited=await fetch(`${limiterBase}/auth/logout`,{method:'POST',headers:authHeaders});
    equal(limited.status,200,'logout does not consume the sign-in/sign-up limit');
    limited=await fetch(`${limiterBase}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:'limit@example.test',password:'LimitPass123'})});
    equal(limited.status,429,'credential entry points remain protected by the auth burst limit');
    equal((await limited.json()).error,'AUTH_RATE_LIMITED','auth burst-limit response uses a stable error code');
  }finally{
    if(limiterSystem)await limiterSystem.close();
    fs.rmSync(limiterTempDir,{recursive:true,force:true});
  }

  console.log(`API_TEST_CHECKS=${checkCount}`);
  check(checkCount>=160, 'API suite meets the 160-check target');
});
