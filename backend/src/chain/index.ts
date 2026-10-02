import { BitcoinAdapter } from './bitcoinAdapter';
import { EvmAdapter } from './evmAdapter';
import { TronAdapter } from './tronAdapter';
import type { Chain, ChainAdapter } from './types';

export * from './types';
export { BitcoinAdapter } from './bitcoinAdapter';
export { EvmAdapter } from './evmAdapter';
export { TronAdapter } from './tronAdapter';
export { networkFor, assertAddressPrefix } from './networks';

const adapters = new Map<Chain, ChainAdapter>();

// Single shared instance per chain - adapters are stateless aside from
// held WebSocket subscriptions, so there's no reason to construct more than one.
export function getAdapter(chain: Chain): ChainAdapter {
  const cached = adapters.get(chain);
  if (cached) return cached;

  let adapter: ChainAdapter;
  switch (chain) {
    case 'bitcoin':
    case 'litecoin':
      adapter = new BitcoinAdapter(chain);
      break;
    case 'ethereum':
      adapter = new EvmAdapter();
      break;
    case 'tron':
      adapter = new TronAdapter();
      break;
    default:
      throw new Error(`Unknown chain: ${chain}`);
  }

  adapters.set(chain, adapter);
  return adapter;
}
