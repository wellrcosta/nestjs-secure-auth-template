# Frontend integration guide (cookie refresh + CSRF)

This template uses:

- **Access tokens** (JWT) returned in the response body and sent by the client using:

  ```
  Authorization: Bearer <access_token>
  ```

- **Refresh tokens** stored in **httpOnly cookies** (never readable by JavaScript).
- **CSRF protection** (double-submit cookie) for cookie-authenticated endpoints.

This document explains how to implement a browser frontend correctly.

## Why cookie-based refresh tokens

Storing long-lived tokens in JavaScript-accessible storage (`localStorage`, `sessionStorage`) increases the blast radius of XSS.

With this approach:
- refresh tokens are not available to JS
- the browser sends them automatically via cookies

Trade-off: you must handle **CSRF** and configure **CORS + credentials** correctly.

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

- the cookies (automatic in browsers when `credentials: 'include'` is used)
- a header:

  ```
  x-csrf-token: <value of csrf_token cookie>
  ```

## Minimal fetch-based implementation

### 1) Access token storage

```ts
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}
```

### 2) Read CSRF token from cookies

```ts
export function getCsrfTokenFromCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
```

### 3) Login

```ts
export async function login(API_URL: string, email: string, password: string) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password, deviceId: 'web' }),
  });

  if (!res.ok) throw new Error('Login failed');

  const data = await res.json();
  setAccessToken(data.access_token);
  return data.user;
}
```

### 4) Refresh

```ts
export async function refreshAccessToken(API_URL: string) {
  const csrf = getCsrfTokenFromCookie();
  if (!csrf) throw new Error('Missing csrf_token cookie');

  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-csrf-token': csrf,
    },
  });

  if (!res.ok) throw new Error('Refresh failed');

  const data = await res.json();
  setAccessToken(data.access_token);
}
```

### 5) API wrapper with 401 → refresh → retry (once)

```ts
let refreshing: Promise<void> | null = null;

export async function apiFetch(API_URL: string, path: string, init: RequestInit = {}) {
  async function doRequest() {
    const headers = new Headers(init.headers);

    const token = getAccessToken();
    if (token) headers.set('authorization', `Bearer ${token}`);

    return fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  }

  let res = await doRequest();
  if (res.status !== 401) return res;

  refreshing ??= refreshAccessToken(API_URL).finally(() => {
    refreshing = null;
  });

  await refreshing;
  return doRequest();
}
```

## Common pitfalls

### Cookies not being set/sent

- Missing `credentials: 'include'`
- CORS not allowing credentials
- Wrong cookie `SameSite` policy
- `COOKIE_SECURE=true` while testing over plain HTTP

### CSRF errors

If you get `401 CSRF token missing/invalid`:
- confirm `csrf_token` cookie exists
- confirm your frontend sends `x-csrf-token` header
- confirm both values match

### Mobile apps

httpOnly cookie refresh is usually not a good default for React Native.
For mobile, prefer storing refresh tokens in secure storage and sending them in the request body.

## Recommended structure in a real app

- `src/lib/auth.ts` — login/logout/refresh logic
- `src/lib/api.ts` — apiFetch wrapper
- Keep access token in memory
- On startup, try calling `/auth/refresh` once to establish a session
