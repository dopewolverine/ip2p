# Integration tests

Real backend + real Postgres; a mock Blockbook (`mockBlockbook.js`, port 5999) stands in for NOWNodes. Testnet params throughout.

1. Postgres 16 with an empty `ip2p` database, superuser reachable at `TEST_SUPERUSER_DB_URL` (default `postgres://postgres:pg@localhost:5432/ip2p`), app role `ip2p_app` / password `app` (or edit `env.sh`).
2. `cd backend && MIGRATE_DATABASE_URL=$TEST_SUPERUSER_DB_URL npm run migrate`
3. `node tests/integration/mockBlockbook.js &`
4. `cd backend && . ../tests/integration/env.sh && npx ts-node --transpile-only src/server.ts > ../tests/integration/server.log 2>&1 &`
   (the reset test reads the dev-mode email from that log; override with `SERVER_LOG`)
5. `node tests/integration/backend.test.js` - auth fixes + a full BTC escrow lifecycle.
6. `node tests/integration/fe.escrow.test.js` - the browser modules (`frontend/src/lib/...`) verifying and signing against the live server, plus withdrawal checks.

`env.sh` holds throwaway test keys only. Never point these tests at production.
