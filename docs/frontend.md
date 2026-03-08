# Frontend integration guide (cookie refresh + CSRF)

This template uses:

- **Access tokens** (JWT) returned in the response body and sent by the client using:

  ```
  Authorization: Bearer <access_token>
  ```

- **Refresh tokens** stored in **httpOnly cookies** (never readable by JavaScript).
- **CSRF protection** (double-submit cookie) for cookie-authenticated endpoints.

This document explains how to implement a browser frontend correctly, including pros/cons.

## Why cookie-based refresh tokens

Storing long-lived tokens in JavaScript-accessible storage (`localStorage`, `sessionStorage`) increases the blast radius of XSS.

With this approach:
- refresh tokens are not available to JS
- the browser sends them automatically via cookies

### Pros

- refresh token is not exposed to JS (reduced impact of token exfiltration)
- works well for traditional browser apps
- enables robust server-side session control (rotation, reuse detection)

### Cons

- requires CSRF protection for cookie-authenticated endpoints
- cross-origin setups require careful CORS + cookie settings
- does not protect you from XSS-driven actions (attackers can still call your API)

## Required server-side settings (API)

If your frontend is on a different origin (domain/port) than the API, you must:

- enable CORS for the frontend origin
- allow credentials
- ensure cookies have correct `SameSite`, `Secure`, and `Domain` settings

In production, you should use HTTPS and set:

- `COOKIE_SECURE=true`

## Client-side storage model

Recommended:
- **Access token:** keep in memory (React state / module variable)
- **Refresh token:** httpOnly cookie (browser-managed)
- **CSRF token:** read from `csrf_token` cookie (not httpOnly)

Do **not** store refresh tokens in localStorage.

## Cookie / CSRF mechanics

On `POST /auth/login`, the server sets two cookies:

- `refresh_token` (httpOnly) — used by the server to rotate sessions
- `csrf_token` (non-httpOnly) — used by the client to prove request intent

For endpoints protected by CSRF (`/auth/refresh`, `/auth/logout`, `/auth/logout-all`), the client must send:

- cookies (automatic in browsers when `credentials: 'include'` is used)
- a header:

  ```
  x-csrf-token: <value of csrf_token cookie>
  ```

## Request strategies (and why this repo uses one)

This repo documents multiple options because refresh token **rotation** changes the frontend problem.

If you're reading this in isolation:
- "Option A" is simply the most practical and common strategy for browser apps.
- Alternatives exist (timers, boot-only refresh), but they have trade-offs.

For the full discussion, see: `docs/overview.md`.

### Option A (recommended): 401 → refresh → retry (once)

- send API requests with the access token
- if a request returns 401:
  1) call `/auth/refresh` (cookies + CSRF)
  2) retry the original request once

### Why refresh must be deduplicated

Because refresh tokens are **rotated**, two concurrent refresh calls can race:

- refresh #1 rotates token A → token B
- refresh #2 still uses token A → token A is revoked → 401

Therefore:
- implement a **single refresh lock** (only one refresh in flight)
- other requests should wait for the lock

## Page reload behavior (session restore)

If you keep the access token only in memory (recommended), a full page reload loses it.

To avoid sending users back to the login screen on reload, do a **silent refresh** on app boot:

1) call `/auth/refresh`
2) if it succeeds, you have a new access token
3) load the initial app state

## Device identity (web)

If your backend enforces “single session per device”, the frontend should provide a stable `deviceId`.

Recommended:
- generate a `deviceId` once
- store it in `localStorage`
- include it in login payloads

## Minimal fetch-based implementation

The demo app under `web/` contains a minimal working example.

Key pieces:

- `refreshAccessToken()` implements a single-flight lock
- `apiFetch()` retries once after refresh
- boot flow tries refresh once to restore session
- `deviceId` is generated and persisted

## Common pitfalls

### Cookies not being set/sent

- missing `credentials: 'include'`
- CORS not allowing credentials
- wrong cookie `SameSite` policy
- `COOKIE_SECURE=true` while testing over plain HTTP

### CSRF errors

If you get `401 CSRF token missing/invalid`:
- confirm `csrf_token` cookie exists
- confirm your frontend sends `x-csrf-token` header
- confirm values match
- confirm you do not have two cookies with the same name but different paths

### Mobile apps

httpOnly cookie refresh is usually not a good default for React Native.
For mobile, prefer storing refresh tokens in secure storage and sending them in the request body.
