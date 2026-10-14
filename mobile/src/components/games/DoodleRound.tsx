import { useEffect, useRef, useState, type RefObject } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { Check, Eraser, Paintbrush, Send, Sparkles, Trash2, Undo2 } from 'lucide-react-native';

import { isApiError } from '@/api/games-extra';
import { useGameActions } from '@/api/hooks';
import { Avatar } from '@/components/avatar/Avatar';
import { IconButton, PressableScale, Text, confirm } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { realtime } from '@/lib/realtime';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { Confetti } from './Confetti';
import { BRUSH_COLOR_NAMES, BRUSH_COLORS, BRUSH_SIZES, DrawingCanvas, PAPER, type CanvasHandle } from './DrawingCanvas';
import { PhaseCountdown, RoundTimer, type GameCtx } from './GameParts';
import { CountUp, Pop } from './Motion';
import { Scoreboard } from './Scoreboard';

export type FeedItem = { key: string; round: number; kind: 'guess' | 'correct'; userId: string; text?: string };

export function DoodleRound({ ctx, canvasRef, feed }: { ctx: GameCtx; canvasRef: RefObject<CanvasHandle | null>; feed: FeedItem[] }) {
  const { colors, reduceMotion } = useTheme();
  const { game, meId, offset, isPlayer, roundGain } = ctx;
  const round = game.round!;
  const actions = useGameActions(game.id);
  const isDrawer = round.drawer_id === meId;
  const drawer = game.players.find((p) => p.id === round.drawer_id);
  const drawing = round.phase === 'drawing';

  const [color, setColor] = useState(BRUSH_COLORS[0]);
  const [size, setSize] = useState(BRUSH_SIZES[1]);
  const [strokeCount, setStrokeCount] = useState(0);
  const [text, setText] = useState('');
  const [verdict, setVerdict] = useState<{ round: number; kind: 'close' | 'wrong' | 'correct'; points?: number; n: number } | null>(null);
  const [burst, setBurst] = useState<number | null>(null);
  const inputRef = useRef<TextInput>(null);

  const myVerdict = verdict?.round === round.index ? verdict : null;
  const guessedIt = round.i_guessed || myVerdict?.kind === 'correct';
  const nameOf = (id: string) => (id === meId ? 'You' : (game.players.find((p) => p.id === id)?.display_name ?? 'Someone'));

  // The artist re-sends the drawing when someone new joins mid-round, or after our own reconnect.
  const activeIds = game.players
    .filter((p) => p.active)
    .map((p) => p.id)
    .sort()
    .join(',');
  const prevIds = useRef(activeIds);
  useEffect(() => {
    if (prevIds.current !== activeIds && isDrawer && drawing) {
      const before = new Set(prevIds.current.split(','));
      if (activeIds.split(',').some((id) => !before.has(id))) canvasRef.current?.resync();
    }
    prevIds.current = activeIds;
  }, [activeIds, isDrawer, drawing, canvasRef]);
  useEffect(() => {
    if (!isDrawer) return;
    return realtime.on('client.reconnected', () => canvasRef.current?.resync());
  }, [isDrawer, canvasRef]);

  const guess = () => {
    const value = text.trim();
    if (!value || guessedIt || actions.guess.isPending) return;
    actions.guess.mutate(
      { round_index: round.index, guess: value },
      {
        onSuccess: (res) => {
          setText('');
          if (res.correct) {
            haptic.success();
            setVerdict({ round: round.index, kind: 'correct', points: res.points, n: Date.now() });
            setBurst(Date.now());
            inputRef.current?.blur();
            ctx.refetch();
          } else if (res.close) {
            haptic.warning();
            setVerdict({ round: round.index, kind: 'close', n: Date.now() });
            setText(value);
          } else {
            haptic.light();
            setVerdict({ round: round.index, kind: 'wrong', n: Date.now() });
          }
        },
        onError: (e) => {
          if (isApiError(e, 409, 'already_guessed')) {
            setVerdict({ round: round.index, kind: 'correct', n: Date.now() });
          } else if (isApiError(e, 409)) {
            toast.show({ title: 'Round over', message: 'This round has closed.', tone: 'warning' });
          } else {
            haptic.error();
            toast.error("Your guess didn't go through", errorMessage(e));
          }
          ctx.refetch();
        },
      },
    );
  };

  const clearAll = async () => {
    if (!strokeCount) return;
    const ok = await confirm({ title: 'Clear the drawing?', message: 'This wipes the canvas for everyone.', confirmLabel: 'Clear', destructive: true });
    if (ok) {
      haptic.medium();
      canvasRef.current?.clear(true);
    }
  };

  const roundFeed = feed.filter((f) => f.round === round.index).slice(-6);
  const guessedIds = round.guessed_user_ids ?? [];

  return (
    <View style={{ gap: space.md }}>
      {round.phase === 'countdown' ? (
        <PhaseCountdown
          game={game}
          offset={offset}
          title={`Round ${round.index + 1} of ${round.total}`}
          subtitle={isDrawer ? "You're drawing next! Get ready." : `${drawer?.display_name ?? 'Someone'} is drawing next`}
        />
      ) : drawing ? (
        <RoundTimer game={game} offset={offset} phaseSeconds={game.settings.draw_seconds ?? 70} />
      ) : (
        <Animated.View entering={reduceMotion ? undefined : FadeIn} style={[styles.reveal, { backgroundColor: colors.primarySoft }]} accessibilityLiveRegion="polite">
          <Text variant="label" tone="muted">
            The word was
          </Text>
          <Pop popKey={`w${round.index}`}>
            <Text variant="display" tone="primary">
              {round.word ?? '…'}
            </Text>
          </Pop>
          <Text variant="caption" tone="muted">
            {guessedIds.length ? `${guessedIds.length} ${guessedIds.length === 1 ? 'person' : 'people'} guessed it` : 'Nobody guessed it this time'}
            {roundGain !== null && roundGain > 0 ? ` · you scored +${roundGain}` : ''}
          </Text>
        </Animated.View>
      )}

      {/* Word card for the artist, hint for guessers */}
      {drawing && isDrawer ? (
        <View style={[styles.wordCard, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]} accessibilityLabel={`Your word to draw: ${round.word}. Only you can see this.`}>
          <Paintbrush size={18} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text variant="caption" tone="muted">
              Draw this (only you can see it)
            </Text>
            <Text variant="title" tone="accent">
              {round.word}
            </Text>
          </View>
        </View>
      ) : drawing ? (
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Text variant="caption" tone="muted">
            {drawer?.display_name ?? 'The artist'} is drawing
          </Text>
          <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 26, letterSpacing: 4, color: colors.text }} accessibilityLabel={`Hint: ${(round.word_hint ?? '').replace(/ /g, '').length} letters`}>
            {round.word_hint}
          </Text>
        </View>
      ) : null}

      <View>
        <DrawingCanvas
          ref={canvasRef}
          sessionId={game.id}
          editable={isDrawer && drawing}
          color={color}
          width={size}
          resetKey={`${round.index}`}
          onStrokeCountChange={setStrokeCount}
          accessibilityLabel={isDrawer ? 'Your drawing canvas. Drag to draw.' : `${drawer?.display_name ?? 'The artist'}'s drawing`}
        />
        {round.phase === 'countdown' ? (
          <View style={[StyleSheet.absoluteFill, styles.canvasOverlay, { backgroundColor: colors.overlay }]}>
            <Text variant="heading" style={{ color: '#FFFFFF' }}>
              Get ready…
            </Text>
          </View>
        ) : null}
        {isDrawer && drawing && strokeCount === 0 ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.canvasOverlay]}>
            <Text variant="bodyStrong" style={{ color: '#8D90A3' }}>
              Drag here to draw
            </Text>
          </View>
        ) : null}
      </View>

      {/* Artist tools */}
      {isDrawer && drawing ? (
        <View style={{ gap: space.sm }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.palette} accessibilityRole="radiogroup" accessibilityLabel="Colours">
            {[...BRUSH_COLORS, PAPER].map((c) => {
              const active = c === color;
              return (
                <PressableScale
                  key={c}
                  onPress={() => setColor(c)}
                  hapticFeedback="tap"
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={BRUSH_COLOR_NAMES[c] ?? c}
                  style={[styles.swatch, { backgroundColor: c, borderColor: active ? colors.primary : colors.border, borderWidth: active ? 3 : 1 }]}
                >
                  {c === PAPER ? <Eraser size={16} color="#5C5F73" /> : active ? <Check size={16} color="#FFFFFF" strokeWidth={3} /> : null}
                </PressableScale>
              );
            })}
          </ScrollView>
          <View style={styles.toolsRow}>
            <View style={styles.sizes} accessibilityRole="radiogroup" accessibilityLabel="Brush size">
              {BRUSH_SIZES.map((s, i) => {
                const active = s === size;
                return (
                  <PressableScale
                    key={s}
                    onPress={() => setSize(s)}
                    hapticFeedback="tap"
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={['Fine', 'Medium', 'Thick', 'Extra thick'][i]}
                    style={[styles.sizeBtn, { backgroundColor: active ? colors.primarySoft : colors.surfaceAlt, borderColor: active ? colors.primary : 'transparent' }]}
                  >
                    <View style={{ width: Math.min(24, s + 2), height: Math.min(24, s + 2), borderRadius: 12, backgroundColor: color === PAPER ? colors.textMuted : color }} />
                  </PressableScale>
                );
              })}
            </View>
            <IconButton icon={Undo2} label="Undo last stroke" variant="filled" onPress={() => canvasRef.current?.undo()} disabled={!strokeCount} />
            <IconButton icon={Trash2} label="Clear drawing" variant="filled" onPress={clearAll} disabled={!strokeCount} />
          </View>
        </View>
      ) : null}

      {/* Guess feed */}
      {(drawing || round.phase === 'round_end') && roundFeed.length ? (
        <View style={{ gap: 4 }} accessibilityLiveRegion="polite">
          {roundFeed.map((f) => (
            <Animated.View key={f.key} entering={reduceMotion ? undefined : FadeInUp.duration(200)} style={styles.feedRow}>
              {f.kind === 'correct' ? <Sparkles size={14} color={colors.success} /> : null}
              <Text variant="label" style={{ color: f.kind === 'correct' ? colors.success : colors.textMuted }}>
                {nameOf(f.userId)}
                {f.kind === 'correct' ? ' guessed it!' : ':'}
              </Text>
              {f.kind === 'guess' ? (
                <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
                  {f.text}
                </Text>
              ) : null}
            </Animated.View>
          ))}
        </View>
      ) : null}

      {/* Guess input */}
      {drawing && !isDrawer ? (
        isPlayer ? (
          guessedIt ? (
            <Animated.View entering={reduceMotion ? undefined : FadeIn} style={[styles.correct, { backgroundColor: colors.successSoft, borderColor: colors.success }]} accessibilityLiveRegion="assertive">
              <Check size={20} color={colors.success} strokeWidth={3} />
              <Text variant="heading" tone="success">
                You got it!
              </Text>
              {myVerdict?.points ? <CountUp value={myVerdict.points} prefix="+" suffix=" points" variant="heading" tone="success" /> : null}
            </Animated.View>
          ) : (
            <View style={{ gap: space.xs }}>
              <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: myVerdict?.kind === 'close' ? colors.warning : colors.border }]}>
                <TextInput
                  ref={inputRef}
                  value={text}
                  onChangeText={setText}
                  onSubmitEditing={guess}
                  placeholder="Type your guess"
                  placeholderTextColor={colors.textFaint}
                  maxLength={60}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="send"
                  blurOnSubmit={false}
                  accessibilityLabel="Your guess"
                  style={[styles.input, { color: colors.text }]}
                />
                <IconButton icon={Send} label="Send guess" variant="primary" size={40} onPress={guess} disabled={!text.trim() || actions.guess.isPending} />
              </View>
              {myVerdict?.kind === 'close' ? (
                <Pop popKey={myVerdict.n}>
                  <Text variant="label" tone="warning" accessibilityLiveRegion="polite">
                    So close! Check your spelling.
                  </Text>
                </Pop>
              ) : myVerdict?.kind === 'wrong' ? (
                <Text variant="caption" tone="muted">
                  Not quite — keep guessing.
                </Text>
              ) : null}
            </View>
          )
        ) : (
          <Text tone="muted" center>
            Join the game to guess.
          </Text>
        )
      ) : null}

      {/* Who's guessed */}
      {drawing && guessedIds.length ? (
        <View style={styles.guessedRow} accessibilityLabel={`Guessed it: ${guessedIds.map(nameOf).join(', ')}`}>
          <Text variant="caption" tone="muted">
            Guessed it:
          </Text>
          {guessedIds.map((id) => {
            const p = game.players.find((x) => x.id === id);
            return p ? (
              <View key={id} style={[styles.guessedChip, { backgroundColor: colors.successSoft }]}>
                <Avatar config={p.avatar} size={20} />
                <Check size={12} color={colors.success} strokeWidth={3} />
              </View>
            ) : null;
          })}
        </View>
      ) : null}

      {round.phase !== 'drawing' ? (
        <View style={{ gap: space.md, marginTop: space.sm }}>
          <Text variant="heading">Scores</Text>
          <Scoreboard players={game.players} meId={meId} drawerId={round.phase === 'countdown' ? round.drawer_id : null} hostId={game.host_id} />
        </View>
      ) : (
        <Scoreboard players={game.players} meId={meId} drawerId={round.drawer_id} guessedIds={guessedIds} hostId={game.host_id} />
      )}
      <Confetti burstKey={burst} originY={0.6} />
    </View>
  );
}

const styles = StyleSheet.create({
  reveal: { alignItems: 'center', gap: space.xs, padding: space.lg, borderRadius: radius.xl },
  wordCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1.5 },
  canvasOverlay: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.xl },
  palette: { gap: space.sm, paddingVertical: 2 },
  swatch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  toolsRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sizes: { flex: 1, flexDirection: 'row', gap: space.xs },
  sizeBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  feedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  correct: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: 1.5, flexWrap: 'wrap' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.md, paddingRight: 4, borderRadius: radius.lg, borderWidth: 1.5, minHeight: 50 },
  input: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 16, paddingVertical: space.sm },
  guessedRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.xs },
  guessedChip: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4, paddingVertical: 2, borderRadius: radius.pill },
});
