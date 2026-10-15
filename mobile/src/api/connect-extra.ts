import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { qk } from '@/api/hooks';
import type { Message, MessageContext, RoomDetail, UserSummary } from '@/api/types';
import { api, get, post, put } from '@/lib/api';

// ---------- Chat: voice notes and replies ----------

/** What the next text message replies to (sent to the server without the display-only fields). */
export type ReplyContext = {
  type: 'photo' | 'prompt';
  photo_id?: string;
  prompt_key?: string;
  text?: string;
  photo_url?: string;
};

export function sendTextRequest(conversationId: string, content: string, clientId: string, context?: ReplyContext | null) {
  const body: Record<string, unknown> = { content, client_id: clientId };
  if (context) {
    const { photo_url: _url, ...rest } = context;
    body.context = rest;
  }
  return post<Message>(`/conversations/${conversationId}/messages`, body);
}

/** Upload a recorded voice note (multipart, like photo uploads). Retrying with the same client id is safe. */
export function sendVoiceRequest(conversationId: string, uri: string, clientId: string, durationMs: number) {
  const form = new FormData();
  form.append('client_id', clientId);
  form.append('duration_ms', String(Math.round(durationMs)));
  form.append('file', {
    uri,
    name: 'voice.m4a',
    type: 'audio/mp4',
  } as unknown as Blob);
  return api<Message>(`/conversations/${conversationId}/voice`, {
    method: 'POST',
    form,
  });
}

export function useSendVoice(conversationId: string) {
  return useMutation({
    mutationFn: (args: { uri: string; clientId: string; durationMs: number }) => sendVoiceRequest(conversationId, args.uri, args.clientId, args.durationMs),
  });
}

export const contextLabel = (c: MessageContext | ReplyContext, mine: boolean) =>
  c.type === 'photo' ? (mine ? 'Replied to their photo' : 'Replied to your photo') : mine ? 'Replied to their prompt' : 'Replied to your prompt';

// ---------- Waves and Free to talk ----------
export type FreeFriend = UserSummary & {
  free_until: string;
  online: boolean | null;
};

export const FREE_OPTIONS = [15, 30, 60, 120] as const;

export const freeQk = ['free-friends'] as const;

export const waveRequest = (userId: string) => post<{ matched: boolean }>(`/connect/wave/${userId}`);

export function useWave() {
  return useMutation({ mutationFn: (userId: string) => waveRequest(userId) });
}

export const useFreeFriends = (enabled = true) =>
  useQuery({
    queryKey: freeQk,
    queryFn: () => get<FreeFriend[]>('/connect/free-friends'),
    enabled,
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

export function useSetFree() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (minutes: 0 | 15 | 30 | 60 | 120) => put<{ free_until: string | null }>('/connect/free', { minutes }),
    onSuccess: (res) => {
      qc.setQueryData(qk.me, (me: any) => (me ? { ...me, free_until: res.free_until } : me));
    },
  });
}

/** Minutes left until `iso`, or 0 when it's in the past. */
export function minutesLeft(iso?: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000));
}

// ---------- Calls ----------
export type CallFormat = 'voice' | 'video';

export const startCallWithFormat = (userId: string, format: CallFormat) => post<RoomDetail>('/rooms/calls', { user_id: userId, format });
export const endCallRequest = (roomId: string) => post(`/rooms/calls/${roomId}/end`);
export const declineCallRequest = (roomId: string) => post(`/rooms/calls/${roomId}/decline`);

// ---------- Vibes (compliments, stored as kudos tags) ----------
export const VIBE_EMOJI: Record<string, string> = {
  funny: '😂',
  kind: '💛',
  great_listener: '🎧',
  good_energy: '✨',
  great_player: '🏆',
  smart: '🧠',
  creative: '🎨',
  great_host: '🎤',
};
