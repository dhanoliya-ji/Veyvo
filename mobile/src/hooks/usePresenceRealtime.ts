import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { freeQk } from '@/api/connect-extra';
import { qk } from '@/api/hooks';
import { useNudges } from '@/components/presence/PresenceNudge';
import { realtime } from '@/lib/realtime';

// Don't nudge about the same friend being free more than once every few hours.
const FREE_NUDGE_GAP_MS = 3 * 60 * 60_000;
const lastFreeNudge = new Map<string, number>();

/** Waves and "free to talk" from friends: keeps lists fresh and shows a nudge with Wave back / Call. Mounted once at the root. */
export function usePresenceRealtime(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const { show } = useNudges.getState();
    const offs = [
      realtime.on('wave.received', (e) => {
        if (e.data?.from) show('wave', e.data.from);
      }),
      realtime.on('wave.matched', (e) => {
        if (e.data?.user) show('matched', e.data.user);
      }),
      realtime.on('friend.free', (e) => {
        qc.invalidateQueries({ queryKey: freeQk });
        qc.invalidateQueries({ queryKey: qk.friendsAll });
        const user = e.data?.user;
        if (!user || !e.data?.free_until) return;
        const last = lastFreeNudge.get(user.id) ?? 0;
        if (Date.now() - last < FREE_NUDGE_GAP_MS) return;
        lastFreeNudge.set(user.id, Date.now());
        show('free', user);
      }),
      realtime.on('me.free', () => qc.invalidateQueries({ queryKey: qk.me })),
    ];
    return () => offs.forEach((off) => off());
  }, [enabled, qc]);
}
