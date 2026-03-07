# nestjs-secure-auth-template

A production-minded **NestJS (Express)** template focused on **secure authentication**.

This repository is meant to be:
- a reference implementation (with explanations and trade-offs), and
- a starter template for new APIs.

## Goals

- Access tokens (JWT)
- Refresh tokens in **httpOnly cookies**
- Refresh token **rotation** + **reuse detection**
- Session tracking (per device)
- Audit logging (structured JSON)
- Loki-friendly logs (Promtail-first, with an optional direct push approach)
- Swagger at `/docs`

## Tech stack

- NestJS (Express)
- Prisma + PostgreSQL
- nestjs-pino (structured JSON logs)
- Swagger

## Project layout

- `api/` — NestJS application

## Development

```bash
cd api
pnpm install
cp .env.example .env
pnpm start:dev
```

Open:
- http://localhost:3000/docs

## Notes

This commit scaffolds the base app + logging + Swagger + Prisma initialization.
Authentication, sessions, CSRF protection, and audit tables are implemented next.

## Git workflow

- Default branch: `main`
- Integration branch: `develop`
- Feature branches: `feat/*`
- Fix branches: `fix/*`

Open PRs into `develop`, then promote `develop` → `main` when stable.

## License

MIT.
