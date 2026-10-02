# Deployment and launch gates

## 1. Secrets

- `SERVER_SECRET` and `APP_ENC_KEY`: 32 random bytes each, hex encoded (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
- `APP_ENC_KEY` encrypts stored 2FA secrets only. To change it: `OLD_APP_ENC_KEY=<old> NEW_APP_ENC_KEY=<new> npm run rotate-app-enc-key -- --dry-run`, then again without `--dry-run`, then switch the variable and restart.
- `POSTGRES_PASSWORD` goes in a `.env` next to the compose files (template: `.env.example`). Never commit it.
- Backend variables are listed in `backend/.env.example`. Keep `TRADING_OPEN=false` until section 6 is done. Engine test endpoints are always off in production.

## 2. Platform key and fee addresses

1. Export the Owner Ledger xpub: testnet `m/45'/1'`, mainnet `m/45'/0'` (BTC) and `m/45'/2'` (LTC).
2. Record it: `MIGRATE_DATABASE_URL=... npm run insert-platform-key -- bitcoin <xpub> "m/45'/1'"`. Private keys are refused. The command prints child 0 so you can compare it on the device.
3. Pin the same xpub and the fee addresses in the frontend build (`NEXT_PUBLIC_PLATFORM_XPUB_BTC/_LTC`, `NEXT_PUBLIC_PLATFORM_FEE_ADDRESS_BTC/_LTC`) and the backend (`PLATFORM_FEE_ADDRESS_BTC/_LTC`). Until they are set, the trade page refuses to show any escrow address.
4. Rebuild the frontend image whenever these values or the network change.

## 3. Build and migrate

1. Build the images from source: `docker compose -f docker-compose.prod.yml build`.
2. Back up the database and test a restore (`ops/README.md`).
3. Run migrations with the migration role: `docker compose -f docker-compose.prod.yml run --rm backend node dist/src/db/migrate.js`. The application role must not own the tables or the deletion function.
4. Migration 0043 refuses to apply if one contract has more than one final settlement. Reconcile such rows against the chain first; never delete a payout record to get past it.
5. Settlements finalised before 0043 have no stored final transition. Check their trade state against the chain by hand.

## 4. Telegram (optional)

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`, then call `setWebhook(url=<api>/telegram/webhook, secret_token=<same secret>)`.

## 5. Design decisions

1. **Network-fee reserve.** The seller funds amount + platform fee + a reserve for the miner fee, fixed when the escrow address is created. What the miner doesn't take returns to the seller as change.
2. **Payout address per party.** Stored with each party's escrow key, so both browsers can check every output against it.
3. **2FA on email reset.** When 2FA is on, an email password reset also needs the code or a recovery code.
4. **Payment details field.** Set by the seller, shown to the buyer once escrow is funded, kept with full history, not filtered like chat.

## 6. Launch gates

Trading stays closed until every item is done.

1. **Ledger.** The Ledger Bitcoin app signs multisig only through registered wallet policies (BIP-388) built from xpubs, while each escrow uses a fresh per-trade key. Sign one dispute on a real device on testnet first. If it can't, the escrow key derivation has to change.
2. **Testnet run.** BTC and LTC: release, mutual refund, dispute both ways, stranded-coin refund, every timer, provider outage and server restart.
3. **Providers.** Confirm the NOWNodes websocket URL format, the `estimatefee` units (coin per kB assumed), and the price and FX feeds.
4. **PostgreSQL.** Concurrent acceptance, signing and deletion tests on a real server; reorg handling after a settlement confirms.
5. **Stuck settlements.** There is no tool yet for a signed settlement that never confirms (no RBF or CPFP flow).
6. **Backups.** Scheduled, monitored, offsite, with a restore drill on record.
7. **Browser.** Argon2 timing on a low-end Android phone; enforce the CSP (it ships report-only) once a browser pass shows nothing legitimate is blocked.
8. **Proxy.** `trust proxy` is set for one reverse proxy (nginx). If the API is ever reachable directly, set it to false.

## 7. Ethereum and Tron escrow

Not built. Wallet adapters for these assets are implemented but still require live provider validation, but trading is limited to BTC and LTC in code (`routes/trades.ts`, `routes/offers.ts`) and by migration 0042.

The plan was to use LocalCoinSwap's escrow contracts. Their source was reviewed (github.com/LocalCoinSwap/trc20-escrow-contract and github.com/LocalCoinSwap/ethereum-token-contracts):

- **TRC-20 contract.** The `_txFee` amount on release, cancel and dispute is chosen by whoever submits the transaction. It is not covered by the users' signatures. Total fees must be below the escrow value, but there is no tighter fee cap, so the relayer or the arbitrator can move almost the whole escrow into platform fees, which the owner can withdraw. Signatures are not bound to a chain or contract. The source is not verified on Tronscan, there are no published tests or audit, and the licence is unclear (MIT header, GPL-3.0 repository).
- **Ethereum contracts.** Written for Solidity 0.5.17, fees are fixed per trade in basis points, and every trade sits in one shared contract under owner, arbitrator and relayer roles that the owner can reassign. They need the same review and an audit before any use.

Do not deploy either as they are. Two candidate designs requiring validation:

1. Fork LocalCoinSwap's contracts, sign and cap the fee, bind signatures to chain and contract, then get an independent audit.
2. No custom contract: a per-trade 2-of-3 Safe for ETH and ERC-20, and a 2-of-3 Tron account permission for TRC-20. Both use existing multisignature mechanisms, but each trade incurs deployment or permission fees. Verify current network fees. For Tron, verify the owner permission and every active permission before funding; no single key may retain spending or permission-reset authority. These designs have not been implemented or validated in this project.

Either route then needs browser-side checks matching the BTC/LTC ones, Ledger support for the chosen signing format, and a full testnet run.

## 8. Data deletion and retention

Deletion is deferred while open trades or unresolved stranded escrow funds remain. The deletion job revokes sessions, removes identifying account data and queues attachment removal. Encrypted wallet blobs and anonymized audit exceptions remain. Contract evidence is retained for an existing counterparty until both accounts have been deleted. Existing backups follow the operator's retention policy; deleting an account does not immediately erase old backups.

## 9. Verification limits

The included PGlite runtime applies migrations and runs tests against mocked blockchain providers. Its single-engine connection serialization cannot establish normal PostgreSQL concurrency behavior. Run acceptance, settlement and deletion race tests on a disposable PostgreSQL server. Mock confirmations do not replace live testnet or hardware tests.

Confirmed settlements are not continuously reversed after a later deep chain reorganization. Continuous WAL/PITR, monitoring, external security review and complete browser testing remain outstanding.

## 10. Production prerequisites

The production Compose file expects an existing `ip2p_default` Docker network and `ip2p_ip2p_pg_data` volume. For a fresh installation, create them before starting services. For an existing installation, verify the correct database volume rather than creating an empty replacement.

Create the restricted `ip2p_app` database role before running migrations. Supply `backend/.env.production` and `frontend/.env.production` separately; they are not shipped or committed. Use the PostgreSQL service hostname and internal port in container database URLs. Backend bind-mounted attachment and discovery directories must be writable by the container's `node` user. Keep privileged migration credentials out of the regular application process where possible.

Rotate any secrets exposed in earlier source deliveries before deployment. Follow the APP_ENC_KEY rotation procedure for existing encrypted 2FA data.
