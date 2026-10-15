# Data model

The authoritative schema and migration are in `server/db/database.js`. The application enables SQLite foreign keys and binds SQL parameters rather than concatenating user-controlled values. The default database is a `sql.js` SQLite file at `data/eventtracker.sqlite`; it is runtime state, not source or seed configuration.

## Tables

| Table | Purpose and notable fields |
|---|---|
| `users` | Accounts: unique username/email, bcrypt `password_hash`, `role` (`attendee`, `organizer`, `admin`), public profile fields, admin verification timestamp/reviewer and timestamps. |
| `categories` | Event categories with unique slug/name, description, cover, neutral color and display order. |
| `events` | Organizer/category-owned event record: title/slug/description, date/time, location/venue, `price_minor`/currency, capacity, cover/video fields, publication status and featured flag. |
| `ticket_types` | Per-event ticket tiers: description, price/currency, quantity sold and optional sale window. |
| `transactions` | Payment ledger: user/event/ticket type, provider, status, provider reference, amount/currency in minor units, unique per-user `idempotency_key`, commission, purpose (`ticket` or `promotion`), JSON metadata and confirmation timestamps. |
| `tickets` | Ticket issued once per successful transaction: owner/event/tier, unique code and signed QR payload, validity/check-in/refund state and check-in time. |
| `promotions` | Paid event placement (`featured`, `boost`, `sponsored`), linked user/transaction, pending/active/expired/cancelled status, amount/currency and activation window. |
| `notifications` | User notifications with type/title/body, optional entity link, read timestamp and creation time. |
| `event_follows` | Unique user-to-event follow relationship. |
| `rsvps` | User/event RSVP with `going` or `cancelled` state; unique per user and event. |
| `saves` | Unique user-to-event saved/bookmarked relationship. |
| `follows` | Unique profile follow relationship (`follower_id` → `followed_id`); self-follow is prohibited. |
| `comments` | Event comments authored by a user. |
| `conversations` | Conversation lifecycle timestamps. |
| `conversation_participants` | Conversation membership and per-participant last-read time. |
| `messages` | Conversation messages with sender, body, creation and read timestamps. |
| `sessions` | Revocable server-side session ID linked to a user, expiry/revocation and activity timestamps. |
| `login_attempts` | Login identifier/IP, success flag and timestamp used by the lockout policy. Old attempts are pruned during login. |
| `audit_log` | Actor (nullable for CLI), action, entity, structured detail and timestamp for administrative changes. |
| `settings` | Platform key/value settings such as default currency, commission rate, service fee and support address. Provider secrets are not stored here. |
| `schema_migrations` | Applied schema migration IDs and timestamps. |

## Relationships and payment invariants

```text
users ──< events >── categories
  │         │
  │         ├──< ticket_types
  │         ├──< comments
  │         ├──< rsvps / saves / event_follows
  │         └──< promotions >── transactions
  ├──< transactions ──0..1── tickets
  ├──< notifications
  ├──< sessions
  └── follows / conversations / messages
```

A transaction is the durable payment record. Amounts, fees and commissions are integer minor units; `idempotency_key` is unique for each user. A ticket is created only when the server finalizes its ticket transaction as successful, and `tickets.transaction_id` is unique. Ticket payloads are HMAC signed with `TICKET_SECRET`. Promotion rows begin pending and become active only as part of successful server-side payment finalization. Provider/network errors do not create a success state.

## Seed behavior

`server/scripts/seed.js` inserts eight categories and six demo users if absent. It inserts the twelve sample events, ticket tiers, a demo attendee ticket, chat message and notification only when the event table is empty. The eight stock categories and their demo events use locally served full-color cinematic JPEG cover art from `client/public/covers/`. Existing demo passwords/roles and existing events are not overwritten by a normal seed run. `--recolour` changes category colors to the graphite palette. `--reset` removes the configured database and uploads directory before seeding; it is destructive. The demo password is documented in the root README and must not be used for a public production instance.

The CLI `server/scripts/make-admin.js` promotes/demotes an existing account by email or username and records the change in `audit_log`. See [Deployment](DEPLOYMENT.md) for production use.
