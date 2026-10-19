/**
 * End-to-end API smoke test.
 *
 *   node scripts/smoke.js            # against http://127.0.0.1:5000
 *   BASE=http://host:5000 node scripts/smoke.js
 *
 * Exercises every public and authenticated route the client uses, including a
 * full pay → verify → ticket flow in sandbox mode. Prints a pass/fail table and
 * exits non-zero when anything unexpected happens.
 */
const BASE = (process.env.BASE || 'http://127.0.0.1:5000') + '/api';

let pass = 0;
const failures = [];

async function call(method, path, { body, token, expect = [200, 201] } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload = null;
  const text = await res.text();
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }

  const ok = expect.includes(res.status);
  const label = `${method} ${path}`;
  if (ok) {
    pass += 1;
    console.log(`  ok   ${label} → ${res.status}`);
  } else {
    failures.push(`${label} → ${res.status} ${JSON.stringify(payload).slice(0, 160)}`);
    console.log(`  FAIL ${label} → ${res.status} ${JSON.stringify(payload).slice(0, 160)}`);
  }
  return { status: res.status, payload };
}

/**
 * Raw request helper for the checks that care about cookies, headers and
 * bodies rather than just the JSON payload.
 */
async function raw(method, path, { body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: res.status, payload, headers: res.headers };
}

/** Record an assertion that is not a single HTTP call. */
function expect(label, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function login(email) {
  const { payload } = await call('POST', '/auth/login', {
    body: { email, password: 'password123' },
  });
  return payload.token;
}

async function main() {
  console.log('\nPublic routes');
  await call('GET', '/health');
  const feed = (await call('GET', '/feed')).payload;
  const events = (await call('GET', '/events?limit=50')).payload.events;
  await call('GET', '/events?search=jazz&price=paid&sort=price_asc&page=1&limit=6');
  await call('GET', '/events?when=weekend&location=Nairobi');
  await call('GET', '/events?category=music&free=free');
  await call('GET', '/events/locations');
  await call('GET', '/events/featured');
  await call('GET', '/categories');
  const categories = (await call('GET', '/categories')).payload.categories;
  for (const category of categories) {
    await call('GET', `/categories/${category.slug}?limit=6`);
  }
  for (const event of events) {
    await call('GET', `/events/${event.id}`);
    await call('GET', `/events/${event.id}/comments`);
    await call('GET', `/events/${event.id}/related`);
  }
  await call('GET', '/promotions/plans');
  await call('GET', '/events/999999', { expect: [404] });

  console.log('\nAuthentication');
  const njeri = await login('njeri@eventtracker.app');
  const daniel = await login('daniel@eventtracker.app');
  const admin = await login('admin@eventtracker.app');
  await call('POST', '/auth/login', { body: { email: 'njeri@eventtracker.app', password: 'nope' }, expect: [401] });
  await call('GET', '/auth/me', { token: njeri });
  await call('GET', '/tickets', { expect: [401] });

  console.log('\nAttendee routes (njeri)');
  await call('GET', '/users/me/overview', { token: njeri });
  await call('GET', '/users/me', { token: njeri });
  await call('GET', '/users?q=dan', { token: njeri });
  await call('GET', '/users/njeri', { token: njeri });
  for (const tab of ['hosting', 'attending', 'saved', 'following']) {
    await call('GET', `/users/njeri/events?tab=${tab}`, { token: njeri });
  }
  await call('GET', '/users/njeri/followers', { token: njeri });
  await call('GET', '/users/njeri/following', { token: njeri });
  await call('GET', '/users/nobody', { token: njeri, expect: [404] });
  await call('GET', '/notifications', { token: njeri });
  await call('POST', '/notifications/read', { token: njeri, body: {} });
  await call('GET', '/conversations', { token: njeri });
  await call('GET', '/payments?limit=10', { token: njeri });
  await call('GET', '/promotions/mine', { token: njeri });

  const tickets = (await call('GET', '/tickets', { token: njeri })).payload;
  if (tickets.tickets.length) {
    await call('GET', `/tickets/${tickets.tickets[0].code}`, { token: njeri });
  }
  await call('GET', '/tickets/ET-NOPE-NOPE', { token: njeri, expect: [404] });

  // Chat: open a DM with an organiser and post a message.
  const conversation = (await call('POST', '/conversations', {
    token: njeri, body: { participantId: 2 },
  })).payload.conversation;
  await call('GET', `/conversations/${conversation.id}/messages`, { token: njeri });
  await call('POST', `/conversations/${conversation.id}/messages`, {
    token: njeri, body: { body: 'Smoke test message' },
  });

  // Social toggles (twice each so the state returns to where it started).
  const target = events[0];
  await call('POST', `/events/${target.id}/save`, { token: njeri });
  await call('POST', `/events/${target.id}/save`, { token: njeri });
  await call('POST', `/events/${target.id}/follow`, { token: njeri });
  await call('POST', `/events/${target.id}/follow`, { token: njeri });
  await call('POST', `/events/${target.id}/rsvp`, { token: njeri, body: { status: 'interested' } });
  await call('POST', `/events/${target.id}/rsvp`, { token: njeri, body: { status: 'none' } });

  console.log('\nComments');
  const comment = (await call('POST', `/events/${target.id}/comments`, {
    token: njeri, body: { body: 'Looking forward to this one.' },
  })).payload.comment;
  await call('DELETE', `/events/${target.id}/comments/${comment.id}`, { token: njeri });

  console.log('\nOrganiser routes (daniel)');
  const hosted = (await call('GET', '/users/daniel/events?tab=hosting', { token: daniel })).payload.events;
  const own = hosted[0];
  const guests = (await call('GET', `/events/${own.id}/attendees`, { token: daniel })).payload;
  await call('GET', `/tickets/event/${own.id}`, { token: daniel });
  await call('GET', `/events/${own.id}/attendees`, { token: njeri, expect: [403] });
  await call('POST', `/promotions/${999999}/cancel`, { token: daniel, expect: [404] });

  const guestTicket = (guests.attendees || []).find((t) => t.status !== 'used') || (guests.attendees || [])[0];
  if (guestTicket) {
    await call('POST', '/tickets/verify', { token: daniel, body: { code: guestTicket.code, check_in: false } });
    await call('POST', '/tickets/verify', { token: njeri, body: { code: guestTicket.code, check_in: false } });
    await call('POST', '/tickets/verify', { token: daniel, body: { code: 'ET-BAD-CODE', check_in: true } });
  }

  console.log('\nPayment → promotion flow (daniel, sandbox)');
  const plans = (await call('GET', '/promotions/plans?currency=KES')).payload.plans;
  const purchase = (await call('POST', '/promotions', {
    token: daniel,
    body: { event_id: own.id, plan: plans[0].id, method: 'mpesa', phone: '+254712345678' },
  })).payload;
  const reference = purchase.transaction.reference;
  await call('GET', `/payments/${reference}`, { token: daniel });
  if (purchase.transaction.metadata?.simulate) {
    await call('POST', `/payments/${reference}/simulate`, { token: daniel, body: { outcome: 'successful' } });
  }
  const after = (await call('GET', `/payments/${reference}`, { token: daniel })).payload.transaction;
  const campaigns = (await call('GET', '/promotions/mine', { token: daniel })).payload.promotions;
  const activated = campaigns.find((c) => c.id === purchase.promotion.id);
  if (after.status === 'successful' && activated?.status !== 'active') {
    failures.push(`promotion ${purchase.promotion.id} did not activate after payment`);
    console.log('  FAIL promotion activation');
  } else {
    pass += 1;
    console.log(`  ok   promotion activated after payment → ${after.status} / ${activated?.status}`);
  }

  console.log('\nPayment → ticket flow (attendee)');
  // A brand-new attendee: the demo accounts already hold their per-user ticket
  // allowance on the seeded events, which would make this flow order-dependent.
  const buyerStamp = Date.now();
  const buyerEmail = `buyer${buyerStamp}@example.com`;
  const buyer = (await call('POST', '/auth/register', {
    body: {
      name: 'Smoke Buyer',
      username: `smokebuyer${buyerStamp % 1000000}`,
      email: buyerEmail,
      password: 'SmokeTest!2026',
    },
  })).payload.token;

  const paidEvent = events.find((e) => Number(e.price_cents) > 0 && Number(e.available) > 0);
  if (paidEvent) {
    const detail = (await call('GET', `/events/${paidEvent.id}`)).payload.event;
    paidEvent.ticket_types = (detail.ticket_types || []).filter((t) => t.remaining === undefined || t.remaining > 0);
    if (!paidEvent.ticket_types.length) {
      console.log('  (no purchasable tier left on this event — skipping ticket flow)');
    } else {
    const quote = (await call('POST', '/payments/quote', {
      token: buyer,
      body: { event_id: paidEvent.id, items: [{ ticket_type_id: paidEvent.ticket_types[0].id, quantity: 1 }] },
    })).payload.quote;
    const intent = (await call('POST', '/payments/intents', {
      token: buyer,
      body: {
        event_id: paidEvent.id,
        items: [{ ticket_type_id: paidEvent.ticket_types[0].id, quantity: 1 }],
        method: 'mpesa',
        phone: '+254712345678',
        idempotency_key: `smoke-${Date.now()}`,
      },
    })).payload;
    if (!quote || !intent?.transaction) {
      failures.push('payment intent could not be created');
      console.log('  FAIL payment intent could not be created');
    } else {
    console.log(`  quote ${quote.total_cents} → intent ${intent.transaction.reference} (${intent.transaction.status})`);

    if (intent.transaction.metadata?.simulate) {
      await call('POST', `/payments/${intent.transaction.reference}/simulate`, {
        token: buyer, body: { outcome: 'successful' },
      });
    }
    const final = (await call('GET', `/payments/${intent.transaction.reference}`, { token: buyer })).payload;
    const issued = final.tickets || [];
    if (final.transaction.status === 'successful' && issued.length === 0) {
      failures.push('no ticket issued for a successful payment');
      console.log('  FAIL ticket not issued after successful payment');
    } else {
      pass += 1;
      console.log(`  ok   payment ${final.transaction.status}, tickets issued: ${issued.length}`);

      if (issued[0]) {
        const check = (await call('POST', '/tickets/verify', {
          token: daniel, body: { code: issued[0].code, check_in: true },
        })).payload;
        console.log(`  ok   check-in → ${check.status}`);

        const again = (await call('POST', '/tickets/verify', {
          token: daniel, body: { code: issued[0].code, check_in: true },
        })).payload;
        if (again.status === 'already_used') {
          pass += 1;
          console.log('  ok   second check-in rejected (already_used)');
        } else {
          failures.push(`double check-in returned ${again.status}`);
          console.log(`  FAIL double check-in → ${again.status}`);
        }
      }
    }
    }
    }
  }

  console.log('\nFree registration');
  const freeEvent = events.find((e) => e.has_free_tier || Number(e.price_cents) === 0);
  if (freeEvent) {
    const result = await call('POST', `/events/${freeEvent.id}/register`, { token: admin });
    console.log(`  register → ${result.status} ${result.payload?.already_registered ? '(already registered)' : ''}`);
  }

  console.log('\nSessions');
  const fresh = await raw('POST', '/auth/login', {
    body: { email: 'njeri@eventtracker.app', password: 'password123' },
  });
  const sessionToken = fresh.payload?.token;
  const cookie = (fresh.headers.get('set-cookie') || '').split(';')[0];
  expect('login sets an httpOnly session cookie',
    /et_session=/.test(cookie) && /httponly/i.test(fresh.headers.get('set-cookie') || ''));
  expect('login returns a token', Boolean(sessionToken));

  const withCookie = await raw('GET', '/auth/me', { headers: { Cookie: cookie } });
  expect('a cookie alone restores the session', withCookie.status === 200 && Boolean(withCookie.payload?.user));

  const cookiePost = await raw('POST', '/conversations', { headers: { Cookie: cookie }, body: { participantId: 2 } });
  expect('a cookie without the app header cannot change state (CSRF)', cookiePost.status === 401, String(cookiePost.status));

  const cookiePostMarked = await raw('POST', '/conversations', {
    headers: { Cookie: cookie, 'X-Requested-With': 'eventtracker' },
    body: { participantId: 2 },
  });
  expect('the app header makes cookie writes usable', [200, 201].includes(cookiePostMarked.status), String(cookiePostMarked.status));

  const refreshed = await raw('POST', '/auth/refresh', {
    headers: { Authorization: `Bearer ${sessionToken}`, 'X-Requested-With': 'eventtracker' },
    body: {},
  });
  expect('refresh renews the session', refreshed.status === 200 && Boolean(refreshed.headers.get('x-session-token')));

  const listed = await raw('GET', '/auth/sessions', { headers: { Authorization: `Bearer ${sessionToken}` } });
  const sessionRows = listed.payload?.sessions || [];
  expect('sessions are listed for the account', sessionRows.length > 0, `${sessionRows.length} row(s)`);
  expect('the current device is marked', sessionRows.some((row) => row.current));

  // A second sign-in gives a session that can be revoked without touching the
  // tokens the rest of this suite depends on.
  const second = await raw('POST', '/auth/login', { body: { email: 'njeri@eventtracker.app', password: 'password123' } });
  const secondToken = second.payload?.token;
  const secondList = await raw('GET', '/auth/sessions', { headers: { Authorization: `Bearer ${sessionToken}` } });
  const other = (secondList.payload?.sessions || []).find((row) => row.id !== sessionRows.find((r) => r.current)?.id);

  const revoked = await raw('DELETE', `/auth/sessions/${other.id}`, { headers: { Authorization: `Bearer ${sessionToken}` } });
  expect('a session can be revoked', revoked.status === 200);

  const otherAfter = await raw('GET', '/auth/me', { headers: { Authorization: `Bearer ${secondToken}` } });
  expect('the revoked device is signed out immediately', otherAfter.status === 401, String(otherAfter.status));

  const survivor = await raw('GET', '/auth/me', { headers: { Authorization: `Bearer ${sessionToken}` } });
  expect('other devices are untouched', survivor.status === 200, String(survivor.status));

  await raw('POST', '/auth/logout', { headers: { Authorization: `Bearer ${sessionToken}` }, body: {} });
  const afterLogout = await raw('GET', '/auth/me', { headers: { Authorization: `Bearer ${sessionToken}` } });
  expect('signing out revokes the token server-side', afterLogout.status === 401, String(afterLogout.status));

  console.log('\nAccount protection');
  const weak = await raw('POST', '/auth/register', {
    body: { name: 'Weak Pass', username: `weak${Date.now() % 100000}`, email: `weak${Date.now() % 100000}@example.com`, password: 'password123' },
  });
  expect('registration rejects a common password', weak.status === 400, weak.payload?.error || '');

  const short = await raw('POST', '/auth/register', {
    body: { name: 'Short Pass', username: `short${Date.now() % 100000}`, email: `short${Date.now() % 100000}@example.com`, password: 'abc123' },
  });
  expect('registration rejects a short password', short.status === 400, short.payload?.error || '');

  const lockEmail = `lockout${Date.now() % 1000000}@example.com`;
  let locked = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const bad = await raw('POST', '/auth/login', { body: { email: lockEmail, password: 'wrong-password-1' } });
    if (bad.status === 429) { locked = attempt + 1; break; }
  }
  expect('repeated failures lock the account', locked > 0, locked ? `locked after ${locked} attempts` : 'never locked');

  console.log('\nHardening');
  const shell = await raw('GET', '/../'.replace('/..', '') || '/');
  expect('the app sends a content security policy', Boolean(shell.headers.get('content-security-policy')));
  expect('and blocks MIME sniffing', shell.headers.get('x-content-type-options') === 'nosniff');
  expect('the inline theme script is allowed by hash, not unsafe-inline',
    /sha256-/.test(shell.headers.get('content-security-policy') || '')
    && !/script-src[^;]*unsafe-inline/.test(shell.headers.get('content-security-policy') || ''));
  expect('the framework banner is hidden', !shell.headers.get('x-powered-by'));

  const svgUpload = await raw('POST', '/uploads?kind=cover', {
    headers: { Authorization: `Bearer ${admin}` },
    body: { data: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>').toString('base64')}` },
  });
  expect('SVG uploads are refused', svgUpload.status === 400, svgUpload.payload?.error || String(svgUpload.status));

  console.log('\nAdmin routes');
  await call('GET', '/admin/overview', { token: admin });
  await call('GET', '/admin/transactions?limit=5', { token: admin });
  await call('GET', `/admin/transactions/${reference}`, { token: admin });
  await call('POST', `/admin/transactions/${reference}/sync`, { token: admin, body: {} });
  await call('GET', '/admin/events?status=published', { token: admin });
  await call('GET', `/admin/events/${own.id}/tickets`, { token: admin });
  await call('GET', '/admin/users?role=organizer', { token: admin });
  await call('GET', '/admin/promotions', { token: admin });
  await call('GET', '/admin/settings', { token: admin });
  await call('PUT', '/admin/settings', { token: admin, body: { support_email: 'support@eventtracker.app' } });
  await call('GET', '/admin/audit', { token: admin });
  await call('GET', '/admin/overview', { token: njeri, expect: [403] });

  console.log(`\n${pass} checks passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const failure of failures) console.log(`  · ${failure}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\nSmoke test crashed:', error);
  process.exit(1);
});
