# Security Audit — VELCOR EventTracker

**Date:** 2026-10-06 · **Scope:** full application (server, client build, dependencies, runtime config)
**Method:** manual code review of every server module, live endpoint probing against the running server, the automated API suite, and `npm audit`.

> No application is ever "100% secure." This document records what was checked, what was fixed, what was verified, and — just as important — the residual risks that remain by design.

---

## 1. Findings fixed in this audit

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| 1 | **CRITICAL** (dev toolchain only) | `shell-quote` command-injection (GHSA-pqg4-j6r4-53mv) pulled in transitively by `concurrently`. No fixed `concurrently` release existed. | Added a package `overrides` entry pinning `shell-quote ^1.12.0` (semver-compatible with concurrently's `^1.9` requirement). `npm audit` now reports **0 vulnerabilities**; `concurrently --version` still works. |
| 2 | **MEDIUM** | No `Permissions-Policy` header — browser capabilities (camera, mic, payment, USB, geolocation, FLoC) were not restricted. | Added `Permissions-Policy: camera=self, microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()` middleware in `server/app.js`. |
| 3 | **MEDIUM** | CSRF / cross-origin requests were rejected **silently** — no telemetry on possible attacks. | Rejections now emit `console.warn('[security] csrf-origin rejected …')` (suppressed in test mode). Rate-limit hits are logged the same way (`rate-limits.js`). No credentials/tokens/cookies are ever logged. |
| 4 | **MEDIUM** | No self-service password change, and stale sessions were never pruned from the DB. | New `POST /api/auth/password` (requires auth + "sensitive" rate limit): verifies current password with bcrypt, enforces the password policy, updates the hash, and **revokes all other sessions**. Login now prunes expired and long-revoked sessions for that user. |
| 5 | **MEDIUM** | Unlimited Socket.IO connections per user — one account could open unbounded sockets. | Per-user cap (6 concurrent sockets) enforced in the `io.use` handshake; excess connections get a `too-many-connections` error. |
| 6 | **LOW** | `cover_image` / `video_url` on events accepted arbitrary strings (external URLs, non-path values) — a stored-XSS-adjacent smell even though CSP blocks script execution. | Both fields now validated server-side against strict local-path patterns (`/uploads/…` or `/covers/…` with an allowed media extension, or empty). External/`javascript:`-style values are rejected with 400. |

## 2. Reviewed and confirmed sound (no change needed)

- **Uploads** (`server/lib/uploads.js`): extension+MIME allowlist cross-check, magic-byte signature verification, 25 MB cap, single file, `wx` write flag, random UUID filenames, `0600` files inside a `0700` directory. SVG is not allowed.
- **SQL**: every statement is parameterized (sql.js prepared statements); no string-built queries found.
- **Sessions/JWT**: httpOnly cookies, `sameSite=lax`, 7-day expiry; JWT `jti` pinning with server-side revocation check.
- **Passwords**: bcrypt cost 12; unified `INVALID_CREDENTIALS` on login; failed-attempt account lockout; password policy (8–72 chars, letter+digit, ≤72-byte bcrypt input).
- **Rate limiting**: separate general / sensitive / login limits; loopback skip only outside production; 429 responses now also logged.
- **Headers**: strict CSP (`default-src 'self'`, `script-src 'self'`, `form-action 'self'`), HSTS in production, `Referrer-Policy: no-referrer`, `nosniff`, `frameguard: sameorigin`, CORS origin allowlist.
- **Google OAuth**: fail-closed 503 `GOOGLE_NOT_CONFIGURED` without credentials; signed short-lived state JWT (HS256, 10 min); `email_verified` required; no secrets in the client.

## 3. Verification

- **Automated suite** (`node --test server/tests/api.test.js`): **3/3 suites pass, 405 checks** (up from 396). New regression checks: Permissions-Policy present (×2), external & non-path cover images rejected 400 (×2), password-change flow — wrong current password 401, weak new password 400, success 200, other sessions revoked 401, login with new password 200 (×5).
- **Live server checks (port 5000)**: `Permissions-Policy` header present; `POST /api/events` with `https://evil.example/x.jpg` cover → **400**; unauthenticated `POST /api/auth/password` → **401**; `/api/auth/google` → **503** fail-closed; real PNG upload → **201** with UUID path; logins for seeded users → 200.
- **Dependencies**: `npm audit` → **0 vulnerabilities** after the shell-quote override.

## 4. Residual risks (honest, by design)

1. **No email-backed password reset.** The app has no mailer/SMTP configured. Shipping a reset flow without a verified mail provider would itself be an attack surface (mail interception, header injection, open relay). The new authenticated password-change endpoint covers users who know their current password; an admin path covers the rest.
2. **bcrypt-12 instead of Argon2id.** bcrypt at cost 12 is acceptable industry practice; Argon2id is the modern recommendation and a reasonable future migration.
3. **Registration reveals existing emails** ("email already registered"). Deliberate UX/security tradeoff; login itself never distinguishes unknown-user from wrong-password.
4. **No MFA.** Not implemented; recommended for admin accounts in a future iteration.
5. **Legal boilerplate** (privacy policy / ToS / cookie policy pages) is static template text and needs professional legal review before public launch.
6. **Major-version dependency bumps** (Express 5, React 19, etc.) were intentionally **not** applied during a security pass to avoid breaking working functionality; they are tracked as routine maintenance instead.

## 5. Operational recommendations

- Run `npm audit` on every release; keep the `shell-quote` override until `concurrently` ships a patched release.
- Set `NODE_ENV=production`, `CORS_ORIGINS`, and strong `SESSION_SECRET` in deployment (the config already refuses weak defaults in production).
- Review the `[security] …` log lines in production; a spike in `csrf-origin rejected` or `rate limit` entries indicates probing.
- Schedule periodic third-party penetration testing; this audit is not a substitute for it.
