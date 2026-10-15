# EventTracker

EventTracker is a self-hosted event discovery, ticketing and organizer platform. It ships as a single Node.js application: Express and Socket.IO serve the API, realtime messaging and the built React/Vite client from one origin. Data is stored in an embedded `sql.js` SQLite database and on-disk uploads.

## Highlights

- **Discover:** Home, Discover, Events, Categories and category-specific listings; event detail pages, saved events, follows, RSVPs and comments.
- **Organize:** Create and manage events, ticket tiers, media, attendee lists and ticket verification/check-in.
- **Attend:** Profiles, notifications, realtime chat, ticket wallet and signed QR tickets.
- **Payments:** M-Pesa and Stripe service integrations, persisted/idempotent payment intents, provider-verified status and callback handling, refunds and paid promotions. Local/test mode can simulate no-charge sandbox payments; production requires live provider credentials and never awards a ticket for a sandbox intent.
- **Admin:** Live database-derived reporting with commission totals by currency, account verification, roles, event moderation, categories, settings and audit history.
- **Security:** bcrypt password hashes, login throttling/lockout, revocable persisted sessions, memory-only browser bearer tokens, HttpOnly `__Host-` production cookies, cookie-mutation Origin checks, CSP/HSTS, provider-verified payments, and permission-restricted data files.
- **Design:** Restrained graphite interface with a user-selected full-bleed charcoal image as the dark-mode background (served from `/backgrounds/dark-mode-background.jpeg` and applied over the animated galaxy by `theme-overrides.css`) and a local abstract image background in light mode; a cinematic dusk-skyline photograph behind the home hero panel; eight self-hosted, cinematic full-color event/category cover photographs; warm glassmorphic sign-in/create-account screens with a local portrait backdrop; self-hosted fonts, responsive desktop/mobile navigation and an optional camera capture flow.

## Requirements

- Node.js **20 or later** (Node 22 LTS recommended) and npm.
- No external database, runtime CDN, or remote font/image dependency is required.

## Local setup

Run commands from the repository root:

```sh
npm ci
cp .env.example .env
npm run build
npm run seed
npm run dev
```

Open `http://localhost:5173`. Vite proxies API requests to the development server at `http://localhost:5000`. Alternatively, run `npm start` after `npm run build`; the single production-style server listens on `0.0.0.0:5000` and serves the client and API together. Set `PORT` to change the port.

`npm run seed` is optional for a fresh local installation. It creates the standard demo records only where appropriate; it does not reset existing user passwords or overwrite existing events. The seed/reset utility is disabled in production, and production startup refuses the built-in demo identities. Use a clean production data volume.

### Demo accounts

All seeded accounts use the initial password `password123`:

| Role | Email | Username |
|---|---|---|
| Admin | `admin@eventtracker.app` | `eventtracker` |
| Organizer | `kamau@eventtracker.app` | `kamau` |
| Organizer | `wambui@eventtracker.app` | `wambui` |
| Attendee | `njeri@eventtracker.app` | `njeri` |
| Attendee | `brian@eventtracker.app` | `brian` |
| Attendee | `amina@eventtracker.app` | `amina` |

The demo identities and `password123` are local-only. Production startup blocks any database containing those seeded accounts; do not copy a development database into production. For a production admin, register a real account over HTTPS, stop the service, then promote that account offline with `npm run make-admin -- you@example.com`.

## Configuration

Copy `.env.example` to `.env` and edit values for your environment. The example contains **development-only** secrets and is not suitable for production. `server/config.js` is the authoritative list of defaults and validation rules; `docs/DEPLOYMENT.md` explains production setup.

Important settings:

- `NODE_ENV`, `PORT`, `CLIENT_URL`, `PUBLIC_APP_URL`, `CORS_ORIGINS`, `TRUST_PROXY`, `FRAME_ANCESTORS`, `COOKIE_SECURE`.
- `JWT_SECRET`, `TICKET_SECRET`, `SESSION_DAYS`, `TOKEN_DAYS`.
- `DATA_DIR`, `DB_FILE`, `UPLOADS_DIR`, `UPLOAD_JSON_LIMIT`.
- `RATE_LIMIT_GENERAL`, `RATE_LIMIT_AUTH`, `RATE_LIMIT_UPLOADS`, `RATE_LIMIT_VERIFY`, `RATE_LIMIT_SENSITIVE`, `RATE_LIMIT_WINDOW_MS`.
- `MPESA_ENV`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_URL`, `MPESA_CALLBACK_TOKEN`.
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.

See [Deployment](docs/DEPLOYMENT.md), [Security](docs/SECURITY.md), [Data model](docs/DATA_MODEL.md) and [API reference](docs/API.md).

## Useful commands

```sh
npm run build             # create client/dist for production serving
npm start                 # start the built single-origin application
npm run test:api          # isolated HTTP/Socket.IO end-to-end suite (396 checks)
npm run test:ui           # jsdom interaction suite (12 tests)
npm run seed              # add initial demo users, categories and sample content
npm run seed -- --recolour # rewrite seeded category colours to graphite neutrals
npm run reset-db          # DESTRUCTIVE: remove the configured DB and uploads, then reseed
npm run make-admin -- --list
npm run make-admin -- you@example.com
npm run make-admin -- you@example.com --demote
```

The destructive reset deletes the configured database and the configured uploads directory before recreating demo content. Back up both first if they contain anything you need.

## Verification and expected behavior

The API and UI suites are run with `npm run test:api` and `npm run test:ui`. They exercise real HTTP routes and local UI flows; coverage includes auth/session security, uploads, chat, payment confirmation and failure paths, signed tickets, promotions, commission reporting, admin account verification, and permissions. Production boot and clean-archive checks are documented in the deployment handover.

Camera permission is requested only after the user taps the camera control. HTTPS (or a browser's localhost exception) is required by browsers for camera access. Users can also choose an image/video file, review its preview, and remove it before submitting.

## Data and operations

The default database is `data/eventtracker.sqlite`; uploaded media is in `data/uploads/`. Both are runtime state and should be backed up and stored on persistent writable storage. Do not commit, distribute, or include them in a release archive. The Docker image and compose setup use `/data` as a persistent volume. See [Data model](docs/DATA_MODEL.md) and [Deployment](docs/DEPLOYMENT.md).

## License

This application is delivered as a private project; no open-source license is asserted by this repository.
