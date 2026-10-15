import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { X } from 'lucide-react-native';
import { create } from 'zustand';

import { startCallWithFormat, waveRequest } from '@/api/connect-extra';
import type { UserSummary } from '@/api/types';
import { UserPhoto } from '@/components/UserPhoto';
import { Button, IconButton, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

export type NudgeKind = 'wave' | 'matched' | 'free';
export type Nudge = { id: number; kind: NudgeKind; user: UserSummary };

type NudgeState = {
  nudge: Nudge | null;
  show: (kind: NudgeKind, user: UserSummary) => void;
  dismiss: () => void;
};

let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;

export const useNudges = create<NudgeState>((set) => ({
  nudge: null,
  show: (kind, user) => {
    const id = nextId++;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => set((s) => (s.nudge?.id === id ? { nudge: null } : s)), 8000);
    set({ nudge: { id, kind, user } });
  },
  dismiss: () => set({ nudge: null }),
}));

const TEXT: Record<NudgeKind, (name: string) => { title: string; message: string }> = {
  wave: (n) => ({
    title: `${n} waved at you 👋`,
    message: 'Wave back and it’s a match.',
  }),
  matched: (n) => ({
    title: `You and ${n} both waved!`,
    message: 'Perfect time for a quick call.',
  }),
  free: (n) => ({
    title: `${n} is free to talk 🟢`,
    message: 'Say hi while they’re around.',
  }),
};

/** Toast-like card with actions (Wave back / Call) for waves and "free to talk". Mounted once at the root. */
export function PresenceNudges() {
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { nudge, dismiss } = useNudges();
  const [busy, setBusy] = useState(false);
  if (!nudge) return null;
  const { user, kind } = nudge;
  const { title, message } = TEXT[kind](user.display_name);

  const act = async (fn: () => Promise<void>, fail: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      dismiss();
    } catch (e) {
      toast.error(fail, errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const waveBack = () =>
    act(async () => {
      const res = await waveRequest(user.id);
      haptic.success();
      if (!res.matched)
        toast.show({
          title: `You waved at ${user.display_name} 👋`,
          tone: 'success',
        });
    }, "Couldn't wave");
  const call = () =>
    act(async () => {
      const room = await startCallWithFormat(user.id, 'voice');
      haptic.medium();
      router.push(`/room/${room.id}`);
    }, `Couldn't call ${user.display_name}`);

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + space.sm }]}>
      <Animated.View
        key={nudge.id}
        entering={reduceMotion ? undefined : FadeInUp.springify().damping(18)}
        exiting={reduceMotion ? undefined : FadeOutUp.duration(160)}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[
          styles.card,
          {
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.border,
            shadowColor: colors.shadow,
          },
        ]}
      >
        <View style={styles.top}>
          <UserPhoto user={user} size={40} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">{title}</Text>
            <Text variant="caption" tone="muted">
              {message}
            </Text>
          </View>
          <IconButton icon={X} label="Dismiss" onPress={dismiss} size={36} />
        </View>
        <View style={styles.actions}>
          {kind === 'wave' ? <Button title="Wave back 👋" variant="secondary" size="sm" onPress={waveBack} disabled={busy} style={{ flex: 1 }} /> : null}
          <Button title="Call" size="sm" onPress={call} disabled={busy} style={{ flex: 1 }} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, zIndex: 1001 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
    elevation: 6,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  actions: { flexDirection: 'row', gap: space.sm },
});
