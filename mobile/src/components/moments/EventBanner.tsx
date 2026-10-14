import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { CalendarHeart, ChevronRight } from 'lucide-react-native';

import { timeLeft, useCurrentEvent } from '@/api/moments-extra';
import { PressableScale, ProgressBar, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

/** Home banner for the active seasonal event. Renders nothing when no event is running. */
export function EventBanner() {
  const { colors } = useTheme();
  const event = useCurrentEvent();
  const e = event.data;
  if (!e) return null;
  const q = e.quest;
  const ready = q.completed && !q.claimed;

  return (
    <PressableScale
      onPress={() => router.push('/event')}
      style={[styles.card, { backgroundColor: `${e.accent}1F`, borderColor: `${e.accent}66` }]}
      accessibilityLabel={`${e.name} event, ${timeLeft(e.ends_at)}. ${q.title}: ${q.progress} of ${q.target}.${ready ? ' Reward ready to claim.' : ''}`}
    >
      <View style={[styles.icon, { backgroundColor: e.accent }]}>
        <CalendarHeart size={20} color="#10111A" />
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
            {e.name}
          </Text>
          <Text variant="caption" tone="muted">
            {timeLeft(e.ends_at)}
          </Text>
        </View>
        {q.claimed ? (
          <Text variant="caption" tone="success">
            Reward claimed — thanks for joining in!
          </Text>
        ) : (
          <>
            <Text variant="caption" tone={ready ? 'success' : 'muted'} numberOfLines={1}>
              {ready ? 'Reward ready — tap to claim' : `${q.title} · ${q.progress}/${q.target}`}
            </Text>
            <ProgressBar value={q.progress / q.target} color={e.accent} height={5} track={colors.surfaceAlt} />
          </>
        )}
      </View>
      <ChevronRight size={18} color={colors.textFaint} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.xl, borderWidth: 1 },
  icon: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
