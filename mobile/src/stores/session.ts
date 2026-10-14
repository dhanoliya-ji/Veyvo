import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

const ACCESS_KEY = 'veyvo.access';
const REFRESH_KEY = 'veyvo.refresh';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';
export type SignOutReason = 'user' | 'expired' | 'deleted' | null;

type AccountBlock = { code: 'account_banned' | 'account_suspended'; until?: string | null; reason?: string | null } | null;

type SessionState = {
  status: SessionStatus;
  accessToken: string | null;
  refreshToken: string | null;
  signOutReason: SignOutReason;
  accountBlock: AccountBlock;
  hydrate: () => Promise<void>;
  setTokens: (access: string, refresh: string) => Promise<void>;
  signOutLocal: (reason?: SignOutReason) => Promise<void>;
  setAccountBlocked: (code: 'account_banned' | 'account_suspended', details?: Record<string, unknown>) => void;
  clearAccountBlock: () => void;
};

/**
 * Tokens live in the OS keystore (expo-secure-store), never in AsyncStorage.
 * The access token is short-lived; the refresh token rotates on every use.
 */
export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  accessToken: null,
  refreshToken: null,
  signOutReason: null,
  accountBlock: null,

  hydrate: async () => {
    try {
      const [access, refresh] = await Promise.all([SecureStore.getItemAsync(ACCESS_KEY), SecureStore.getItemAsync(REFRESH_KEY)]);
      set({ accessToken: access, refreshToken: refresh, status: refresh ? 'signedIn' : 'signedOut' });
    } catch {
      set({ status: 'signedOut' });
    }
  },

  setTokens: async (access, refresh) => {
    await Promise.all([SecureStore.setItemAsync(ACCESS_KEY, access), SecureStore.setItemAsync(REFRESH_KEY, refresh)]);
    set({ accessToken: access, refreshToken: refresh, status: 'signedIn', signOutReason: null, accountBlock: null });
  },

  signOutLocal: async (reason = 'user') => {
    await Promise.all([SecureStore.deleteItemAsync(ACCESS_KEY), SecureStore.deleteItemAsync(REFRESH_KEY)]).catch(() => undefined);
    set({ accessToken: null, refreshToken: null, status: 'signedOut', signOutReason: reason });
  },

  setAccountBlocked: (code, details) =>
    set({ accountBlock: { code, until: (details?.until as string) ?? null, reason: (details?.reason as string) ?? null } }),
  clearAccountBlock: () => set({ accountBlock: null }),
}));
