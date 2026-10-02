# iP2P — Backend

Node / Express / TypeScript. Postgres. See the repo root README for the
full quick-start (Docker Postgres + both halves running together).

## Structure

```
src/
  config/env.ts        All required env vars, read once at startup
  db/
    pool.ts             pg connection pool (uses DATABASE_URL — the
                         restricted ip2p_app role, never the superuser)
    migrate.ts           Migration runner (uses MIGRATE_DATABASE_URL —
                         the superuser, since 0010 does GRANT/REVOKE)
    migrations/          Numbered, plain SQL, applied in order
  lib/                   Crypto helpers, sessions, KDF params, TOTP,
                         recovery codes, signed tokens, step-up auth,
                         scheduled sweeps (2FA disable, account deletion)
  middleware/            Session auth, in-memory rate limiting
  routes/                One file per feature area
  chain/                 P1 — ChainAdapter interface + provider adapters
  server.ts              Express app, mounts every router
```

## Commands

```bash
npm install
npm run migrate   # applies src/db/migrations/*.sql in order, tracked in schema_migrations
npm run dev        # ts-node-dev, auto-restart
npm run build       # tsc -> dist/
npm start            # node dist/server.js
```

## Required environment variables

See `.env.example` for the full list with generation commands. In short:

- `DATABASE_URL` — the app's restricted `ip2p_app` role
- `MIGRATE_DATABASE_URL` — a superuser, used only by `npm run migrate`
- `SERVER_SECRET`, `APP_ENC_KEY` — 32 random bytes each, hex-encoded
- `NOWNODES_API_KEY` — required once P1 chain routes are mounted (not
  required for P0 — registration, login, etc. work without it)

## The `ip2p_app` database role

Created once, by hand, outside of any migration (so its password never
ends up in a versioned file):

```bash
psql <your-db-url> -c "CREATE ROLE ip2p_app LOGIN PASSWORD 'pick-something-strong';"
```

Migration `0010_app_role_grants.sql` then grants it exactly what it
needs — including a hard `REVOKE UPDATE, DELETE` on `auth_events`, which
is what makes that table's append-only guarantee real rather than a
convention the application code could violate.
