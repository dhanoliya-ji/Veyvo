import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { ArrowLeftRight, Hand, SkipForward } from 'lucide-react-native';

import { actionsOf, canDo, type CrazyEightsBoardView, type GameAction, type Suit } from '@/api/games-extra';
import { Button, PressableScale, Sheet, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space } from '@/theme/tokens';
import { nameOf, PlayerAvatar, playerOf, TurnBanner, useGameTheme, type GameCtx } from '../GameParts';
import { cardName, isRed, PlayingCard, rankOf, SUIT_NAMES, SuitIcon } from './PlayingCard';

const FELT = '#0F5A3A';
const FELT_EDGE = '#3B2615';
const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

type PlayAction = GameAction & { card: string; suit?: Suit };

/** Your hand, fanned. Playable cards are raised and tappable. */
function FannedHand({ cards, playable, onPlay, disabled }: { cards: string[]; playable: Set<string>; onPlay: (card: string) => void; disabled: boolean }) {
  const { width } = useWindowDimensions();
  const { reduceMotion } = useTheme();
  const avail = width - screenPadding * 2;
  const n = cards.length;
  const cw = Math.min(78, Math.max(52, avail / 4.4));
  const ch = Math.round(cw * 1.4);
  const step = n > 1 ? Math.min(cw * 0.62, (avail - cw) / (n - 1)) : 0;
  const total = cw + step * (n - 1);
  const spread = n > 1 ? Math.min(5, 36 / n) : 0;
  const mid = (n - 1) / 2;
  return (
    <View style={{ height: ch + 34, width: avail, alignSelf: 'center' }} accessibilityRole="list" accessibilityLabel={`Your hand, ${n} cards`}>
      {cards.map((c, i) => {
        const can = playable.has(c);
        const off = i - mid;
        const lift = can ? 18 : 0;
        return (
          <Animated.View
            key={c}
            entering={reduceMotion ? undefined : ZoomIn.delay(i * 25).springify().damping(16)}
            style={{
              position: 'absolute',
              left: (avail - total) / 2 + i * step,
              top: 22 + Math.abs(off) * Math.abs(off) * (n > 6 ? 0.8 : 1.6) - lift,
              transform: [{ rotate: `${off * spread}deg` }],
              zIndex: i,
            }}
          >
            <Pressable
              onPress={() => onPlay(c)}
              disabled={!can || disabled}
              accessibilityRole="button"
              accessibilityLabel={`${cardName(c)}${can ? ', playable' : ', cannot play now'}`}
              accessibilityState={{ disabled: !can || disabled }}
            >
              <PlayingCard card={c} width={cw} dimmed={!can && playable.size > 0} highlight={can} />
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

export function CrazyEightsTable({ ctx }: { ctx: GameCtx }) {
  const { colors } = useTheme();
  const { game, meId, readOnly, pending } = ctx;
  const view = game.board as CrazyEightsBoardView;
  const back = useGameTheme().cardBack;
  const [suitFor, setSuitFor] = useState<string | null>(null);
  const myTurn = !readOnly && view.status === 'active' && view.turn === meId;
  const plays = myTurn ? actionsOf<PlayAction>(game, 'play') : [];
  const playable = new Set(plays.map((a) => a.card));
  const canDraw = myTurn && canDo(game, 'draw');
  const canPass = myTurn && canDo(game, 'pass');
  const opponents = view.players.filter((p) => p !== meId);
  const topIs8 = rankOf(view.top_card) === '8';

  const play = (card: string) => {
    if (pending) return;
    if (rankOf(card) === '8') setSuitFor(card);
    else ctx.act({ type: 'play', card });
  };

  const ev = view.last_event;
  const evText = (() => {
    if (!ev) return null;
    const who = nameOf(ctx, ev.player_id);
    if (ev.type === 'play')
      return `${who} played the ${cardName(ev.card)}${rankOf(ev.card) === '8' ? ` and chose ${SUIT_NAMES[ev.suit as Suit]}` : ''}${ev.effect === 'skip' ? ': next player skipped' : ev.effect === 'reverse' ? ': direction reversed' : ev.effect === 'draw_two' ? ': next player draws 2' : ''}.`;
    if (ev.type === 'draw') return ev.penalty ? `${who} drew ${ev.count} penalty cards.` : `${who} drew a card${ev.can_play ? '' : ' and passed'}.`;
    if (ev.type === 'pass') return `${who} passed.`;
    if (ev.type === 'player_left') return `${who} left the table.`;
    return null;
  })();

  const status =
    view.status !== 'active'
      ? 'Game over'
      : myTurn
        ? view.pending_draw > 0
          ? playable.size
            ? `Play a 2 or draw ${view.pending_draw}`
            : `Draw ${view.pending_draw} cards`
          : canPass
            ? playable.size
              ? 'You can play the card you drew, or pass'
              : 'Pass to end your turn'
            : playable.size
              ? 'Your turn: play a raised card'
              : 'No match: draw a card'
        : `${nameOf(ctx, view.turn)} is playing…`;

  return (
    <View style={{ gap: space.md }}>
      {!readOnly ? <TurnBanner mine={myTurn} text={status} /> : null}

      <View style={[styles.table, { backgroundColor: FELT, borderColor: FELT_EDGE }]}>
        {/* Opponents */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.opponents}>
          {opponents.map((pid) => {
            const count = view.hand_counts[pid] ?? 0;
            const left = view.left.includes(pid);
            const turn = view.turn === pid;
            return (
              <View key={pid} style={styles.opponent} accessible accessibilityLabel={`${nameOf(ctx, pid)}, ${left ? 'left' : `${count} cards`}${turn ? ', their turn' : ''}`}>
                <PlayerAvatar player={playerOf(game, pid)} size={38} highlight={turn} ringColor="#F5B700" dimmed={left} />
                <Text variant="tiny" numberOfLines={1} style={{ color: '#F3EFE3', maxWidth: 72 }}>
                  {nameOf(ctx, pid)}
                </Text>
                <View style={styles.miniFan}>
                  {Array.from({ length: Math.min(count, 6) }, (_, i) => (
                    <View key={i} style={{ marginLeft: i ? -12 : 0, transform: [{ rotate: `${(i - Math.min(count, 6) / 2) * 6}deg` }] }}>
                      <PlayingCard card={null} width={16} back={back} />
                    </View>
                  ))}
                  <Text variant="tiny" style={{ color: '#F3EFE3', marginLeft: 6 }}>
                    {left ? 'left' : count}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        {/* Piles */}
        <View style={styles.piles}>
          <PressableScale
            onPress={() => ctx.act({ type: 'draw' })}
            disabled={!canDraw || pending}
            hapticFeedback="light"
            accessibilityRole="button"
            accessibilityLabel={`Draw pile, ${view.deck_count} cards${canDraw ? `. Tap to draw${view.pending_draw > 0 ? ` ${view.pending_draw}` : ''}` : ''}`}
            accessibilityState={{ disabled: !canDraw }}
            style={{ alignItems: 'center', gap: 6 }}
          >
            <View style={{ width: 74, height: 108 }}>
              {view.deck_count > 2 ? <PlayingCard back={back} card={null} width={70} style={{ position: 'absolute', left: 4, top: 4 }} /> : null}
              {view.deck_count > 1 ? <PlayingCard back={back} card={null} width={70} style={{ position: 'absolute', left: 2, top: 2 }} /> : null}
              {view.deck_count > 0 ? <PlayingCard back={back} card={null} width={70} style={{ position: 'absolute', left: 0, top: 0 }} highlight={canDraw} /> : <View style={styles.emptyPile} />}
            </View>
            <Text variant="tiny" style={{ color: canDraw ? '#FFE08A' : '#CFE3D6' }}>
              {canDraw ? (view.pending_draw > 0 ? `Draw ${view.pending_draw}` : 'Tap to draw') : `${view.deck_count} left`}
            </Text>
          </PressableScale>

          <View style={{ alignItems: 'center', gap: 6 }} accessible accessibilityLabel={`Top card: ${cardName(view.top_card)}. Current suit: ${SUIT_NAMES[view.current_suit]}`}>
            <Animated.View key={view.top_card} entering={FadeIn.duration(200)} style={{ width: 84, height: 112, alignItems: 'center', justifyContent: 'center' }}>
              <PlayingCard card={view.top_card} width={76} style={{ transform: [{ rotate: '-4deg' }] }} />
            </Animated.View>
            <View style={[styles.suitPill, { backgroundColor: topIs8 ? '#FFF4D6' : 'rgba(255,255,255,0.92)' }]}>
              <SuitIcon suit={view.current_suit} size={14} />
              <Text variant="tiny" style={{ color: isRed(view.current_suit) ? '#C8102E' : '#111' }}>
                {topIs8 ? `${SUIT_NAMES[view.current_suit]} chosen` : SUIT_NAMES[view.current_suit]}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.tableFooter}>
          {view.rules?.ace_reverse ? (
            <View style={styles.footerItem}>
              <ArrowLeftRight size={12} color="#CFE3D6" />
              <Text variant="tiny" style={{ color: '#CFE3D6' }}>
                {view.direction === 1 ? 'Clockwise' : 'Reversed'}
              </Text>
            </View>
          ) : null}
          {view.pending_draw > 0 ? (
            <Text variant="tiny" style={{ color: '#FFE08A' }}>
              +{view.pending_draw} pending
            </Text>
          ) : null}
        </View>
        {evText ? (
          <Text variant="caption" center style={{ color: '#E6F0EA', paddingHorizontal: space.md, paddingBottom: space.md }} accessibilityLiveRegion="polite">
            {evText}
          </Text>
        ) : null}
      </View>

      {/* Your hand */}
      {view.hand && !readOnly ? (
        <View style={{ gap: space.sm }}>
          <View style={styles.handHeader}>
            <Hand size={16} color={colors.textMuted} />
            <Text variant="label" tone="muted" style={{ flex: 1 }}>
              Your hand · {view.hand.length}
            </Text>
            {canPass ? <Button title="Pass" icon={SkipForward} size="sm" variant="secondary" onPress={() => ctx.act({ type: 'pass' })} disabled={pending} /> : null}
            {canDraw ? <Button title={view.pending_draw > 0 ? `Draw ${view.pending_draw}` : 'Draw'} size="sm" onPress={() => ctx.act({ type: 'draw' })} disabled={pending} /> : null}
          </View>
          <FannedHand cards={view.hand} playable={playable} onPlay={play} disabled={pending || !myTurn} />
        </View>
      ) : null}

      {/* Revealed hands at the end */}
      {view.final_hands ? (
        <View style={{ gap: space.sm }}>
          <Text variant="label" tone="muted">
            Cards left in hand
          </Text>
          {view.players.map((pid) => {
            const left = view.final_hands?.[pid] ?? [];
            return (
            <View key={pid} style={styles.finalRow}>
              <PlayerAvatar player={playerOf(game, pid)} size={28} />
              <Text variant="label" style={{ width: 80 }} numberOfLines={1}>
                {nameOf(ctx, pid)}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
                {left.length ? (
                  left.map((c) => <PlayingCard key={c} card={c} width={30} />)
                ) : (
                  <Text variant="caption" tone="success">
                    {view.winner === pid ? 'Went out first' : 'No cards'}
                  </Text>
                )}
              </ScrollView>
            </View>
            );
          })}
        </View>
      ) : null}

      <Sheet visible={!!suitFor} onClose={() => setSuitFor(null)} title="Eights are wild: pick a suit">
        <View style={styles.suitGrid}>
          {SUITS.map((s) => {
            const option = plays.find((a) => a.card === suitFor && a.suit === s);
            return (
              <PressableScale
                key={s}
                disabled={!option || pending}
                onPress={() => {
                  const card = suitFor;
                  setSuitFor(null);
                  if (card) ctx.act({ type: 'play', card, suit: s });
                }}
                hapticFeedback="light"
                accessibilityLabel={`Choose ${SUIT_NAMES[s]}`}
                style={[styles.suitBtn, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
              >
                <SuitIcon suit={s} size={40} color={isRed(s) ? '#E0313F' : colors.text} />
                <Text variant="label" style={{ textTransform: 'capitalize' }}>
                  {SUIT_NAMES[s]}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  table: { borderRadius: radius.xxl, borderWidth: 6, overflow: 'hidden' },
  opponents: { gap: space.lg, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  opponent: { alignItems: 'center', gap: 3, minWidth: 64 },
  miniFan: { flexDirection: 'row', alignItems: 'center', height: 24 },
  piles: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: space.huge, paddingVertical: space.lg },
  emptyPile: { width: 70, height: 98, borderRadius: 6, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.35)' },
  suitPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, height: 24, borderRadius: radius.pill },
  tableFooter: { flexDirection: 'row', justifyContent: 'center', gap: space.lg, paddingBottom: space.sm },
  footerItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  handHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  finalRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48 },
  suitGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingVertical: space.md },
  suitBtn: { flexBasis: '46%', flexGrow: 1, alignItems: 'center', gap: space.xs, paddingVertical: space.lg, borderRadius: radius.lg, borderWidth: 1 },
});
