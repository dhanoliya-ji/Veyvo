import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';

import { qk } from '@/api/hooks';
import type { GameInviteEvent } from '@/api/invites-extra';
import { haptic } from '@/lib/haptics';
import { realtime } from '@/lib/realtime';

const SHOW_MS = 12_000;

type InviteState = {
  invite: GameInviteEvent | null;
  show: (invite: GameInviteEvent) => void;
  dismiss: () => void;
};

let timer: ReturnType<typeof setTimeout> | null = null;

/** The game invite currently shown in the banner (one at a time; a newer invite replaces it). */
export const useGameInviteBanner = create<InviteState>((set) => ({
  invite: null,
  show: (invite) => {
    if (timer) clearTimeout(timer);
    set({ invite });
    timer = setTimeout(() => set({ invite: null }), SHOW_MS);
  },
  dismiss: () => {
    if (timer) clearTimeout(timer);
    timer = null;
    set({ invite: null });
  },
}));

/**
 * Listens for `game.invite` and shows "Maya invited you to Chess — Join".
 * Mount once next to useRealtimeSync, and render <GameInviteBanner /> next to <Toaster />.
 */
export function useGameInvites(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const off = realtime.on('game.invite', (e) => {
      const invite = e.data as GameInviteEvent;
      if (!invite?.game_id) return;
      haptic.medium();
      useGameInviteBanner.getState().show(invite);
      qc.invalidateQueries({ queryKey: qk.notifications });
    });
    return () => {
      off();
      useGameInviteBanner.getState().dismiss();
    };
  }, [enabled, qc]);
}
