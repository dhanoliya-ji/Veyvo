import { memo, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { ArrowDown } from 'lucide-react-native';

import type { FourInARowBoardView } from '@/api/games-extra';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { nameOf, PlayerAvatar, playerOf, TurnBanner, useBoardSize, type GameCtx } from './GameParts';

const COLS = 7;
const ROWS = 6;
export const DISC = {
  1: { fill: '#E63946', ring: '#FF8A93', edge: '#9E1B26', name: 'red' },
  2: { fill: '#F6C343', ring: '#FFE59A', edge: '#B08300', name: 'yellow' },
} as const;

const Disc = memo(function Disc({ disc, size, x, y, fallFrom, animKey }: { disc: 1 | 2; size: number; x: number; y: number; fallFrom: number | null; animKey: number }) {
  const { reduceMotion } = useTheme();
  // Start above the board (no one-frame flash at the final spot).
  const ty = useSharedValue(fallFrom !== null && !reduceMotion ? -fallFrom : 0);
  useEffect(() => {
    if (fallFrom === null || reduceMotion) {
      ty.value = 0;
      return;
    }
    ty.value = -fallFrom;
    const ms = 180 + Math.sqrt(fallFrom) * 18;
    ty.value = withSequence(withTiming(0, { duration: ms, easing: Easing.in(Easing.quad) }), withTiming(-size * 0.12, { duration: 90 }), withSpring(0, { damping: 10, stiffness: 300 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animKey]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));
  const c = DISC[disc];
  return (
    <Animated.View style={[{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: size / 2, backgroundColor: c.fill, borderWidth: 2, borderColor: c.edge, alignItems: 'center', justifyContent: 'center' }, style]}>
      <View style={{ width: size * 0.66, height: size * 0.66, borderRadius: size, borderWidth: size * 0.06, borderColor: c.ring, opacity: 0.7 }} />
    </Animated.View>
  );
});

function holesPath(w: number, h: number, cell: number, r: number): string {
  let d = `M0 0H${w}V${h}H0Z`;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cx = col * cell + cell / 2;
      const cy = row * cell + cell / 2;
      d += `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
    }
  }
  return d;
}

export function FourInARowBoard({ ctx }: { ctx: GameCtx }) {
  const { colors } = useTheme();
  const { game, meId, readOnly, pending } = ctx;
  const view = game.board as FourInARowBoardView;
  const width = useBoardSize(460, 12);
  const cell = width / COLS;
  const height = cell * ROWS;
  const discSize = cell * 0.78;
  const holeR = cell * 0.4;
  const zone = Math.max(36, cell * 0.8);
  const myTurn = !readOnly && view.status === 'active' && view.turn === meId;
  const playable = new Set(myTurn ? game.legal_actions.filter((a) => a.type === 'drop').map((a) => Number(a.col)) : []);
  const last = view.last_event?.type === 'drop' ? (view.last_event as { row: number; col: number; move_no: number }) : null;
  const winning = new Set((view.winning_cells ?? []).map(([r, c]) => `${r}-${c}`));
  const myDisc = view.you;
  const turnDisc = view.turn ? view.discs[view.turn] : null;

  const status =
    view.status !== 'active'
      ? 'Game over'
      : myTurn
        ? `Your turn: drop a ${myDisc ? DISC[myDisc].name : ''} disc`
        : `${nameOf(ctx, view.turn)} is thinking…`;

  return (
    <View style={{ gap: space.md }}>
      {!readOnly ? <TurnBanner mine={myTurn} text={status} tint={turnDisc ? DISC[turnDisc].fill : undefined} /> : null}

      <View style={styles.legend}>
        {view.players.map((pid) => {
          const d = view.discs[pid];
          return (
            <View key={pid} style={[styles.legendItem, { backgroundColor: colors.surface, borderColor: view.turn === pid ? DISC[d].fill : colors.border }]} accessible accessibilityLabel={`${nameOf(ctx, pid)} plays ${DISC[d].name}${view.turn === pid ? ', their turn' : ''}`}>
              <PlayerAvatar player={playerOf(game, pid)} size={28} highlight={view.turn === pid} ringColor={DISC[d].fill} />
              <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>
                {nameOf(ctx, pid)}
              </Text>
              <View style={[styles.legendDisc, { backgroundColor: DISC[d].fill, borderColor: DISC[d].edge }]} />
            </View>
          );
        })}
      </View>

      <View style={{ alignSelf: 'center', width: width + 12 }}>
        {/* Drop zone */}
        <View style={{ height: zone, flexDirection: 'row', paddingHorizontal: 6 }}>
          {Array.from({ length: COLS }, (_, c) => (
            <View key={c} style={{ width: cell, alignItems: 'center', justifyContent: 'center' }}>
              {playable.has(c) ? <ArrowDown size={18} color={myDisc ? DISC[myDisc].fill : colors.textMuted} strokeWidth={3} /> : null}
            </View>
          ))}
        </View>
        <View style={[styles.frame]}>
          <View style={{ width, height, backgroundColor: '#DCE5F2', borderRadius: 4 }}>
            {view.board.map((rowCells, row) =>
              rowCells.map((v, col) => {
                if (!v) return null;
                const displayRow = ROWS - 1 - row;
                const isLast = !!last && last.row === row && last.col === col;
                return (
                  <Disc
                    key={`${row}-${col}`}
                    disc={v as 1 | 2}
                    size={discSize}
                    x={col * cell + (cell - discSize) / 2}
                    y={displayRow * cell + (cell - discSize) / 2}
                    fallFrom={isLast ? (displayRow + 1) * cell + zone : null}
                    animKey={isLast ? last.move_no : 0}
                  />
                );
              }),
            )}
            <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
              <Defs>
                <LinearGradient id="c4blue" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#2F6BE0" />
                  <Stop offset="1" stopColor="#1A47A8" />
                </LinearGradient>
              </Defs>
              <Path d={holesPath(width, height, cell, holeR)} fill="url(#c4blue)" fillRule="evenodd" />
              {Array.from({ length: ROWS * COLS }, (_, i) => {
                const row = Math.floor(i / COLS);
                const col = i % COLS;
                return <Circle key={i} cx={col * cell + cell / 2} cy={row * cell + cell / 2} r={holeR} fill="none" stroke="#123B8F" strokeWidth={2} />;
              })}
              {[...winning].map((k) => {
                const [r, c] = k.split('-').map(Number);
                return <Circle key={`w${k}`} cx={c * cell + cell / 2} cy={(ROWS - 1 - r) * cell + cell / 2} r={holeR - 2} fill="none" stroke="#FFFFFF" strokeWidth={4} />;
              })}
            </Svg>
          </View>
        </View>
        {/* Column touch targets */}
        <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', paddingHorizontal: 6 }]}>
          {Array.from({ length: COLS }, (_, c) => (
            <Pressable
              key={c}
              onPress={() => ctx.act({ type: 'drop', col: c })}
              disabled={!playable.has(c) || pending}
              style={{ width: cell, height: '100%' }}
              accessibilityRole="button"
              accessibilityLabel={`Column ${c + 1}${view.status === 'active' && !view.playable_columns.includes(c) ? ', full' : ''}`}
              accessibilityState={{ disabled: !playable.has(c) || pending }}
            />
          ))}
        </View>
        <View style={[styles.feet]}>
          <View style={styles.foot} />
          <View style={styles.foot} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', gap: space.sm },
  legendItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm, minHeight: 44, borderRadius: radius.md, borderWidth: 1.5 },
  legendDisc: { width: 18, height: 18, borderRadius: 9, borderWidth: 2 },
  frame: { padding: 6, borderRadius: radius.md, backgroundColor: '#1A47A8', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  feet: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.sm },
  foot: { width: 34, height: 10, backgroundColor: '#123B8F', borderBottomLeftRadius: 6, borderBottomRightRadius: 6 },
});
