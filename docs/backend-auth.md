# Backend auth design (NestJS + Prisma)

This document explains the **backend-side** authentication design and the security trade-offs.

## Overview

### Tokens

- **Access token**: JWT, short-lived, sent via `Authorization: Bearer <token>`.
- **Refresh token**: opaque random token stored in an **httpOnly cookie**.

### Session model

- A **Session** represents a single login context (device/browser).
- Each session can issue multiple refresh tokens over time (rotation).

### Rotation + reuse detection

- Every call to `POST /auth/refresh` **rotates** the refresh token.
- The previous refresh token is revoked and linked via `replacedById`.
- If a revoked refresh token is ever used again, we treat it as a potential theft and:
  - revoke the entire session
  - return `401 Refresh token reuse detected`

## CSRF protection (double-submit cookie)

Because refresh/logout rely on cookies, they are protected by CSRF.

Mechanism:
- `csrf_token` cookie is set by the server (non-httpOnly)
- client must send `x-csrf-token` header with the same value

Endpoints protected by CSRF:
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/logout-all`

### Important cookie paths

- `refresh_token`: scoped to `Path=/auth` (least privilege)
- `csrf_token`: scoped to `Path=/` so frontend JS can read it on any route

To avoid mismatches from legacy cookie paths, the API clears any old `csrf_token` cookie scoped to `/auth`.

## Logout semantics

### `POST /auth/logout`

This template treats logout as **kill session**:
- revokes the whole session (`Session.revokedAt`)
- revokes all active refresh tokens belonging to that session

Rationale:
- avoids the confusing state “logged out but session still active”
- makes session list/audit more intuitive

### `POST /auth/logout-all`

Revokes all sessions for the user.

## Single-session per device (web)

To avoid unlimited session growth for the same browser, the login flow can enforce:

- if `deviceId` is provided and there is an active session with the same `userId + deviceId`, revoke it before creating a new session.

### Pros

- safer defaults for the common “one browser = one session” model
- reduces operational noise (session tables do not grow quickly during tests)

### Cons

- deviceId must be stable per browser (frontend should persist it)
- users who intentionally want multiple sessions for the same device (rare) cannot

## What this design is good for

- browser frontends where you want to keep refresh tokens out of JS
- APIs that need auditability and session control

## What this design does not solve

- **XSS**: if your frontend has XSS, attackers can make authenticated calls.
- compromised devices

## Prisma / persistence notes

- Refresh tokens are stored as **hashes** (peppered) and never stored in plain text.
- Use `REFRESH_TOKEN_PEPPER` and keep it stable; rotating it will invalidate all refresh tokens.
