// Spec P1 §7.2B - all on-chain arithmetic uses integers in the chain's
// base unit; conversion to/from a human decimal string happens only here,
// at the presentation layer, using string/BigInt math (never parseFloat).
export const ASSET_DECIMALS: Record<string, number> = {
  BTC: 8,
  LTC: 8,
  ETH: 18,
  USDT_ERC20: 6,
  USDC_ERC20: 6,
  USDT_TRC20: 6,
};

export function toBaseUnits(amount: string, decimals: number): string {
  const trimmed = amount.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    throw new Error('invalid_amount');
  }
  const [whole = '0', frac = ''] = trimmed.split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, '');
  return combined === '' ? '0' : combined;
}

export function fromBaseUnits(baseUnits: string, decimals: number): string {
  const padded = baseUnits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals) || '0';
  const frac = padded.slice(-decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}
