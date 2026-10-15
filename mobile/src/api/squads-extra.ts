import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { del, get, patch, post } from '@/lib/api';
import type { Page, RoomDetail, UserSummary } from './types';

export type SquadMember = { user: UserSummary; role: 'owner' | 'member'; joined_at: string };

export type SquadMessage = {
  id: string;
  squad_id: string;
  sender: UserSummary;
  client_id?: string | null;
  content: string;
  removed: boolean;
  created_at: string;
  /** Local-only state for optimistic sends. */
  pending?: boolean;
  failed?: boolean;
};

export type Squad = {
  id: string;
  name: string;
  emoji: string;
  owner_id: string | null;
  my_role: 'owner' | 'member';
  member_count: number;
  members: SquadMember[];
  unread_count: number;
  last_message: SquadMessage | null;
  streak_weeks: number;
  /** Squad night in UTC: weekday 0 = Monday, time "HH:MM". */
  weekly_day: number | null;
  weekly_time: string | null;
  next_squad_night: string | null;
  live_room_id: string | null;
  present_count: number;
  created_at: string;
};

export const MAX_SQUAD_SIZE = 8;
export const SQUAD_EMOJIS = ['✨', '🔥', '🦉', '🎮', '🍕', '🎧', '🌙', '🌈', '🐸', '🚀', '☕', '🎲', '🌊', '🍿', '💜', '⚡'];

export const squadKeys = {
  all: ['squads'] as const,
  detail: (id: string) => ['squad', id] as const,
  messages: (id: string) => ['squad-messages', id] as const,
};

export const useSquads = () => useQuery({ queryKey: squadKeys.all, queryFn: () => get<Squad[]>('/squads') });

export const useSquad = (id: string) => useQuery({ queryKey: squadKeys.detail(id), queryFn: () => get<Squad>(`/squads/${id}`), enabled: !!id });

export const useSquadMessages = (id: string) =>
  useInfiniteQuery({
    queryKey: squadKeys.messages(id),
    queryFn: ({ pageParam }) => get<Page<SquadMessage>>(`/squads/${id}/messages`, { before: pageParam ?? undefined, limit: 30 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: !!id,
  });

function useRefreshSquad() {
  const qc = useQueryClient();
  return (squad?: Squad | string) => {
    const id = typeof squad === 'string' ? squad : squad?.id;
    if (squad && typeof squad !== 'string') qc.setQueryData(squadKeys.detail(squad.id), squad);
    else if (id) qc.invalidateQueries({ queryKey: squadKeys.detail(id) });
    qc.invalidateQueries({ queryKey: squadKeys.all });
  };
}

export function useCreateSquad() {
  const refresh = useRefreshSquad();
  return useMutation({
    mutationFn: (body: { name: string; emoji: string; member_ids: string[] }) => post<Squad>('/squads', body),
    onSuccess: (squad) => refresh(squad),
  });
}

export function useUpdateSquad(id: string) {
  const refresh = useRefreshSquad();
  return useMutation({
    mutationFn: (body: { name?: string; emoji?: string; weekly_day?: number | null; weekly_time?: string | null }) => patch<Squad>(`/squads/${id}`, body),
    onSuccess: (squad) => refresh(squad),
  });
}

export function useAddSquadMember(id: string) {
  const refresh = useRefreshSquad();
  return useMutation({ mutationFn: (userId: string) => post<Squad>(`/squads/${id}/members`, { user_id: userId }), onSuccess: (squad) => refresh(squad) });
}

export function useRemoveSquadMember(id: string) {
  const refresh = useRefreshSquad();
  return useMutation({ mutationFn: (userId: string) => del<Squad>(`/squads/${id}/members/${userId}`), onSuccess: (squad) => refresh(squad) });
}

export function useLeaveSquad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => post(`/squads/${id}/leave`),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: squadKeys.detail(id) });
      qc.removeQueries({ queryKey: squadKeys.messages(id) });
      qc.invalidateQueries({ queryKey: squadKeys.all });
    },
  });
}

export const sendSquadMessage = (id: string, content: string, clientId: string) => post<SquadMessage>(`/squads/${id}/messages`, { content, client_id: clientId });

export const markSquadRead = (id: string) => post(`/squads/${id}/read`);

/** Opens (or returns) the squad's private video hangout and joins it. Navigate to /room/[id] afterwards. */
export function useStartSquadHangout(id: string) {
  const refresh = useRefreshSquad();
  return useMutation({ mutationFn: () => post<RoomDetail>(`/squads/${id}/room`), onSuccess: () => refresh(id) });
}

// ----- Squad night: the server stores UTC, people pick local time -----
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Local weekday (0 = Monday) and "HH:MM" -> UTC weekday and time. */
export function localToUtc(day: number, time: string): { weekly_day: number; weekly_time: string } {
  const [h, m] = time.split(':').map(Number);
  const now = new Date();
  const d = new Date(now);
  const localDow = (now.getDay() + 6) % 7; // JS: 0 = Sunday
  d.setDate(now.getDate() + ((day - localDow + 7) % 7));
  d.setHours(h, m, 0, 0);
  return { weekly_day: (d.getUTCDay() + 6) % 7, weekly_time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
}

/** UTC weekday and "HH:MM" -> local weekday (0 = Monday) and "HH:MM". */
export function utcToLocal(day: number, time: string): { day: number; time: string } {
  const [h, m] = time.split(':').map(Number);
  const now = new Date();
  const utcDow = (now.getUTCDay() + 6) % 7;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + ((day - utcDow + 7) % 7), h, m));
  return { day: (d.getDay() + 6) % 7, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export function squadNightLabel(squad: Pick<Squad, 'weekly_day' | 'weekly_time'>): string | null {
  if (squad.weekly_day === null || !squad.weekly_time) return null;
  const local = utcToLocal(squad.weekly_day, squad.weekly_time);
  const [h, m] = local.time.split(':').map(Number);
  const when = new Date();
  when.setHours(h, m, 0, 0);
  return `${WEEKDAYS[local.day]}s at ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}
