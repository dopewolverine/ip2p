// P1 spec §3.1 - the one interface every chain family implements. Nothing
// outside src/chain/ may call a provider (NOWNodes, TronGrid, Blockstream)
// directly - that's the entire point of this layer (§3: "Build this first").

export type Chain = 'bitcoin' | 'litecoin' | 'ethereum' | 'tron';
export type Asset = 'BTC' | 'LTC' | 'ETH' | 'USDT_ERC20' | 'USDC_ERC20' | 'USDT_TRC20';

// Base-unit amounts (satoshis / wei / sun) as strings, never numbers or
// floats - spec §7.2B. Internal math uses bigint; strings are just the
// JSON-safe wire format.
export interface Balance {
  confirmed: string;
  unconfirmed: string;
}

export interface Utxo {
  txid: string;
  vout: number;
  value: string; // satoshis
  confirmations: number;
  scriptPubKeyHex: string;
}

export interface ChainTx {
  txid: string;
  direction: 'in' | 'out';
  amount: string;
  confirmations: number;
  timestamp: number; // unix seconds
}

export interface FeeEstimate {
  slow: string;
  normal: string;
  fast: string;
  unit: 'sat_per_vb' | 'wei_per_gas' | 'sun';
}

export interface UnsignedTx {
  format: 'psbt_base64' | 'evm_tx' | 'tron_tx';
  data: unknown;
}

export interface Subscription {
  unsubscribe(): void;
}

export interface BuildTxParams {
  asset: Asset;
  fromAddress: string;
  toAddress: string;
  amount: string;   // base units
  feeRate?: string; // sat/vB (BTC/LTC) or gas price in wei (EVM) — Tron ignores this
}

export interface SubscribeOptions {
  // ETH, USDT-ERC20 and USDC-ERC20 share one address. Without a
  // filter, a USDT deposit was recorded against all three wallets.
  asset?: Asset;
}

export interface ChainAdapter {
  readonly chain: Chain;
  getBalance(address: string, asset: Asset): Promise<Balance>;
  getUtxos?(address: string): Promise<Utxo[]>; // BTC/LTC only
  getTransactions(address: string, limit: number, cursor?: string): Promise<{ txs: ChainTx[]; nextCursor?: string }>;
  estimateFee(asset: Asset, priority: 'slow' | 'normal' | 'fast'): Promise<FeeEstimate>;
  buildTransaction(params: BuildTxParams): Promise<UnsignedTx>;
  broadcast(signedTxHex: string): Promise<{ txid: string }>;
  getConfirmations(txid: string): Promise<number>;
  subscribeAddress(address: string, callback: (tx: ChainTx) => void, opts?: SubscribeOptions): Subscription;
}
