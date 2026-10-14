import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { CircleCheck, CircleX, Clock, Lock } from 'lucide-react-native';

import { isApiError } from '@/api/games-extra';
import { useGameActions } from '@/api/hooks';
import { Badge, PressableScale, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { Confetti } from './Confetti';
import { PhaseCountdown, RoundTimer, type GameCtx } from './GameParts';
import { CountUp, GrowBar, Pulse } from './Motion';
import { Scoreboard } from './Scoreboard';

const LETTERS = ['A', 'B', 'C', 'D'];

export function TriviaRound({ ctx }: { ctx: GameCtx }) {
  const { colors, reduceMotion } = useTheme();
  const { game, meId, offset, isPlayer, roundGain } = ctx;
  const round = game.round!;
  const actions = useGameActions(game.id);
  const [picked, setPicked] = useState<{ round: number; choice: number } | null>(null);
  const [closed, setClosed] = useState<number | null>(null);
  const revealedFor = useRef<number | null>(null);
  const [burst, setBurst] = useState<number | null>(null);

  const active = game.players.filter((p) => p.active);
  const myChoice = round.my_answer ?? (picked?.round === round.index ? picked.choice : null);
  const revealed = round.phase === 'reveal' || round.phase === 'round_end';
  const settings = game.settings;

  // Celebrate (or commiserate) once per reveal, using only the server's verdict.
  useEffect(() => {
    if (!revealed || round.correct_index === null || revealedFor.current === round.index) return;
    revealedFor.current = round.index;
    if (round.my_answer === null) return;
    if (round.my_answer === round.correct_index) {
      haptic.success();
      setBurst(round.index);
    } else {
      haptic.warning();
    }
  }, [revealed, round.correct_index, round.index, round.my_answer]);

  const answer = (choice: number) => {
    if (!isPlayer || myChoice !== null || closed === round.index) return;
    haptic.medium();
    setPicked({ round: round.index, choice });
    actions.answer.mutate(
      { round_index: round.index, choice },
      {
        onError: (e) => {
          if (isApiError(e, 409, 'already_answered')) return;
          setPicked(null);
          if (isApiError(e, 409)) {
            setClosed(round.index);
            toast.show({ title: 'Too late', message: 'This question has closed.', tone: 'warning' });
          } else {
            haptic.error();
            toast.error("Your answer didn't go through", errorMessage(e));
          }
          ctx.refetch();
        },
      },
    );
  };

  if (round.phase === 'countdown') {
    return (
      <View style={{ gap: space.xl }}>
        <PhaseCountdown
          game={game}
          offset={offset}
          title={`Question ${round.index + 1} of ${round.total}`}
          subtitle={round.category ? `Category: ${round.category}` : 'Get ready!'}
        />
        {round.index > 0 ? (
          <View style={{ gap: space.md }}>
            <Text variant="heading">Scores</Text>
            <Scoreboard players={game.players} meId={meId} hostId={game.host_id} />
          </View>
        ) : null}
      </View>
    );
  }

  const options = round.options ?? [];
  const counts = round.answer_counts ?? [];
  const totalAnswers = counts.reduce((a, b) => a + b, 0);
  const locked = myChoice !== null;

  return (
    <View style={{ gap: space.lg }}>
      {revealed ? (
        <Text variant="label" tone="muted">
          Question {round.index + 1} of {round.total} · {round.index + 1 >= round.total ? 'Final results next' : 'Next question soon'}
        </Text>
      ) : (
        <RoundTimer game={game} offset={offset} phaseSeconds={settings.question_seconds ?? 15} label={`Question ${round.index + 1} of ${round.total}`} />
      )}

      <Animated.View key={`q${round.index}`} entering={reduceMotion ? undefined : FadeInDown.duration(260)} style={{ gap: space.sm }}>
        {round.category ? <Badge label={round.category} tone="accent" /> : null}
        <Text variant="title" accessibilityRole="header">
          {round.question}
        </Text>
      </Animated.View>

      <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
        {options.map((opt, i) => {
          const isMine = myChoice === i;
          const isCorrect = revealed && round.correct_index === i;
          const isWrongPick = revealed && isMine && round.correct_index !== i;
          const bg = isCorrect ? colors.successSoft : isWrongPick ? colors.dangerSoft : isMine ? colors.primarySoft : colors.surface;
          const border = isCorrect ? colors.success : isWrongPick ? colors.danger : isMine ? colors.primary : colors.border;
          const dim = (locked && !isMine && !revealed) || (revealed && !isCorrect && !isMine);
          const status = isCorrect ? (isMine ? 'Correct — your answer' : 'Correct answer') : isWrongPick ? 'Your answer' : isMine && !revealed ? 'Locked in' : null;
          return (
            <Pulse key={i} pulseKey={isMine ? `${round.index}-${i}` : null}>
              <PressableScale
                onPress={() => answer(i)}
                disabled={!isPlayer || revealed || (locked && !isMine) || closed === round.index}
                hapticFeedback={false}
                accessibilityRole="radio"
                accessibilityState={{ selected: isMine, disabled: !isPlayer || revealed || locked }}
                accessibilityLabel={`${LETTERS[i]}: ${opt}${status ? `. ${status}` : ''}${revealed && counts.length ? `. ${counts[i] ?? 0} picked this` : ''}`}
                style={[styles.option, { backgroundColor: bg, borderColor: border, opacity: dim ? 0.6 : 1 }]}
              >
                <View style={[styles.letter, { backgroundColor: isCorrect ? colors.success : isWrongPick ? colors.danger : isMine ? colors.primary : colors.surfaceAlt }]}>
                  {isCorrect ? (
                    <CircleCheck size={18} color="#FFFFFF" />
                  ) : isWrongPick ? (
                    <CircleX size={18} color="#FFFFFF" />
                  ) : isMine ? (
                    <Lock size={15} color={colors.onPrimary} />
                  ) : (
                    <Text variant="label">{LETTERS[i]}</Text>
                  )}
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="bodyStrong">{opt}</Text>
                  {status ? (
                    <Text variant="caption" style={{ color: border }}>
                      {status}
                    </Text>
                  ) : null}
                  {revealed && counts.length ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                      <View style={{ flex: 1 }}>
                        <GrowBar fraction={totalAnswers ? (counts[i] ?? 0) / totalAnswers : 0} color={isCorrect ? colors.success : isWrongPick ? colors.danger : colors.textFaint} height={6} delay={i * 80} />
                      </View>
                      <Text variant="caption" tone="muted" style={{ minWidth: 18, textAlign: 'right' }}>
                        {counts[i] ?? 0}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </PressableScale>
            </Pulse>
          );
        })}
      </View>

      {!revealed ? (
        <View style={[styles.waiting, { backgroundColor: colors.surfaceAlt }]} accessibilityLiveRegion="polite">
          {locked ? <Lock size={16} color={colors.primary} /> : <Clock size={16} color={colors.textMuted} />}
          <Text variant="label" tone={locked ? 'primary' : 'muted'} style={{ flex: 1 }}>
            {!isPlayer ? 'Join to answer the next question.' : locked ? 'Locked in! Waiting for the others…' : closed === round.index ? 'This question has closed.' : 'Pick an answer'}
          </Text>
          <Text variant="label" tone="muted">
            {round.answered_count} of {active.length} answered
          </Text>
        </View>
      ) : (
        <Animated.View entering={reduceMotion ? undefined : FadeIn.delay(250)} style={[styles.result, { backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityLiveRegion="polite">
          {round.my_answer === null ? (
            <Text variant="heading" tone="muted">
              {isPlayer ? 'No answer this time' : 'Answer revealed'}
            </Text>
          ) : round.my_answer === round.correct_index ? (
            <>
              <CircleCheck size={22} color={colors.success} />
              <Text variant="heading" tone="success">
                Correct!
              </Text>
              {roundGain !== null && roundGain > 0 ? <CountUp value={roundGain} prefix="+" suffix=" points" variant="heading" tone="success" /> : null}
            </>
          ) : (
            <>
              <CircleX size={22} color={colors.danger} />
              <Text variant="heading">Not this time</Text>
              <Text variant="label" tone="muted">
                +0 points
              </Text>
            </>
          )}
        </Animated.View>
      )}

      {revealed ? (
        <View style={{ gap: space.md }}>
          <Text variant="heading">Scores</Text>
          <Scoreboard players={game.players} meId={meId} hostId={game.host_id} />
        </View>
      ) : (
        <Scoreboard players={game.players} meId={meId} showScores={false} markAnswered hostId={game.host_id} />
      )}
      <Confetti burstKey={burst} />
    </View>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingVertical: space.md, paddingHorizontal: space.md, borderRadius: radius.lg, borderWidth: 2 },
  letter: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg },
  result: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, flexWrap: 'wrap' },
});
