# HTTP and realtime API reference

The JSON API is mounted at `/api`. The single-origin client defaults to relative `/api`; all paths below are relative to that prefix. Authentication uses an HttpOnly session cookie and a short-lived/reissued HS256 bearer token; send `Authorization: Bearer <token>` from non-browser clients. Admin endpoints require the `admin` role; event verification requires an `organizer` or `admin`. IDs, ownership and provider confirmation are rechecked by the server.

## Platform and authentication

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/` | Public | API identity/version. |
| `GET` | `/health` | Public | Readiness (`status`, database and uptime). |
| `GET` | `/settings/public` | Public | Public platform settings and explicit live/sandbox payment mode (no private provider secrets). |
| `POST` | `/auth/register` | Public | Create attendee/organizer account, session and cookie. Public registration cannot grant admin. |
| `POST` | `/auth/login` | Public | Sign in by email or username; lockout and rate limits apply. |
| `POST` | `/auth/logout` | Session | Revoke current session and clear cookie. |
| `GET` | `/auth/me` | Session | Current user and profile statistics. |
| `POST` | `/auth/refresh` | Session | Explicit renewal; normal authenticated use also silently renews after token half-life. |
| `POST` | `/uploads` | Session | Upload one supported image/video (max 25 MiB); returns a local `/uploads/...` URL. |

## Discovery, events and categories

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/categories` | Public | Ordered category list. |
| `GET` | `/categories/:slug` | Public | Category and its events. |
| `GET` | `/feed` | Public | Featured/current event feed. |
| `GET` | `/events` | Public | Event listing with query filters/pagination. |
| `GET` | `/events/:id/:slug?` | Public | Event detail, ticket types, counts and relevant viewer context. |
| `POST` | `/events` | Session | Create an event and ticket type. |
| `PATCH` | `/events/:id` | Owner/admin | Update an event. |
| `DELETE` | `/events/:id` | Owner/admin | Delete an event. |
| `POST` | `/events/:id/follow` | Session | Toggle an event follow. |
| `POST` | `/events/:id/save` | Session | Toggle a saved event. |
| `POST` | `/events/:id/rsvp` | Session | Set/cancel RSVP. |
| `GET` | `/comments?event_id=...` | Public | Read event comments. |
| `POST` | `/comments` | Session | Add a comment. |

## Profiles, notifications and chat

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/users/:id` | Public | Public profile, follower stats and published events. |
| `POST` | `/users/:id/follow` | Session | Toggle a profile follow. |
| `PUT` | `/me/profile` | Session | Update name, bio and local media avatar. |
| `GET` | `/me/events` | Session | Current user's organizer events. |
| `GET` | `/me/saved` | Session | Saved events. |
| `GET` | `/me/notifications` | Session | Notifications and unread count. |
| `PATCH` | `/me/notifications/read` | Session | Mark one notification or all as read. |
| `GET` | `/chat/unread` | Session | Unread message count. |
| `GET` | `/chat/conversations` | Session | Current user's conversations. |
| `POST` | `/chat/conversations` | Session | Create/find a direct conversation (`user_id`). |
| `GET` | `/chat/conversations/:id/messages` | Participant | Read messages and update read markers. |
| `POST` | `/chat/conversations/:id/messages` | Participant | Send a message over HTTP. |

Socket.IO uses the same server and session token. Realtime events include `conversation:join` (membership checked), `message:send` (membership/body validated) and `message:new`. User-specific notifications are emitted to authenticated sockets.

## Payments, promotions and tickets

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/promotions/pricing` | Public | Supported currency/placement prices in minor and major units. |
| `POST` | `/payments` | Session | Create ticket payment intent (`event_id`, provider, currency, idempotency key; optional ticket type/phone). |
| `POST` | `/promotions` | Event owner/admin | Create a pending paid-placement intent (`featured`, `boost` or `sponsored`). |
| `GET` | `/payments` | Session | User's payments (admin sees recent global rows). |
| `GET` | `/payments/:id` | Owner/admin | Payment details. |
| `GET` | `/payments/:id/status` | Owner/admin | Server-side provider/sandbox status synchronization; never send a success status from the browser. |
| `POST` | `/payments/callback/mpesa` | Provider callback | Requires configured shared callback token, matching checkout reference and expected KES amount. |
| `POST` | `/payments/callback/stripe` | Provider callback | Requires a valid Stripe webhook signature plus matching session ID, amount and currency. |
| `GET` | `/promotions` | Session | User's promotions (admin sees recent global rows). |
| `GET` | `/tickets` | Session | Current user's issued tickets. |
| `GET` | `/tickets/:id` | Owner/event owner/admin | Ticket detail. |
| `GET` | `/tickets/:id/qr` | Owner/event owner/admin | Locally generated QR data URI and signed payload. |
| `POST` | `/verify` | Event organizer/admin | Verify signed QR payload; `{ "check_in": true }` marks a valid ticket checked in. |
| `POST` | `/admin/payments/:id/refund` | Admin | Mark successful payment/ticket refunded; reconcile the actual provider refund separately. |

Payment amounts are server-calculated and stored as integer minor units. Use a unique `idempotency_key` per payment action. A redirect, query parameter or client-supplied status is not payment proof. Local/test environments may simulate no-charge sandbox status. Production returns `503 PAYMENT_PROVIDER_NOT_CONFIGURED` for paid checkout without a live provider, and legacy sandbox payments stay pending (no ticket is issued). Provider/network errors remain pending.

## Admin operations

All routes in this group require the `admin` role.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/figures` | Live counts, confirmed commission/revenue totals by currency and per-event ticket reporting; refunded payments are excluded. |
| `GET` | `/admin/users?q=...` | Search accounts. |
| `PATCH` | `/admin/users/:id/role` | Change attendee/organizer/admin role. |
| `PATCH` | `/admin/users/:id/verification` | `{ "verified": true/false }` marks or revokes admin account verification; changes are audited. |
| `GET` | `/admin/events` | Event moderation list with live counts. |
| `PATCH` | `/admin/events/:id/status` | Set draft/published/cancelled status. |
| `GET` | `/admin/tickets` | Ticket reconciliation. |
| `GET` | `/admin/settings` | Platform settings. |
| `PATCH` | `/admin/settings` | Change allowed settings (currency, commission, service fee, support email); keys are allowlisted. |
| `GET` | `/admin/audit` | Recent audit history. |
| `GET` | `/admin/categories` | Category administration list. |
| `POST` | `/admin/categories` | Create category. |
| `PATCH` | `/admin/categories/:id` | Edit category. |
| `DELETE` | `/admin/categories/:id` | Delete category subject to database constraints. |

Successful responses are JSON; failures use stable `error` codes and generic unexpected-server-error responses. The detailed route validators and response projections are maintained in `server/routes/` and tested by `server/tests/api.test.js`.
