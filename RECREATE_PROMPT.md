# Recreate prompt — EventTracker

Paste the block below into a coding agent (Claude Code, Cursor, Codex, Arena, etc.) that has an empty repository and terminal access. It is written to rebuild the app from nothing, not just to describe it.

---

## Master prompt

```text
Build a complete, self-hosted event discovery and management platform called
EventTracker in an empty git repository. It must run as a single Node.js
application: an Express + Socket.IO API that also serves a built React client
from the same origin, an embedded SQLite database via sql.js, and media stored
on disk. No external database, CDN, remote font, or third-party image host may
be required — every asset must be generated or bundled locally.

Work autonomously: create the full project, install dependencies, seed data,
build, run it, and verify it with real HTTP requests before reporting back.
Do not stop at scaffolding — every screen and endpoint listed below must work.

===================== STACK =====================
- Node 18+ (Node 20/22 recommended), npm workspaces with `client` as a workspace.
- Server: Express 4, Socket.IO 4, jsonwebtoken, bcryptjs, helmet, cors,
  compression, express-rate-limit, multer, qrcode, sql.js.
- Client: React 18, React Router 6+, Vite 5+, lucide-react, socket.io-client.
- Database: sql.js (pure JS SQLite). Whole DB in memory, flushed to a file after
  every write; batched transactions flush once. Default file:
  server/data/eventtracker.db. Uploads default to server/uploads/{covers,avatars,videos,misc}.
- Type is self-hosted (Inter 400/500/600/700, Plus Jakarta Sans 500/600/700 as
  woff2 in client/public/fonts). No Google Fonts requests.

===================== REPOSITORY LAYOUT =====================
package.json                 scripts, deps, workspaces
.env.example                 documented environment variables
server/
  index.js                   app bootstrap, middleware, static client, error handling
  paths.js                   DATA_DIR / DB_FILE / UPLOADS_DIR resolution
  db/index.js                sql.js wrapper: get/all/run/prepare/transaction, schema + migrations
  middleware/security.js     helmet CSP, CORS, body limits, rate limiters
  routes/{auth,users,categories,events,feed,chat,uploads,payments,tickets,promotions,notifications,admin}.js
  services/{payments,sessions,tickets,notifications,promotions,security}.js
  services/payments/{index,money}.js and providers/{mpesa,card}.js
  sockets.js                 Socket.IO auth + chat events
  seed.js                    idempotent demo dataset and generated SVG artwork
scripts/{smoke.js,ui-smoke.js,make-admin.js,recolour.js,make-galaxy.js}
client/
  index.html, vite.config.js
  src/{main.jsx,App.jsx}
  src/api/client.js          fetch wrapper, token/cookie handling, payment polling
  src/context/{Auth,Theme,Toast,Notification}Context.jsx
  src/components/{Background,CameraCapture,EventCard,EventQuickView,MediaUploader,MobileNav,Navbar,Payments,TicketCard,UI}.jsx
  src/pages/{Home,Discover,Events,EventDetails,CreateEvent,Checkout,Login,Register,Tickets,TicketDetail,Verify,Promotions,Profile,Chat,Notifications,Categories,Admin,NotFound}.jsx
  src/styles/{theme.css,app.css}
  src/hooks/{index.js,useEventSearch.js}

===================== DATA MODEL =====================
Create these tables with sensible columns, foreign keys, and indexes:
users(id, name, username UNIQUE, email UNIQUE, password_hash, bio, location,
      phone, avatar_url, cover_url, role [user|organizer|admin], interests,
      created_at, updated_at)
categories(id, name, slug UNIQUE, description, icon, color, sort_order)
events(id, organizer_id, category_id, title, slug, tagline, description,
       starts_at, ends_at, venue, address, city, country, latitude, longitude,
       image_url, video_url, capacity, currency, status [draft|published|cancelled],
       featured, contact_email, contact_phone, created_at, updated_at)
ticket_types(id, event_id, name, description, price_cents, quantity, sold,
             per_user_limit, sort_order)
transactions(id, reference UNIQUE, user_id, event_id, amount_cents, fee_cents,
             currency, method [mpesa|card|free], status [pending|processing|
             successful|failed|cancelled|refunded], provider_ref, phone,
             idempotency_key UNIQUE, created_at, updated_at)
tickets(id, code UNIQUE, transaction_id UNIQUE, event_id, user_id, ticket_type_id,
        attendee_name, checked_in_at, checked_in_by, created_at)
promotions(id, event_id, user_id, transaction_id, placement [featured|boost|
           sponsored], amount_cents, currency, status [pending|active|expired|
           cancelled], starts_at, ends_at, impressions, clicks, created_at)
notifications(id, user_id, type, title, body, link, read_at, created_at)
event_follows(event_id, user_id) · rsvps(event_id, user_id, status) ·
saves(event_id, user_id) · follows(follower_id, followed_id) ·
comments(id, event_id, user_id, body, created_at)
conversations(id, event_id NULL, created_at) ·
conversation_participants(conversation_id, user_id) ·
messages(id, conversation_id, sender_id, body, created_at)
sessions(id UUID, user_id, token_hash, user_agent, ip, created_at, expires_at,
         revoked_at, last_seen_at)
login_attempts(id, email, ip, successful, created_at)
audit_log(id, actor_id, action, target_type, target_id, meta, created_at)
settings(key PRIMARY KEY, value)

Implement schema versioning with a `schema_migrations` table and additive
migrations so existing databases upgrade without data loss.

===================== API =====================
Mount everything under /api. Auth is a bearer token (JWT with session id) and
also an httpOnly session cookie; every sign-in creates a revocable row in
`sessions`, the expiry slides on use, and the response sets `X-Session-Token`
when a token is renewed. Return consistent JSON errors: `{ error: "MESSAGE" }`
for users, plus `details`/`fields` for validation where useful.

auth:        POST /auth/register, /auth/login, /auth/refresh, /auth/logout,
             POST /auth/logout-all · GET /auth/me · GET /auth/sessions,
             DELETE /auth/sessions/:id
users:       GET /users?q= · GET /users/me · PUT /users/me ·
             GET /users/me/overview · PUT /users/me/interests ·
             GET /users/:username · GET /users/:username/events?tab=
             GET /users/:username/followers|following · POST /users/:username/follow
categories:  GET /categories · GET /categories/:slug
events:      GET /events (search q, category, city, date_from/date_to, price,
             free, sort, page, limit, organizer) · GET /events/featured ·
             GET /events/locations · GET /events/:id · POST /events ·
             PUT /events/:id · DELETE /events/:id · POST /events/:id/follow ·
             POST /events/:id/save · POST /events/:id/rsvp ·
             POST /events/:id/register · GET /events/:id/tickets ·
             GET /events/:id/attendees · GET/POST /events/:id/comments ·
             DELETE /events/:id/comments/:commentId · GET /events/:id/related
feed:        GET /feed (stats, promoted spotlight, categories, upcoming)
chat:        GET /conversations · POST /conversations ·
             GET/POST /conversations/:id/messages
uploads:     POST /uploads (multipart, kind=cover|avatar|video|misc) ·
             POST /uploads/data (base64 camera capture)
payments:    GET /payments/methods · POST /payments/quote · POST /payments/intents ·
             GET /payments · GET /payments/:reference ·
             POST /payments/:reference/simulate · POST /payments/:reference/cancel ·
             POST /payments/webhooks/mpesa · POST /payments/webhooks/card
tickets:     GET /tickets · GET /tickets/:code · GET /tickets/event/:eventId ·
             POST /tickets/verify
promotions:  GET /promotions/plans?currency= · GET /promotions/mine ·
             POST /promotions · POST /promotions/:id/cancel ·
             POST /promotions/:id/track · GET /promotions/event/:eventId
notifications: GET /notifications?limit= · GET /notifications/unread ·
             POST /notifications/read
admin:       GET /admin/overview · GET /admin/transactions?query ·
             GET /admin/transactions/:reference ·
             POST /admin/transactions/:reference/refund|sync ·
             GET /admin/events?status= · POST /admin/events/:id/feature|status ·
             DELETE /admin/events/:id · GET /admin/events/:id/tickets ·
             GET /admin/users?role= · POST /admin/users/:id/role ·
             GET /admin/promotions · POST /admin/promotions/:id/end ·
             GET/PUT /admin/settings · GET /admin/audit
GET /api/health returns ok, version, environment, database status, payment provider modes.

===================== PAYMENTS, TICKETS, PROMOTIONS =====================
- Build a provider interface: createIntent(), verify(), refund(), webhook.
  Implement M-Pesa (Daraja STK push) and card (Stripe PaymentIntent), plus a
  free path for zero-price registrations.
- With no provider credentials, both run in explicit local "simulation" mode.
  The UI must show that nothing is charged. Never award a ticket in production
  for a simulated intent.
- Prices are always recalculated server-side from ticket_types and a
  `service_fee_percent` setting (default 5). Never trust client totals.
- Enforce stock and per-user purchase limits before creating an intent.
- Intent creation is idempotent on an `Idempotency-Key` header.
- Statuses: pending → processing → successful | failed | cancelled | refunded.
- Issue exactly one ticket per successful transaction (idempotent), with code
  ET-XXXX-XXXX and a QR payload signed HMAC-SHA256 with TICKET_SECRET.
- Ticket check-in: POST /tickets/verify is organiser-only, accepts a signed
  payload or code, allows one check-in, and records who checked it in.
- Promotion pricing comes from server settings; a promotion stays pending until
  its linked payment is successful, then activates for its duration. Track
  impressions and clicks.

===================== CLIENT PAGES AND UX =====================
Routes: / · /discover · /events · /events/new · /events/:id ·
/events/:id/edit · /checkout/:id · /categories · /categories/:slug · /tickets ·
/tickets/:code · /verify · /promotions · /notifications · /profile · /u/:username ·
/chat · /login · /register · /admin · * (404).

- Home: search bar, sponsored/featured spotlight, popular categories, upcoming rail.
- Discover: full filter set (search, category, dates, location, price, free/paid),
  sort, active filter chips, pagination, responsive grid.
- Events: quick date chips (today/tomorrow/weekend/this week) and list/grid toggle.
- Event details: cover, date/venue/map link, share, save, follow, tier prices,
  comments, related events, organiser tools (guest list, check-in stats, edit,
  cancel, delete) and "message the host".
- Create/edit event: four steps (details → date & location → tickets → media),
  live preview, single or multi-tier tickets, capacity, currency, cover upload or
  camera capture, optional video. Show plain-language validation errors.
- Checkout: server quote, buyer details, M-Pesa or card, sandbox simulate button
  in development, polling until terminal state, then ticket reveal.
- Tickets: wallet of issued tickets, detail page with QR.
- Verify: camera scan where BarcodeDetector exists, typed-code fallback,
  organiser-only, success/already-used/invalid states.
- Promotions: three placements with prices, purchase flow, active campaigns.
- Profile: avatar/banner upload, edit details, stats, tabs (events, attending,
  saved, following), followers/following lists, session management.
- Chat: conversation list, unread counts, message thread, composer, typing and
  presence, mobile single-pane layout.
- Notifications: list, unread badge, mark all read.
- Admin: overview (commission, tickets paid vs free, gross, promotion revenue,
  per-event commission with organiser net, 14-day volume chart, method split,
  top events), transactions with filters/detail/refund/provider re-check,
  events with feature/cancel/delete, users with role changes, promotions,
  commerce settings, audit log.
- Navbar with theme switcher and account menu; glass bottom bar on phones
  (Home / Discover / Create / Tickets / Chat). Respect safe-area insets.

===================== VISUAL DESIGN (IMPORTANT) =====================
- Strictly monochrome: every UI value is a hue-free grey. Hierarchy comes from
  contrast, weight, spacing and depth — not colour. Primary action is near-black
  on light, near-white on dark. Status chips are solid ink when settled,
  outlined when pending. Red is reserved for destructive actions and failures.
- Real light and dark themes, persisted, applied before first paint to avoid a
  flash. Light: white/light-grey surfaces. Dark: true neutral black (no blue cast).
- Ambient background behind the app: drifting colour-free light wash, soft light
  sources, a slow aurora ribbon, a panning grid, a pointer-following spotlight,
  and a generated spiral-galaxy SVG (two logarithmic arms, tapered strokes,
  glowing core, ~760 stars) rotating slowly. Pause when the tab is hidden and
  stop entirely under prefers-reduced-motion.
- Glassmorphism on cards, dialogs and auth screens: translucent surface,
  backdrop blur, 1px hairline border, soft shadow. Rounded corners 14–24px.
- Quick view: clicking any event card opens a dialog that visibly grows out of
  that card and collapses back into it, showing cover, date, venue, price, tiers
  and save/follow, without leaving the list.
- Typography: Inter for UI, Plus Jakarta Sans for display headings. Fluid type
  scale, tight tracking on headings.
- Responsive 320px → wide desktop. No horizontal overflow at 320px. Buttons
  reachable with a thumb; focus-visible rings on all interactive elements.

===================== SECURITY =====================
- bcrypt (cost 12) password hashes; reject common passwords and require 8+ chars
  with a letter and a number.
- Rate limit auth, uploads, ticket verification and sensitive account actions;
  skip throttling for loopback in development.
- Helmet CSP with script-src by SHA-256 hash of the inline theme bootstrap (no
  unsafe-inline for scripts), frame-ancestors configurable, HSTS in production.
- CORS allowlist; same-origin default; reject unknown origins on state changes.
- Validate and cap every body; refuse SVG uploads; random filenames; serve
  uploads with nosniff and a strict Content-Disposition for media.
- Never trust client-supplied amounts, roles, statuses or user ids.
- Audit-log privileged admin actions.
- Production refuses weak/default secrets; document secure setup.

===================== SEED DATA =====================
`npm run seed` is idempotent: it exits early if users already exist, and
`npm run reset-db` wipes and reseeds. Generate all artwork locally as SVG files
written into server/uploads (10 avatars, 8 category covers and 20 event covers).
Seed 10 users (password123 for all), including an admin at
admin@eventtracker.app (username amina). Include 8 categories, 20 events with
ticket tiers across Nairobi, Mombasa, Kisumu, Nakuru and Naivasha, follows,
RSVPs, saves, comments, ~30 transactions (mixed successful/pending/failed),
tickets, 4 promotions, notifications, chat conversations and settings
(service fee 5%).

Demo accounts (all @eventtracker.app, password password123):
admin · daniel · zawadi · kamau · fatuma · njeri · brian · wanjiku · omar · lucia

===================== SCRIPTS AND VERIFICATION =====================
package.json scripts:
  dev (API :5000 + Vite :5173) · dev:server · dev:client · build · start ·
  seed · reset-db · test:api · test:ui · make-admin · recolour
- `npm start` must build the client first, then serve API + client on :5000 bound
  to 0.0.0.0. `npm run dev` proxies /api, /uploads and /socket.io (ws) from Vite
  to :5000 and accepts any preview host.
- scripts/smoke.js: end-to-end API checks against a running server covering auth,
  sessions, events, tickets, payments (including failure paths), promotions,
  admin data and permissions. It must exit non-zero on any failure.
- scripts/ui-smoke.js: bundle the real React tree with esbuild, run it in jsdom
  against the running server, sign in, navigate the main pages and fail on any
  render error or console error.
- scripts/make-admin.js: list accounts, promote or demote by email offline.
- Do not commit the database, uploads or build output; ship .gitkeep files and
  document recreating them with the seed script.

===================== ACCEPTANCE CRITERIA =====================
Before you finish, prove each of these with real commands:
1. `npm ci && npm run seed && npm run build && npm start` works from a clean clone.
2. GET / returns the app shell; /events, /discover and a deep link all return 200.
3. Register, sign in, refresh and sign out work; a revoked session returns 401.
4. Create an event, publish it, appear in search and on its category page.
5. Buy a ticket in simulation mode, confirm a ticket is issued only after the
   payment is successful, and that /tickets shows it with a QR.
6. Verify that ticket once; a second check-in is refused.
7. Follow, save, comment, RSVP and chat all persist and notify.
8. Admin overview totals match the seeded ledger; refund and role changes work
   and appear in the audit log.
9. API and UI smoke suites pass with zero failures.
10. No network requests to third-party hosts at runtime; all fonts, images and
    scripts are local. No console errors on any main route.
11. At 320px wide there is no horizontal scroll on any page.

Report: what you built, the commands you ran, test output, demo credentials,
and anything still incomplete.
```

---

## Short version (if you only want the workspace set up)

```text
Clone github.com/warenkyle792-prog/eventtracker, then:
npm ci
npm run seed
npm run build
npm start          # serves API + client on http://localhost:5000

Run `npm run dev` if you want Vite hot reload on :5173 with the API on :5000.
Sign in with admin@eventtracker.app / password123.
Verify with `npm run test:api` and `npm run test:ui` while the server is running.
```

---

## Notes on this checkout

- The app running here is exactly the source above: `server/` + `client/src/`.
- `npm start` rebuilds `client/dist` before booting, so a cleaned snapshot still runs.
- `FRAME_ANCESTORS` and a development-only `*.e2b.app` CORS allowance are set so
  the sandbox preview can embed the app.
- The earlier v11 build (compiled-only client, different API) is preserved in
  git history on `master` and the commit before the import.
