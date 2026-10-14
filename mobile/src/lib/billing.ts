import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

import { post } from './api';

type IapModule = typeof import('expo-iap');
type Purchase = import('expo-iap').Purchase;

export const GEM_PACK_IDS = ['gems_100', 'gems_550', 'gems_1200'] as const;
export const PLUS_ID = 'veyvo_plus_monthly';

let cached: IapModule | null | undefined;
let connected: Promise<boolean> | null = null;

/** Google Play Billing is native: unavailable in Expo Go. Load lazily so Expo Go still works. */
function load(): IapModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'android' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    cached = null;
    return cached;
  }
  try {
    cached = require('expo-iap') as IapModule;
  } catch {
    cached = null;
  }
  return cached;
}

export function billingSupported(): boolean {
  return load() !== null;
}

async function connect(m: IapModule): Promise<boolean> {
  if (!connected) {
    connected = Promise.resolve(m.initConnection())
      .then(() => true)
      .catch(() => {
        connected = null;
        return false;
      });
  }
  return connected;
}

export type StoreProduct = { id: string; title: string; price: string; offerToken?: string };

/** Localised prices straight from Google Play (never hard-coded). */
export async function loadProducts(): Promise<{ packs: StoreProduct[]; plus: StoreProduct | null }> {
  const m = load();
  if (!m || !(await connect(m))) return { packs: [], plus: null };
  const [packs, subs] = await Promise.all([
    m.fetchProducts({ skus: [...GEM_PACK_IDS], type: 'in-app' }).catch(() => []),
    m.fetchProducts({ skus: [PLUS_ID], type: 'subs' }).catch(() => []),
  ]);
  const toProduct = (p: any): StoreProduct => ({
    id: p.id,
    title: p.title ?? p.id,
    price: p.displayPrice ?? '',
    offerToken: p.subscriptionOffers?.[0]?.offerTokenAndroid ?? undefined,
  });
  return { packs: (packs ?? []).map(toProduct), plus: subs?.[0] ? toProduct(subs[0]) : null };
}

/**
 * Buy a product: Google Play shows its own payment sheet, then the server verifies the purchase with
 * Google before anything is granted. Only then is the transaction finished (consumed/acknowledged).
 */
export function purchase(product: StoreProduct, accountRef: string): Promise<'done' | 'cancelled' | 'pending'> {
  const m = load();
  if (!m) return Promise.reject(new Error('Purchases need the installed Veyvo app.'));
  const isSub = product.id === PLUS_ID;
  return new Promise((resolve, reject) => {
    let finished = false;
    const done = (fn: () => void) => {
      if (finished) return;
      finished = true;
      ok.remove();
      err.remove();
      fn();
    };
    const ok = m.purchaseUpdatedListener(async (p: Purchase) => {
      if (p.productId !== product.id) return;
      const token = p.purchaseToken;
      if (!token) return done(() => resolve('pending'));
      try {
        await verifyAndFinish(m, p, token, isSub);
        done(() => resolve('done'));
      } catch (e) {
        done(() => reject(e));
      }
    });
    const err = m.purchaseErrorListener((e) => done(() => (m.isUserCancelledError(e) ? resolve('cancelled') : reject(new Error(m.getUserFriendlyErrorMessage(e))))));

    connect(m)
      .then((ready) => {
        if (!ready) throw new Error('Google Play Billing is unavailable on this device.');
        return isSub
          ? m.requestPurchase({
              type: 'subs',
              request: { google: { skus: [product.id], obfuscatedAccountId: accountRef, subscriptionOffers: product.offerToken ? [{ sku: product.id, offerToken: product.offerToken }] : [] } },
            })
          : m.requestPurchase({ type: 'in-app', request: { google: { skus: [product.id], obfuscatedAccountId: accountRef } } });
      })
      .catch((e) => done(() => reject(e)));
  });
}

async function verifyAndFinish(m: IapModule, p: Purchase, token: string, isSub: boolean) {
  await post('/billing/google/verify', { product_id: p.productId, purchase_token: token });
  // Gem packs are consumed so they can be bought again; subscriptions are acknowledged by the server.
  await m.finishTransaction({ purchase: p, isConsumable: !isSub });
}

/** Re-verify anything Google Play still holds (e.g. a purchase interrupted before verification). */
export async function restorePurchases(): Promise<number> {
  const m = load();
  if (!m || !(await connect(m))) return 0;
  const purchases = await m.getAvailablePurchases().catch(() => [] as Purchase[]);
  let restored = 0;
  for (const p of purchases) {
    if (!p.purchaseToken) continue;
    try {
      await verifyAndFinish(m, p, p.purchaseToken, p.productId === PLUS_ID);
      restored += 1;
    } catch {
      /* keep going */
    }
  }
  return restored;
}
