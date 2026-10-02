import { api } from './client';

export interface OfferListItem {
  id: string;
  side: 'buy' | 'sell';
  price_type: 'fixed' | 'margin';
  price: string | null;
  margin_percent: string | null;
  current_price: number | null;
  min_amount: string;
  max_amount: string;
  payment_window_hours: number;
  terms: string | null;
  vendor_id: string;
  vendor_reputation?: VendorReputation;
  asset_symbol: string;
  asset_slug: string;
  country_slug: string;
  currency_code: string;
  decimal_places: number;
  payment_method_name: string;
  payment_method_slug: string;
}

export function browseOffers(filters: {
  side?: string; asset?: string; country?: string; currency?: string;
  payment_method?: string; amount?: string; sort?: string;
}) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
  return api.get<{ offers: OfferListItem[] }>(`/offers?${params.toString()}`);
}

export function requestTrade(offerId: string, fiatAmount: string) {
  return api.post<{ id: string; reference: string; state: string }>('/trades/request', {
    offer_id: offerId, fiat_amount: fiatAmount,
  });
}

// ---- Reference data ----

export interface AssetRef { symbol: string; name: string; chain: string; slug: string; decimals: number }
export interface CountryRef { iso_code: string; name: string; slug: string }
export interface CurrencyRef { code: string; name: string; symbol: string; decimal_places: number; slug: string }
export interface PaymentMethodRef { name: string; slug: string; category: string; risk_tier: number }

export function getAssets() { return api.get<{ assets: AssetRef[] }>('/reference/assets'); }
export function getCountries() { return api.get<{ countries: CountryRef[] }>('/reference/countries'); }
export function getCurrencies() { return api.get<{ currencies: CurrencyRef[] }>('/reference/currencies'); }
export function getPaymentMethods() { return api.get<{ payment_methods: PaymentMethodRef[] }>('/reference/payment-methods'); }

// ---- Offer creation ----

export function createOffer(payload: {
  side: 'buy' | 'sell'; asset_slug: string; country_slug: string; fiat_currency_code: string;
  payment_method_slug: string; price_type: 'fixed' | 'margin'; price?: string; margin_percent?: string;
  min_amount: string; max_amount: string; total_available: string; terms?: string; payment_window_hours: number;
}) {
  return api.post<{ id: string; status: string }>('/offers', payload);
}

// ---- Vendor trade inbox ----

export interface IncomingTrade {
  id: string; reference: string; asset: string; chain: string; amount: string;
  fiat_amount: string; price_snapshot: string; payment_window_hours: number; state: string; created_at: string;
}

export function getIncomingTrades() {
  return api.get<{ trades: IncomingTrade[] }>('/trades/incoming');
}

export function acceptTrade(id: string, paymentWindowHours?: number) {
  return api.post<{ state: string }>(`/trades/${id}/accept`, paymentWindowHours ? { payment_window_hours: paymentWindowHours } : {});
}

export function declineTrade(id: string) {
  return api.post<{ state: string }>(`/trades/${id}/decline`, {});
}

// ---- Reputation (P5) ----

export interface VendorReputation {
  held: boolean;
  account_created_at?: string;
  total_trades?: number;
  trades_30d?: number;
  completion_rate_30d?: number | null;
  avg_release_seconds?: number | null;
  avg_pay_seconds?: number | null;
  distinct_counterparties?: number;
  badge?: string;
}

export function getReputation(userId: string) {
  return api.get<VendorReputation>(`/users/${userId}/reputation`);
}

// ---- Manage my own offers ----

export interface MyOffer {
  id: string; side: 'buy' | 'sell'; status: string; paused_reason: string | null;
  price_type: 'fixed' | 'margin'; price: string | null; margin_percent: string | null;
  min_amount: string; max_amount: string; total_available: string; payment_window_hours: number;
  created_at: string; asset_symbol: string; country_slug: string; currency_code: string;
  payment_method_name: string;
}

export function getMyOffers() {
  return api.get<{ offers: MyOffer[] }>('/offers/mine');
}

export function pauseOffer(id: string) {
  return api.post<{ status: string }>(`/offers/${id}/pause`, {});
}

export function withdrawOffer(id: string) {
  return api.post<{ status: string }>(`/offers/${id}/withdraw`, {});
}

export function reactivateOffer(id: string) {
  return api.post<{ status: string }>(`/offers/${id}/reactivate`, {});
}
