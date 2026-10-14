import Constants from 'expo-constants';

/**
 * Where the API lives.
 *
 * 1. EXPO_PUBLIC_API_URL wins (set it for staging/production builds, e.g. https://api.veyvo.app).
 * 2. In development we derive the dev machine's LAN address from Metro's host, so a physical phone
 *    reaches the backend at http://<your-computer-ip>:8000 — `localhost` would point at the phone itself.
 */
function resolveApiUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const hostUri = Constants.expoConfig?.hostUri ?? (Constants as unknown as { manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } } }).manifest2?.extra?.expoGo?.debuggerHost;
  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:8000`;
  return 'http://localhost:8000';
}

export const API_URL = resolveApiUrl();
export const API_BASE = `${API_URL}/api/v1`;
export const WS_URL = `${API_URL.replace(/^http/, 'ws')}/api/v1/ws`;
export const LEGAL_URLS = {
  privacy: `${API_URL}/legal/privacy`,
  terms: `${API_URL}/legal/terms`,
  guidelines: `${API_URL}/legal/guidelines`,
  childSafety: `${API_URL}/legal/child-safety`,
  deleteAccount: `${API_URL}/account/delete`,
};
export const SUPPORT_EMAIL = 'support@veyvo.app';
