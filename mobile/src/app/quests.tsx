import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { CircleCheck, Flame, Gem, Gift, Shield, Sparkles, Target, Trophy } from 'lucide-react-native';

import { useClaimQuest, useMe, useQuests } from '@/api/hooks';
import type { Quest } from '@/api/types';
import { Confetti } from '@/components/games/Confetti';
import { GrowBar } from '@/components/games/Motion';
import { Badge, Button, Card, EmptyState, ErrorState, Header, RowSkeleton, Screen, SectionHeader, Skeleton, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { plural } from '@/lib/format';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

export default function Quests() {
  const { colors, reduceMotion } = useTheme();
  const me = useMe();
  const quests = useQuests();
  const claim = useClaimQuest();
  const [claiming, setClaiming] = useState<string | null>(null);
  const [burst, setBurst] = useState<number | null>(null);
  const [levelUp, setLevelUp] = useState<number | null>(null);

  const doClaim = (q: Quest) => {
    setClaiming(q.key);
    claim.mutate(q.key, {
      onSuccess: (r) => {
        haptic.success();
        setBurst(Date.now());
        toast.success(`+${r.gems} gems · +${r.xp} XP`, `"${q.title}" complete.`);
        if (r.leveled_up) setLevelUp(r.level);
      },
      onError: (e) => {
        haptic.error();
        toast.error("Couldn't claim that", errorMessage(e));
        quests.refetch();
      },
      onSettled: () => setClaiming(null),
    });
  };

  const list = quests.data ?? [];
  const ready = list.filter((q) => q.completed && !q.claimed);
  const inProgress = list.filter((q) => !q.completed);
  const done = list.filter((q) => q.claimed);
  const streak = me.data?.streak;

  const row = (q: Quest) => {
    const state = q.claimed ? 'claimed' : q.completed ? 'ready' : 'progress';
    return (
      <Animated.View key={q.key} layout={reduceMotion ? undefined : LinearTransition}>
        <Card style={[styles.quest, state === 'ready' && { borderColor: colors.success, backgroundColor: colors.successSoft }]}>
          <View style={[styles.qIcon, { backgroundColor: state === 'ready' ? colors.success : state === 'claimed' ? colors.surfaceAlt : colors.primarySoft }]}>
            {state === 'ready' ? <Gift size={20} color="#FFFFFF" /> : state === 'claimed' ? <CircleCheck size={20} color={colors.textMuted} /> : <Target size={20} color={colors.primary} />}
          </View>
          <View style={{ flex: 1, gap: space.xs }}>
            <Text variant="bodyStrong" tone={state === 'claimed' ? 'muted' : 'default'}>
              {q.title}
            </Text>
            <View style={styles.rewards}>
              <Gem size={12} color={colors.gold} />
              <Text variant="caption" style={{ color: colors.gold }}>
                {q.gems}
              </Text>
              <Sparkles size={12} color={colors.primary} />
              <Text variant="caption" tone="primary">
                {q.xp} XP
              </Text>
              <Text variant="caption" tone="muted">
                · {state === 'claimed' ? 'Claimed' : `${q.progress}/${q.target}`}
              </Text>
            </View>
            {state === 'progress' ? (
              <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: q.target, now: q.progress }}>
                <GrowBar fraction={q.progress / q.target} color={colors.primary} height={6} />
              </View>
            ) : null}
          </View>
          {state === 'ready' ? (
            <Button title="Claim" size="sm" onPress={() => doClaim(q)} loading={claiming === q.key} disabled={!!claiming && claiming !== q.key} accessibilityLabel={`Claim ${q.gems} gems and ${q.xp} XP for ${q.title}`} />
          ) : null}
        </Card>
      </Animated.View>
    );
  };

  return (
    <Screen scroll refreshing={quests.isRefetching && !quests.isLoading} onRefresh={() => { quests.refetch(); me.refetch(); }} header={<Header title="Quests" />}>
      {/* Streak */}
      {me.isLoading ? (
        <Skeleton height={150} rounded={radius.xl} />
      ) : streak ? (
        <Card style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={[styles.flame, { backgroundColor: colors.accentSoft }]}>
              <Flame size={28} color={colors.accent} fill={streak.active_today ? colors.accent : 'transparent'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="title">{plural(streak.current, 'day')}</Text>
              <Text variant="caption" tone="muted">
                {streak.active_today ? 'You’ve been here today — streak safe.' : streak.current ? 'Hang out, play or answer the daily question to keep it going.' : 'Do anything fun today to start a streak.'}
              </Text>
            </View>
          </View>
          <View style={styles.stats}>
            <View style={[styles.stat, { backgroundColor: colors.surfaceAlt }]} accessible accessibilityLabel={`Best streak ${streak.best} days`}>
              <Trophy size={16} color={colors.gold} />
              <Text variant="bodyStrong">{streak.best}</Text>
              <Text variant="caption" tone="muted">
                Best
              </Text>
            </View>
            <View style={[styles.stat, { backgroundColor: colors.surfaceAlt }]} accessible accessibilityLabel={`${streak.freezes} streak freezes`}>
              <Shield size={16} color={colors.primary} />
              <Text variant="bodyStrong">{streak.freezes}</Text>
              <Text variant="caption" tone="muted">
                Freezes
              </Text>
            </View>
          </View>
          <Text variant="caption" tone="muted">
            Life happens. A freeze protects your streak if you miss a day, and you earn one every 7 days in a row (up to 3). No pressure — streaks are just for fun.
          </Text>
        </Card>
      ) : null}

      {levelUp ? (
        <Animated.View entering={reduceMotion ? undefined : FadeIn} style={[styles.levelUp, { backgroundColor: colors.primary }]} accessibilityLiveRegion="assertive">
          <Sparkles size={20} color={colors.onPrimary} />
          <Text variant="heading" style={{ color: colors.onPrimary, flex: 1 }}>
            Level up! You're now level {levelUp}.
          </Text>
          <Button title="Nice" size="sm" variant="secondary" onPress={() => setLevelUp(null)} />
        </Animated.View>
      ) : null}

      <View style={{ marginTop: space.xl, gap: space.xl }}>
        {quests.isLoading ? (
          <RowSkeleton count={5} />
        ) : quests.isError ? (
          <ErrorState error={quests.error} onRetry={() => quests.refetch()} />
        ) : !list.length ? (
          <EmptyState icon={Target} title="No quests right now" message="Check back soon." />
        ) : (
          <>
            {ready.length ? (
              <View>
                <SectionHeader title="Ready to claim" />
                <View style={{ gap: space.sm }}>{ready.map(row)}</View>
              </View>
            ) : null}
            {inProgress.length ? (
              <View>
                <SectionHeader title="In progress" subtitle="Progress updates as you hang out, play and chat." />
                <View style={{ gap: space.sm }}>{inProgress.map(row)}</View>
              </View>
            ) : null}
            {done.length ? (
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md }}>
                  <Text variant="heading">Completed</Text>
                  <Badge label={`${done.length}`} tone="neutral" />
                </View>
                <View style={{ gap: space.sm }}>{done.map(row)}</View>
              </View>
            ) : null}
          </>
        )}
      </View>
      <Confetti burstKey={burst} originY={0.2} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  quest: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  qIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rewards: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  flame: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg },
  levelUp: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, marginTop: space.lg },
});
