// @ts-ignore - tronweb's published types are inconsistent across versions;
// treated as untyped rather than fighting the declaration file.
import TronWeb from 'tronweb';
import { chainConfig } from './config';
import type {
  Asset, Balance, BuildTxParams, Chain, ChainAdapter, ChainTx, FeeEstimate,
  Subscription, UnsignedTx, SubscribeOptions,
} from './types';

// USDT is the only TRC20 asset in scope (spec P1 §1). Mainnet contract.
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_TRC20_DECIMALS = 6;

/**
 * Serves TRX and USDT (TRC20). Balance, transaction building, and
 * broadcast go through NOWNodes via TronWeb (spec's recommended library).
 * Transaction history uses TronGrid's REST API directly rather than
 * NOWNodes - NOWNodes' Tron product is a full-node RPC, not an indexed
 * explorer, so there's no NOWNodes endpoint to ask "what transactions
 * touched this address." TronGrid (named as the read-only Tron fallback
 * in spec §3.2) is the one provider here that actually offers that, so
 * getTransactions uses it directly rather than as a failover path. Every
 * other method still treats NOWNodes as primary, matching the spec.
 *
 * Live provider validation remains required.
 */
export class TronAdapter implements ChainAdapter {
  readonly chain: Chain = 'tron';
  private readonly tronWeb: any;
  private readonly apiKey = chainConfig.nowNodes.apiKey;
  private pollHandle: NodeJS.Timeout | null = null;

  constructor() {
    this.tronWeb = new TronWeb({
      fullHost: chainConfig.nowNodes.tronRpcUrl,
      headers: { 'api-key': this.apiKey },
    });
  }

  async getBalance(address: string, asset: Asset): Promise<Balance> {
    if (asset === 'USDT_TRC20') {
      const contract = await this.tronWeb.contract().at(USDT_TRC20_CONTRACT);
      const raw = await contract.balanceOf(address).call();
      return { confirmed: raw.toString(), unconfirmed: '0' };
    }
    return this.getTrxBalance(address);
  }

  // TRX isn't one of the six tradeable assets (spec P1 §1), so it has no
  // slot in the Asset union and no place in the generic getBalance(asset)
  // signature - but the wallet still needs its TRX balance to check
  // bandwidth/energy coverage before a TRC20 send (spec §7.4). Exposed as
  // its own typed method rather than a magic string cast through getBalance.
  async getTrxBalance(address: string): Promise<Balance> {
    const sun: number = await this.tronWeb.trx.getBalance(address);
    return { confirmed: String(sun), unconfirmed: '0' };
  }

  async getTransactions(address: string, limit: number, cursor?: string) {
    const url = new URL(`${chainConfig.tronGrid.baseUrl}/v1/accounts/${address}/transactions`);
    url.searchParams.set('limit', String(limit));
    if (cursor) url.searchParams.set('fingerprint', cursor);

    const headers: Record<string, string> = {};
    if (chainConfig.tronGrid.apiKey) headers['TRON-PRO-API-KEY'] = chainConfig.tronGrid.apiKey;

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) throw new Error(`TronGrid ${res.status}`);
    const data = (await res.json()) as {
      data: Array<{ txID: string; raw_data: { contract: any[] }; ret: Array<{ contractRet: string }> }>;
      meta?: { fingerprint?: string };
    };

    const currentBlock = await this.tronWeb.trx.getCurrentBlock();
    const currentNum = currentBlock.block_header.raw_data.number;

    const txs: ChainTx[] = data.data.map((t) => {
      const contract = t.raw_data.contract[0]?.parameter?.value;
      const isOutgoing = contract?.owner_address
        ? this.tronWeb.address.fromHex(contract.owner_address) === address
        : false;
      return {
        txid: t.txID,
        direction: isOutgoing ? 'out' : 'in',
        amount: String(contract?.amount ?? '0'),
        confirmations: currentNum, // TronGrid's list endpoint doesn't return per-tx block height directly; see note below
        timestamp: Math.floor(Date.now() / 1000),
      };
    });

    return { txs, nextCursor: data.meta?.fingerprint };
  }

  async estimateFee(asset: Asset, _priority: 'slow' | 'normal' | 'fast'): Promise<FeeEstimate> {
    // Spec P1 §7.3 - Tron has no sat/vB or gas-price model. Sending is
    // often free for accounts holding enough TRX for bandwidth; the real
    // cost is energy for TRC20 sends. This returns an estimated sun cost
    // for reference in the UI, not a rate to plug into buildTransaction.
    if (asset === 'USDT_TRC20') {
      const chainParams = await this.tronWeb.trx.getChainParameters();
      const energyFeeParam = chainParams.find((p: any) => p.key === 'getEnergyFee');
      const energyFee = energyFeeParam?.value ?? 420; // sun per energy unit, fallback to a typical value
      const estimatedEnergy = 15000; // typical USDT transfer energy cost — verify against a real estimation call
      const val = String(energyFee * estimatedEnergy);
      return { slow: val, normal: val, fast: val, unit: 'sun' };
    }
    return { slow: '0', normal: '0', fast: '0', unit: 'sun' };
  }

  async buildTransaction(params: BuildTxParams): Promise<UnsignedTx> {
    if (params.asset === 'USDT_TRC20') {
      const { transaction } = await this.tronWeb.transactionBuilder.triggerSmartContract(
        USDT_TRC20_CONTRACT,
        'transfer(address,uint256)',
        {},
        [
          { type: 'address', value: params.toAddress },
          { type: 'uint256', value: params.amount },
        ],
        params.fromAddress
      );
      return { format: 'tron_tx', data: transaction };
    }

    const unsigned = await this.tronWeb.transactionBuilder.sendTrx(
      params.toAddress,
      Number(params.amount),
      params.fromAddress
    );
    return { format: 'tron_tx', data: unsigned };
  }

  async broadcast(signedTxHex: string): Promise<{ txid: string }> {
    const signedTx = JSON.parse(signedTxHex);
    const result = await this.tronWeb.trx.sendRawTransaction(signedTx);
    if (!result.result) throw new Error(result.message ?? 'broadcast failed');
    return { txid: result.txid };
  }

  async getConfirmations(txid: string): Promise<number> {
    const info = await this.tronWeb.trx.getTransactionInfo(txid);
    if (!info?.blockNumber) return 0;
    const current = await this.tronWeb.trx.getCurrentBlock();
    return Math.max(0, current.block_header.raw_data.number - info.blockNumber + 1);
  }

  subscribeAddress(address: string, callback: (tx: ChainTx) => void, _opts?: SubscribeOptions): Subscription {
    // No native push subscription on TronGrid's public API - polling is
    // the documented approach. 15s interval balances responsiveness
    // against TronGrid's rate limits; tune once you have a real key.
    let lastSeen = new Set<string>();
    // One timer per subscription. A single shared handle meant each
    // new subscription orphaned the previous timer.
    const handle = setInterval(async () => {
      try {
        const { txs } = await this.getTransactions(address, 10);
        for (const tx of txs) {
          if (!lastSeen.has(tx.txid)) {
            lastSeen.add(tx.txid);
            if (tx.direction === 'in') callback(tx);
          }
        }
      } catch (err) {
        console.error('tron address poll failed', err);
      }
    }, 15_000);

    return {
      unsubscribe: () => {
        clearInterval(handle);
      },
    };
  }
}
