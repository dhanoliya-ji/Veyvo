import { API_BASE } from './config';
import { useSession } from '@/stores/session';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isNetwork() {
    return this.code === 'network_error';
  }
}

/** User-facing text for an error, never a raw stack trace. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) {
    if (err.isNetwork) return "We couldn't reach Veyvo. Check your connection and try again.";
    if (err.status >= 500) return 'Veyvo is having a moment. Please try again shortly.';
    return err.message || fallback;
  }
  return fallback;
}

export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || err.code !== 'validation_error') return {};
  const fields = (err.details?.fields as { field: string; message: string }[] | undefined) ?? [];
  return Object.fromEntries(fields.map((f) => [f.field, f.message.replace(/^Value error, /, '')]));
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  auth?: boolean;
  signal?: AbortSignal;
  /** multipart upload (photos); sent instead of a JSON body */
  form?: FormData;
};

let refreshing: Promise<boolean> | null = null;

/** Single-flight refresh: concurrent 401s share one refresh request. */
async function refreshTokens(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const { refreshToken, setTokens, signOutLocal } = useSession.getState();
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) {
        if (res.status === 401) await signOutLocal('expired');
        return false;
      }
      const data = await res.json();
      await setTokens(data.access_token, data.refresh_token);
      return true;
    } catch {
      return false; // network issue: keep the session, try again later
    }
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return params.length ? `${url}?${params.join('&')}` : url;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true, signal, form } = opts;

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
    const token = useSession.getState().accessToken;
    if (auth && token) headers.Authorization = `Bearer ${token}`;
    return fetch(buildUrl(path, query), { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined), signal });
  };

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && auth && useSession.getState().refreshToken) {
      if (await refreshTokens()) res = await send();
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError(0, 'network_error', "We couldn't reach Veyvo.");
  }

  if (res.status === 204) return undefined as T;
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = data?.error;
    const apiError = new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? 'Something went wrong.', err?.details);
    // Account-level states end the session everywhere in the app.
    if (res.status === 403 && (apiError.code === 'account_banned' || apiError.code === 'account_suspended')) {
      useSession.getState().setAccountBlocked(apiError.code, err?.details);
    }
    if (res.status === 401 && auth && apiError.code !== 'invalid_credentials') {
      await useSession.getState().signOutLocal('expired');
    }
    throw apiError;
  }
  return data as T;
}

export const get = <T,>(path: string, query?: RequestOptions['query']) => api<T>(path, { query });
export const post = <T,>(path: string, body?: unknown, query?: RequestOptions['query']) => api<T>(path, { method: 'POST', body: body ?? {}, query });
export const patch = <T,>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T,>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
/** Upload a local image file (from the image picker or camera) as multipart form data. */
export function uploadImage<T>(path: string, uri: string, fields: Record<string, string> = {}) {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  form.append('file', { uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
  return api<T>(path, { method: 'POST', form });
}

export const del = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body });
