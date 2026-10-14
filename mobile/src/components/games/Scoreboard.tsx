import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Crown, Gem } from 'lucide-react-native';
import { router } from 'expo-router';

import type { GamePlayer } from '@/api/types';
import { UserPhoto } from '@/components/UserPhoto';
import { PressableScale, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { CountUp } from './Motion';

/** One ranked line of a finished game (rank and score come from the server's `results`). */
export type RankedEntry = { id: string; player: GamePlayer | undefined; rank: number; score: number; label: string };

/** Final standings: rank, real photo, name and the game's score label. */
export function Scoreboard({ entries, meId, hostId }: { entries: RankedEntry[]; meId?: string; hostId?: string | null }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.xs }} accessibilityRole="list" accessibilityLabel="Final standings">
      {entries.map((e) => {
        const mine = e.id === meId;
        const name = e.player?.display_name ?? 'Player';
        return (
          <View
            key={e.id}
            style={[styles.row, { backgroundColor: mine ? colors.primarySoft : colors.surface, borderColor: mine ? colors.primary : colors.border, opacity: e.player?.active === false ? 0.6 : 1 }]}
            accessible
            accessibilityLabel={`Rank ${e.rank}, ${name}${mine ? ' (you)' : ''}, ${e.label}${e.player?.active === false ? ', left the game' : ''}`}
          >
            <Text variant="label" style={{ width: 22, textAlign: 'center', color: e.rank === 1 ? colors.gold : colors.textMuted }}>
              {e.rank}
            </Text>
            <UserPhoto user={e.player} size={36} />
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                {name}
                {mine ? ' (you)' : ''}
              </Text>
              {e.id === hostId ? <Crown size={13} color={colors.gold} /> : null}
            </View>
            <Text variant="label" tone={mine ? 'primary' : 'muted'}>
              {e.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const MEDALS = ['#FFC857', '#C9CCD6', '#E0A06B'];

/** Top three on stepped blocks, the winner in the middle. */
export function Podium({ entries, meId }: { entries: RankedEntry[]; meId?: string }) {
  const { colors, reduceMotion } = useTheme();
  const top = entries.slice(0, 3);
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
  const heights = [96, 70, 54];
  return (
    <View style={styles.podium} accessibilityRole="summary" accessibilityLabel={`Top players: ${top.map((e) => `rank ${e.rank}, ${e.player?.display_name ?? 'Player'}, ${e.label}`).join('; ')}`}>
      {order.map((e) => {
        const place = top.indexOf(e);
        const medal = MEDALS[Math.min(2, e.rank - 1)] ?? MEDALS[2];
        return (
          <Animated.View key={e.id} entering={reduceMotion ? undefined : FadeInDown.delay(300 + (2 - place) * 220).springify().damping(14)} style={styles.podiumCol}>
            {e.rank === 1 ? <Crown size={22} color={colors.gold} fill={colors.gold} /> : null}
            <View style={{ borderRadius: 999, borderWidth: 3, borderColor: medal }}>
              <UserPhoto user={e.player} size={place === 0 ? 72 : 56} />
            </View>
            <Text variant="label" numberOfLines={1} style={{ maxWidth: 96 }}>
              {e.player?.display_name ?? 'Player'}
              {e.id === meId ? ' (you)' : ''}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {e.label}
            </Text>
            <View style={[styles.step, { height: heights[place], backgroundColor: place === 0 ? colors.primary : colors.surfaceAlt }]}>
              <Text variant="title" style={{ color: place === 0 ? colors.onPrimary : colors.textMuted }}>
                {e.rank}
              </Text>
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

/** Gem balance pill; tap opens the shop. Pass `onPress={null}` for a static pill. */
export function GemPill({ gems, onPress }: { gems: number | undefined; onPress?: (() => void) | null }) {
  const { colors } = useTheme();
  const content = (
    <>
      <Gem size={16} color={colors.gold} />
      {gems === undefined ? <Text variant="label" style={{ color: colors.gold }}>…</Text> : <CountUp value={gems} variant="label" style={{ color: colors.gold }} />}
    </>
  );
  if (onPress === null) {
    return (
      <View style={[styles.gems, { backgroundColor: colors.warningSoft }]} accessible accessibilityLabel={`${gems ?? 0} gems`}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale onPress={onPress ?? (() => router.push('/shop'))} hapticFeedback="tap" accessibilityLabel={`${gems ?? 0} gems. Open the gem shop`} style={[styles.gems, { backgroundColor: colors.warningSoft }]}>
      {content}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, minHeight: 56 },
  podium: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: space.md, paddingTop: space.md },
  podiumCol: { alignItems: 'center', gap: 4, width: 100 },
  step: { width: '100%', borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  gems: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, height: 36, borderRadius: radius.pill },
});
