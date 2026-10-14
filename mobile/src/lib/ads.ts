import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

type AdsModule = typeof import('react-native-google-mobile-ads');

let cached: AdsModule | null | undefined;
let initialized: Promise<void> | null = null;

/** AdMob is a native module: unavailable in Expo Go and on web. Load lazily so those still work. */
function load(): AdsModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    cached = null;
    return cached;
  }
  try {
    cached = require('react-native-google-mobile-ads') as AdsModule;
  } catch {
    cached = null;
  }
  return cached;
}

export function adsSupported(): boolean {
  return load() !== null;
}

/** Ask for consent where required (EU/UK GDPR) via Google's UMP form, then start the SDK once. */
async function ensureInitialized(m: AdsModule) {
  if (!initialized) {
    initialized = (async () => {
      try {
        await m.AdsConsent.gatherConsent();
      } catch {
        // Consent form unavailable (e.g. no network). Ads will be non-personalised.
      }
      await m.default().initialize();
    })();
  }
  return initialized;
}

function rewardedUnitId(m: AdsModule): string {
  // Google's test unit in development; set EXPO_PUBLIC_ADMOB_REWARDED_ID for production builds.
  return process.env.EXPO_PUBLIC_ADMOB_REWARDED_ID || m.TestIds.REWARDED;
}

export type RewardedResult = 'earned' | 'closed' | 'unavailable' | 'failed';

/**
 * Show a rewarded ad. `nonce` goes to Google as SSV custom data; the server grants gems only when
 * Google's signed callback arrives — the client never grants rewards itself.
 */
export async function showRewardedAd(nonce: string): Promise<RewardedResult> {
  const m = load();
  if (!m) return 'unavailable';
  try {
    await ensureInitialized(m);
  } catch {
    return 'failed';
  }
  return new Promise<RewardedResult>((resolve) => {
    let earned = false;
    let settled = false;
    const ad = m.RewardedAd.createForAdRequest(rewardedUnitId(m), {
      requestNonPersonalizedAdsOnly: true,
      serverSideVerificationOptions: { customData: nonce },
    });
    const finish = (result: RewardedResult) => {
      if (settled) return;
      settled = true;
      unsubscribers.forEach((u) => u());
      resolve(result);
    };
    const timeout = setTimeout(() => finish('failed'), 20_000);
    const unsubscribers = [
      ad.addAdEventListener(m.RewardedAdEventType.LOADED, () => {
        clearTimeout(timeout);
        ad.show().catch(() => finish('failed'));
      }),
      ad.addAdEventListener(m.RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
      }),
      ad.addAdEventListener(m.AdEventType.CLOSED, () => finish(earned ? 'earned' : 'closed')),
      ad.addAdEventListener(m.AdEventType.ERROR, () => {
        clearTimeout(timeout);
        finish('failed');
      }),
    ];
    ad.load();
  });
}
