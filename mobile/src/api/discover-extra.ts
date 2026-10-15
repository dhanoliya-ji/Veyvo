import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { get, post, put } from '@/lib/api';
import { qk } from './hooks';
import type { Photo } from './photos-extra';
import type { Interest, Me, UserSummary } from './types';

// ---------- Types ----------
export type PromptOption = { key: string; text: string };
export type ProfilePrompt = { key: string; text: string; answer: string };

export type DiscoverCard = {
  user: UserSummary;
  bio: string;
  vibe: string | null;
  verified: boolean;
  photos: Photo[];
  prompts: ProfilePrompt[];
  interests: Interest[];
  common_interests: Interest[];
  mutual_friend_count: number;
  /** Short "You both…" chips, strongest first. */
  common_ground: string[];
  daily_pick: boolean;
};

export type Deck = { cards: DiscoverCard[]; remaining_today: number; daily_limit: number; resets_at: string; daily_picks: number };
export type DeckFilters = { verifiedOnly?: boolean; interestId?: number | null };

export type CommentContext = { type: 'photo'; photo_id: string } | { type: 'prompt'; prompt_key: string };
export type SwipeBody = { target_id: string; decision: 'like' | 'pass'; comment?: string; comment_context?: CommentContext };
export type SwipeResult = { matched: boolean; friend: UserSummary | null; conversation_id: string | null; remaining_today: number };
export type MatchEvent = { friend: UserSummary; conversation_id: string | null };

export const discoverKeys = {
  all: ['discover'] as const,
  deck: (filters: DeckFilters) => ['discover', 'deck', filters.verifiedOnly ?? false, filters.interestId ?? null] as const,
  prompts: ['discover', 'prompts'] as const,
};

// ---------- Friend Swipe ----------
export const useDeck = (filters: DeckFilters = {}, enabled = true) =>
  useQuery({
    queryKey: discoverKeys.deck(filters),
    queryFn: () =>
      get<Deck>('/discover/deck', {
        verified_only: filters.verifiedOnly ? 'true' : undefined,
        interest_id: filters.interestId ? String(filters.interestId) : undefined,
      }),
    enabled,
    staleTime: 60_000,
  });

export function useSwipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SwipeBody) => post<SwipeResult>('/discover/swipe', body),
    onSuccess: (result) => {
      if (result.matched) {
        qc.invalidateQueries({ queryKey: qk.friendsAll });
        qc.invalidateQueries({ queryKey: qk.conversations });
        qc.invalidateQueries({ queryKey: qk.home });
      }
    },
  });
}

export function useUndoPass() {
  return useMutation({ mutationFn: () => post<{ undone: boolean; target_id: string | null; remaining_today: number }>('/discover/undo') });
}

// ---------- Prompts ----------
export const usePromptCatalogue = () => useQuery({ queryKey: discoverKeys.prompts, queryFn: () => get<PromptOption[]>('/discover/prompts'), staleTime: 60 * 60_000 });

export function useSavePrompts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prompts: { key: string; answer: string }[]) => put<Me>('/discover/me/prompts', { prompts }),
    onSuccess: (me) => {
      qc.setQueryData(qk.me, me);
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

// ---------- Chat replies ----------
/**
 * Route params for replying to a friend's photo or prompt. The chat screen (messages/[id]) reads these and
 * sends the reply with `context`, so the message shows what it's about.
 */
export type ReplyParams = { replyType: 'photo' | 'prompt'; replyPhotoId?: string; replyPromptKey?: string; replyText?: string };
