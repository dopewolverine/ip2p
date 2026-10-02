import { Router } from 'express';
import { z } from 'zod';
import * as bitcoin from 'bitcoinjs-lib';
import { Transaction as EvmTransaction } from 'ethers';
// @ts-ignore - see the note in chain/tronAdapter.ts about tronweb's types.
import TronWeb from 'tronweb';
import { pool } from '../db/pool';
import { ASSET_CONFIG, ALL_ASSETS, isValidAddressForChain, validateDestinationAddress, Chain } from '../lib/walletAssets';
import { getAdapter } from '../chain';
import { networkFor } from '../chain/networks';
import { getCachedBalance, setCachedBalance } from '../lib/balanceCache';
import { subscribeWallet } from '../lib/depositMonitor';
import { checkNativeGasAvailable } from '../lib/nativeGasCheck';
import { logWalletEvent } from '../lib/walletEvents';
import { rateLimit } from '../middleware/rateLimit';
import { requireSession } from '../middleware/auth';
import { getReferencePriceUsd } from '../marketplace/priceFeed';
import { getUsdRates, SUPPORTED_CURRENCIES } from '../lib/fiatRates';
import { idParam } from '../lib/params';

export const walletRouter = Router();

// ---- POST /wallet/addresses ----
// Spec P1 §4.1 - the client derives the receiving address per asset after
// decrypting the seed; the server validates and stores.
//
// An address recorded for the current wallet blob can
// no longer be replaced. The old upsert overwrote it, so anyone holding a
// user's session could swap the deposit address shown to that user. The
// browser also re-derives and compares every address before showing it.
// A password change or seed recovery re-encrypts the SAME
// seed; rows for identical addresses are re-attached to the new blob
// instead of being duplicated (which double-recorded every deposit).
const addressesSchema = z.object({
  addresses: z.array(z.object({
    asset: z.enum(ALL_ASSETS as [string, ...string[]]),
    address: z.string().min(1).max(100),
  })).min(1).max(ALL_ASSETS.length),
});

walletRouter.post(
  '/wallet/addresses',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyFn: (req) => `wallet_addresses:${req.user!.id}` }),
  async (req, res) => {
    const parsed = addressesSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
    const userId = req.user!.id;

    for (const entry of parsed.data.addresses) {
      const { chain } = ASSET_CONFIG[entry.asset as keyof typeof ASSET_CONFIG];
      if (!isValidAddressForChain(entry.address, chain)) return res.status(400).json({ error: 'invalid_address', asset: entry.asset });
    }

    const { rows: blobRows } = await pool.query(`SELECT id FROM wallet_blobs WHERE user_id = $1 AND status = 'current'`, [userId]);
    const currentBlobId = blobRows[0]?.id;
    if (!currentBlobId) return res.status(409).json({ error: 'no_current_blob' });

    const toWatch: Array<{ id: string; user_id: string; asset: string; chain: Chain; address: string }> = [];
    const created: string[] = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const entry of parsed.data.addresses) {
        const asset = entry.asset as keyof typeof ASSET_CONFIG;
        const { chain, derivationPath } = ASSET_CONFIG[asset];

        const { rows: forBlob } = await client.query(
          `SELECT id, address FROM wallets WHERE user_id = $1 AND asset = $2 AND blob_id = $3`, [userId, asset, currentBlobId]
        );
        let walletId: string;
        if (forBlob[0]) {
          if (forBlob[0].address !== entry.address) {
            await client.query('ROLLBACK');
            await logWalletEvent({ userId, eventType: 'address_validation_failed', asset, metadata: { reason: 'address_change_rejected' } });
            return res.status(409).json({ error: 'address_mismatch', asset });
          }
          await client.query(`UPDATE wallets SET status = 'active' WHERE id = $1`, [forBlob[0].id]);
          walletId = forBlob[0].id;
        } else {
          const { rows: sameAddress } = await client.query(
            `SELECT id FROM wallets WHERE user_id = $1 AND asset = $2 AND address = $3 ORDER BY created_at DESC LIMIT 1`,
            [userId, asset, entry.address]
          );
          if (sameAddress[0]) {
            await client.query(`UPDATE wallets SET blob_id = $1, status = 'active' WHERE id = $2`, [currentBlobId, sameAddress[0].id]);
            walletId = sameAddress[0].id;
          } else {
            const { rows: inserted } = await client.query(
              `INSERT INTO wallets (user_id, asset, chain, address, derivation_path, blob_id, status)
               VALUES ($1, $2, $3, $4, $5, $6, 'active') RETURNING id`,
              [userId, asset, chain, entry.address, derivationPath, currentBlobId]
            );
            walletId = inserted[0].id;
            created.push(asset);
          }
        }
        toWatch.push({ id: walletId, user_id: userId, asset, chain, address: entry.address });
      }

      // Spec P1 §4.3 - wallets tied to any other blob are archived.
      await client.query(
        `UPDATE wallets SET status = 'archived' WHERE user_id = $1 AND blob_id <> $2 AND status = 'active'`,
        [userId, currentBlobId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    for (const w of toWatch) subscribeWallet(w); // idempotent; archived addresses stay watched from startup
    for (const asset of created) await logWalletEvent({ userId, eventType: 'address_generated', asset });
    res.json({ status: 'ok' });
  }
);

// ---- GET /wallet/value ----
walletRouter.get('/wallet/value', requireSession, async (req, res) => {
  const asset = String(req.query.asset ?? '');
  const currency = String(req.query.currency ?? 'USD').toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(currency)) return res.status(400).json({ error: 'unsupported_currency' });

  const usdPrice = await getReferencePriceUsd(asset);
  const rates = await getUsdRates();
  if (usdPrice === null || !rates) return res.status(503).json({ error: 'rate_unavailable' });

  res.json({ asset, currency, price_per_unit: usdPrice * (rates[currency] ?? 1) });
});

// ---- GET /wallet/addresses ---- active and archived (P1 §6.3).
walletRouter.get('/wallet/addresses', requireSession, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, asset, chain, address, derivation_path, status, created_at
     FROM wallets WHERE user_id = $1
     ORDER BY (status = 'active') DESC, asset, created_at DESC`,
    [req.user!.id]
  );
  res.json({ wallets: rows });
});

// ---- GET /wallet/balance/:asset ---- on demand, cached 60s (P1 §5.1).
const assetParamSchema = z.enum(ALL_ASSETS as [string, ...string[]]);

walletRouter.get(
  '/wallet/balance/:asset',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 60, keyFn: (req) => `wallet_balance:${req.user!.id}` }),
  async (req, res) => {
    const parsedAsset = assetParamSchema.safeParse(req.params.asset);
    if (!parsedAsset.success) return res.status(400).json({ error: 'invalid_asset' });
    const asset = parsedAsset.data as keyof typeof ASSET_CONFIG;
    const userId = req.user!.id;
    const forceRefresh = req.query.refresh === 'true';

    if (!forceRefresh) {
      const cached = getCachedBalance(userId, asset);
      if (cached) return res.json({ ...cached, cached: true });
    }

    const { rows } = await pool.query(`SELECT address FROM wallets WHERE user_id = $1 AND asset = $2 AND status = 'active'`, [userId, asset]);
    const wallet = rows[0];
    if (!wallet) return res.status(404).json({ error: 'wallet_not_found' });

    let balance: { confirmed: string; unconfirmed: string };
    try {
      balance = await getAdapter(ASSET_CONFIG[asset].chain).getBalance(wallet.address, asset);
    } catch (err) {
      console.error(`balance fetch failed for ${asset}`, (err as Error).message);
      return res.status(502).json({ error: 'provider_unavailable' });
    }

    setCachedBalance(userId, asset, balance);
    await logWalletEvent({ userId, eventType: 'balance_queried', asset, metadata: { refresh: forceRefresh } });
    res.json({ ...balance, cached: false });
  }
);

// ---- GET /wallet/wallets/:walletId/balance ---- archived wallets stay readable (P1 §6.3).
walletRouter.get(
  '/wallet/wallets/:walletId/balance',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 60, keyFn: (req) => `wallet_balance_byid:${req.user!.id}` }),
  async (req, res) => {
    const userId = req.user!.id;
    const walletId = idParam(req, 'walletId');
    const forceRefresh = req.query.refresh === 'true';
    const cacheKey = `wallet:${walletId}`;

    const { rows } = await pool.query(`SELECT id, asset, chain, address, status FROM wallets WHERE id = $1 AND user_id = $2`, [walletId, userId]);
    const wallet = rows[0];
    if (!wallet) return res.status(404).json({ error: 'wallet_not_found' });

    if (!forceRefresh) {
      const cached = getCachedBalance(userId, cacheKey);
      if (cached) return res.json({ ...cached, cached: true, status: wallet.status });
    }

    let balance: { confirmed: string; unconfirmed: string };
    try {
      balance = await getAdapter(wallet.chain).getBalance(wallet.address, wallet.asset);
    } catch (err) {
      console.error(`balance fetch failed for wallet ${walletId}`, (err as Error).message);
      return res.status(502).json({ error: 'provider_unavailable' });
    }

    setCachedBalance(userId, cacheKey, balance);
    await logWalletEvent({ userId, eventType: 'balance_queried', asset: wallet.asset, metadata: { refresh: forceRefresh, wallet_id: walletId, status: wallet.status } });
    res.json({ ...balance, cached: false, status: wallet.status });
  }
);

// ---- GET /wallet/transactions ----
walletRouter.get('/wallet/transactions', requireSession, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.direction, t.txid, t.amount, t.fee, t.counterparty, t.confirmations,
            t.status, t.created_at, t.confirmed_at, w.asset, w.chain
     FROM transactions t JOIN wallets w ON w.id = t.wallet_id
     WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT 100`,
    [req.user!.id]
  );
  res.json({ transactions: rows });
});

// ---- POST /wallet/build-tx ---- P1 §7.1 step 3 (no step-up, P0 §8).
const buildTxSchema = z.object({
  asset: z.enum(ALL_ASSETS as [string, ...string[]]),
  to: z.string().min(1).max(100),
  amount: z.string().regex(/^\d+$/, 'must be an integer in base units'),
  fee_rate: z.string().regex(/^\d+$/).optional(),
});

walletRouter.post(
  '/wallet/build-tx',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyFn: (req) => `wallet_buildtx:${req.user!.id}` }),
  async (req, res) => {
    const parsed = buildTxSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const { asset: assetRaw, to, amount, fee_rate } = parsed.data;
    const asset = assetRaw as keyof typeof ASSET_CONFIG;
    const { chain } = ASSET_CONFIG[asset];
    const userId = req.user!.id;

    const destCheck = validateDestinationAddress(to, chain);
    if (!destCheck.ok) {
      await logWalletEvent({
        userId, eventType: 'address_validation_failed', asset,
        metadata: { rejected_address: to, target_chain: chain, detected_chain: destCheck.detectedChain },
      });
      return res.status(400).json({ error: 'invalid_destination', message: destCheck.error });
    }

    const gasCheck = await checkNativeGasAvailable(userId, asset);
    if (!gasCheck.ok) return res.status(400).json({ error: 'insufficient_native_gas', message: gasCheck.error });

    const { rows } = await pool.query(`SELECT address FROM wallets WHERE user_id = $1 AND asset = $2 AND status = 'active'`, [userId, asset]);
    const wallet = rows[0];
    if (!wallet) return res.status(409).json({ error: 'no_wallet_for_asset' });

    try {
      const unsignedTx = await getAdapter(chain).buildTransaction({
        asset: asset as any, fromAddress: wallet.address, toAddress: to, amount, feeRate: fee_rate,
      });
      await logWalletEvent({ userId, eventType: 'transaction_built', asset });
      res.json(unsignedTx);
    } catch (err: any) {
      if (err?.message === 'insufficient_funds') return res.status(400).json({ error: 'insufficient_funds' });
      console.error('build-tx failed', err?.message);
      res.status(502).json({ error: 'provider_unavailable' });
    }
  }
);

// "broadcast an unsigned or foreign-signed transaction
// via the API directly - refused." The server relayed any signed
// transaction. It now only broadcasts transactions that spend from the
// caller's own wallet for that asset.
function spendsOnlyFrom(chain: Chain, signedTx: string, ownAddress: string): boolean {
  try {
    if (chain === 'bitcoin' || chain === 'litecoin') {
      const tx = bitcoin.Transaction.fromHex(signedTx);
      if (tx.ins.length === 0) return false;
      const network = networkFor(chain);
      return tx.ins.every((input) => {
        const w = input.witness;
        const pubkey = w[1];
        if (w.length !== 2 || !pubkey || pubkey.length !== 33) return false;
        return bitcoin.payments.p2wpkh({ pubkey, network }).address === ownAddress;
      });
    }
    if (chain === 'ethereum') {
      const tx = EvmTransaction.from(signedTx);
      return !!tx.from && tx.from.toLowerCase() === ownAddress.toLowerCase();
    }
    if (chain === 'tron') {
      const tx = JSON.parse(signedTx);
      const owner = tx?.raw_data?.contract?.[0]?.parameter?.value?.owner_address;
      return typeof owner === 'string' && Array.isArray(tx.signature) && tx.signature.length > 0
        && TronWeb.address.fromHex(owner) === ownAddress;
    }
  } catch {
    return false;
  }
  return false;
}

const broadcastSchema = z.object({
  asset: z.enum(ALL_ASSETS as [string, ...string[]]),
  signed_tx: z.string().min(1).max(200_000),
  to: z.string().min(1).max(100),
  amount: z.string().regex(/^\d+$/),
  fee: z.string().regex(/^\d+$/).optional(),
});

walletRouter.post(
  '/wallet/broadcast',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyFn: (req) => `wallet_broadcast:${req.user!.id}` }),
  async (req, res) => {
    const parsed = broadcastSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const { asset: assetRaw, signed_tx, to, amount, fee } = parsed.data;
    const asset = assetRaw as keyof typeof ASSET_CONFIG;
    const { chain } = ASSET_CONFIG[asset];
    const userId = req.user!.id;

    const { rows } = await pool.query(`SELECT id, address FROM wallets WHERE user_id = $1 AND asset = $2 AND status = 'active'`, [userId, asset]);
    const wallet = rows[0];
    if (!wallet) return res.status(409).json({ error: 'no_wallet_for_asset' });

    if (!spendsOnlyFrom(chain, signed_tx, wallet.address)) {
      await logWalletEvent({ userId, eventType: 'address_validation_failed', asset, metadata: { reason: 'foreign_or_unsigned_transaction' } });
      return res.status(400).json({ error: 'not_your_transaction' });
    }

    let txid: string;
    try {
      txid = (await getAdapter(chain).broadcast(signed_tx)).txid;
    } catch (err) {
      console.error('broadcast failed', (err as Error).message);
      return res.status(502).json({ error: 'broadcast_failed' });
    }

    await pool.query(
      `INSERT INTO transactions (user_id, wallet_id, direction, txid, amount, fee, counterparty, status)
       VALUES ($1, $2, 'out', $3, $4, $5, $6, 'pending')
       ON CONFLICT (txid, wallet_id, direction) DO NOTHING`,
      [userId, wallet.id, txid, amount, fee ?? null, to]
    );
    await logWalletEvent({ userId, eventType: 'transaction_broadcast', asset, metadata: { txid } });
    res.json({ txid });
  }
);

// ---- POST /wallet/export ---- P1 §8: rate limit + log only; no key material.
const exportSchema = z.object({ asset: z.enum(ALL_ASSETS as [string, ...string[]]) });

walletRouter.post(
  '/wallet/export',
  requireSession,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyFn: (req) => `wallet_export:${req.user!.id}` }),
  async (req, res) => {
    const parsed = exportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
    await logWalletEvent({ userId: req.user!.id, eventType: 'export_requested', asset: parsed.data.asset });
    res.json({ status: 'ok' });
  }
);
