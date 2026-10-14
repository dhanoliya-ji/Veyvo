import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { icebreakerApi, qk } from '@/api/hooks';
import { ApiError } from '@/lib/api';

/** True when `err` is an ApiError with the given HTTP status and (optionally) one of the given codes. */
export function isApiError(err: unknown, status?: number, ...codes: string[]): err is ApiError {
  if (!(err instanceof ApiError)) return false;
  if (status !== undefined && err.status !== status) return false;
  return codes.length === 0 || codes.includes(err.code);
}

/** Re-renders every `intervalMs` while `enabled`, returning Date.now(). */
export function useNow(intervalMs = 250, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}

/**
 * Difference between the server clock and this device (ms to add to Date.now() to get server time).
 * `receivedAt` should be when the response arrived (TanStack's dataUpdatedAt).
 */
export function clockOffset(serverTimeIso: string | null | undefined, receivedAt: number): number {
  if (!serverTimeIso || !receivedAt) return 0;
  const server = Date.parse(serverTimeIso);
  return Number.isFinite(server) ? server - receivedAt : 0;
}

/** Milliseconds left until `endsAtIso` on the server clock. */
export function msLeft(endsAtIso: string | null | undefined, offset: number, now = Date.now()): number {
  if (!endsAtIso) return 0;
  return Math.max(0, Date.parse(endsAtIso) - (now + offset));
}

/** Milliseconds until the next UTC midnight (when the daily question and quests roll over). */
export function msUntilUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return next - now;
}

export function hoursMinutes(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

/** Mirrors backend KUDOS_TAGS (also served in /config). */
export const KUDOS_TAGS: { key: string; label: string; emoji: string }[] = [
  { key: 'funny', label: 'Funny', emoji: '😂' },
  { key: 'kind', label: 'Kind', emoji: '💛' },
  { key: 'great_listener', label: 'Great listener', emoji: '👂' },
  { key: 'smart', label: 'Big brain', emoji: '🧠' },
  { key: 'creative', label: 'Creative', emoji: '🎨' },
  { key: 'great_host', label: 'Great host', emoji: '🏕️' },
];

export const GAME_META = {
  trivia: { name: 'Trivia', tagline: 'Quick-fire questions. Fastest right answers score most.' },
  doodle: { name: 'Doodle & Guess', tagline: 'Take turns drawing a secret word while everyone guesses.' },
} as const;

export const GAME_REWARDS = { play: 10, win: 15 } as const;

/**
 * A specific icebreaker session by id. `/icebreakers/current` only returns active sessions, so this keeps
 * the result (connected / ended) visible after it finishes. Keyed under qk.icebreaker so realtime
 * invalidations of the icebreaker also refresh it.
 */
export const useIcebreakerSession = (id: string | null) =>
  useQuery({
    queryKey: [...qk.icebreaker, 'session', id ?? ''],
    queryFn: () => icebreakerApi.get(id!),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === 'active' ? 8000 : false),
  });
