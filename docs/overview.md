# Secure auth template: threat model, architecture, and trade-offs

This repository is a **secure authentication template** for NestJS APIs.

It is written with two audiences in mind:

1) **Engineers** who want a clear, practical reference implementation (with reasoning)
2) **Teams/companies** who want a template they can adopt as a baseline for real products

The goal is not to be "clever". The goal is to be **boring, explainable security**.

---

## Why this template exists

Token-based authentication is easy to implement "enough to work".
It is also easy to implement in a way that quietly increases risk:

- long-lived tokens stored in `localStorage`
- refresh tokens that do not rotate
- no session visibility or audit trail
- no CSRF protection when cookies are involved
- poor logging that cannot support incident response

This template exists to provide a **default that is safe**, and a foundation that is **auditable and maintainable**.

---

## Threat model (what we are trying to protect against)

### Threats we mitigate well

#### 1) Refresh token theft / session hijacking

If an attacker steals a refresh token, they can usually keep minting new access tokens.

This template reduces impact by using:

- **httpOnly cookie** refresh tokens (not readable by JavaScript)
- **rotation** (every refresh invalidates the previous refresh token)
- **reuse detection** (if a revoked token appears again, revoke the entire session)

Net effect: a stolen refresh token has a **smaller time window** and is **detectable**.

#### 2) Token exfiltration via storage leaks

Storing long-lived tokens in JS-accessible storage increases the blast radius of XSS.

This template keeps refresh tokens out of JS.

#### 3) CSRF on cookie-authenticated endpoints

If refresh/logout endpoints rely on cookies, they become CSRF targets.

This template uses a **double-submit cookie** mechanism:
- `csrf_token` cookie
- `x-csrf-token` header

#### 4) Brute force / credential stuffing (baseline)

Login implements lockout logic and the API includes throttling.

### Threats we do NOT solve

#### XSS

If your frontend has XSS, an attacker can make authenticated requests as the user.
httpOnly cookies help protect token exfiltration, but **do not prevent actions**.

Mitigations live elsewhere:
- CSP (Content Security Policy)
- safe rendering
- dependency hygiene
- strict input handling

#### Compromised devices

If the OS/browser is compromised, any auth scheme can be abused.

---

## Architecture (high-level)

### Access token (JWT)

- short-lived JWT
- sent via `Authorization: Bearer <token>`
- used for most API calls

### Refresh token (opaque)

- random opaque token
- stored in a database as a **hash** (peppered)
- stored client-side as an **httpOnly cookie**

### Sessions

- a `Session` represents one device/browser login context
- refresh tokens are associated with a session
- sessions can be listed and revoked

### Audit log

- security events are recorded (login, refresh, logout, revoke)
- supports security review and incident response

---

## Frontend strategy: options

Refresh tokens rotate. That fact drives the frontend strategy.

### Option A (recommended): "401 → refresh → retry once"

**How it works:**

1) Frontend calls API with access token.
2) If the API returns `401`:
   - call `POST /auth/refresh` (cookies + CSRF header)
   - store the new access token
   - retry the original request **once**

**Why it works well:**
- avoids timers
- naturally refreshes only when needed
- easy to reason about

**What you must implement:**
- a **single-flight refresh lock** (deduplicate refresh calls)

Because refresh rotates tokens, concurrent refresh calls can race:
- refresh #1 rotates token A → token B
- refresh #2 still uses token A → token A is revoked → `401`

So: only one refresh in flight at a time.

### Option B: proactive refresh (timer)

Set an interval to refresh before the JWT expires.

Pros:
- fewer 401s

Cons:
- tricky with multiple tabs
- harder to tune
- still requires a lock (you can still trigger concurrent refresh)

### Option C: refresh on boot only

On page load, call refresh once.

Pros:
- fixes "reload sends me back to login"

Cons:
- still need Option A for long-lived sessions

This template uses **Option A + a boot refresh**.

---

## Logout semantics

This template treats logout as **kill session**.

When a user clicks "Logout", they generally expect:

- refresh token is revoked
- the session is no longer valid
- refresh attempts fail

So logout revokes the whole session (`Session.revokedAt`) and any active refresh tokens for that session.

---

## Single-session per device (web)

In real products, a single browser should not accidentally create unlimited active sessions.

This template supports a "single session per deviceId" approach:

- frontend provides a stable `deviceId` (persisted in `localStorage`)
- backend revokes any existing active session with the same `userId + deviceId` on login

This keeps session lists meaningful and reduces operational noise.

---

## Observability and auditability (why it matters in real companies)

Teams usually discover the importance of auth logging during incidents:

- "Which sessions were active?"
- "Was a refresh token replayed?"
- "Which IPs attempted login failures?"
- "When did a user session get revoked?"

This template emits:
- **structured JSON logs** (easy to parse/label)
- **audit log events** in the database

The log backend varies by company:
- Loki, ELK, Datadog, Splunk, CloudWatch, etc.

The important part is the **shape** of the logs and the discipline:
- never log secrets
- log security-relevant events consistently

---

## Real-world impact

Adopting this template can improve:

- **security posture** (rotation + reuse detection + CSRF)
- **incident response** (sessions + audit events)
- **engineering velocity** (a safe baseline reduces repeated decision-making)
- **debuggability** (structured logs)

Costs/trade-offs:

- more moving parts than a naive JWT-only implementation
- cookie/CSRF complexity
- careful CORS + HTTPS configuration in production

---

## When to use this template

Good fit:
- browser-based products
- APIs where you need auditability and session controls

Not a good fit:
- mobile apps without reliable httpOnly cookie support (prefer secure storage + body refresh)
- highly constrained environments where cookies/CSRF/CORS are not feasible
