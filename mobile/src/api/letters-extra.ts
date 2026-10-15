import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { del, get, post } from '@/lib/api';

/** All you ever see of a pen pal until you become friends. */
export type Pal = { display_name: string; photo_url: string | null; verified: boolean };

export type PenPal = {
  id: string;
  pal: Pal;
  status: 'active' | 'friends';
  letters_sent: number;
  letters_received: number;
  unread_count: number;
  incoming_arrives_at: string | null;
  outgoing_arrives_at: string | null;
  can_befriend: boolean;
  letters_needed_to_befriend: number;
  asked_to_befriend: boolean;
  pal_asked_to_befriend: boolean;
  created_at: string;
  last_activity_at: string;
};

export type LettersHome = { allow_pen_pals: boolean; waiting: boolean; max_pen_pals: number; pen_pals: PenPal[] };

export type Letter = { id: string; mine: boolean; content: string; removed: boolean; sent_at: string; deliver_at: string; delivered: boolean };

export type LetterThread = { pen_pal: PenPal; letters: Letter[] };

export const LETTER_MIN = 20;
export const LETTER_MAX = 5000;

export const letterKeys = {
  home: ['letters'] as const,
  thread: (id: string) => ['letter-thread', id] as const,
};

export const useLetters = () => useQuery({ queryKey: letterKeys.home, queryFn: () => get<LettersHome>('/letters') });

export const useLetterThread = (id: string) => useQuery({ queryKey: letterKeys.thread(id), queryFn: () => get<LetterThread>(`/letters/${id}`), enabled: !!id, retry: false });

function useRefreshLetters() {
  const qc = useQueryClient();
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: letterKeys.home });
    if (id) qc.invalidateQueries({ queryKey: letterKeys.thread(id) });
  };
}

/** The device's UTC offset in minutes (e.g. +330 for India). Only used for matching and delivery time; never shown. */
export const deviceUtcOffset = () => -new Date().getTimezoneOffset();

export function useFindPenPal() {
  const refresh = useRefreshLetters();
  return useMutation({
    mutationFn: () => post<{ status: 'matched' | 'waiting'; pen_pal: PenPal | null }>('/letters/find', { utc_offset_minutes: deviceUtcOffset() }),
    onSuccess: () => refresh(),
  });
}

export function useStopLooking() {
  const refresh = useRefreshLetters();
  return useMutation({ mutationFn: () => del('/letters/find'), onSuccess: () => refresh() });
}

export function useSendLetter(id: string) {
  const refresh = useRefreshLetters();
  return useMutation({ mutationFn: (content: string) => post<Letter>(`/letters/${id}`, { content }), onSuccess: () => refresh(id) });
}

export function useBefriendPal(id: string) {
  const refresh = useRefreshLetters();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<PenPal>(`/letters/${id}/befriend`),
    onSuccess: () => {
      refresh(id);
      qc.invalidateQueries({ queryKey: ['friends'] });
    },
  });
}

export function useEndPenPal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, block }: { id: string; block?: boolean }) => post(`/letters/${id}/${block ? 'block' : 'end'}`),
    onSuccess: (_d, { id, block }) => {
      qc.removeQueries({ queryKey: letterKeys.thread(id) });
      qc.invalidateQueries({ queryKey: letterKeys.home });
      if (block) qc.invalidateQueries({ queryKey: ['blocks'] });
    },
  });
}

/** "arrives in 5h", "arrives in 20 min", "arrives any moment". */
export function arrivesIn(iso: string): string {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (mins <= 1) return 'arrives any moment';
  if (mins < 60) return `arrives in ${mins} min`;
  const hours = Math.round(mins / 60);
  return `arrives in ${hours}h`;
}
