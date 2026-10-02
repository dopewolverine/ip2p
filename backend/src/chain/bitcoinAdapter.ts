import * as bitcoin from 'bitcoinjs-lib';
import WebSocket from 'ws';
import { chainConfig } from './config';
import { networkFor, assertAddressPrefix, UtxoChain } from './networks';
import type {
  Asset, Balance, BuildTxParams, ChainAdapter, ChainTx, FeeEstimate,
  Subscription, UnsignedTx, Utxo,
} from './types';

interface BlockbookTx {
  txid: string;
  confirmations?: number;
  blockTime?: number;
  vin?: Array<{ addresses?: string[]; value?: string }>;
  vout?: Array<{ addresses?: string[]; value?: string }>;
}

export class ProviderError extends Error {
  constructor(message: string, public status: number | null) { super(message); }
}

// Net effect of one transaction on one address, from Blockbook's vin/vout.
// Deposit records and escrow funding checks depend on these amounts.
export function netForAddress(tx: BlockbookTx, address: string): { direction: 'in' | 'out'; amount: string } {
  let received = 0n;
  let sent = 0n;
  for (const o of tx.vout ?? []) if (o.addresses?.includes(address)) received += BigInt(o.value ?? '0');
  for (const i of tx.vin ?? []) if (i.addresses?.includes(address)) sent += BigInt(i.value ?? '0');
  if (sent > 0n) {
    const net = sent - received;
    return { direction: 'out', amount: (net > 0n ? net : 0n).toString() };
  }
  return { direction: 'in', amount: received.toString() };
}

/**
 * Serves both BTC and LTC - same Blockbook API on both, differing only in
 * base URL and network params (spec §7.2A).
 *
 * VERIFY ON TESTNET: the REST paths follow the public Blockbook API. The
 * websocket URL format is NOWNodes' (`wss://<host>/wss/<api-key>`) and can
 * be overridden with NOWNODES_BTC_WS_URL / NOWNODES_LTC_WS_URL.
 */
export class BitcoinAdapter implements ChainAdapter {
  readonly chain: UtxoChain;
  private readonly network: bitcoin.Network;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fallbackUrl?: string;
  private readonly wsUrl: string;

  // One websocket per chain, carrying every watched
  // address. Blockbook notifications arrive keyed by the subscription's
  // request id (never by method name), so the old handler matched nothing;
  // there was also no API key on the socket, no keepalive and no reconnect.
  private ws: WebSocket | null = null;
  private readonly listeners = new Map<string, Set<(tx: ChainTx) => void>>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private backoffMs = 1000;
  private errorStreak = 0;

  constructor(chain: UtxoChain) {
    this.chain = chain;
    this.network = networkFor(chain);
    this.apiKey = chainConfig.nowNodes.apiKey;
    this.baseUrl = chain === 'bitcoin'
      ? chainConfig.nowNodes.bitcoinBlockbookUrl
      : chainConfig.nowNodes.litecoinBlockbookUrl;
    const wsOverride = chain === 'bitcoin' ? process.env.NOWNODES_BTC_WS_URL : process.env.NOWNODES_LTC_WS_URL;
    this.wsUrl = wsOverride ?? `${this.baseUrl.replace(/^http/, 'ws')}/wss/${this.apiKey}`;
    // Reserved for a separately validated Esplora adapter; automatic fallback is disabled.
    this.fallbackUrl = chain === 'bitcoin' ? chainConfig.blockstreamFallbackUrl : undefined;
  }

  private async request<T>(path: string, opts: { useFallback?: boolean } = {}): Promise<T> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { headers: { 'api-key': this.apiKey }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new ProviderError(`NOWNodes ${res.status} on ${path}`, res.status);
      return (await res.json()) as T;
    } catch (err) {
      if (!opts.useFallback || !this.fallbackUrl) throw err;
      // Blockstream speaks Esplora; never send Blockbook paths to it.
      throw err;

    }
  }

  async getBalance(address: string, _asset: Asset): Promise<Balance> {
    assertAddressPrefix(address, this.chain);
    const data = await this.request<{ balance: string; unconfirmedBalance: string }>(
      `/api/v2/address/${address}`,
      { useFallback: true }
    );
    return { confirmed: data.balance, unconfirmed: data.unconfirmedBalance };
  }

  async getUtxos(address: string): Promise<Utxo[]> {
    assertAddressPrefix(address, this.chain);
    const raw = await this.request<Array<{ txid: string; vout: number; value: string; confirmations: number }>>(
      `/api/v2/utxo/${address}`,
      { useFallback: true }
    );
    const scriptPubKeyHex = bitcoin.address.toOutputScript(address, this.network).toString('hex');
    return raw.map((u) => ({
      txid: u.txid, vout: u.vout, value: String(u.value), confirmations: u.confirmations ?? 0, scriptPubKeyHex,
    }));
  }

  async getTransactions(address: string, limit: number, cursor?: string) {
    assertAddressPrefix(address, this.chain);
    const page = cursor ?? '1';
    const data = await this.request<{ transactions?: BlockbookTx[]; page: number; totalPages: number }>(
      `/api/v2/address/${address}?page=${page}&pageSize=${limit}&details=txs`,
      { useFallback: true }
    );

    const txs: ChainTx[] = (data.transactions ?? []).map((t) => {
      const { direction, amount } = netForAddress(t, address);
      return { txid: t.txid, direction, amount, confirmations: t.confirmations ?? 0, timestamp: t.blockTime ?? 0 };
    });

    return { txs, nextCursor: data.page < data.totalPages ? String(data.page + 1) : undefined };
  }

  async estimateFee(_asset: Asset, priority: 'slow' | 'normal' | 'fast'): Promise<FeeEstimate> {
    const blocks = priority === 'fast' ? 1 : priority === 'normal' ? 3 : 6;
    const data = await this.request<{ result: string }>(`/api/v2/estimatefee/${blocks}`, { useFallback: true });
    // Blockbook returns coin per kB; convert to integer sat/vB. VERIFY ON
    // TESTNET - some deployments return sat/kB instead.
    const coinPerKb = parseFloat(data.result);
    const satPerVb = Number.isFinite(coinPerKb) && coinPerKb > 0 ? Math.max(1, Math.round((coinPerKb * 1e8) / 1000)) : 1;
    const val = String(satPerVb);
    return { slow: val, normal: val, fast: val, unit: 'sat_per_vb' };
  }

  async buildTransaction(params: BuildTxParams): Promise<UnsignedTx> {
    assertAddressPrefix(params.fromAddress, this.chain);
    assertAddressPrefix(params.toAddress, this.chain);

    const amount = BigInt(params.amount);
    if (amount <= 0n) throw new Error('invalid_amount');
    let feeRate = BigInt(params.feeRate ?? (await this.estimateFee(params.asset, 'normal')).normal);
    if (feeRate < 1n) feeRate = 1n;
    const utxos = await this.getUtxos(params.fromAddress);

    const P2WPKH_INPUT_VBYTES = 68n;
    const OUTPUT_VBYTES = 43n; // upper bound (P2WSH/P2TR destination)
    const OVERHEAD_VBYTES = 11n;

    const selected: Utxo[] = [];
    let total = 0n;
    let fee = 0n;

    for (const utxo of utxos) {
      selected.push(utxo);
      total += BigInt(utxo.value);
      const vbytes = OVERHEAD_VBYTES + BigInt(selected.length) * P2WPKH_INPUT_VBYTES + 2n * OUTPUT_VBYTES;
      fee = vbytes * feeRate;
      if (total >= amount + fee) break;
    }

    if (total < amount + fee) throw new Error('insufficient_funds');

    const change = total - amount - fee;
    const DUST_THRESHOLD = this.chain === 'bitcoin' ? 546n : 5460n;

    const psbt = new bitcoin.Psbt({ network: this.network });
    for (const utxo of selected) {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: { script: Buffer.from(utxo.scriptPubKeyHex, 'hex'), value: Number(utxo.value) },
      });
    }
    psbt.addOutput({ address: params.toAddress, value: Number(amount) });
    if (change > DUST_THRESHOLD) psbt.addOutput({ address: params.fromAddress, value: Number(change) });

    return { format: 'psbt_base64', data: psbt.toBase64() };
  }

  async broadcast(signedTxHex: string): Promise<{ txid: string }> {
    // Never fails over - a broadcast succeeding "somewhere" silently is
    // worse than a clear error (spec §3.2).
    const res = await fetch(`${this.baseUrl}/api/v2/sendtx/${signedTxHex}`, { headers: { 'api-key': this.apiKey }, signal: AbortSignal.timeout(10000) });
    const data = (await res.json().catch(() => ({}))) as { result?: string; error?: string | { message?: string } };
    if (!res.ok || data.error || !data.result) {
      const msg = typeof data.error === 'string' ? data.error : data.error?.message;
      throw new ProviderError(msg ?? `broadcast failed: ${res.status}`, res.status);
    }
    return { txid: data.result };
  }

  async getConfirmations(txid: string): Promise<number> {
    const data = await this.request<{ confirmations: number }>(`/api/v2/tx/${txid}`, { useFallback: true });
    return data.confirmations ?? 0;
  }

  // P2 §4A.3 - the FULL previous transaction for nonWitnessUtxo.
  async getRawTransactionHex(txid: string): Promise<string> {
    const data = await this.request<{ hex?: string }>(`/api/v2/tx-specific/${txid}`);
    if (!data.hex) throw new Error(`no raw hex returned for ${txid}`);
    return data.hex;
  }

  subscribeAddress(address: string, callback: (tx: ChainTx) => void): Subscription {
    assertAddressPrefix(address, this.chain);
    let set = this.listeners.get(address);
    if (!set) {
      set = new Set();
      this.listeners.set(address, set);
    }
    set.add(callback);
    if (this.ws) this.sendSubscription();
    else this.connect();

    return {
      unsubscribe: () => {
        const s = this.listeners.get(address);
        s?.delete(callback);
        if (s && s.size === 0) this.listeners.delete(address);
        this.sendSubscription();
      },
    };
  }

  private connect(): void {
    if (this.ws || this.listeners.size === 0) return;
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;
    ws.on('open', () => {
      this.backoffMs = 1000;
      this.errorStreak = 0;
      this.sendSubscription();
      this.pingTimer = setInterval(() => {
        try { ws.send(JSON.stringify({ id: 'ping', method: 'ping', params: {} })); } catch { /* reconnect handles it */ }
      }, 30_000);
      this.pingTimer.unref?.();
    });
    ws.on('message', (raw) => this.onMessage(raw.toString()));
    ws.on('error', (err) => {
      if (this.errorStreak++ === 0) console.error(`[${this.chain}] blockbook websocket error: ${(err as Error).message}`);
    });
    ws.on('close', () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.ws = null;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.listeners.size === 0) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private sendSubscription(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // Blockbook replaces the connection's address set on every call, so
    // the full list is always sent.
    this.ws.send(JSON.stringify({
      id: 'subscribe', method: 'subscribeAddresses', params: { addresses: [...this.listeners.keys()] },
    }));
  }

  private onMessage(text: string): void {
    let msg: any;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg?.id !== 'subscribe') return;
    const address = msg?.data?.address;
    const tx = msg?.data?.tx as BlockbookTx | undefined;
    if (typeof address !== 'string' || !tx?.txid) return;
    const subs = this.listeners.get(address);
    if (!subs) return;
    const { direction, amount } = netForAddress(tx, address);
    for (const cb of subs) {
      try {
        cb({ txid: tx.txid, direction, amount, confirmations: tx.confirmations ?? 0, timestamp: tx.blockTime ?? Math.floor(Date.now() / 1000) });
      } catch (err) {
        console.error('address subscription callback failed', err);
      }
    }
  }
}
