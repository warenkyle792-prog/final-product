# Security notes and operational controls

EventTracker is self-hosted. These controls reduce common application risks but do not replace provider setup, infrastructure hardening, a penetration test, or an incident-response plan.

## Production startup and deployment boundary

- Production startup requires independent random `JWT_SECRET` and `TICKET_SECRET` values (at least 32 characters), `COOKIE_SECURE=true`, HTTPS `CLIENT_URL`, `PUBLIC_APP_URL` and exact HTTPS `CORS_ORIGINS`, and session/token lifetimes no longer than 30 days. `TRUST_PROXY=true` is rejected; configure only the actual trusted hop count or proxy address.
- Production uses the host-only `__Host-et_session` cookie (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`). HSTS and a restrictive CSP are enabled. Production WebSocket connections are limited to the configured app host.
- Built-in demo seed accounts are refused at production startup and the seed/reset utility is disabled in production. Start with a clean production data volume; create a real account over HTTPS and promote the first administrator offline with `make-admin`.
- The API sets `Cache-Control: no-store` for `/api` responses. The browser keeps the bearer token in memory only; legacy `eventtracker.session` local-storage entries are removed. A reload restores the session through the HttpOnly cookie.
- Unsafe cookie-authenticated requests require an allowed `Origin`; bearer-token clients can use the API without browser cookies. CORS is an exact origin allowlist, not `*`.

## Authentication and authorization

- Passwords use bcryptjs cost 12. Registration requires 8–72 characters including letters and digits. Login errors avoid account enumeration; failures are recorded by identifier/IP, with a five-failure 15-minute account/IP lockout plus route rate limits.
- Each login creates a server-side session row. HS256 tokens are verified with an explicit algorithm allowlist and must reference an unrevoked, unexpired session. Session revocation is checked for HTTP requests and each Socket.IO packet; socket messages also have payload and per-user rate limits.
- Role checks run on the server. Admin account-verification changes record reviewer and timestamp in the audit log. The app does not collect identity documents; an admin must complete the approved review process before marking an account verified.
- Logout revokes the session and expires the cookie. Browser token renewal is generation-guarded so a late response cannot overwrite a newer login.

## Secrets and payment controls

- Never expose Stripe secret/webhook keys, M-Pesa consumer secrets/passkeys/callback tokens, database files, or uploads in client build variables, public settings, logs, or source archives. Only the Stripe publishable key is intended for browser disclosure.
- In production, paid checkouts require a configured live provider. Stripe test keys and sandbox M-Pesa credentials are rejected by production config. If no provider is configured, checkout returns `503 PAYMENT_PROVIDER_NOT_CONFIGURED`; a sandbox/legacy intent is never promoted to a successful payment in production.
- Stripe webhook signatures use the raw request body and a five-minute timestamp window; valid `v1` signatures are compared in constant time. Successful events must match the stored provider session, transaction amount and currency. Server-side Stripe status checks apply the same amount/currency match.
- M-Pesa callback tokens are compared as equal-length UTF-8 buffers with `timingSafeEqual`. The callback must match the stored checkout reference and amount; M-Pesa checkout is KES-only. Provider and network errors leave transactions pending rather than granting a ticket.
- M-Pesa providers may require the shared callback token in the callback URL query. Query strings can enter proxy access logs: redact callback query strings at the TLS reverse proxy and use a dedicated random token that is not reused elsewhere.
- Payment creation uses per-user idempotency keys. Ticket QR payloads are HMAC-SHA256 signed with `TICKET_SECRET`, checked in constant time, and matched back to the persisted ticket. Promotions stay pending until provider confirmation.

## Requests, uploads and realtime

- API request classes have rate limits. The built-in rate-limit store is in memory; it is appropriate only for the supported single-process deployment. Do not horizontally scale this build without moving to a shared rate-limit store and a concurrency-safe database.
- Inputs are type/length/enum checked and SQL values are parameterized. Generic server errors do not return stack traces. The JSON parser and HTTP server have request-size/time limits; production proxy logs should omit authorization headers and sensitive query strings.
- Socket.IO validates the browser Origin, requires an authenticated session, checks conversation membership before joining/sending, rechecks the session on each packet, limits payload size and throttles messages.
- Uploads accept one image/video file up to 25 MiB. Extension and declared MIME must agree with the file signature; server-generated UUID names are used. Files and database are private on disk (`0600` files, `0700` data/upload directories) but uploaded media URLs are intentionally public for event/profile presentation. There is no malware-scanning service.

## Storage, scale and recovery

The current database is `sql.js` persisted as a local SQLite snapshot. It is a single-process, single-writer deployment design—not a horizontally scalable database. Run one application replica, keep `/data` on persistent storage, and stop the application before running offline admin/seed utilities against the same volume. Back up the database and uploads together, encrypt backups at rest, restrict access, and test restores. Do not include live data in source control, Docker build context, or handoff archives.

`npm run reset-db` is destructive and disabled in production. Do not run it against a production volume.

## Remaining launch risks

- There is no admin MFA, user email-verification, or self-service password-reset flow. Use a unique high-entropy admin password, limit admin access, and decide whether MFA/email verification is a launch requirement for your payment and privacy obligations.
- No external live provider credentials or callbacks can be validated from the source tree. Complete a small real-provider test, verify callback delivery/signature/amount/currency, confirm settlements/refunds with the provider, and monitor failures before opening paid events.
- This review is code-level hardening, not an independent penetration test or legal/payment-compliance certification.
