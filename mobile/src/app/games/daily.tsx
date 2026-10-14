import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { CalendarClock, Check, Gem, Sparkles } from 'lucide-react-native';

import { hoursMinutes, isApiError, msUntilUtcMidnight, useNow } from '@/api/games-extra';
import { useAnswerDaily, useDaily } from '@/api/hooks';
import { Confetti } from '@/components/games/Confetti';
import { GrowBar } from '@/components/games/Motion';
import { Card, ErrorState, Header, PressableScale, Screen, Skeleton, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { plural } from '@/lib/format';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

export default function DailyQuestion() {
  const { colors, reduceMotion } = useTheme();
  const daily = useDaily();
  const answer = useAnswerDaily();
  const [pending, setPending] = useState<number | null>(null);
  const [burst, setBurst] = useState<number | null>(null);
  const now = useNow(1000);
  const d = daily.data;

  const pick = (choice: number) => {
    if (answer.isPending || !d || d.my_choice !== null) return;
    haptic.medium();
    setPending(choice);
    answer.mutate(choice, {
      onSuccess: (res) => {
        haptic.success();
        setBurst(Date.now());
        if (res.reward) {
          toast.success(`+${res.reward.gems} gems`, res.reward.leveled_up ? `Level up! You're now level ${res.reward.level}.` : 'Thanks for answering today’s question.');
        }
      },
      onError: (e) => {
        if (isApiError(e, 409)) daily.refetch();
        else {
          haptic.error();
          toast.error("Couldn't save your answer", errorMessage(e));
        }
      },
      onSettled: () => setPending(null),
    });
  };

  let body;
  if (daily.isLoading) {
    body = (
      <View style={{ gap: space.md }}>
        <Skeleton height={60} />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={60} rounded={radius.lg} />
        ))}
      </View>
    );
  } else if (daily.isError || !d) {
    body = <ErrorState error={daily.error} onRetry={() => daily.refetch()} />;
  } else {
    const answered = d.my_choice !== null && d.results !== null;
    const total = d.total ?? 0;
    const pct = (i: number) => (total ? Math.round(((d.results?.[i] ?? 0) / total) * 100) : 0);
    const mine = d.my_choice;
    const others = mine !== null ? pct(mine) : 0;

    body = (
      <View style={{ gap: space.xl }}>
        <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(260)} style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Sparkles size={16} color={colors.gold} />
            <Text variant="label" tone="muted">
              {new Date(`${d.day}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })}
            </Text>
          </View>
          <Text variant="title" accessibilityRole="header">
            {d.question}
          </Text>
          {!answered ? (
            <Text tone="muted">Pick one to see how everyone else answered. +10 gems for taking part.</Text>
          ) : null}
        </Animated.View>

        <View style={{ gap: space.sm }} accessibilityRole={answered ? 'list' : 'radiogroup'}>
          {d.options.map((opt, i) => {
            if (!answered) {
              const busy = pending === i;
              return (
                <PressableScale
                  key={i}
                  onPress={() => pick(i)}
                  disabled={answer.isPending}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: busy, busy }}
                  accessibilityLabel={opt}
                  style={[styles.option, { backgroundColor: busy ? colors.primarySoft : colors.surface, borderColor: busy ? colors.primary : colors.border }]}
                >
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {opt}
                  </Text>
                </PressableScale>
              );
            }
            const isMine = mine === i;
            return (
              <View
                key={i}
                style={[styles.result, { backgroundColor: isMine ? colors.primarySoft : colors.surface, borderColor: isMine ? colors.primary : colors.border }]}
                accessible
                accessibilityLabel={`${opt}: ${pct(i)} percent${isMine ? ', your pick' : ''}`}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  {isMine ? <Check size={16} color={colors.primary} strokeWidth={3} /> : null}
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {opt}
                  </Text>
                  <Text variant="bodyStrong" tone={isMine ? 'primary' : 'muted'}>
                    {pct(i)}%
                  </Text>
                </View>
                {isMine ? (
                  <Text variant="caption" tone="primary">
                    Your pick
                  </Text>
                ) : null}
                <GrowBar fraction={pct(i) / 100} color={isMine ? colors.primary : colors.textFaint} delay={i * 90} />
              </View>
            );
          })}
        </View>

        {answered && mine !== null ? (
          <Animated.View entering={reduceMotion ? undefined : FadeIn.delay(400)} style={{ gap: space.lg }}>
            <Card style={{ gap: space.xs }}>
              <Text variant="heading">
                {others === 100 && total > 1 ? 'Everyone agrees with you so far!' : `You and ${others}% of people chose "${d.options[mine]}".`}
              </Text>
              <Text variant="caption" tone="muted">
                {plural(total, 'answer')} so far today.
              </Text>
            </Card>
            <View style={[styles.reward, { backgroundColor: colors.warningSoft }]}>
              <Gem size={18} color={colors.gold} />
              <Text variant="label" style={{ color: colors.gold, flex: 1 }}>
                Daily reward collected: +10 gems
              </Text>
            </View>
            <View style={[styles.reward, { backgroundColor: colors.surfaceAlt }]} accessibilityLabel={`Come back tomorrow for a new question. Next one in ${hoursMinutes(msUntilUtcMidnight(now))}`}>
              <CalendarClock size={18} color={colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text variant="label">Come back tomorrow for a new question</Text>
                <Text variant="caption" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
                  Next one in {hoursMinutes(msUntilUtcMidnight(now))}
                </Text>
              </View>
            </View>
          </Animated.View>
        ) : null}
      </View>
    );
  }

  return (
    <Screen scroll refreshing={daily.isRefetching && !daily.isLoading} onRefresh={() => daily.refetch()} header={<Header title="Daily question" />}>
      {body}
      <Confetti burstKey={burst} originY={0.3} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  option: { minHeight: 60, paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.lg, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center' },
  result: { padding: space.md, borderRadius: radius.lg, borderWidth: 1.5, gap: space.sm },
  reward: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg },
});
