import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Check, Crown, Gem, Pencil } from 'lucide-react-native';
import { router } from 'expo-router';

import type { GamePlayer } from '@/api/types';
import { UserPhoto } from '@/components/UserPhoto';
import { PressableScale, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { CountUp } from './Motion';

/** Players ranked by server score. `showScores` is false while a trivia question is open so nothing hints at correctness. */
export function Scoreboard({
  players,
  meId,
  showScores = true,
  markAnswered,
  drawerId,
  guessedIds,
  hostId,
}: {
  players: GamePlayer[];
  meId?: string;
  showScores?: boolean;
  /** Show a tick for players who've answered this question. */
  markAnswered?: boolean;
  drawerId?: string | null;
  guessedIds?: string[];
  hostId?: string | null;
}) {
  const { colors, reduceMotion } = useTheme();
  const list = players.filter((p) => p.active || p.score > 0);
  return (
    <View style={{ gap: space.xs }} accessibilityRole="list" accessibilityLabel="Scoreboard">
      {list.map((p, i) => {
        const mine = p.id === meId;
        const guessed = guessedIds?.includes(p.id);
        const status = p.id === drawerId ? 'drawing' : guessed ? 'guessed it' : markAnswered && p.answered ? 'answered' : null;
        return (
          <Animated.View
            key={p.id}
            layout={reduceMotion ? undefined : LinearTransition.springify().damping(18)}
            style={[styles.row, { backgroundColor: mine ? colors.primarySoft : colors.surface, borderColor: mine ? colors.primary : colors.border, opacity: p.active ? 1 : 0.55 }]}
            accessible
            accessibilityLabel={`${showScores ? `Rank ${i + 1}, ` : ''}${p.display_name}${mine ? ' (you)' : ''}${showScores ? `, ${p.score} points` : ''}${status ? `, ${status}` : ''}${p.active ? '' : ', left the game'}`}
          >
            {showScores ? (
              <Text variant="label" tone="muted" style={{ width: 22, textAlign: 'center' }}>
                {i + 1}
              </Text>
            ) : null}
            <UserPhoto user={p} size={36} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {p.display_name}
                  {mine ? ' (you)' : ''}
                </Text>
                {p.id === hostId ? <Crown size={13} color={colors.gold} /> : null}
              </View>
              {status ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  {p.id === drawerId ? <Pencil size={11} color={colors.accent} /> : <Check size={12} color={colors.success} strokeWidth={3} />}
                  <Text variant="caption" style={{ color: p.id === drawerId ? colors.accent : colors.success }}>
                    {p.id === drawerId ? 'Drawing' : guessed ? 'Guessed it' : 'Answered'}
                  </Text>
                </View>
              ) : !p.active ? (
                <Text variant="caption" tone="faint">
                  Left the game
                </Text>
              ) : null}
            </View>
            {showScores ? <CountUp value={p.score} variant="bodyStrong" tone={mine ? 'primary' : 'default'} /> : null}
          </Animated.View>
        );
      })}
    </View>
  );
}

const MEDALS = ['#FFC857', '#C9CCD6', '#E0A06B'];

/** Top three on stepped blocks, the winner in the middle. */
export function Podium({ players, meId }: { players: GamePlayer[]; meId?: string }) {
  const { colors, reduceMotion } = useTheme();
  const top = players.slice(0, 3);
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
  const heights = { 0: 96, 1: 70, 2: 54 } as Record<number, number>;
  return (
    <View style={styles.podium} accessibilityRole="summary" accessibilityLabel={`Winners: ${top.map((p, i) => `${i + 1}. ${p.display_name}, ${p.score} points`).join('; ')}`}>
      {order.map((p) => {
        const rank = top.indexOf(p);
        return (
          <Animated.View
            key={p.id}
            entering={reduceMotion ? undefined : FadeInDown.delay(300 + (2 - rank) * 220).springify().damping(14)}
            style={styles.podiumCol}
          >
            {rank === 0 ? <Crown size={22} color={colors.gold} fill={colors.gold} /> : null}
            <View style={{ borderRadius: 999, borderWidth: 3, borderColor: MEDALS[rank] }}>
              <UserPhoto user={p} size={rank === 0 ? 72 : 56} />
            </View>
            <Text variant="label" numberOfLines={1} style={{ maxWidth: 96 }}>
              {p.display_name}
              {p.id === meId ? ' (you)' : ''}
            </Text>
            <Text variant="caption" tone="muted">
              {p.score} pts
            </Text>
            <View style={[styles.step, { height: heights[rank], backgroundColor: rank === 0 ? colors.primary : colors.surfaceAlt }]}>
              <Text variant="title" style={{ color: rank === 0 ? colors.onPrimary : colors.textMuted }}>
                {rank + 1}
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
    <PressableScale
      onPress={onPress ?? (() => router.push('/shop'))}
      hapticFeedback="tap"
      accessibilityLabel={`${gems ?? 0} gems. Open the gem shop`}
      style={[styles.gems, { backgroundColor: colors.warningSoft }]}
    >
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
