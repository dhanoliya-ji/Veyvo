import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { Flag, Handshake } from 'lucide-react-native';

import { actionsOf, canDo, type ChessBoardView, type GameAction } from '@/api/games-extra';
import { Button, Card, PressableScale, Sheet, Text, confirm } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { nameOf, PlayerAvatar, playerOf, TurnBanner, useBoardSize, useGameTheme, type GameCtx } from '../GameParts';
import { PIECE_VALUES, PieceGlyph, PieceIcon, pieceName } from './ChessPieces';

const FILES = 'abcdefgh';

type MoveAction = GameAction & { from: string; to: string; promotion?: string };

/** Square name for a display cell (row 0 at the top). */
function squareAt(row: number, col: number, flipped: boolean): string {
  return flipped ? `${FILES[7 - col]}${row + 1}` : `${FILES[col]}${8 - row}`;
}

function pieceOn(board: string[][], sq: string): string {
  const file = FILES.indexOf(sq[0]);
  const rank = Number(sq[1]);
  return board[8 - rank]?.[file] ?? '';
}

/** Replays the server's UCI history into short algebraic-style labels (display only; legality is the server's job). */
function readableMoves(history: string[]): string[] {
  const start = 'rnbqkbnrpppppppp' + '.'.repeat(32) + 'PPPPPPPPRNBQKBNR';
  // index = (8 - rank) * 8 + file, i.e. a8 = 0
  const b = start.split('');
  const idx = (sq: string) => (8 - Number(sq[1])) * 8 + FILES.indexOf(sq[0]);
  return history.map((uci) => {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promo = uci.slice(4);
    const f = idx(from);
    const t = idx(to);
    const piece = b[f];
    if (!piece || piece === '.') return uci;
    let captured = b[t] !== '.';
    const kind = piece.toLowerCase();
    let label: string;
    if (kind === 'k' && Math.abs(t - f) === 2) {
      const kingSide = t > f;
      b[t] = piece;
      b[f] = '.';
      b[kingSide ? t - 1 : t + 1] = b[kingSide ? t + 1 : t - 2];
      b[kingSide ? t + 1 : t - 2] = '.';
      return kingSide ? 'O-O' : 'O-O-O';
    }
    if (kind === 'p' && from[0] !== to[0] && !captured) {
      // en passant: the captured pawn sits beside the destination
      b[piece === 'P' ? t + 8 : t - 8] = '.';
      captured = true;
    }
    if (kind === 'p') label = `${captured ? `${from[0]}x` : ''}${to}${promo ? `=${promo.toUpperCase()}` : ''}`;
    else label = `${kind.toUpperCase()}${captured ? 'x' : ''}${to}`;
    b[t] = promo ? (piece === 'P' ? promo.toUpperCase() : promo.toLowerCase()) : piece;
    b[f] = '.';
    return label;
  });
}

function CapturedRow({ pieces, advantage }: { pieces: string[]; advantage: number }) {
  const { colors } = useTheme();
  const sorted = [...pieces].sort((a, b) => PIECE_VALUES[b.toLowerCase()] - PIECE_VALUES[a.toLowerCase()]);
  if (!sorted.length && advantage <= 0) return null;
  return (
    <View style={styles.captured} accessible accessibilityLabel={`Captured: ${sorted.map(pieceName).join(', ') || 'nothing'}${advantage > 0 ? `. Up ${advantage}` : ''}`}>
      {sorted.map((p, i) => (
        <View key={`${p}-${i}`} style={{ marginLeft: i && sorted[i - 1] === p ? -8 : 0 }}>
          <PieceIcon piece={p} size={18} />
        </View>
      ))}
      {advantage > 0 ? (
        <Text variant="caption" tone="muted" style={{ marginLeft: 4, color: colors.textMuted }}>
          +{advantage}
        </Text>
      ) : null}
    </View>
  );
}

export function ChessBoard({ ctx }: { ctx: GameCtx }) {
  const { colors } = useTheme();
  const { game, meId, readOnly, pending } = ctx;
  const view = game.board as ChessBoardView;
  // Board colours come from the viewer's chess theme (theme-independent of light/dark mode).
  const { light: LIGHT, dark: DARK, frame: FRAME, highlight, lastMove } = useGameTheme().chess;
  const size = useBoardSize(520, 12);
  const sq = size / 8;
  const flipped = view.you === 'b';
  const [selected, setSelected] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<MoveAction[] | null>(null);

  const myTurn = !readOnly && view.status === 'active' && view.turn === meId;
  const moves = useMemo(() => (myTurn ? actionsOf<MoveAction>(game, 'move') : []), [game, myTurn]);
  const byFrom = useMemo(() => {
    const m = new Map<string, MoveAction[]>();
    for (const a of moves) m.set(a.from, [...(m.get(a.from) ?? []), a]);
    return m;
  }, [moves]);
  const sel = selected && byFrom.has(selected) ? selected : null;
  const targets = new Set((sel ? byFrom.get(sel) : [])?.map((a) => a.to));

  const whiteId = Object.keys(view.colors).find((p) => view.colors[p] === 'w') ?? null;
  const blackId = Object.keys(view.colors).find((p) => view.colors[p] === 'b') ?? null;
  const bottomId = flipped ? blackId : whiteId;
  const topId = flipped ? whiteId : blackId;
  const material = (list: string[]) => list.reduce((s, p) => s + PIECE_VALUES[p.toLowerCase()], 0);
  const diff = material(view.captured.w) - material(view.captured.b);

  // King in check (side to move).
  const checkSq = useMemo(() => {
    if (!view.check) return null;
    const king = view.side_to_move === 'w' ? 'K' : 'k';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (view.board[r][c] === king) return `${FILES[c]}${8 - r}`;
    return null;
  }, [view.board, view.check, view.side_to_move]);

  const history = useMemo(() => readableMoves(view.history), [view.history]);

  const play = async (a: MoveAction[]) => {
    setSelected(null);
    if (a.length > 1 || a[0].promotion) {
      setPromotion(a);
      return;
    }
    await ctx.act({ type: 'move', from: a[0].from, to: a[0].to });
  };

  const onSquare = (name: string) => {
    if (pending || !myTurn) return;
    if (sel && targets.has(name)) {
      play((byFrom.get(sel) ?? []).filter((a) => a.to === name));
      return;
    }
    if (byFrom.has(name)) {
      haptic.tap();
      setSelected(name === sel ? null : name);
    } else setSelected(null);
  };

  const resign = async () => {
    const ok = await confirm({ title: 'Resign this game?', message: 'Your opponent wins straight away.', confirmLabel: 'Resign', destructive: true });
    if (ok) ctx.act({ type: 'resign' });
  };

  const opponentOffered = !!view.draw_offer && view.draw_offer !== meId;
  const iOffered = view.draw_offer === meId;
  const turnName = nameOf(ctx, view.turn);
  const status =
    view.status !== 'active'
      ? 'Game over'
      : myTurn
        ? view.check
          ? 'Check! Your move'
          : 'Your move'
        : view.you
          ? `${view.check ? 'Check. ' : ''}Waiting for ${turnName}…`
          : `${view.side_to_move === 'w' ? 'White' : 'Black'} to move${view.check ? ' (check)' : ''}`;

  const playerBar = (pid: string | null, side: 'w' | 'b') => {
    const p = playerOf(game, pid);
    const toMove = view.status === 'active' && view.side_to_move === side;
    return (
      <View style={styles.playerBar}>
        <PlayerAvatar player={p} size={32} highlight={toMove} />
        <View style={{ flex: 1 }}>
          <Text variant="label" numberOfLines={1}>
            {nameOf(ctx, pid)} <Text variant="caption" tone="muted">· {side === 'w' ? 'White' : 'Black'}</Text>
          </Text>
          <CapturedRow pieces={view.captured[side]} advantage={side === 'w' ? diff : -diff} />
        </View>
        {toMove ? <View style={[styles.toMove, { backgroundColor: side === 'w' ? '#F5F5F0' : '#1E1E1E', borderColor: colors.borderStrong }]} /> : null}
      </View>
    );
  };

  return (
    <View style={{ gap: space.md }}>
      {!readOnly ? <TurnBanner mine={myTurn} text={status} tint={view.check ? colors.danger : undefined} /> : null}

      {opponentOffered && canDo(game, 'accept_draw') && !readOnly ? (
        <Card style={{ gap: space.sm, borderColor: colors.primary }}>
          <Text variant="bodyStrong">{nameOf(ctx, view.draw_offer)} offers a draw</Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title="Accept draw" size="sm" onPress={() => ctx.act({ type: 'accept_draw' })} disabled={pending} style={{ flex: 1 }} />
            <Button title="Decline" size="sm" variant="secondary" onPress={() => ctx.act({ type: 'decline_draw' })} disabled={pending} style={{ flex: 1 }} />
          </View>
        </Card>
      ) : null}

      {playerBar(topId, flipped ? 'w' : 'b')}

      <View style={[styles.frame, { width: size + 12, backgroundColor: FRAME, alignSelf: 'center' }]}>
        <View style={{ width: size, height: size }}>
          <Svg width={size} height={size}>
            <Defs>
              <RadialGradient id="check" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor="#FF2D2D" stopOpacity={0.95} />
                <Stop offset="0.6" stopColor="#E61E1E" stopOpacity={0.55} />
                <Stop offset="1" stopColor="#B00000" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            {Array.from({ length: 64 }, (_, i) => {
              const row = Math.floor(i / 8);
              const col = i % 8;
              const name = squareAt(row, col, flipped);
              const dark = (row + col) % 2 === 1;
              const x = col * sq;
              const y = row * sq;
              const isLast = view.last_move && (view.last_move.from === name || view.last_move.to === name);
              return (
                <G key={name}>
                  <Rect x={x} y={y} width={sq} height={sq} fill={dark ? DARK : LIGHT} />
                  {isLast ? <Rect x={x} y={y} width={sq} height={sq} fill={lastMove} /> : null}
                  {sel === name ? <Rect x={x} y={y} width={sq} height={sq} fill={highlight} opacity={0.75} /> : null}
                  {checkSq === name ? <Rect x={x} y={y} width={sq} height={sq} fill="url(#check)" /> : null}
                  {col === 0 ? (
                    <SvgText x={x + 3} y={y + 11} fontSize={Math.max(8, sq * 0.2)} fontWeight="700" fill={dark ? LIGHT : DARK}>
                      {name[1]}
                    </SvgText>
                  ) : null}
                  {row === 7 ? (
                    <SvgText x={x + sq - 3} y={y + sq - 3} fontSize={Math.max(8, sq * 0.2)} fontWeight="700" textAnchor="end" fill={dark ? LIGHT : DARK}>
                      {name[0]}
                    </SvgText>
                  ) : null}
                </G>
              );
            })}
            {Array.from({ length: 64 }, (_, i) => {
              const row = Math.floor(i / 8);
              const col = i % 8;
              const name = squareAt(row, col, flipped);
              const piece = pieceOn(view.board, name);
              return piece ? <PieceGlyph key={`p-${name}`} piece={piece} x={col * sq + sq * 0.05} y={row * sq + sq * 0.04} size={sq * 0.9} /> : null;
            })}
            {Array.from({ length: 64 }, (_, i) => {
              const row = Math.floor(i / 8);
              const col = i % 8;
              const name = squareAt(row, col, flipped);
              if (!targets.has(name)) return null;
              const cx = col * sq + sq / 2;
              const cy = row * sq + sq / 2;
              return pieceOn(view.board, name) ? (
                <Circle key={`t-${name}`} cx={cx} cy={cy} r={sq * 0.44} fill="none" stroke="#1B3B1B" strokeOpacity={0.45} strokeWidth={sq * 0.08} />
              ) : (
                <Circle key={`t-${name}`} cx={cx} cy={cy} r={sq * 0.15} fill="#1B3B1B" fillOpacity={0.4} />
              );
            })}
          </Svg>
          {/* Touch + accessibility layer */}
          <View style={StyleSheet.absoluteFill}>
            {Array.from({ length: 8 }, (_, row) => (
              <View key={row} style={{ flexDirection: 'row' }}>
                {Array.from({ length: 8 }, (_, col) => {
                  const name = squareAt(row, col, flipped);
                  const piece = pieceOn(view.board, name);
                  const isTarget = targets.has(name);
                  const movable = byFrom.has(name);
                  return (
                    <Pressable
                      key={name}
                      onPress={() => onSquare(name)}
                      disabled={!myTurn || pending}
                      style={{ width: sq, height: sq }}
                      accessibilityRole="button"
                      accessibilityLabel={`${name}, ${piece ? pieceName(piece) : 'empty'}${isTarget ? ', move here' : movable ? ', can move' : ''}${sel === name ? ', selected' : ''}`}
                      accessibilityState={{ selected: sel === name, disabled: !myTurn || (!isTarget && !movable) }}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      </View>

      {playerBar(bottomId, flipped ? 'b' : 'w')}

      {!readOnly && view.status === 'active' && ctx.isPlayer ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {canDo(game, 'offer_draw') ? (
            <Button title="Offer draw" icon={Handshake} variant="secondary" size="sm" onPress={() => ctx.act({ type: 'offer_draw' })} disabled={pending} style={{ flex: 1 }} />
          ) : iOffered ? (
            <View style={[styles.offered, { borderColor: colors.border }]}>
              <Text variant="caption" tone="muted">
                Draw offered…
              </Text>
            </View>
          ) : null}
          {canDo(game, 'resign') ? <Button title="Resign" icon={Flag} variant="outline" size="sm" onPress={resign} disabled={pending} style={{ flex: 1 }} /> : null}
        </View>
      ) : null}

      {history.length ? (
        <View style={{ gap: space.xs }}>
          <Text variant="label" tone="muted">
            Moves
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs }}>
            {Array.from({ length: Math.ceil(history.length / 2) }, (_, i) => (
              <View key={i} style={[styles.movePair, { backgroundColor: colors.surfaceAlt }]} accessible accessibilityLabel={`Move ${i + 1}: white ${history[i * 2]}${history[i * 2 + 1] ? `, black ${history[i * 2 + 1]}` : ''}`}>
                <Text variant="caption" tone="faint">
                  {i + 1}.
                </Text>
                <Text variant="caption">{history[i * 2]}</Text>
                {history[i * 2 + 1] ? <Text variant="caption">{history[i * 2 + 1]}</Text> : null}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <Sheet visible={!!promotion} onClose={() => setPromotion(null)} title="Promote your pawn">
        <View style={styles.promoRow}>
          {(['q', 'r', 'b', 'n'] as const).map((k) => {
            const piece = view.you === 'b' ? k : k.toUpperCase();
            const option = promotion?.find((a) => a.promotion === k);
            return (
              <PressableScale
                key={k}
                disabled={!option || pending}
                onPress={() => {
                  setPromotion(null);
                  if (option) ctx.act({ type: 'move', from: option.from, to: option.to, promotion: k });
                }}
                hapticFeedback="light"
                accessibilityLabel={`Promote to ${pieceName(piece).split(' ')[1]}`}
                style={[styles.promo, { backgroundColor: LIGHT, borderColor: FRAME }]}
              >
                <PieceIcon piece={piece} size={56} />
              </PressableScale>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { padding: 6, borderRadius: radius.sm, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  playerBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  captured: { flexDirection: 'row', alignItems: 'center', minHeight: 18 },
  toMove: { width: 14, height: 14, borderRadius: 7, borderWidth: 1 },
  offered: { flex: 1, height: 36, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  movePair: { flexDirection: 'row', gap: 6, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.sm },
  promoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm, paddingVertical: space.md },
  promo: { flex: 1, aspectRatio: 1, borderRadius: radius.md, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
