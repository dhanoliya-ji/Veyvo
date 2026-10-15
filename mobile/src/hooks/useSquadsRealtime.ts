import { useEffect } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';

import { letterKeys } from '@/api/letters-extra';
import { squadKeys, type SquadMessage } from '@/api/squads-extra';
import type { Page } from '@/api/types';
import { realtime } from '@/lib/realtime';

/** Insert or replace a squad message in the paged cache (newest first), deduping by id and client id. */
export function upsertSquadMessage(qc: ReturnType<typeof useQueryClient>, message: SquadMessage) {
  qc.setQueryData<InfiniteData<Page<SquadMessage>>>(squadKeys.messages(message.squad_id), (data) => {
    if (!data) return data;
    let replaced = false;
    const pages = data.pages.map((page) => ({
      ...page,
      items: page.items.map((m) => {
        if (m.id === message.id || (!!message.client_id && m.client_id === message.client_id && m.sender.id === message.sender.id)) {
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

/** Keeps Squads and Slow Letters in step with server events. Mount once next to useRealtimeSync. */
export function useSquadsRealtime(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const offs = [
      realtime.on('squad.message', (e) => {
        const message = e.data as SquadMessage;
        upsertSquadMessage(qc, message);
        qc.invalidateQueries({ queryKey: squadKeys.all });
        qc.invalidateQueries({ queryKey: squadKeys.detail(message.squad_id) });
      }),
      realtime.on('squad.read', (e) => {
        qc.invalidateQueries({ queryKey: squadKeys.all });
        if (e.data?.squad_id) qc.invalidateQueries({ queryKey: squadKeys.detail(e.data.squad_id) });
      }),
      ...(['squad.updated', 'squad.hangout'] as const).map((type) =>
        realtime.on(type, (e) => {
          qc.invalidateQueries({ queryKey: squadKeys.all });
          if (e.data?.squad_id) qc.invalidateQueries({ queryKey: squadKeys.detail(e.data.squad_id) });
        }),
      ),
      realtime.on('pen_pal.updated', (e) => {
        qc.invalidateQueries({ queryKey: letterKeys.home });
        if (e.data?.pen_pal_id) qc.invalidateQueries({ queryKey: letterKeys.thread(e.data.pen_pal_id) });
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [enabled, qc]);
}
