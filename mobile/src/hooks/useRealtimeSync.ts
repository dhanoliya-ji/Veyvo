import { useEffect } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';

import { qk } from '@/api/hooks';
import type { Conversation, LocalMessage, Message, Page } from '@/api/types';
import { realtime } from '@/lib/realtime';
import { useSession } from '@/stores/session';
import { toast } from '@/stores/toast';

/** Insert or replace a message in a conversation's paged cache (newest-first), deduping by id and client id. */
export function upsertMessage(qc: ReturnType<typeof useQueryClient>, message: LocalMessage) {
  qc.setQueryData<InfiniteData<Page<LocalMessage>>>(qk.messages(message.conversation_id), (data) => {
    if (!data) return data;
    let replaced = false;
    const pages = data.pages.map((page) => ({
      ...page,
      items: page.items.map((m) => {
        if (m.id === message.id || (m.client_id === message.client_id && m.sender_id === message.sender_id)) {
          replaced = true;
          return { ...message, pending: false, failed: false };
        }
        return m;
      }),
    }));
    if (!replaced && pages.length) pages[0] = { ...pages[0], items: [message, ...pages[0].items] };
    return { ...data, pages };
  });
}

/** Keeps the TanStack Query cache in step with server events. Mounted once at the root. */
export function useRealtimeSync(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    realtime.start();
    const offs = [
      realtime.on('message.created', (e) => {
        const message = e.data as Message;
        upsertMessage(qc, message);
        qc.setQueryData<Conversation[]>(qk.conversations, (list) => {
          if (!list) return list;
          const found = list.find((c) => c.id === message.conversation_id);
          if (!found) return list;
          const mine = message.sender_id !== found.other_user.id;
          const updated = { ...found, last_message: message, last_message_at: message.created_at, unread_count: mine ? found.unread_count : found.unread_count + 1 };
          return [updated, ...list.filter((c) => c.id !== found.id)];
        });
        qc.invalidateQueries({ queryKey: qk.conversations });
        qc.invalidateQueries({ queryKey: qk.home });
      }),
      realtime.on('message.updated', (e) => upsertMessage(qc, e.data as Message)),
      realtime.on('conversation.read', (e) => {
        qc.invalidateQueries({ queryKey: qk.conversation(e.data.conversation_id) });
        qc.invalidateQueries({ queryKey: qk.conversations });
      }),
      realtime.on('notification.created', () => {
        qc.invalidateQueries({ queryKey: qk.notifications });
        qc.invalidateQueries({ queryKey: qk.home });
      }),
      realtime.on('friend_request.created', (e) => {
        qc.invalidateQueries({ queryKey: qk.requests });
        qc.invalidateQueries({ queryKey: qk.home });
        const name = e.data?.from?.display_name;
        if (name) toast.show({ title: `${name} sent you a friend request`, tone: 'info' });
      }),
      realtime.on('friend_request.updated', () => {
        qc.invalidateQueries({ queryKey: qk.requests });
        qc.invalidateQueries({ queryKey: qk.friendsAll });
        qc.invalidateQueries({ queryKey: ['profile'] });
        qc.invalidateQueries({ queryKey: qk.home });
      }),
      realtime.on('friendship.removed', () => {
        qc.invalidateQueries({ queryKey: qk.friendsAll });
        qc.invalidateQueries({ queryKey: ['profile'] });
      }),
      realtime.on('presence.updated', () => {
        qc.invalidateQueries({ queryKey: qk.friendsAll });
        qc.invalidateQueries({ queryKey: qk.conversations });
      }),
      realtime.on('icebreaker.matched', () => qc.invalidateQueries({ queryKey: qk.icebreaker })),
      realtime.on('icebreaker.updated', () => qc.invalidateQueries({ queryKey: qk.icebreaker })),
      realtime.on('room.removed', (e) => {
        qc.invalidateQueries({ queryKey: qk.room(e.data.room_id) });
        toast.show({ title: e.data.banned ? "You've been removed from that hangout." : 'The host removed you from the hangout.', tone: 'warning' });
      }),
      realtime.on('account.status', (e) => {
        useSession.getState().setAccountBlocked(e.data.status === 'banned' ? 'account_banned' : 'account_suspended', { until: e.data.until });
      }),
      // After a reconnect or returning to the app, refetch anything that may have changed.
      realtime.on('client.reconnected', () => qc.invalidateQueries()),
      realtime.on('client.foreground', () => qc.invalidateQueries()),
    ];
    return () => {
      offs.forEach((off) => off());
      realtime.stop();
    };
  }, [enabled, qc]);
}
