import { getReferencePriceUsd } from './priceFeed';
import { getUsdRates } from '../lib/fiatRates';

export async function resolveOfferPrice(offer: {
  price_type: string; price: string | null; margin_percent: string | null;
  asset_symbol: string; currency_code: string;
}): Promise<number | null> {
  if (offer.price_type === 'fixed') {
    const price = Number(offer.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  }
  const reference = await getReferencePriceUsd(offer.asset_symbol);
  if (reference === null || !Number.isFinite(reference) || reference <= 0) return null;
  const currency = offer.currency_code.toUpperCase();
  const fx = currency === 'USD' ? 1 : (await getUsdRates())?.[currency];
  if (!fx || !Number.isFinite(fx) || fx <= 0) return null;
  const margin = Number(offer.margin_percent ?? '0');
  const price = reference * fx * (1 + margin / 100);
  return Number.isFinite(price) && price > 0 ? price : null;
}
