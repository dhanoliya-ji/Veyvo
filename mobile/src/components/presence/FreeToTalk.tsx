import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FREE_OPTIONS, minutesLeft, useSetFree } from '@/api/connect-extra';
import { useMe } from '@/api/hooks';
import { Button, Chip, PressableScale, Sheet, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const label = (m: number) => (m >= 60 ? `${m / 60} hour${m > 60 ? 's' : ''}` : `${m} min`);

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** "Free to talk 🟢" chip: tap to tell friends you're up for a call for a while. Only friends see it. */
export function FreeToTalk() {
  const { colors } = useTheme();
  const me = useMe();
  const setFree = useSetFree();
  const [open, setOpen] = useState(false);
  useNow();
  const left = minutesLeft(me.data?.free_until);
  const free = left > 0;

  const choose = async (minutes: 0 | 15 | 30 | 60 | 120) => {
    setOpen(false);
    try {
      await setFree.mutateAsync(minutes);
      haptic.success();
      toast.show(
        minutes
          ? {
              title: `You're free to talk for ${label(minutes)} 🟢`,
              message: 'Your friends can see it.',
              tone: 'success',
            }
          : { title: 'Free to talk is off' },
      );
    } catch (e) {
      toast.error("Couldn't update", errorMessage(e));
    }
  };

  return (
    <>
      <PressableScale
        onPress={() => setOpen(true)}
        accessibilityLabel={free ? `Free to talk, ${left} minutes left. Change` : 'Set yourself free to talk'}
        style={[
          styles.chip,
          {
            backgroundColor: free ? colors.successSoft : colors.surfaceAlt,
            borderColor: free ? colors.success : colors.border,
          },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: free ? colors.success : colors.textFaint }]} />
        <Text variant="label" style={{ color: free ? colors.success : colors.textMuted }}>
          {free ? `Free to talk · ${left < 60 ? `${left}m` : `${Math.round(left / 60)}h`} left` : 'Free to talk?'}
        </Text>
      </PressableScale>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Free to talk 🟢">
        <Text tone="muted" style={{ marginBottom: space.md }}>
          Let your friends know you're up for a call or a game. Only friends see it, and nobody gets a notification.
        </Text>
        <View style={styles.options}>
          {FREE_OPTIONS.map((m) => (
            <Chip key={m} label={label(m)} tone="success" selected={false} onPress={() => choose(m)} />
          ))}
        </View>
        {free ? <Button title="I'm not free anymore" variant="secondary" onPress={() => choose(0)} style={{ marginTop: space.lg }} /> : null}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'flex-start',
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
