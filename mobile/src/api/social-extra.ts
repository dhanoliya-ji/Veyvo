import { useEffect, useState } from 'react';
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';

import { qk, useConfig } from '@/api/hooks';
import type { LocalMessage, Page } from '@/api/types';
import { post } from '@/lib/api';

/** Mirrors backend KUDOS_TAGS; the live list comes from /config when available. */
export const KUDOS_FALLBACK: Record<string, string> = {
  funny: 'Funny',
  kind: 'Kind',
  great_listener: 'Great listener',
  good_energy: 'Good energy',
  great_player: 'Great player',
  smart: 'Big brain',
  creative: 'Creative',
  great_host: 'Great host',
};

export const KUDOS_EMOJI: Record<string, string> = {
  funny: '😂',
  kind: '💛',
  great_listener: '🎧',
  good_energy: '✨',
  great_player: '🏆',
  smart: '🧠',
  creative: '🎨',
  great_host: '🎤',
};

export function useKudosLabels(): Record<string, string> {
  const config = useConfig();
  const tags = config.data?.kudos_tags;
  return tags && Object.keys(tags).length ? tags : KUDOS_FALLBACK;
}

/** Hide a conversation's history for me only (the other person keeps theirs). */
export function useClearConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => post(`/conversations/${conversationId}/clear`),
    onSuccess: (_d, conversationId) => {
      qc.setQueryData<InfiniteData<Page<LocalMessage>>>(qk.messages(conversationId), (data) =>
        data ? { pages: [{ items: [], next_cursor: null }], pageParams: [null] } : data,
      );
      qc.invalidateQueries({ queryKey: qk.conversations });
      qc.invalidateQueries({ queryKey: qk.conversation(conversationId) });
      qc.invalidateQueries({ queryKey: qk.home });
    },
  });
}

/** Patch a message (matched by sender + client id) in a conversation's paged cache without touching delivery flags elsewhere. */
export function patchCachedMessage(
  qc: ReturnType<typeof useQueryClient>,
  conversationId: string,
  senderId: string,
  clientId: string,
  patch: Partial<LocalMessage>,
) {
  qc.setQueryData<InfiniteData<Page<LocalMessage>>>(qk.messages(conversationId), (data) => {
    if (!data) return data;
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map((m) => (m.client_id === clientId && m.sender_id === senderId ? { ...m, ...patch } : m)),
      })),
    };
  });
}

export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
