# iP2P

Peer-to-peer marketplace for buying and selling bitcoin and litecoin for local currency. It is non-custodial: recovery phrases are created and encrypted in the browser, and every trade is held in a 2-of-3 multisig escrow between the buyer, the seller and a platform hardware key.

## Status

Development build. Trading is closed by default (`TRADING_OPEN=false`) and stays closed until the launch gates in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) are done.

| Area | State |
| --- | --- |
| Accounts, 2FA, password reset, seed recovery | Implemented |
| Wallets: BTC, LTC, ETH, USDT and USDC (ERC-20), USDT (TRC-20) | Implemented, live provider checks pending |
| Escrow trading: BTC, LTC | Implemented, testnet run pending |
| Escrow trading: ETH, ERC-20, TRC-20 | Not built, see docs/DEPLOYMENT.md section 7 |
| Dispute signing with the Ledger | Signed PSBT is pasted in by hand, device test pending |

## Layout

| Folder | Contents |
| --- | --- |
| `backend/` | Express and TypeScript API, PostgreSQL migrations, chain adapters, escrow engine |
| `frontend/` | Next.js app. Key handling and every escrow check run in the browser |
| `tests/` | Integration tests against a mock blockchain provider |
| `tools/` | Offline escrow recovery CLI, see `tools/RECOVERY.md` |
| `ops/` | Encrypted backup and restore scripts, see `ops/README.md` |
| `docs/` | Deployment steps and launch gates |

## Requirements

Node 20 or newer, PostgreSQL 16, npm.

## Local development

```sh
cp .env.example .env                  # set POSTGRES_PASSWORD
docker compose up -d postgres
cp backend/.env.example backend/.env    # fill in both database URLs; local Compose uses port 5433
# Create the ip2p_app role before migrating; see backend/README.md.
npm ci --prefix backend
npm ci --prefix frontend
npm run migrate --prefix backend
npm run dev --prefix backend
npm run dev --prefix frontend           # run in a second terminal
```

## Checks

```sh
npm run build --prefix backend
npm run build --prefix frontend
node tests/integration/pricing.test.js
npm ci --prefix tests/runtime && node tests/runtime/run.cjs
```

`tests/runtime` runs the included integration suite on PGlite with mocked blockchain providers. It does not verify normal PostgreSQL concurrency or live blockchains. To run it against a real PostgreSQL server, follow `tests/integration/README.md`.

## Secrets

Never commit `.env` files, keys or passwords. Production secrets live only on the server.
