# Production deployment

EventTracker serves the built React app, `/api`, uploaded media and Socket.IO from one Node process. Its current `sql.js` persistence and in-memory rate limits are designed for a **single application replica**; do not horizontally scale this build.

Payment providers are optional for the initial deployment. Leave the M-Pesa and Stripe credentials blank to keep paid checkout disabled in production; free-event RSVP remains available. Configure provider credentials only when live payment services are ready.

## Before deployment

1. Choose a stable HTTPS app origin, for example `https://events.example.com`, and terminate TLS at a maintained reverse proxy/load balancer.
2. Keep a private environment file or use the deployment platform's secret manager. Never commit `.env` or put real credentials into Vite variables, issue trackers or logs.
3. Set `NODE_ENV=production`, `COOKIE_SECURE=true`, and separate random secrets for `JWT_SECRET` and `TICKET_SECRET` (32 bytes or more each). For example:
   ```sh
   openssl rand -hex 32
   openssl rand -hex 32
   ```
   These values must differ from each other and from payment callback/webhook secrets. Production startup rejects weak/reused secrets and `SESSION_DAYS`/`TOKEN_DAYS` above 30.
4. Set exact HTTPS origins, without paths or wildcards:
   ```env
   CLIENT_URL=https://events.example.com
   PUBLIC_APP_URL=https://events.example.com
   CORS_ORIGINS=https://events.example.com
   ```
   Add only additional exact HTTPS origins that you actually operate.
5. Set `TRUST_PROXY` to the real trusted proxy topology: e.g. `1` for exactly one trusted hop, or leave `false` when clients connect directly. Do not use `true`; production refuses it. The proxy must forward the original host/protocol and support WebSocket upgrades.
6. Use a fresh, persistent production data volume. Production refuses the built-in demo accounts, and `seed`/`reset-db` are disabled in production. Register a real user over HTTPS and promote the first admin as described below.

Production cookies use the `__Host-et_session` prefix (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`). Keep the site HTTPS-only. HSTS is set to one year with `includeSubDomains` and `preload`; enable this only when every covered subdomain is HTTPS-ready. CSP restricts scripts to self and limits production WebSockets to the app host.

## Native Node.js

Use Node 20+ (Node 22 LTS recommended) and run commands from the project root:

```sh
npm ci
npm run build
npm start
```

Keep a supervisor (systemd or equivalent) responsible for restart and logs. `npm start` binds to `0.0.0.0:${PORT:-5000}`. The server handles `SIGTERM`/`SIGINT`, closes Socket.IO and flushes the database, with a shutdown guard. Health check: `GET /api/health`.

## Docker Compose

The supplied image runs as the unprivileged `node` account, has a read-only app filesystem, drops Linux capabilities, sets `no-new-privileges`, and keeps persistent database/uploads under `/data`.

```sh
cp .env.example .env
# Edit .env: NODE_ENV is overridden to production by Compose; set
# COOKIE_SECURE=true, HTTPS origins, independent secrets and provider keys.
chmod 600 .env
docker compose build
docker compose up -d
docker compose logs -f eventtracker
```

Compose publishes to `127.0.0.1:${HOST_PORT:-5000}` by default for a host-level TLS proxy. If a network-facing load balancer must connect directly, set `HOST_IP=0.0.0.0` and protect the port with a firewall. Do not run more than one replica against the same `/data` volume.

Back up the SQLite database and uploads together. For a consistent offline copy, stop the service, snapshot/copy the full volume, then restart. Encrypt backups at rest, restrict access, and test restores. The database and upload directories are private on disk, but uploaded media URLs are public by design.

## Live payments

The no-charge sandbox exists only for local/test modes. Production never simulates a successful paid transaction. With no live provider configured, paid checkout returns `503 PAYMENT_PROVIDER_NOT_CONFIGURED` and old sandbox transactions remain pending; free-event RSVP remains available.

### M-Pesa

Use `MPESA_ENV=production` and configure the live consumer key/secret, shortcode, passkey, callback token (at least 32 random characters), and public HTTPS callback URL ending in `/api/payments/callback/mpesa`. M-Pesa checkout is KES-only. The provider callback reference and amount must match the stored transaction before a ticket is issued. The callback token is placed in the provider URL query because arbitrary application headers may not be supported; configure reverse-proxy logs to redact callback query strings.

### Stripe

Set live `sk_live_` (or supported `rk_live_`) and `pk_live_` keys plus the provider-issued `STRIPE_WEBHOOK_SECRET`. Test-mode keys are rejected in production. Configure the webhook endpoint as `https://events.example.com/api/payments/callback/stripe`; it validates the raw-body signature and five-minute timestamp window, then checks the session ID, transaction amount and currency. Browser redirects alone do not confirm a payment.

Run a small real-provider test and reconcile it with the provider dashboard before opening paid events. Confirm callback delivery, settlement, cancellation and refund procedures. Never manually mark a pending payment successful.

## Admin bootstrap and offline tools

Create an account, stop the service, then run the CLI against the exact production volume:

```sh
npm run make-admin -- --list
npm run make-admin -- person@example.com
```

Stop the app before using `make-admin`: the current database is a single-process in-memory SQLite snapshot, so concurrent app/CLI writers are unsafe. The CLI writes an audit record. The first production account should have a unique high-entropy password and tightly limited access; admin MFA is not currently implemented.

## Release checks

Run from the extracted release directory:

```sh
npm ci
npm run build
npm run test:api
npm run test:ui
npm audit --omit=dev
```

Also verify a production boot with production-quality environment values, `/api/health`, the app shell, and HTTPS/HSTS through the actual proxy. Confirm the deployed cookie has `Secure` and the `__Host-` name; verify exact CORS origins, proxy trust, persistent volume and callback-log redaction. A source-level config test is not proof that the live provider account, domain, proxy or production secrets are correct.

Before enabling payments, verify that free-event RSVP works and paid checkout stays unavailable without provider credentials. After configuring a provider, follow its live-payment checks above before opening paid events.
