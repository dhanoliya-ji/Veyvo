import { memo } from 'react';
import { StyleSheet, Text as RNText, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect } from 'react-native-svg';

import type { Suit } from '@/api/games-extra';
import { CARD_BACKS, type CardBackTheme } from '@/lib/themes';

export const SUIT_NAMES: Record<Suit, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const RANK_NAMES: Record<string, string> = { A: 'Ace', J: 'Jack', Q: 'Queen', K: 'King' };
export const isRed = (suit: Suit) => suit === 'H' || suit === 'D';
const RED = '#C8102E';
const BLACK = '#111111';

export const rankOf = (card: string) => card.slice(0, -1);
export const suitOf = (card: string) => card.slice(-1) as Suit;

export function cardName(card: string): string {
  const r = rankOf(card);
  return `${RANK_NAMES[r] ?? r} of ${SUIT_NAMES[suitOf(card)]}`;
}

/** Crisp vector suit symbol (Unicode suits can render as emoji on Android). */
export const SuitIcon = memo(function SuitIcon({ suit, size, color }: { suit: Suit; size: number; color?: string }) {
  const fill = color ?? (isRed(suit) ? RED : BLACK);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {suit === 'H' ? <Path d="M12 21.5C12 21.5 2.5 15 2.5 8.6 2.5 5.5 4.9 3 7.9 3c1.8 0 3.2.9 4.1 2.3C12.9 3.9 14.3 3 16.1 3c3 0 5.4 2.5 5.4 5.6 0 6.4-9.5 12.9-9.5 12.9z" fill={fill} /> : null}
      {suit === 'D' ? <Path d="M12 1.5 20 12 12 22.5 4 12z" fill={fill} /> : null}
      {suit === 'S' ? (
        <Path d="M12 1.8S2.8 9.2 2.8 14.1c0 2.8 2.2 4.6 4.6 4.6 1.6 0 2.9-.8 3.6-1.8-.2 2-1 3.6-2.6 5.3h7.2c-1.6-1.7-2.4-3.3-2.6-5.3.7 1 2 1.8 3.6 1.8 2.4 0 4.6-1.8 4.6-4.6C21.2 9.2 12 1.8 12 1.8z" fill={fill} />
      ) : null}
      {suit === 'C' ? (
        <G fill={fill}>
          <Circle cx={12} cy={6.8} r={4.3} />
          <Circle cx={6.6} cy={13.6} r={4.3} />
          <Circle cx={17.4} cy={13.6} r={4.3} />
          <Circle cx={12} cy={12.4} r={2.6} />
          <Path d="M11 13h2l1.6 9.2H9.4z" />
        </G>
      ) : null}
    </Svg>
  );
});

/** Card back in the viewer's purchased style: base colour, fine lattice pattern and a centre medallion. */
const CardBack = memo(function CardBack({ width, height, theme }: { width: number; height: number; theme: CardBackTheme }) {
  const inset = width * 0.07;
  const step = width / 7;
  const lines: number[] = [];
  for (let k = -height; k < width + height; k += step) lines.push(k);
  return (
    <Svg width={width} height={height}>
      <Defs>
        <ClipPath id="backClip">
          <Rect x={inset} y={inset} width={width - inset * 2} height={height - inset * 2} rx={width * 0.05} />
        </ClipPath>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} rx={width * 0.08} fill={theme.border} />
      <Rect x={inset} y={inset} width={width - inset * 2} height={height - inset * 2} rx={width * 0.05} fill={theme.base} />
      <G clipPath="url(#backClip)">
        {lines.map((k) => (
          <Line key={`a${k}`} x1={k} y1={0} x2={k + height} y2={height} stroke={theme.pattern} strokeOpacity={0.8} strokeWidth={0.8} />
        ))}
        {lines.map((k) => (
          <Line key={`b${k}`} x1={k} y1={height} x2={k + height} y2={0} stroke={theme.pattern} strokeOpacity={0.8} strokeWidth={0.8} />
        ))}
      </G>
      <Rect x={inset * 1.6} y={inset * 1.6} width={width - inset * 3.2} height={height - inset * 3.2} rx={width * 0.04} fill="none" stroke={theme.border} strokeOpacity={0.7} strokeWidth={1} />
      <Circle cx={width / 2} cy={height / 2} r={width * 0.17} fill={theme.base} stroke={theme.border} strokeWidth={1.2} />
      <Path
        d={`M${width / 2} ${height / 2 - width * 0.1} L${width / 2 + width * 0.07} ${height / 2} L${width / 2} ${height / 2 + width * 0.1} L${width / 2 - width * 0.07} ${height / 2} Z`}
        fill={theme.pattern}
      />
    </Svg>
  );
});

type Props = { card: string | null; width: number; style?: StyleProp<ViewStyle>; dimmed?: boolean; highlight?: boolean; back?: CardBackTheme };

/** A realistic playing card. `card` is e.g. "10H" or "QS"; null renders the back. */
export const PlayingCard = memo(function PlayingCard({ card, width, style, dimmed, highlight, back = CARD_BACKS.navy }: Props) {
  const height = Math.round(width * 1.4);
  const base: ViewStyle = { width, height, borderRadius: width * 0.08 };
  if (!card) {
    return (
      <View style={[styles.shadow, base, style]}>
        <CardBack width={width} height={height} theme={back} />
      </View>
    );
  }
  const r = rankOf(card);
  const s = suitOf(card);
  const color = isRed(s) ? RED : BLACK;
  const corner = Math.max(9, width * 0.2);
  const face = r === 'J' || r === 'Q' || r === 'K';
  return (
    <View style={[styles.shadow, styles.face, base, { borderColor: highlight ? '#F5B700' : '#D6D3CC', borderWidth: highlight ? 2 : StyleSheet.hairlineWidth }, style]}>
      <View style={[styles.corner, { left: width * 0.06, top: width * 0.05 }]}>
        <RNText style={[styles.rank, { color, fontSize: corner, lineHeight: corner * 1.05 }]} allowFontScaling={false}>
          {r}
        </RNText>
        <SuitIcon suit={s} size={corner * 0.8} />
      </View>
      <View style={[styles.corner, { right: width * 0.06, bottom: width * 0.05, transform: [{ rotate: '180deg' }] }]}>
        <RNText style={[styles.rank, { color, fontSize: corner, lineHeight: corner * 1.05 }]} allowFontScaling={false}>
          {r}
        </RNText>
        <SuitIcon suit={s} size={corner * 0.8} />
      </View>
      <View style={styles.center} pointerEvents="none">
        {face ? (
          <View style={[styles.faceFrame, { width: width * 0.56, height: height * 0.58, borderColor: color }]}>
            <RNText style={{ color, fontSize: width * 0.34, fontFamily: 'Inter_800ExtraBold', lineHeight: width * 0.4 }} allowFontScaling={false}>
              {r}
            </RNText>
            <SuitIcon suit={s} size={width * 0.22} />
          </View>
        ) : (
          <SuitIcon suit={s} size={width * (r === 'A' ? 0.5 : r === '8' ? 0.46 : 0.4)} />
        )}
      </View>
      {dimmed ? <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20,20,30,0.28)', borderRadius: width * 0.08 }]} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  shadow: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  face: { backgroundColor: '#FFFFFF' },
  corner: { position: 'absolute', alignItems: 'center' },
  rank: { fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  faceFrame: { borderWidth: 1.2, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FBF6EA' },
});
