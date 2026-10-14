// Extra helpers for hangouts and communities. Builds on hooks.ts without modifying it.
import { useMemo } from 'react';
import type { QueryClient } from '@tanstack/react-query';

import { qk, useCommunities, useShop } from './hooks';
import type { Community, RoomDetail, RoomMessage, Scene, TimerState } from './types';
import { ApiError, errorMessage } from '@/lib/api';

export const FREE_SCENES: Scene[] = ['cafe', 'campfire', 'library', 'rooftop'];
export const ALL_SCENES: Scene[] = ['cafe', 'campfire', 'library', 'rooftop', 'beach', 'space'];

/** Scenes this person can use: the free ones plus any bought in the shop. */
export function useOwnedScenes() {
  const shop = useShop();
  const owned = useMemo(() => {
    const set = new Set<Scene>(FREE_SCENES);
    for (const item of shop.data ?? []) {
      if (item.slot === 'scene' && item.owned) set.add(item.value as Scene);
    }
    return set;
  }, [shop.data]);
  return { owned, loading: shop.isLoading, shop };
}

/** Communities where you're an active member, so you can host a hangout in them. */
export function useHostableCommunities() {
  const query = useCommunities({ mine: true });
  const list = useMemo<Community[]>(
    () => (query.data ?? []).filter((c) => c.membership === 'owner' || c.membership === 'moderator' || c.membership === 'member'),
    [query.data],
  );
  return { ...query, list };
}

/** Append (or replace) a chat message in the room chat cache, deduped by id. */
export function upsertRoomMessage(qc: QueryClient, roomId: string, message: RoomMessage) {
  qc.setQueryData<RoomMessage[]>(qk.roomChat(roomId), (list) => {
    if (!list) return [message];
    if (list.some((m) => m.id === message.id)) return list;
    return [...list, message].slice(-200);
  });
}

export function setRoomTimer(qc: QueryClient, roomId: string, timer: TimerState | null) {
  qc.setQueryData<RoomDetail>(qk.room(roomId), (room) => (room ? { ...room, timer } : room));
}

export type RoomErrorKind = 'forbidden' | 'full' | 'ended' | 'not_found' | 'not_started' | 'offline' | 'other';

/** Turns a join/view error into copy for the live room. */
export function describeRoomError(err: unknown): { kind: RoomErrorKind; title: string; message: string } {
  if (err instanceof ApiError) {
    if (err.isNetwork) return { kind: 'offline', title: "You're offline", message: "We couldn't reach Veyvo. Check your connection and try again." };
    if (err.status === 403 && (err.code === 'room_private' || err.code === 'room_banned'))
      return { kind: 'forbidden', title: "You can't join this room", message: "You don't have permission to join this room." };
    if (err.status === 403) return { kind: 'forbidden', title: "You can't join this room", message: errorMessage(err) };
    if (err.code === 'room_full') return { kind: 'full', title: 'This hangout is full', message: 'Every seat is taken right now. Try again in a bit, or start your own.' };
    if (err.status === 410 || err.code === 'room_ended') return { kind: 'ended', title: 'This hangout has ended', message: 'Thanks for stopping by. There are more hangouts happening right now.' };
    if (err.code === 'room_not_started') return { kind: 'not_started', title: "It hasn't started yet", message: 'The host will open the doors soon.' };
    if (err.status === 404) return { kind: 'not_found', title: 'Hangout not found', message: "This hangout doesn't exist anymore." };
  }
  return { kind: 'other', title: "Couldn't join", message: errorMessage(err) };
}

/** ISO 8601 with the device's local UTC offset, e.g. 2026-10-14T20:00:00+05:30. */
export function toIsoWithOffset(d: Date): string {
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

export type ScheduleOption = { key: string; label: string; date: Date | null };

/** Simple start-time choices computed in local time. "Now" means live immediately. */
export function scheduleOptions(now = new Date()): ScheduleOption[] {
  const options: ScheduleOption[] = [{ key: 'now', label: 'Now', date: null }];
  const inHour = new Date(now.getTime() + 60 * 60_000);
  inHour.setSeconds(0, 0);
  inHour.setMinutes(Math.ceil(inHour.getMinutes() / 5) * 5);
  options.push({ key: 'hour', label: 'In 1 hour', date: inHour });
  const tonight = new Date(now);
  tonight.setHours(20, 0, 0, 0);
  if (tonight.getTime() - now.getTime() > 90 * 60_000) options.push({ key: 'tonight', label: 'Tonight 8 PM', date: tonight });
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(20, 0, 0, 0);
  options.push({ key: 'tomorrow', label: 'Tomorrow 8 PM', date: tomorrow });
  const weekend = new Date(now);
  const daysToSat = (6 - now.getDay() + 7) % 7 || 7;
  weekend.setDate(now.getDate() + daysToSat);
  weekend.setHours(18, 0, 0, 0);
  if (daysToSat > 1) options.push({ key: 'saturday', label: 'Saturday 6 PM', date: weekend });
  return options;
}
