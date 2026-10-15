import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { qk } from '@/api/hooks';
import type { MatchEvent } from '@/api/discover-extra';
import { showMatch } from '@/components/discover/MatchModal';
import { realtime } from '@/lib/realtime';

/**
 * Listens for `discover.match` (both people liked each other in Friend Swipe) and celebrates it wherever
 * the user is. Pair it with one `<MatchModalHost />` mounted at the root, which renders the celebration.
 */
export function useDiscoverRealtime(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const off = realtime.on('discover.match', (e) => {
      const match = e.data as MatchEvent;
      if (!match?.friend?.id) return;
      qc.invalidateQueries({ queryKey: qk.friendsAll });
      qc.invalidateQueries({ queryKey: qk.conversations });
      qc.invalidateQueries({ queryKey: qk.home });
      qc.invalidateQueries({ queryKey: qk.profile(match.friend.id) });
      showMatch(match);
    });
    return off;
  }, [enabled, qc]);
}
