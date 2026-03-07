# nestjs-secure-auth-template

A production-minded **NestJS (Express)** template focused on **secure authentication**.

This repository is designed to be both:
- a **reference implementation** (explains threat models and trade-offs), and
- a **starter template** for new APIs.

## Features

- Access tokens (JWT)
- Refresh tokens stored in **httpOnly cookies**
- Refresh token **rotation** + **reuse detection** (session hijack mitigation)
- Session tracking (per device)
- Audit logging (DB table + structured JSON logs)
- Loki-friendly logs (Promtail-first; optional direct push path documented later)
- Swagger at `/docs` (and `GET /` redirects to `/docs`)

## Tech stack

- NestJS (Express)
- Prisma + PostgreSQL
- nestjs-pino (structured JSON logs)
- Swagger

## Security model (high-level)

- **Access token** is short-lived and sent via `Authorization: Bearer <token>`.
- **Refresh token** is a random opaque token stored only as an **httpOnly cookie**.
- On refresh, tokens are **rotated**:
  - the old refresh token is revoked
  - a new refresh token is issued
- **Reuse detection**: if a revoked refresh token is seen again, we assume it may have been stolen and we **revoke the entire session**.
- **CSRF protection**: refresh/logout endpoints use a **double-submit cookie** token (`csrf_token` cookie + `x-csrf-token` header).

> This template does **not** attempt to solve XSS. If an attacker gets XSS in your app, they can call your API with the victim context. Use CSP + proper input handling.

## Project layout

- `api/` — NestJS application

## Environment variables

Copy `api/.env.example` to `api/.env`.

Required:
- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `REFRESH_TOKEN_PEPPER`

Recommended:
- `JWT_ACCESS_TTL_SECONDS` (default: 900)

Cookies:
- `COOKIE_SECURE` (`true` in production)
- `COOKIE_SAMESITE` (`lax` by default; consider `strict` depending on your UX)
- `COOKIE_DOMAIN` (optional)

## Development

## Local stack (Postgres + Loki)

This repository ships a `docker-compose.yml` that starts:
- Postgres
- API (NestJS)
- Loki + Promtail
- Grafana (Loki datasource pre-provisioned)

```bash
docker compose up --build
```

- API docs: http://localhost:3000/docs
- Grafana: http://localhost:3001 (admin/admin)
- Loki: http://localhost:3100

### Logs

The API emits **JSON logs**. Promtail reads the API container logs from the Docker socket and pushes to Loki.

In Grafana, use **Explore** → **Loki** and query:

```
{container=~".*api.*"}
```

> Tip: Remove the `keep` relabel rule in `infra/promtail/config.yml` to ingest logs from all containers.


```bash
cd api
pnpm install
cp .env.example .env

# Generate Prisma client (required after schema changes)
pnpm prisma:generate

pnpm start:dev
```

Open:
- http://localhost:3000/docs

## Auth endpoints (summary)

- `POST /auth/register` (public)
- `POST /auth/login` (public)
  - sets `refresh_token` (httpOnly) + `csrf_token` (non-httpOnly)
  - returns `{ access_token }`
- `POST /auth/refresh` (requires CSRF)
  - reads refresh cookie
  - rotates refresh token
  - returns `{ access_token }`
- `POST /auth/logout` (requires CSRF)
- `POST /auth/logout-all` (requires CSRF)
- `GET /auth/sessions` (JWT bearer)

### CSRF header

For endpoints protected by CSRF (`/auth/refresh`, `/auth/logout`, `/auth/logout-all`):

- browser will send cookie automatically
- client must send a header:

```
x-csrf-token: <value of csrf_token cookie>
```

## Logging

- App logs are JSON (nestjs-pino) and redact sensitive fields.
- Audit events are also stored in the `AuditLog` table.

## Git workflow

- Default branch: `main`
- Integration branch: `develop`
- Feature branches: `feat/*`
- Fix branches: `fix/*`

Open PRs into `develop`, then promote `develop` → `main` when stable.

## License

MIT.
