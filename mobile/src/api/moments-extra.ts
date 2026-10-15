import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { del, get, post } from '@/lib/api';
import { qk } from './hooks';
import type { Page, UserSummary } from './types';

// Mirrors backend/app/schemas/moments.py
export type MomentKind = 'game_finished' | 'room_hangout' | 'streak_milestone' | 'level_up' | 'friend_made' | 'friendship_milestone';
export type Moment = { id: string; kind: MomentKind; title: string; stats: Record<string, any>; created_at: string };

export type SeasonEvent = {
  key: string;
  name: string;
  description: string;
  starts_at: string;
  ends_at: string;
  accent: string;
  item: { key: string; slot: string; value: string; name: string } | null;
  quest: { title: string; target: number; progress: number; completed: boolean; claimed: boolean };
  gems: number;
  xp: number;
  server_time: string;
};

export type EventClaim = { event_key: string; item_key: string | null; gems: number; xp: number; new_balance: number; already_claimed: boolean };

export type Rank = 'newcomer' | 'regular' | 'core' | 'legend';
export type LeaderboardEntry = { user: UserSummary; rank: number; points: number; tier: Rank };
export type Leaderboard = { week: string; period: 'current' | 'previous'; entries: LeaderboardEntry[]; me: LeaderboardEntry | null };

export const RANK_LABELS: Record<string, string> = { newcomer: 'Newcomer', regular: 'Regular', core: 'Core', legend: 'Legend' };

const keys = {
  moments: ['moments'] as const,
  event: ['event-current'] as const,
  leaderboard: (id: string, week: string) => ['leaderboard', id, week] as const,
};

export function useMoments() {
  return useInfiniteQuery({
    queryKey: keys.moments,
    queryFn: ({ pageParam }) => get<Page<Moment>>('/moments', { before: pageParam ?? undefined, limit: 20 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
}

export function useDeleteMoment() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => del(`/moments/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: keys.moments }) });
}

export const useCurrentEvent = () => useQuery({ queryKey: keys.event, queryFn: () => get<SeasonEvent | null>('/events/current'), staleTime: 60_000 });

export function useClaimEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => post<EventClaim>(`/events/${key}/claim`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.event });
      qc.invalidateQueries({ queryKey: qk.me });
      qc.invalidateQueries({ queryKey: qk.shop });
    },
  });
}

export const useLeaderboard = (communityId: string, week: 'current' | 'previous', enabled = true) =>
  useQuery({
    queryKey: keys.leaderboard(communityId, week),
    queryFn: () => get<Leaderboard>(`/communities/${communityId}/leaderboard`, { week }),
    enabled: !!communityId && enabled,
  });

/** "3d 4h left" — computed from real, fixed end times. */
export function timeLeft(endsAt: string, now = Date.now()): string {
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return 'Ended';
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h left`;
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h >= 1 ? `${h}h ${m}m left` : `${m}m left`;
}
