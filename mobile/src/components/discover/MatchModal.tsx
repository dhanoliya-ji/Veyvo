import { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { router, type Href } from 'expo-router';
import { Gamepad2, MessageCircle, Video } from 'lucide-react-native';
import { create } from 'zustand';

import { qk, startCallRequest, useMe, useStartConversation } from '@/api/hooks';
import type { MatchEvent } from '@/api/discover-extra';
import { UserPhoto } from '@/components/UserPhoto';
import { Button, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/queryClient';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

type MatchState = {
  match: MatchEvent | null;
  /** Friend ids shown recently, so the swipe response and the realtime event don't both open the modal. */
  recent: Record<string, number>;
  /** Screens that render their own host (Friend Swipe) — the global host stays quiet while one is mounted. */
  localHosts: number;
  show: (m: MatchEvent) => void;
  close: () => void;
  addLocal: (delta: number) => void;
};

const useMatchStore = create<MatchState>((set, get) => ({
  match: null,
  recent: {},
  localHosts: 0,
  show: (m) => {
    const now = Date.now();
    const seen = get().recent[m.friend.id];
    if (seen && now - seen < 15_000) {
      // Same match again (e.g. realtime event after the swipe response): keep the newer conversation id.
      if (m.conversation_id && get().match?.friend.id === m.friend.id) set({ match: { ...get().match!, conversation_id: m.conversation_id } });
      return;
    }
    haptic.success();
    set({ match: m, recent: { ...get().recent, [m.friend.id]: now } });
  },
  close: () => set({ match: null }),
  addLocal: (delta) => set({ localHosts: get().localHosts + delta }),
}));

/** Show the "It's a match!" celebration from anywhere. */
export const showMatch = (m: MatchEvent) => useMatchStore.getState().show(m);

/**
 * Renders the match celebration. Mount one globally (`<MatchModalHost />`); screens that want it even when
 * the global one isn't mounted can render `<MatchModalHost local />`.
 */
export function MatchModalHost({ local, onKeepSwiping }: { local?: boolean; onKeepSwiping?: () => void }) {
  const match = useMatchStore((s) => s.match);
  const localHosts = useMatchStore((s) => s.localHosts);
  const close = useMatchStore((s) => s.close);
  const addLocal = useMatchStore((s) => s.addLocal);

  useEffect(() => {
    if (!local) return;
    addLocal(1);
    return () => addLocal(-1);
  }, [local, addLocal]);

  if (!local && localHosts > 0) return null;
  return (
    <MatchModal
      match={match}
      onClose={close}
      onKeepSwiping={() => {
        close();
        onKeepSwiping?.();
      }}
    />
  );
}

function MatchModal({ match, onClose, onKeepSwiping }: { match: MatchEvent | null; onClose: () => void; onKeepSwiping: () => void }) {
  const { colors, reduceMotion } = useTheme();
  const me = useMe();
  const start = useStartConversation();
  const [calling, setCalling] = useState(false);
  const friend = match?.friend;

  const openChat = async () => {
    if (!friend) return;
    try {
      let id = match?.conversation_id;
      if (!id) {
        const conv = await start.mutateAsync(friend.id);
        queryClient.setQueryData(qk.conversation(conv.id), conv);
        id = conv.id;
      }
      onClose();
      router.push(`/messages/${id}`);
    } catch (e) {
      toast.error("Couldn't open chat", errorMessage(e));
    }
  };

  const call = async () => {
    if (!friend || calling) return;
    setCalling(true);
    try {
      const room = await startCallRequest(friend.id);
      haptic.medium();
      onClose();
      router.push(`/room/${room.id}`);
    } catch (e) {
      toast.error(`Couldn't call ${friend.display_name}`, errorMessage(e));
    } finally {
      setCalling(false);
    }
  };

  const play = () => {
    onClose();
    router.push('/(tabs)/games' as Href);
  };

  return (
    <Modal transparent visible={!!friend} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        {friend ? (
          <Animated.View
            entering={reduceMotion ? undefined : ZoomIn.springify().damping(16)}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            accessibilityViewIsModal
            accessibilityLiveRegion="polite"
          >
            <Animated.View entering={reduceMotion ? undefined : FadeIn.delay(120)} style={styles.photos}>
              <View style={[styles.photoRing, { borderColor: colors.primary, transform: [{ rotate: '-6deg' }] }]}>
                <UserPhoto user={me.data} size={96} showVerified={false} />
              </View>
              <View style={[styles.photoRing, { borderColor: colors.accent, marginLeft: -18, transform: [{ rotate: '6deg' }] }]}>
                <UserPhoto user={friend} size={96} />
              </View>
            </Animated.View>
            <Text variant="display" center accessibilityRole="header">
              It's a match!
            </Text>
            <Text variant="subheading" center>
              You and {friend.display_name} are now friends 🎉
            </Text>
            <Text tone="muted" center style={{ maxWidth: 300 }}>
              Friends, not dating. Say hi, hop on a call or play a game together.
            </Text>
            <View style={{ gap: space.sm, alignSelf: 'stretch', marginTop: space.md }}>
              <Button title="Say hi" icon={MessageCircle} onPress={openChat} loading={start.isPending} fullWidth />
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button title="Video call" icon={Video} variant="secondary" onPress={call} loading={calling} style={{ flex: 1 }} />
                <Button title="Play a game" icon={Gamepad2} variant="secondary" onPress={play} style={{ flex: 1 }} />
              </View>
              <Button title="Keep swiping" variant="ghost" onPress={onKeepSwiping} fullWidth />
            </View>
          </Animated.View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  card: { width: '100%', maxWidth: 420, alignItems: 'center', gap: space.sm, padding: space.xxl, borderRadius: radius.xxl, borderWidth: StyleSheet.hairlineWidth },
  photos: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  photoRing: { borderWidth: 3, borderRadius: 60, padding: 3 },
});
