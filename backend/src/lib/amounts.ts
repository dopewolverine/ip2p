// "Grep for float and double in all
// amount handling. None." Decimal strings are converted to scaled
// integers here; all amount arithmetic after this point is BigInt.
export function decimalToScaled(value: string | number, scale: number): bigint {
  const str = typeof value === 'number' ? value.toFixed(scale) : String(value).trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(str);
  if (!m) throw new Error('invalid_decimal');
  const frac = (m[2] ?? '').padEnd(scale, '0').slice(0, scale); // truncates beyond `scale`
  return BigInt(`${m[1]}${frac}`);
}
