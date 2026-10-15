import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { API_BASE } from './config';

/**
 * Privacy-friendly crash reporting (no native SDK).
 *
 * Reports go to our own backend (`POST /client-errors`) and contain only technical details: the error
 * message and stack (scrubbed, file paths cut to file names), app version, platform, OS version, the
 * current screen pattern (e.g. "room/[id]", never real ids) and whether it was fatal. No account id,
 * email, token or anything a person wrote is ever sent. The only id is a random install id made on this
 * device, so repeat crashes can be grouped; it is wiped on sign-out.
 *
 * In development builds errors are only logged to the console unless REPORT_IN_DEV is true.
 */
export const REPORT_IN_DEV = false;

const MAX_REPORTS_PER_SESSION = 10;
const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const INSTALL_ID_KEY = 'veyvo.install-id';
const PENDING_KEY = 'veyvo.pending-crash';

type Source = 'global' | 'promise' | 'boundary' | 'manual';

export type CrashReport = {
  message: string;
  stack: string | null;
  is_fatal: boolean;
  source: Source;
  app_version: string;
  platform: string;
  os_version: string;
  route: string | null;
  timestamp: string;
  install_id: string | null;
};

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsShape = { getGlobalHandler: () => GlobalHandler; setGlobalHandler: (handler: GlobalHandler) => void };
type HermesShape = {
  enablePromiseRejectionTracker?: (options: { allRejections: boolean; onUnhandled: (id: number, rejection: unknown) => void; onHandled?: () => void }) => void;
};

const enabled = () => !__DEV__ || REPORT_IN_DEV;

let installed = false;
let sentThisSession = 0;
const seen = new Set<string>();
let currentRoute: string | null = null;
let installIdCache: string | null = null;

/** Called by the root layout whenever the screen changes. Pass route patterns only (e.g. "user/[id]"). */
export function setCrashRoute(route: string | null) {
  currentRoute = route ? route.slice(0, 200) : null;
}

// ---- Scrubbing ----

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const BEARER = /bearer\s+[\w.~+/=-]+/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_NUMBER = /\d{7,}/g;
// Bundle URLs carry query strings (?platform=android&dev=true...) and paths may include a user folder.
const QUERY = /\?[^\s:)]*/g;
const PATH = /(?:[a-z][a-z0-9+.-]*:\/\/[^\s/()]*)?(?:[A-Za-z]:)?(?:[^\s()/\\:@]*[/\\])+([^\s()/\\:]+)/g;

export function scrubText(value: string): string {
  return value.replace(JWT, '[token]').replace(BEARER, 'Bearer [token]').replace(EMAIL, '[email]').replace(UUID, '[id]').replace(LONG_NUMBER, '[number]');
}

/** Cut every file path or URL in a stack trace down to its file name. */
export function stripPaths(stack: string): string {
  return stack.replace(QUERY, '').replace(PATH, '$1');
}

function describe(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    const name = error.name && error.name !== 'Error' ? `${error.name}: ` : '';
    return { message: `${name}${error.message || 'Unknown error'}`, stack: error.stack ?? null };
  }
  if (typeof error === 'string') return { message: error, stack: null };
  try {
    return { message: `Non-error thrown: ${JSON.stringify(error)?.slice(0, 200) ?? String(error)}`, stack: null };
  } catch {
    return { message: 'Non-error thrown', stack: null };
  }
}

export function buildReport(error: unknown, opts: { isFatal?: boolean; source?: Source; extraStack?: string; installId?: string | null } = {}): CrashReport {
  const { message, stack } = describe(error);
  const fullStack = [stack, opts.extraStack].filter(Boolean).join('\n--- components ---\n');
  const cleanMessage = scrubText(stripPaths(message)).replace(/\s+/g, ' ').trim() || 'Unknown error';
  return {
    message: cleanMessage.slice(0, MAX_MESSAGE),
    stack: fullStack ? scrubText(stripPaths(fullStack)).slice(0, MAX_STACK) : null,
    is_fatal: !!opts.isFatal,
    source: opts.source ?? 'global',
    app_version: (Constants.expoConfig?.version ?? 'unknown').slice(0, 32),
    platform: Platform.OS,
    os_version: String(Platform.Version ?? '').slice(0, 32),
    route: currentRoute,
    timestamp: new Date().toISOString(),
    install_id: opts.installId ?? null,
  };
}

// ---- Anonymous install id ----

function randomId(): string {
  // Not security-sensitive: only groups repeat crashes from one install.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function getInstallId(): Promise<string | null> {
  if (installIdCache) return installIdCache;
  try {
    let id = await AsyncStorage.getItem(INSTALL_ID_KEY);
    if (!id) {
      id = randomId();
      await AsyncStorage.setItem(INSTALL_ID_KEY, id);
    }
    installIdCache = id;
    return id;
  } catch {
    return null;
  }
}

/** Forget the anonymous install id (called on sign-out). A new one is made on the next report. */
export async function resetInstallId() {
  installIdCache = null;
  await AsyncStorage.removeItem(INSTALL_ID_KEY).catch(() => undefined);
}

// ---- Sending ----

async function send(report: CrashReport): Promise<boolean> {
  try {
    // Plain fetch on purpose: no Authorization header, no cookies, nothing that identifies the account.
    const res = await fetch(`${API_BASE}/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      credentials: 'omit',
    });
    // 4xx (bad report, rate limited) won't get better by retrying.
    return res.status < 500;
  } catch {
    return false;
  }
}

/** Report an error. Throttled to 10 per app session, and identical messages are only sent once. */
export async function reportError(error: unknown, opts: { isFatal?: boolean; source?: Source; extraStack?: string } = {}): Promise<void> {
  try {
    if (!enabled()) {
      console.log('[crash]', opts.source ?? 'global', opts.isFatal ? 'fatal' : 'non-fatal', error);
      return;
    }
    const preview = buildReport(error, opts);
    // The same error can surface twice (e.g. a boundary and the global handler), so dedupe on the message alone.
    const key = preview.message;
    if (seen.has(key) || sentThisSession >= MAX_REPORTS_PER_SESSION) return;
    seen.add(key);
    sentThisSession += 1;
    const report = { ...preview, install_id: await getInstallId() };
    if (opts.isFatal) {
      // The app may be killed before the request finishes: keep a copy and send it on next launch.
      await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(report)).catch(() => undefined);
    }
    if (await send(report)) {
      if (opts.isFatal) await AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined);
    }
  } catch {
    // Reporting must never cause another crash.
  }
}

async function flushPending() {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return;
    const report = JSON.parse(raw) as CrashReport;
    if (await send(report)) await AsyncStorage.removeItem(PENDING_KEY);
  } catch {
    await AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined);
  }
}

function withTimeout(promise: Promise<unknown>, ms: number) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

/** Install the global JS error handler and unhandled-rejection tracking. Safe to call more than once. */
export function installCrashReporting() {
  if (installed) return;
  installed = true;

  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      if (isFatal && enabled()) {
        // Give the report a moment to go out before the default handler closes the app.
        withTimeout(reportError(error, { isFatal: true, source: 'global' }), 1500).finally(() => previous(error, isFatal));
        return;
      }
      reportError(error, { isFatal: !!isFatal, source: 'global' });
      previous(error, isFatal);
    });
  }

  // Hermes can tell us about promises that were rejected and never handled. In development React Native
  // already uses this for its own warnings, so we leave it alone there.
  const hermes = (globalThis as { HermesInternal?: HermesShape }).HermesInternal;
  if (enabled() && hermes?.enablePromiseRejectionTracker) {
    hermes.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (_id, rejection) => {
        reportError(rejection, { isFatal: false, source: 'promise' });
      },
      onHandled: () => undefined,
    });
  }

  if (enabled()) flushPending();
}
