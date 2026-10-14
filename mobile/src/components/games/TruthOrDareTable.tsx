import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Check, Flame, MessageCircleQuestion, SkipForward, Sparkles } from 'lucide-react-native';

import { canDo, type TruthOrDareBoardView } from '@/api/games-extra';
import { UserPhoto } from '@/components/UserPhoto';
import { Button, PressableScale, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space } from '@/theme/tokens';
import { nameOf, playerOf, TurnBanner, usePulse, type GameCtx } from './GameParts';

const TRUTH = '#3BA3FF';
const DARE = '#FF4D6D';
const GOLD = '#E6C77A';

function CardSurface({ width, height, from, to }: { width: number; height: number; from: string; to: string }) {
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="todGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} rx={24} fill="url(#todGrad)" />
      <Rect x={10} y={10} width={width - 20} height={height - 20} rx={18} fill="none" stroke={GOLD} strokeOpacity={0.55} strokeWidth={1.2} />
    </Svg>
  );
}

/** Big prompt card that flips over when a prompt is drawn. */
function PromptCard({ prompt }: { prompt: TruthOrDareBoardView['prompt'] }) {
  const { reduceMotion } = useTheme();
  const { width: screen } = useWindowDimensions();
  const w = Math.min(420, screen - screenPadding * 2);
  const h = Math.round(w * 0.78);
  const rot = useSharedValue(prompt ? 180 : 0);
  const showFront = !!prompt;
  useEffect(() => {
    const target = showFront ? 180 : 0;
    rot.value = reduceMotion ? target : withTiming(target, { duration: 520, easing: Easing.out(Easing.cubic) });
  }, [showFront, prompt?.id, reduceMotion, rot]);
  const backStyle = useAnimatedStyle(() => ({ transform: [{ perspective: 1000 }, { rotateY: `${rot.value}deg` }] }));
  const frontStyle = useAnimatedStyle(() => ({ transform: [{ perspective: 1000 }, { rotateY: `${rot.value - 180}deg` }] }));
  const tint = prompt?.kind === 'dare' ? DARE : TRUTH;
  return (
    <View style={{ width: w, height: h, alignSelf: 'center' }} accessible accessibilityLiveRegion="polite" accessibilityLabel={prompt ? `${prompt.kind}: ${prompt.text}` : 'Truth or dare card, face down'}>
      <Animated.View style={[styles.face, { width: w, height: h }, backStyle]}>
        <CardSurface width={w} height={h} from="#2A1E4A" to="#120C22" />
        <Sparkles size={28} color={GOLD} />
        <Text style={[styles.backTitle, { color: '#F6EFD9' }]}>Truth</Text>
        <Text variant="label" style={{ color: GOLD, letterSpacing: 4 }}>
          OR
        </Text>
        <Text style={[styles.backTitle, { color: '#F6EFD9' }]}>Dare</Text>
      </Animated.View>
      <Animated.View style={[styles.face, { width: w, height: h }, frontStyle]}>
        <CardSurface width={w} height={h} from="#FFFDF7" to="#F1EADB" />
        <View style={[styles.kindPill, { backgroundColor: tint }]}>
          {prompt?.kind === 'dare' ? <Flame size={14} color="#fff" /> : <MessageCircleQuestion size={14} color="#fff" />}
          <Text variant="tiny" style={{ color: '#fff', letterSpacing: 2 }}>
            {prompt?.kind === 'dare' ? 'DARE' : 'TRUTH'}
          </Text>
        </View>
        <Text style={styles.promptText} maxFontSizeMultiplier={1.3}>
          {prompt?.text ?? ''}
        </Text>
        {prompt?.pack ? (
          <Text variant="tiny" style={{ color: '#8A7F69', textTransform: 'uppercase', letterSpacing: 1.5 }}>
            {prompt.pack.replace('_', ' ')} pack
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

export function TruthOrDareTable({ ctx }: { ctx: GameCtx }) {
  const { colors } = useTheme();
  const { game, meId, readOnly, pending } = ctx;
  const view = game.board as TruthOrDareBoardView;
  const current = playerOf(game, view.turn);
  const myTurn = !readOnly && view.status === 'active' && view.turn === meId;
  const canChoose = myTurn && canDo(game, 'choose');
  const canDone = myTurn && canDo(game, 'done');
  const canSkip = myTurn && canDo(game, 'skip');
  const skipsLeft = view.turn ? (view.skips_left[view.turn] ?? 0) : 0;
  const glow = usePulse(view.status === 'active', 0.05, 900);
  const ranked = [...view.players].sort((a, b) => (view.scores[b] ?? 0) - (view.scores[a] ?? 0));

  const status =
    view.status !== 'active'
      ? 'Game over'
      : myTurn
        ? view.phase === 'choose'
          ? 'Your turn: truth or dare?'
          : view.prompt?.kind === 'dare'
            ? 'Do the dare, then tap Done'
            : 'Answer honestly, then tap Done'
        : view.phase === 'choose'
          ? `${nameOf(ctx, view.turn)} is choosing…`
          : `${nameOf(ctx, view.turn)} is on a ${view.prompt?.kind ?? 'prompt'}`;

  return (
    <View style={{ gap: space.lg }}>
      {!readOnly ? <TurnBanner mine={myTurn} text={status} right={<Text variant="label" tone="muted">Round {view.round}/{view.rounds}</Text>} /> : null}

      {view.status === 'active' && current ? (
        <View style={styles.spotlight} accessible accessibilityLabel={`Spotlight on ${nameOf(ctx, view.turn)}`}>
          <Animated.View style={[styles.spotRing, { borderColor: view.prompt?.kind === 'dare' ? DARE : TRUTH }, glow]}>
            <UserPhoto user={current} size={92} />
          </Animated.View>
          <Text variant="heading">{view.turn === meId ? 'You' : current.display_name}</Text>
          <Text variant="caption" tone="muted">
            {skipsLeft} skip{skipsLeft === 1 ? '' : 's'} left · {view.scores[view.turn ?? ''] ?? 0} done
          </Text>
        </View>
      ) : null}

      {view.status === 'active' ? <PromptCard prompt={view.prompt} /> : null}

      {canChoose ? (
        <View style={styles.choiceRow}>
          <PressableScale onPress={() => ctx.act({ type: 'choose', kind: 'truth' })} disabled={pending} hapticFeedback="medium" accessibilityRole="button" accessibilityLabel="Truth" style={[styles.choice, { backgroundColor: TRUTH }]}>
            <MessageCircleQuestion size={26} color="#fff" />
            <Text variant="heading" style={{ color: '#fff' }}>
              Truth
            </Text>
          </PressableScale>
          <PressableScale onPress={() => ctx.act({ type: 'choose', kind: 'dare' })} disabled={pending} hapticFeedback="medium" accessibilityRole="button" accessibilityLabel="Dare" style={[styles.choice, { backgroundColor: DARE }]}>
            <Flame size={26} color="#fff" />
            <Text variant="heading" style={{ color: '#fff' }}>
              Dare
            </Text>
          </PressableScale>
        </View>
      ) : null}

      {canDone || canSkip ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {canDone ? <Button title="Done (+1)" icon={Check} size="lg" onPress={() => ctx.act({ type: 'done' })} disabled={pending} style={{ flex: 1.4 }} /> : null}
          <Button
            title={`Skip (${view.skips_left[meId] ?? 0} left)`}
            icon={SkipForward}
            size="lg"
            variant="secondary"
            onPress={() => ctx.act({ type: 'skip' })}
            disabled={pending || !canSkip}
            style={{ flex: 1 }}
            accessibilityHint={canSkip ? undefined : 'No skips left'}
          />
        </View>
      ) : null}

      <View style={{ gap: space.xs }}>
        <Text variant="label" tone="muted">
          Scores
        </Text>
        {ranked.map((pid, i) => {
          const p = playerOf(game, pid);
          const left = view.left.includes(pid);
          return (
            <View
              key={pid}
              style={[styles.scoreRow, { backgroundColor: pid === view.turn ? colors.primarySoft : colors.surface, borderColor: pid === view.turn ? colors.primary : colors.border, opacity: left ? 0.5 : 1 }]}
              accessible
              accessibilityLabel={`${nameOf(ctx, pid)}, ${view.scores[pid] ?? 0} completed, ${view.skips_left[pid] ?? 0} skips left${left ? ', left' : ''}`}
            >
              <Text variant="label" tone="muted" style={{ width: 18 }}>
                {i + 1}
              </Text>
              <UserPhoto user={p} size={30} showVerified={false} />
              <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
                {nameOf(ctx, pid)}
              </Text>
              <Text variant="caption" tone="faint">
                {left ? 'Left' : `${view.skips_left[pid] ?? 0} skips`}
              </Text>
              <Text variant="bodyStrong" style={{ minWidth: 24, textAlign: 'right' }}>
                {view.scores[pid] ?? 0}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  face: { position: 'absolute', alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xxl, backfaceVisibility: 'hidden', borderRadius: 24, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  backTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 34, lineHeight: 40, letterSpacing: -0.5 },
  kindPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, height: 28, borderRadius: radius.pill },
  promptText: { fontFamily: 'Inter_700Bold', fontSize: 21, lineHeight: 29, color: '#1E1A14', textAlign: 'center' },
  spotlight: { alignItems: 'center', gap: space.xs },
  spotRing: { padding: 4, borderRadius: 999, borderWidth: 3 },
  choiceRow: { flexDirection: 'row', gap: space.md },
  choice: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs, height: 96, borderRadius: radius.xl },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, minHeight: 48, borderRadius: radius.md, borderWidth: 1 },
});
