import { useMutation, useQuery } from '@tanstack/react-query';

import { get, post } from '@/lib/api';
import type { GameView, UserSummary } from './types';

/** Up to 8 friends per invite. */
export const MAX_GAME_INVITES = 8;

export type GameInviteResult = {
  /** Friends who got the invite. */
  invited: string[];
  /** Friends who were skipped (invites switched off, blocked, or not friends anymore). */
  skipped: string[];
};

/** Realtime `game.invite` payload, delivered to the invited friend. */
export type GameInviteEvent = {
  game_id: string;
  game_type: GameView['game_type'];
  game_name: string;
  code: string;
  from: UserSummary;
};

export const inviteToGame = (gameId: string, userIds: string[]) =>
  post<GameInviteResult>(`/games/${gameId}/invite`, { user_ids: userIds.slice(0, MAX_GAME_INVITES) });

export const useInviteToGame = (gameId: string) => useMutation({ mutationFn: (userIds: string[]) => inviteToGame(gameId, userIds) });

/** A friendly opener for a quiet chat. Only ever pre-fills the composer; nothing is sent for you. */
export type Spark = {
  suggestion: string | null;
  opener: string | null;
  reason: 'prompt' | 'interest' | 'game' | 'anniversary' | 'hello' | 'recent' | 'not_friends' | string;
};

export const sparkKeys = { conversation: (id: string) => ['spark', id] as const };

/** The server keeps the pick stable for a whole day, so a long stale time is fine. */
export const useSpark = (conversationId: string, enabled = true) =>
  useQuery({
    queryKey: sparkKeys.conversation(conversationId),
    queryFn: () => get<Spark>(`/conversations/${conversationId}/spark`),
    enabled: !!conversationId && enabled,
    staleTime: 10 * 60_000,
  });
