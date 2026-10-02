import { pool } from '../db/pool';
import { getAdapter } from '../chain';
import { TronAdapter } from '../chain/tronAdapter';
import { ASSET_CONFIG } from './walletAssets';
import type { Asset } from '../chain/types';

// Spec P1 §7.4 - token withdrawals need the chain's native asset for gas/
// bandwidth. Checked server-side too, not just in the UI - the spec's
// "check before the user fills in the form" is a frontend UX rule, but
// this is the backend backstop for whenever that frontend check didn't
// run or was bypassed.
const NATIVE_ASSET_FOR: Partial<Record<Asset, Asset>> = {
  USDT_ERC20: 'ETH',
  USDC_ERC20: 'ETH',
};

export async function checkNativeGasAvailable(
  userId: string,
  asset: Asset
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Tron: the real requirement is TRX/bandwidth, a separate model from
  // the ERC20/ETH case below - TronAdapter exposes a dedicated
  // getTrxBalance() for exactly this (TRX isn't one of the six
  // tradeable assets, so it has no place in the generic getBalance call).
  if (asset === 'USDT_TRC20') {
    const { rows } = await pool.query(
      `SELECT address FROM wallets WHERE user_id = $1 AND asset = 'USDT_TRC20' AND status = 'active'`,
      [userId]
    );
    if (!rows[0]) return { ok: true }; // no wallet yet — build-tx fails on that separately
    const adapter = getAdapter('tron') as TronAdapter;
    const trx = await adapter.getTrxBalance(rows[0].address);
    if (BigInt(trx.confirmed) <= 0n) {
      return { ok: false, error: 'You need TRX in this wallet (for bandwidth) to send USDT. Current TRX balance: 0.' };
    }
    return { ok: true };
  }

  const nativeAsset = NATIVE_ASSET_FOR[asset];
  if (!nativeAsset) return { ok: true }; // native asset itself — nothing to check

  const { rows } = await pool.query(
    `SELECT address FROM wallets WHERE user_id = $1 AND asset = $2 AND status = 'active'`,
    [userId, nativeAsset]
  );
  const wallet = rows[0];
  if (!wallet) return { ok: false, error: `No ${nativeAsset} wallet found.` };

  const { chain } = ASSET_CONFIG[nativeAsset];
  const balance = await getAdapter(chain).getBalance(wallet.address, nativeAsset);

  if (BigInt(balance.confirmed) <= 0n) {
    return {
      ok: false,
      error: `You need ${nativeAsset} in this wallet to send ${asset}. Current ${nativeAsset} balance: 0.`,
    };
  }

  return { ok: true };
}
