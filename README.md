# EventTracker

An event discovery and management platform: browse and filter events, follow and
save them, buy tickets with M-Pesa or card, check attendees in at the door, chat
with organisers, promote listings and run the whole thing from an admin console.

Everything ships in one repository — a React client, an Express API, a SQLite
database and a bundled demo dataset (cover artwork included, no external assets).

---

## Highlights

**Discovery**
- Home page with a search bar, featured/sponsored spotlight, popular categories
  and an upcoming-events rail ordered by date
- Discover page with search, category, date range, location, price and
  free/paid filters, sort options, active-filter chips and pagination
- Events index with quick date chips (today, tomorrow, weekend, this week) and a
  list/grid layout toggle
- Category pages, related events, map links, share and save/follow

**Event management**
- Four-step create/edit form (details → date & location → tickets → media) with
  a live preview before publishing, single or multi-tier ticketing, capacity,
  currency and contact details
- Cover image upload **or camera capture**, optional feature video, profile
  pictures and banners
- Organiser tools on the event page: guest list, check-in stats, edit, cancel
  and delete

**Payments**
- Dedicated payment service layer (`server/services/payments`) with providers
  for **M-Pesa (Daraja STK push)**, **cards (Stripe PaymentIntent)** and free
  registration; adding another provider means implementing one interface
- Server-side cart pricing: totals are always recalculated on the backend, with
  stock and per-user limits enforced before an intent is created
- Idempotent intent creation, provider verification, webhook/callback handling
  and a polling endpoint for the client
- Platform commission: a configurable service fee (5% by default, editable in
  Admin → Settings) is charged on the ticket subtotal, shown in the checkout
  summary before payment, and stored on the transaction as `fee_cents` so
  commission is a ledger figure rather than something calculated after the fact
- Statuses: `pending`, `processing`, `successful`, `failed`, `cancelled`,
  `refunded`. Every transaction stores reference, user, event, amount, fee,
  currency, method, status, provider reference and timestamps
- No provider secret ever reaches the browser, and a payment is never treated as
  successful because the client said so

**Tickets**
- A ticket is issued **only** after the payment is confirmed successful, and is
  idempotent per transaction
- Each ticket carries a unique code (`ET-XXXX-XXXX`) and a QR code signed with
  HMAC-SHA256, plus ticket type, attendee, event, payment status and check-in
  state
- `/verify` checks tickets in from the camera (`BarcodeDetector` where
  available) with a typed-code fallback for USB scanners; one check-in per
  ticket, organiser-only

**Promotions**
- Three placements — featured listing, boosted ranking and sponsored placement —
  each with a fixed price shown before payment
- A promotion is created as `pending` and only becomes `active` when the linked
  payment is confirmed by the payment service
- Impression/click counters and campaign reporting for organisers and admins

**Social**
- Follow events and people, save events, comment on events, notify
- Real-time chat: direct messages and per-event group chats over Socket.IO
  (typing indicators, presence, REST fallback)

**Administration**
- Overview dashboard: commission earned, tickets sold (paid vs free), gross
  revenue, promotion revenue, a per-event commission table with the organiser's
  net, 14-day volume chart, payment-method split, best-performing events and
  provider modes
- Transactions with filters, a commission column and total, detail drawer
  (including the commission kept and the organiser's net), provider re-check and
  refunds
- Event feature/cancel/delete, user role management, campaign control,
  commerce settings and an audit log of privileged actions

**Interface**
- Live ambient background: a drifting colour wash, three soft light sources, a
  slowly turning aurora ribbon, a panning grid and a slow spotlight that follows
  the pointer — with a **spiral galaxy spinning behind them all**. The galaxy is
  generated artwork (`scripts/make-galaxy.js`): two logarithmic-spiral arms and
  two spurs, each stroked at decreasing widths so it tapers outward, a
  gradient-glowed core and about 760 stars, tinted from the theme's own silver
  range and held back to around 45% opacity so it never competes with content. It rotates slowly enough to read as drift rather than a spinning
  disc, pauses when the tab is hidden, and stops entirely under
  `prefers-reduced-motion`
- Quick view: any event card opens a morphing dialog that grows out of the card
  you clicked and collapses back into it, showing the cover, date, venue, price,
  ticket tiers and the save / follow controls without leaving the list
- Real light and dark themes — clean white/light grey in light mode, true
  neutral black in dark mode (no blue cast) — with a switcher in the navbar
- A monochrome palette: every value is a hue-free grey, so hierarchy comes from
  contrast, weight and depth rather than colour. The primary action is
  near-black on light and near-white on dark; status chips are solid ink for
  settled states and outlined for pending ones. Red is kept for exactly one
  job — destructive actions and failures
- Responsive from 320 px phones to wide desktops: desktop navigation with an
  account menu, a glass bottom bar on phones, single-pane chat and stacked
  detail/checkout layouts
- Camera access is requested only when a capture button is pressed and is never
  disabled by responsive rules
- Sessions that survive real browsers: every sign-in creates a revocable
  server-side session, the expiry slides forward while the app is in use, and an
  httpOnly cookie restores the session on reload even when site storage is
  blocked, partitioned or has been cleared

---

## Stack

| Layer | Choice |
|---|---|
| Client | React 18, React Router 6, Vite 5, lucide-react, socket.io-client |
| Server | Node 18+, Express 4, Socket.IO 4 |
| Database | SQLite through `sql.js` (single file, no native build step) |
| Auth | JWT + bcrypt password hashing |
| Uploads | Multer, stored under `server/uploads` |
| QR codes | `qrcode` on the server, signed payloads verified on check-in |

---

## Getting started

```bash
npm install          # installs the API and the client workspace
npm run seed         # writes the demo database + artwork (skips if data exists)
npm run dev          # API on :5000 and Vite on :5173
```

Open http://localhost:5173.

For a production-style run:

```bash
npm run build        # builds the client into client/dist
npm start            # API + built client on http://localhost:5000
```

`npm run reset-db` wipes and re-seeds the database.
`node scripts/make-galaxy.js` regenerates the background galaxy artwork.

### Tests

```bash
npm run test:api     # 144 API checks against a running server (seeds data, so reset afterwards)
npm run test:ui      # renders the real React tree in jsdom and drives it
```

`test:api` covers the endpoints; `test:ui` covers the screens — it signs in
through the actual login form, checks that a wrong password is refused in place
and a correct one lands on the home page, renders the admin dashboard and every
admin tab against live data, mounts the galaxy background, and opens the quick
view dialog from a real event card (asserting the morph stays mid-flight rather
than snapping to its end state). Bugs like a form that threw before it could
navigate, or a dashboard that crashed rendering an object as a React child, only
show up in a real render.

Both expect a server on `http://127.0.0.1:5000`; override with `BASE=`.

### Demo accounts

All accounts use the password `password123`.

| Account | Role |
|---|---|
| `admin@eventtracker.app` | platform administrator |
| `daniel@eventtracker.app`, `zawadi@eventtracker.app`, `kamau@eventtracker.app`, `fatuma@eventtracker.app`, `lucia@eventtracker.app` | organisers |
| `njeri@eventtracker.app`, `brian@eventtracker.app`, `wanjiku@eventtracker.app`, `omar@eventtracker.app` | attendees |

The seed creates 8 categories, 10 members, 20 events (18 upcoming, 2 past), real
ticket tiers, 30 transactions with mixed statuses, issued and checked-in
tickets, running promotions, comments, follows and a few conversations.

### Payments without credentials

With no provider keys set, M-Pesa and card run in **sandbox mode**: the intent is
created and stays `pending`, and the payment screen offers Approve / Decline
buttons that call `POST /api/payments/:reference/simulate`. That endpoint is
disabled automatically once real credentials are configured. Nothing is ever
charged in sandbox mode.

Copy `.env.example` to `.env` to set `JWT_SECRET`, `TICKET_SECRET`, the M-Pesa
Daraja keys and the Stripe keys.

---

## Project layout

```
server/
  index.js               Express app, Socket.IO, static uploads, SPA fallback
  paths.js               data + uploads locations (env-configurable for volumes)
  db/                    sql.js connection, schema and query helpers
  middleware/            auth (bearer, cookie, session renewal) + security
                         (headers, CSP, CORS, rate limits, body ceilings)
  routes/                auth, users, categories, events, feed, tickets,
                         payments, promotions, notifications, admin, uploads, chat
  services/              payments (index + mpesa/card providers + money),
                         tickets, promotions, notifications, sessions, security
  sockets.js             realtime: presence, chat, ticket and payment events
  seed.js                demo dataset and generated SVG artwork
  uploads/               covers, avatars, videos, misc
deploy/
  nginx.conf             TLS + reverse proxy + websocket upgrade
  eventtracker.service   hardened systemd unit
Dockerfile               multi-stage production image
docker-compose.yml       app + data volume
render.yaml              Render blueprint with a persistent disk
client/
  src/components/        Navbar, MobileNav, EventCard, TicketCard, CameraCapture,
                         MediaUploader, Payments, UI, Background,
                         EventQuickView
  src/context/           Theme, Auth, Toast, Notification providers
  src/hooks/             media queries, async helper, event search state
  src/pages/             Home, Discover, Events, EventDetails, CreateEvent,
                         Checkout, Categories, Tickets, TicketDetail, Verify,
                         Promotions, Profile, Chat, Notifications, Admin, auth
  src/styles/            theme tokens + application stylesheet
```

---

## API sketch

```
POST   /api/auth/register | login | logout      GET /api/auth/me
POST   /api/auth/refresh | logout-all           GET /api/auth/sessions
DELETE /api/auth/sessions/:id                   (revoke one signed-in device)
GET    /api/feed                                GET /api/events?search&category&when&…
GET    /api/events/:id                          POST /api/events
POST   /api/events/:id/register                 GET  /api/events/:id/attendees
POST   /api/events/:id/follow | save | rsvp      GET  /api/events/:id/comments
GET    /api/payments/methods | quote | :ref      POST /api/payments/intents
POST   /api/payments/:ref/simulate | cancel      POST /api/payments/mpesa/callback
GET    /api/tickets | /api/tickets/:code         POST /api/tickets/verify
GET    /api/promotions/plans | mine              POST /api/promotions
GET    /api/conversations | :id/messages          POST /api/conversations
GET    /api/notifications                        POST /api/notifications/read
GET    /api/admin/overview | transactions | events | users | promotions | audit
```

---

## Security

The rules live on the server; the browser is treated as untrusted input.

| Area | What is in place |
| --- | --- |
| Passwords | bcrypt (cost 12), minimum 8 characters with letters and numbers, common-password and personal-detail checks |
| Sign-in | Per-account lockout after 10 failed attempts in 15 minutes, identical error for unknown email and wrong password, every attempt logged to the audit trail |
| Sessions | Server-side session per device, sliding expiry, revocable individually or everywhere, invalidated on password change |
| Tokens | HS256 with pinned algorithm, issuer and audience; short-lived relative to the session and rotated automatically as they age |
| Cookies | httpOnly, SameSite=Lax, Secure in production; accepted for state-changing requests only when the app's own `X-Requested-With` header is present, which blocks CSRF |
| Transport | Helmet with a strict CSP (the inline theme script is allowed by hash, not `unsafe-inline`), HSTS in production, `nosniff`, strict referrer policy, compression |
| Rate limits | Per-IP ceilings on all API traffic, sign-in, uploads, ticket verification and account changes — loopback is exempt outside production so local work is never locked out |
| Uploads | MIME allowlist with extension derived from the type, per-kind size caps, random filenames, SVG rejected, `default-src 'none'` CSP on served media |
| Payments | Provider secrets stay server-side, amounts are computed server-side, Stripe webhooks are signature-verified and M-Pesa callbacks carry a shared token; nothing is marked successful from client input |
| Errors | 5xx responses are generic to the client and logged in full server-side; no stack traces in responses |
| Admin | Role checked on the server for every admin route, with an audit log of privileged actions |

Two things to do before going live: set real `JWT_SECRET` and `TICKET_SECRET`
values (the server refuses to start in production with the development key), and
change the demo account passwords.

## Deployment

One Node process serves the API, the websockets and the built client. The whole
state is a SQLite file plus an uploads directory, so back up the volume mounted
at `DATA_DIR` (default `server/data`) and `UPLOADS_DIR` (default
`server/uploads`).

```bash
npm ci
npm run build          # builds client/dist
NODE_ENV=production PORT=5000 \
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))") \
  npm start
```

`GET /api/health` returns service, version and database status — point the
platform health check at it. The server shuts down cleanly on `SIGTERM`,
flushing the database before exit.

### First run on an empty database

A fresh deployment starts with an empty database: the schema is created at boot
and every route works, but there are no accounts yet. Register through the app,
then appoint the first administrator from the server — the admin area requires
one, so it cannot be granted from inside the app:

```bash
npm run make-admin -- you@example.com     # grant admin
npm run make-admin -- --list              # list accounts and roles
npm run make-admin -- you@example.com --demote
```

Copying the bundled `server/data/eventtracker.db` instead (as it ships in the
archive) gives you the demo dataset, including `admin@eventtracker.app`.
`npm run reset-db` rebuilds that demo dataset at any time.

### Docker

```bash
docker build -t eventtracker .
docker run -p 5000:5000 \
  -e JWT_SECRET="$(openssl rand -hex 48)" \
  -e TICKET_SECRET="$(openssl rand -hex 32)" \
  -e PUBLIC_APP_URL=https://events.example.com \
  -v eventtracker-data:/data \
  eventtracker
```

`docker compose up -d --build` does the same thing from `docker-compose.yml`,
which also declares the `eventtracker-data` volume.

### Render / Railway / Fly.io

- **Render** — commit `render.yaml` and use *New → Blueprint*. It provisions the
  service, generates both secrets and attaches a persistent disk at `/var/data`
  (set `DATA_DIR=/var/data`, `UPLOADS_DIR=/var/data/uploads`).
- **Railway** — build `npm ci && npm run build`, start `npm start`, then add a
  volume mounted at `/data` and set `DATA_DIR=/data`, `UPLOADS_DIR=/data/uploads`.
- **Fly.io** — `fly launch`, keep the provided Dockerfile, then
  `fly volumes create eventtracker_data --size 1` and mount it at `/data`.

On any of these, set `NODE_ENV=production`, `PUBLIC_APP_URL` to the public
origin, and leave `TRUST_PROXY=1` so rate limiting sees real client addresses.

### VPS (nginx + systemd)

`deploy/nginx.conf` terminates TLS, proxies the API and the socket upgrade, and
serves `/assets` straight from disk; `deploy/eventtracker.service` runs the app
as an unprivileged user with a hardened unit. Copy `.env.example` to
`/etc/eventtracker.env`, fill it in, `chmod 600` it, then enable the service.

### Upgrading an existing install

```bash
npm run recolour   # rewrites pre-existing category colours and generated artwork
npm run make-admin -- you@example.com        # appoint or demote an administrator
npm run reset-db   # only if you want the demo dataset again — this drops data
```

Schema changes are applied automatically at boot; `recolour` exists because
colour values from older versions live in the database rather than in code.

---

## License

MIT.
