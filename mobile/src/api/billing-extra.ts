import { useQuery, useQueryClient } from '@tanstack/react-query';

import { get, post } from '@/lib/api';
import { loadProducts } from '@/lib/billing';
import { qk } from './hooks';

// Mirrors backend services/monetization.billing_status
export type BillingStatus = {
  billing_available: boolean;
  account_ref: string;
  gem_packs: { product_id: string; gems: number }[];
  plus: { product_id: string; active: boolean; until: string | null; perks: string[] };
  ads: { enabled: boolean; gems_per_ad: number; remaining_today: number; dev_claim: boolean };
  gems: number;
};

export const billingKeys = { status: ['billing-status'] as const, products: ['store-products'] as const };

export const useBillingStatus = () => useQuery({ queryKey: billingKeys.status, queryFn: () => get<BillingStatus>('/billing/status') });

/** Prices come from Google Play itself. Empty when billing isn't available on this device. */
export const useStoreProducts = (enabled: boolean) =>
  useQuery({ queryKey: billingKeys.products, queryFn: loadProducts, enabled, staleTime: 10 * 60_000, retry: 1 });

export const adRewardApi = {
  start: () => post<{ nonce: string; gems: number; remaining_today: number }>('/ads/rewards'),
  status: (nonce: string) => get<{ status: 'pending' | 'granted'; gems: number }>(`/ads/rewards/${nonce}`),
  devClaim: (nonce: string) => post<{ status: 'pending' | 'granted'; gems: number }>(`/ads/rewards/${nonce}/dev-claim`),
};

export function useRefreshWallet() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: billingKeys.status });
    qc.invalidateQueries({ queryKey: qk.me });
  };
}
