import { ethers } from 'ethers';
import { chainConfig } from './config';
import type {
  Asset, Balance, BuildTxParams, Chain, ChainAdapter, ChainTx, FeeEstimate,
  Subscription, UnsignedTx, SubscribeOptions,
} from './types';

// P1 §1 - ERC20 tokens share the Ethereum address; they're balances inside
// a token contract, not separate wallets. Mainnet contract addresses.
const ERC20_CONTRACTS: Partial<Record<Asset, { address: string; decimals: number }>> = {
  USDT_ERC20: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  USDC_ERC20: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
};

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

/**
 * Serves ETH, USDT (ERC20), USDC (ERC20) - one Ethereum address, three
 * assets. Balance/broadcast/tx-building go through NOWNodes' JSON-RPC via
 * ethers; transaction history uses NOWNodes' Ethereum Blockbook-style
 * explorer, following the same pattern as the Bitcoin/Litecoin adapter.
 *
 * Live provider validation remains required before enabling withdrawals.
 */
export class EvmAdapter implements ChainAdapter {
  readonly chain: Chain = 'ethereum';
  private readonly provider: ethers.JsonRpcProvider;
  private readonly explorerUrl = process.env.NOWNODES_ETH_BLOCKBOOK_URL ?? 'https://eth-blockbook.nownodes.io';
  private readonly apiKey = chainConfig.nowNodes.apiKey;

  constructor() {
    // FetchRequest lets us attach the NOWNodes api-key header to every RPC call.
    const fetchReq = new ethers.FetchRequest(chainConfig.nowNodes.ethereumRpcUrl);
    fetchReq.setHeader('api-key', this.apiKey);
    this.provider = new ethers.JsonRpcProvider(fetchReq);
  }

  private erc20(asset: Asset): ethers.Contract | null {
    const cfg = ERC20_CONTRACTS[asset];
    if (!cfg) return null;
    return new ethers.Contract(cfg.address, ERC20_ABI, this.provider);
  }

  async getBalance(address: string, asset: Asset): Promise<Balance> {
    if (asset === 'ETH') {
      const wei = await this.provider.getBalance(address);
      // Native ETH has no separate "unconfirmed" concept at the RPC layer -
      // getBalance always reads the latest confirmed state.
      return { confirmed: wei.toString(), unconfirmed: '0' };
    }

    const token = this.erc20(asset);
    if (!token) throw new Error(`unsupported asset for EVM adapter: ${asset}`);
    const raw: bigint = await token.getFunction('balanceOf')(address);
    return { confirmed: raw.toString(), unconfirmed: '0' };
  }

  async getTransactions(address: string, limit: number, cursor?: string) {
    const page = cursor ?? '1';
    const res = await fetch(
      `${this.explorerUrl}/api/v2/address/${address}?page=${page}&pageSize=${limit}&details=txs`,
      { headers: { 'api-key': this.apiKey } }
    );
    if (!res.ok) throw new Error(`explorer ${res.status}`);
    const data = (await res.json()) as {
      transactions?: Array<{ txid: string; confirmations: number; blockTime: number; vin: any[] }>;
      page: number; totalPages: number;
    };

    const txs: ChainTx[] = (data.transactions ?? []).map((t) => ({
      txid: t.txid,
      direction: t.vin?.some((v: any) => v.addresses?.includes(address)) ? 'out' : 'in',
      amount: '0', // needs a real value-transfer calculation once response shapes are confirmed
      confirmations: t.confirmations,
      timestamp: t.blockTime,
    }));

    return { txs, nextCursor: data.page < data.totalPages ? String(data.page + 1) : undefined };
  }

  async estimateFee(_asset: Asset, priority: 'slow' | 'normal' | 'fast'): Promise<FeeEstimate> {
    const feeData = await this.provider.getFeeData();
    const base = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
    const multiplier = priority === 'fast' ? 100n : priority === 'normal' ? 85n : 70n;
    const val = ((base * multiplier) / 100n).toString();
    return { slow: val, normal: val, fast: val, unit: 'wei_per_gas' };
  }

  async buildTransaction(params: BuildTxParams): Promise<UnsignedTx> {
    const nonce = await this.provider.getTransactionCount(params.fromAddress, 'pending');
    const feeData = await this.provider.getFeeData();
    const { chainId } = await this.provider.getNetwork();

    const maxFeePerGas = params.feeRate ? BigInt(params.feeRate) : (feeData.maxFeePerGas ?? 0n);
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;

    let tx: ethers.TransactionRequest;

    if (params.asset === 'ETH') {
      tx = {
        to: params.toAddress,
        value: BigInt(params.amount),
        chainId,
        nonce,
        maxFeePerGas,
        maxPriorityFeePerGas,
        type: 2,
      };
    } else {
      const cfg = ERC20_CONTRACTS[params.asset];
      if (!cfg) throw new Error(`unsupported asset: ${params.asset}`);
      const iface = new ethers.Interface(ERC20_ABI);
      const data = iface.encodeFunctionData('transfer', [params.toAddress, BigInt(params.amount)]);
      tx = {
        to: cfg.address,
        value: 0n,
        data,
        chainId,
        nonce,
        maxFeePerGas,
        maxPriorityFeePerGas,
        type: 2,
      };
    }

    const gasLimit = await this.provider.estimateGas({ ...tx, from: params.fromAddress });
    tx.gasLimit = (gasLimit * 120n) / 100n; // 20% headroom

    // JSON.stringify throws on bigint - res.json() in the route handler
    // would crash on this object as-is. Every bigint field becomes a
    // string here; the frontend converts them back to bigint before
    // handing the object to ethers for signing.
    const serializable = {
      ...tx,
      value: tx.value?.toString(),
      chainId: tx.chainId?.toString(),
      nonce: tx.nonce,
      maxFeePerGas: tx.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString(),
      gasLimit: tx.gasLimit?.toString(),
    };

    return { format: 'evm_tx', data: serializable };
  }

  async broadcast(signedTxHex: string): Promise<{ txid: string }> {
    const res = await this.provider.broadcastTransaction(signedTxHex);
    return { txid: res.hash };
  }

  async getConfirmations(txid: string): Promise<number> {
    const receipt = await this.provider.getTransactionReceipt(txid);
    if (!receipt || receipt.blockNumber == null) return 0;
    const current = await this.provider.getBlockNumber();
    return Math.max(0, current - receipt.blockNumber + 1);
  }

  subscribeAddress(address: string, callback: (tx: ChainTx) => void, opts?: SubscribeOptions): Subscription {
    // Native ETH: ethers' provider.on(address, ...) fires for any mined
    // transaction touching this address at the top level.
    const nativeListener = (tx: ethers.TransactionResponse) => {
      callback({
        txid: tx.hash,
        direction: tx.to?.toLowerCase() === address.toLowerCase() ? 'in' : 'out',
        amount: tx.value.toString(),
        confirmations: 1,
        timestamp: Math.floor(Date.now() / 1000),
      });
    };
    // Guarded: this ethers version/provider combo throws on a bare-address
    // subscription in some setups. Native-ETH push monitoring degrades to
    // "off" rather than crashing - ERC20 monitoring below still works.
    if (!opts?.asset || opts.asset === 'ETH') try {
      this.provider.on(address, nativeListener);
    } catch (err) {
      console.error(`native ETH address subscription failed for ${address}, continuing without it`, err);
    }

    // ERC20: native tx-level subscription doesn't see token transfers -
    // those only appear as event logs, so each supported token gets its
    // own Transfer filter for this address as recipient.
    const tokenListeners: Array<() => void> = [];
    for (const asset of Object.keys(ERC20_CONTRACTS) as Asset[]) {
      if (opts?.asset && opts.asset !== asset) continue;
      const contract = this.erc20(asset)!;
      const filter = contract.filters['Transfer']!(null, address);
      const listener = (from: string, to: string, value: bigint, event: ethers.EventLog) => {
        callback({
          txid: event.transactionHash,
          direction: 'in',
          amount: value.toString(),
          confirmations: 1,
          timestamp: Math.floor(Date.now() / 1000),
        });
      };
      contract.on(filter, listener);
      tokenListeners.push(() => contract.off(filter, listener));
    }

    return {
      unsubscribe: () => {
        this.provider.off(address, nativeListener);
        tokenListeners.forEach((off) => off());
      },
    };
  }
}
