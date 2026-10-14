import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Dices } from 'lucide-react-native';

import { canDo, type LudoBoardView, type LudoColour, type LudoToken } from '@/api/games-extra';
import { Button, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import type { LudoTheme } from '@/lib/themes';
import { nameOf, PlayerAvatar, playerOf, shade, TurnBanner, useBoardSize, useGameTheme, usePulse, type GameCtx } from '../GameParts';
import { Dice } from './Dice';

type LudoPalette = Record<LudoColour, { base: string; light: string; dark: string; label: string }>;

/** Player colours from the viewer's Ludo theme, with glossy highlight/shadow tones derived from each. */
export function ludoPalette(theme: LudoTheme): LudoPalette {
  const mk = (base: string, label: string) => ({ base, light: shade(base, 0.45), dark: shade(base, -0.45), label });
  return { red: mk(theme.red, 'Red'), green: mk(theme.green, 'Green'), yellow: mk(theme.yellow, 'Yellow'), blue: mk(theme.blue, 'Blue') };
}

/**
 * Classic 15x15 cross board. Absolute track index 0 is red's start square; the track runs clockwise
 * (red top-left, green top-right, yellow bottom-right, blue bottom-left), matching the engine's
 * START_INDEX (red 0, green 13, yellow 26, blue 39).
 */
const TRACK: [number, number][] = [
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  [7, 0], [8, 0],
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  [14, 7], [14, 8],
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  [7, 14], [6, 14],
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  [0, 7], [0, 6],
];

const HOME_STRETCH: Record<LudoColour, [number, number][]> = {
  red: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  green: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  yellow: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  blue: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
};

const BASE_ORIGIN: Record<LudoColour, [number, number]> = { red: [0, 0], green: [9, 0], yellow: [9, 9], blue: [0, 9] };
const START: Record<LudoColour, number> = { red: 0, green: 13, yellow: 26, blue: 39 };
const STARS = [8, 21, 34, 47];
// Centre-triangle anchor (in grid units) where finished tokens rest.
const FINISH_ANCHOR: Record<LudoColour, [number, number]> = { red: [6.55, 7.5], green: [7.5, 6.55], yellow: [8.45, 7.5], blue: [7.5, 8.45] };

function starPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${cx + Math.cos(a) * rr},${cy + Math.sin(a) * rr}`);
  }
  return pts.join(' ');
}

/** Grid-unit centre of a token (before stacking offsets). */
function tokenSpot(colour: LudoColour, t: LudoToken): { x: number; y: number; key: string; big: boolean } {
  if (t.where === 'base') {
    const [ox, oy] = BASE_ORIGIN[colour];
    return { x: ox + (t.token % 2 === 0 ? 2 : 4), y: oy + (t.token < 2 ? 2 : 4), key: `base-${colour}-${t.token}`, big: true };
  }
  if (t.where === 'finished') {
    const [fx, fy] = FINISH_ANCHOR[colour];
    return { x: fx, y: fy, key: `fin-${colour}`, big: false };
  }
  if (t.where === 'home_stretch' && t.home_index !== null) {
    const [x, y] = HOME_STRETCH[colour][Math.max(0, Math.min(4, t.home_index))];
    return { x: x + 0.5, y: y + 0.5, key: `home-${colour}-${t.home_index}`, big: false };
  }
  const [x, y] = TRACK[((t.track_index ?? 0) + 52) % 52];
  return { x: x + 0.5, y: y + 0.5, key: `track-${t.track_index}`, big: false };
}

const OFFSETS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-0.2, -0.1], [0.2, 0.1]],
  3: [[-0.2, -0.18], [0.2, -0.18], [0, 0.2]],
  4: [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]],
};

type Placed = { pid: string; colour: LudoColour; token: LudoToken; x: number; y: number; r: number };

function where(t: LudoToken): string {
  if (t.where === 'base') return 'in base';
  if (t.where === 'finished') return 'home';
  return `${t.where === 'home_stretch' ? 'on the home stretch' : 'on the track'}, ${56 - t.progress} squares from home`;
}

const Token = memo(function Token({ x, y, r, colour, edge }: { x: number; y: number; r: number; colour: LudoColour; edge: string }) {
  return (
    <G>
      <Ellipse cx={x + r * 0.12} cy={y + r * 0.35} rx={r * 0.95} ry={r * 0.7} fill="#000" opacity={0.28} />
      <Circle cx={x} cy={y} r={r} fill={`url(#peg-${colour})`} stroke={edge} strokeWidth={Math.max(1, r * 0.12)} />
      <Circle cx={x} cy={y} r={r * 0.52} fill="none" stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={Math.max(0.8, r * 0.1)} />
      <Ellipse cx={x - r * 0.3} cy={y - r * 0.38} rx={r * 0.32} ry={r * 0.18} fill="#FFFFFF" opacity={0.75} transform={`rotate(-30 ${x - r * 0.3} ${y - r * 0.38})`} />
    </G>
  );
});

function PulseRing({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  const style = usePulse(true, 0.25, 550);
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: r, borderWidth: 3, borderColor: color }, style]} />;
}

export function LudoBoard({ ctx }: { ctx: GameCtx }) {
  const { colors } = useTheme();
  const { game, meId, readOnly, pending } = ctx;
  const view = game.board as LudoBoardView;
  const theme = useGameTheme().ludo;
  const LC = useMemo(() => ludoPalette(theme), [theme]);
  const size = useBoardSize(520);
  const cell = size / 15;
  const myTurn = !readOnly && view.status === 'active' && view.turn === meId;
  const canRoll = myTurn && canDo(game, 'roll');
  const movable = myTurn && view.phase === 'move' ? game.legal_actions.filter((a) => a.type === 'move').map((a) => Number(a.token)) : [];
  const turnColour = view.turn ? view.colors[view.turn] : null;

  const placed = useMemo(() => {
    const groups = new Map<string, Placed[]>();
    for (const pid of view.players) {
      if (view.left.includes(pid) && !view.tokens[pid]?.some((t) => t.where === 'finished')) continue;
      const colour = view.colors[pid];
      for (const t of view.tokens[pid] ?? []) {
        const spot = tokenSpot(colour, t);
        const list = groups.get(spot.key) ?? [];
        list.push({ pid, colour, token: t, x: spot.x, y: spot.y, r: spot.big ? 0.62 : 0.4 });
        groups.set(spot.key, list);
      }
    }
    const out: Placed[] = [];
    for (const list of groups.values()) {
      const n = Math.min(4, list.length);
      list.forEach((p, i) => {
        const [dx, dy] = OFFSETS[n][i % 4];
        out.push({ ...p, x: (p.x + dx) * cell, y: (p.y + dy) * cell, r: p.r * cell * (n > 1 ? 0.72 : 1) });
      });
    }
    // Draw the current player's tokens last so they sit on top.
    return out.sort((a, b) => Number(a.pid === view.turn) - Number(b.pid === view.turn));
  }, [view, cell]);

  const mine = placed.filter((p) => p.pid === meId && movable.includes(p.token.token));
  const ev = view.last_event;
  const evText = (() => {
    if (!ev) return null;
    const who = nameOf(ctx, ev.player_id);
    if (ev.type === 'roll' && ev.forfeit) return `${who} rolled three 6s in a row and lost the turn.`;
    if (ev.type === 'roll' && ev.no_move) return `${who} rolled a ${ev.roll}: no token could move.`;
    if (ev.type === 'move' && ev.finished) return `${who} brought every token home!`;
    if (ev.type === 'move' && Array.isArray(ev.captured) && ev.captured.length)
      return `${who} sent ${ev.captured.map((c: { player_id: string }) => (c.player_id === meId ? 'your' : `${nameOf(ctx, c.player_id)}'s`)).join(' and ')} token back to base!`;
    if (ev.type === 'player_left') return `${who} left the game.`;
    return null;
  })();

  const rollKey = ev && ev.type === 'roll' ? (ev.move_no as number) : null;
  const status =
    view.status !== 'active'
      ? 'Game over'
      : myTurn
        ? view.phase === 'roll'
          ? view.last_roll === 6 && ev?.type === 'move' && ev.player_id === meId
            ? 'You rolled a 6: roll again!'
            : 'Your turn: roll the die'
          : `You rolled a ${view.last_roll}: pick a token to move`
        : `${nameOf(ctx, view.turn)}'s turn${turnColour ? ` (${LC[turnColour].label})` : ''}`;

  return (
    <View style={{ gap: space.md }}>
      {!readOnly ? <TurnBanner mine={myTurn} text={status} tint={turnColour ? LC[turnColour].base : undefined} /> : null}

      <View style={[styles.boardShadow, { width: size + 8, alignSelf: 'center' }]}>
        <View style={{ width: size, height: size }}>
          <Svg width={size} height={size}>
            <Defs>
              {(Object.keys(LC) as LudoColour[]).map((k) => (
                <RadialGradient key={k} id={`peg-${k}`} cx="38%" cy="32%" r="70%">
                  <Stop offset="0" stopColor={LC[k].light} />
                  <Stop offset="0.55" stopColor={LC[k].base} />
                  <Stop offset="1" stopColor={LC[k].dark} />
                </RadialGradient>
              ))}
            </Defs>
            <Rect x={0} y={0} width={size} height={size} rx={cell * 0.3} fill={theme.board} />
            {/* Bases */}
            {(Object.keys(BASE_ORIGIN) as LudoColour[]).map((k) => {
              const [ox, oy] = BASE_ORIGIN[k];
              const c = LC[k];
              const glow = turnColour === k && view.status === 'active';
              return (
                <G key={k}>
                  <Rect x={ox * cell} y={oy * cell} width={6 * cell} height={6 * cell} fill={c.base} rx={cell * 0.3} />
                  <Rect x={(ox + 0.8) * cell} y={(oy + 0.8) * cell} width={4.4 * cell} height={4.4 * cell} rx={cell * 0.5} fill={theme.track} stroke={glow ? c.dark : 'none'} strokeWidth={glow ? 3 : 0} />
                  {[0, 1, 2, 3].map((i) => (
                    <Circle key={i} cx={(ox + (i % 2 === 0 ? 2 : 4)) * cell} cy={(oy + (i < 2 ? 2 : 4)) * cell} r={cell * 0.72} fill={c.light} opacity={0.55} stroke={c.base} strokeWidth={1.5} />
                  ))}
                </G>
              );
            })}
            {/* Track */}
            {TRACK.map(([x, y], i) => {
              const startOf = (Object.keys(START) as LudoColour[]).find((k) => START[k] === i);
              return (
                <G key={`t${i}`}>
                  <Rect x={x * cell} y={y * cell} width={cell} height={cell} fill={startOf ? LC[startOf].base : theme.track} stroke="#9C9384" strokeWidth={0.8} />
                  {STARS.includes(i) ? <Polygon points={starPoints((x + 0.5) * cell, (y + 0.5) * cell, cell * 0.36)} fill={theme.star} /> : null}
                  {startOf ? <Polygon points={starPoints((x + 0.5) * cell, (y + 0.5) * cell, cell * 0.36)} fill="#FFFFFF" opacity={0.85} /> : null}
                </G>
              );
            })}
            {/* Home stretches */}
            {(Object.keys(HOME_STRETCH) as LudoColour[]).map((k) =>
              HOME_STRETCH[k].map(([x, y], i) => <Rect key={`${k}${i}`} x={x * cell} y={y * cell} width={cell} height={cell} fill={LC[k].base} stroke="#9C9384" strokeWidth={0.8} />),
            )}
            {/* Centre home */}
            <Polygon points={`${6 * cell},${6 * cell} ${6 * cell},${9 * cell} ${7.5 * cell},${7.5 * cell}`} fill={LC.red.base} />
            <Polygon points={`${6 * cell},${6 * cell} ${9 * cell},${6 * cell} ${7.5 * cell},${7.5 * cell}`} fill={LC.green.base} />
            <Polygon points={`${9 * cell},${6 * cell} ${9 * cell},${9 * cell} ${7.5 * cell},${7.5 * cell}`} fill={LC.yellow.base} />
            <Polygon points={`${6 * cell},${9 * cell} ${9 * cell},${9 * cell} ${7.5 * cell},${7.5 * cell}`} fill={LC.blue.base} />
            <Path d={`M${6 * cell} ${6 * cell}L${9 * cell} ${9 * cell}M${9 * cell} ${6 * cell}L${6 * cell} ${9 * cell}`} stroke="#FFFFFF" strokeOpacity={0.5} strokeWidth={1} />
            <Rect x={0.5} y={0.5} width={size - 1} height={size - 1} rx={cell * 0.3} fill="none" stroke="#6B5E4A" strokeWidth={1.5} />
            {/* Tokens */}
            {placed.map((p) => (
              <Token key={`${p.pid}-${p.token.token}`} x={p.x} y={p.y} r={p.r} colour={p.colour} edge={LC[p.colour].dark} />
            ))}
          </Svg>
          {mine.map((p) => (
            <PulseRing key={`ring-${p.token.token}`} x={p.x} y={p.y} r={p.r + 4} color={colors.text} />
          ))}
          {mine.map((p) => {
            const hit = Math.max(p.r * 2 + 8, 34);
            return (
              <Pressable
                key={`hit-${p.token.token}`}
                onPress={() => ctx.act({ type: 'move', token: p.token.token })}
                disabled={pending}
                hitSlop={6}
                style={{ position: 'absolute', left: p.x - hit / 2, top: p.y - hit / 2, width: hit, height: hit, borderRadius: hit / 2 }}
                accessibilityRole="button"
                accessibilityLabel={`Move token ${p.token.token + 1}, ${where(p.token)}`}
              />
            );
          })}
        </View>
      </View>

      {/* Dice + controls */}
      {view.status === 'active' ? (
        <View style={[styles.diceRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Dice
            value={view.last_roll}
            rollKey={rollKey}
            size={60}
            onPress={canRoll ? () => ctx.act({ type: 'roll' }) : undefined}
            disabled={pending}
            label={canRoll ? 'Roll the die' : view.last_roll ? `Last roll: ${view.last_roll}` : 'Die'}
          />
          <View style={{ flex: 1, gap: space.xs }}>
            {canRoll ? (
              <Button title="Roll" icon={Dices} onPress={() => ctx.act({ type: 'roll' })} loading={pending} />
            ) : movable.length ? (
              <Text variant="bodyStrong">Tap a glowing token</Text>
            ) : (
              <Text variant="label" tone="muted">
                {view.last_roll ? `Last roll: ${view.last_roll}` : 'Waiting for the first roll'}
              </Text>
            )}
            {evText ? (
              <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
                {evText}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {movable.length ? (
        <View style={styles.tokenButtons}>
          {movable.map((t) => {
            const tok = view.tokens[meId]?.[t];
            return tok ? (
              <Button key={t} size="sm" variant="secondary" title={`Token ${t + 1}`} onPress={() => ctx.act({ type: 'move', token: t })} disabled={pending} accessibilityLabel={`Move token ${t + 1}, ${where(tok)}`} />
            ) : null;
          })}
        </View>
      ) : null}

      {/* Players */}
      <View style={{ gap: space.xs }}>
        {view.players.map((pid) => {
          const colour = view.colors[pid];
          const home = (view.tokens[pid] ?? []).filter((t) => t.where === 'finished').length;
          const place = view.finished.indexOf(pid);
          const left = view.left.includes(pid);
          return (
            <View
              key={pid}
              style={[styles.playerRow, { backgroundColor: colors.surface, borderColor: view.turn === pid ? LC[colour].base : colors.border }]}
              accessible
              accessibilityLabel={`${nameOf(ctx, pid)}, ${LC[colour].label}, ${home} of 4 home${place >= 0 ? `, finished ${place + 1}` : ''}${left ? ', left' : ''}${view.turn === pid ? ', their turn' : ''}`}
            >
              <View style={[styles.swatch, { backgroundColor: LC[colour].base }]} />
              <PlayerAvatar player={playerOf(game, pid)} size={30} highlight={view.turn === pid} ringColor={LC[colour].base} dimmed={left} />
              <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
                {nameOf(ctx, pid)}
              </Text>
              <Text variant="caption" tone="muted">
                {left ? 'Left' : place >= 0 ? `Finished #${place + 1}` : `${home}/4 home`}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  boardShadow: { padding: 4, borderRadius: radius.md, backgroundColor: '#6B5E4A', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  diceRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.md, borderRadius: radius.lg, borderWidth: 1 },
  tokenButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, minHeight: 48, borderRadius: radius.md, borderWidth: 1.5 },
  swatch: { width: 10, height: 28, borderRadius: 5 },
});
