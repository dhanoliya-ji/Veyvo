import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Moon, PawPrint } from 'lucide-react-native';

import type { GameType } from '@/api/games-extra';
import { Text } from '@/components/ui';
import { PlayingCard } from './cards/PlayingCard';
import { PieceGlyph } from './chess/ChessPieces';
import { useGameTheme } from './GameParts';

const W = 160;
const H = 100;

function ChessArt() {
  const t = useGameTheme().chess;
  const sq = 25;
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
      <Rect x={0} y={0} width={W} height={H} fill={t.frame} />
      <G transform="translate(18 6) rotate(-8 60 50)">
        {Array.from({ length: 20 }, (_, i) => {
          const r = Math.floor(i / 5);
          const c = i % 5;
          return <Rect key={i} x={c * sq} y={r * sq} width={sq} height={sq} fill={(r + c) % 2 ? t.dark : t.light} />;
        })}
        <PieceGlyph piece="K" x={sq * 1} y={sq * 1} size={sq} />
        <PieceGlyph piece="n" x={sq * 3} y={sq * 0} size={sq} />
        <PieceGlyph piece="P" x={sq * 2} y={sq * 2} size={sq} />
        <PieceGlyph piece="q" x={sq * 4} y={sq * 2} size={sq} />
      </G>
    </Svg>
  );
}

function LudoArt() {
  const t = useGameTheme().ludo;
  const c = 10;
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
      <Defs>
        <RadialGradient id="pv-peg" cx="35%" cy="30%" r="70%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.9} />
          <Stop offset="0.4" stopColor={t.red} />
          <Stop offset="1" stopColor="#5A0D0D" />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={W} height={H} fill={t.board} />
      <G transform={`translate(${W / 2 - 7.5 * c} ${H / 2 - 7.5 * c})`}>
        <Rect x={0} y={0} width={6 * c} height={6 * c} fill={t.red} />
        <Rect x={9 * c} y={0} width={6 * c} height={6 * c} fill={t.green} />
        <Rect x={9 * c} y={9 * c} width={6 * c} height={6 * c} fill={t.yellow} />
        <Rect x={0} y={9 * c} width={6 * c} height={6 * c} fill={t.blue} />
        {[0, 9].map((x) => [0, 9].map((y) => <Rect key={`${x}${y}`} x={(x + 1) * c} y={(y + 1) * c} width={4 * c} height={4 * c} rx={6} fill={t.track} />))}
        {Array.from({ length: 6 }, (_, i) => (
          <G key={i}>
            <Rect x={i * c} y={6 * c} width={c} height={c} fill={t.track} stroke="#B9B2A4" strokeWidth={0.5} />
            <Rect x={i * c} y={8 * c} width={c} height={c} fill={t.track} stroke="#B9B2A4" strokeWidth={0.5} />
            <Rect x={(i + 9) * c} y={6 * c} width={c} height={c} fill={t.track} stroke="#B9B2A4" strokeWidth={0.5} />
            <Rect x={(i + 9) * c} y={8 * c} width={c} height={c} fill={t.track} stroke="#B9B2A4" strokeWidth={0.5} />
            <Rect x={6 * c} y={i * c} width={c} height={c} fill={t.track} stroke="#B9B2A4" strokeWidth={0.5} />
            <Rect x={8 * c} y={i * c} width={c} height={c} fill={t.track} stroke="#B9B2A4" strokeWidth={0.5} />
            <Rect x={6 * c} y={(i + 9) * c} width={c} height={c} fill={t.track} stroke="#B9B2A4" strokeWidth={0.5} />
            <Rect x={8 * c} y={(i + 9) * c} width={c} height={c} fill={t.track} stroke="#B9B2A4" strokeWidth={0.5} />
            {i ? <Rect x={i * c} y={7 * c} width={c} height={c} fill={t.red} /> : <Rect x={0} y={7 * c} width={c} height={c} fill={t.track} stroke="#B9B2A4" strokeWidth={0.5} />}
            {i ? <Rect x={7 * c} y={i * c} width={c} height={c} fill={t.green} /> : <Rect x={7 * c} y={0} width={c} height={c} fill={t.track} stroke="#B9B2A4" strokeWidth={0.5} />}
            {i ? <Rect x={(14 - i) * c} y={7 * c} width={c} height={c} fill={t.yellow} /> : null}
            {i ? <Rect x={7 * c} y={(14 - i) * c} width={c} height={c} fill={t.blue} /> : null}
          </G>
        ))}
        <Polygon points={`${6 * c},${6 * c} ${6 * c},${9 * c} ${7.5 * c},${7.5 * c}`} fill={t.red} />
        <Polygon points={`${6 * c},${6 * c} ${9 * c},${6 * c} ${7.5 * c},${7.5 * c}`} fill={t.green} />
        <Polygon points={`${9 * c},${6 * c} ${9 * c},${9 * c} ${7.5 * c},${7.5 * c}`} fill={t.yellow} />
        <Polygon points={`${6 * c},${9 * c} ${9 * c},${9 * c} ${7.5 * c},${7.5 * c}`} fill={t.blue} />
        <Circle cx={3.5 * c} cy={6.5 * c} r={4.2} fill="url(#pv-peg)" stroke="#5A0D0D" strokeWidth={0.8} />
        <Circle cx={2 * c} cy={2 * c} r={6} fill="url(#pv-peg)" stroke="#5A0D0D" strokeWidth={0.8} />
        <Circle cx={4 * c} cy={4 * c} r={6} fill="url(#pv-peg)" stroke="#5A0D0D" strokeWidth={0.8} />
      </G>
    </Svg>
  );
}

function CardsArt() {
  const back = useGameTheme().cardBack;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0F5A3A', alignItems: 'center', justifyContent: 'center' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <PlayingCard card={null} back={back} width={40} style={{ transform: [{ rotate: '-16deg' }, { translateY: 6 }], marginRight: -14 }} />
        <PlayingCard card="8S" width={44} style={{ transform: [{ rotate: '-4deg' }], marginRight: -14 }} />
        <PlayingCard card="QH" width={44} style={{ transform: [{ rotate: '8deg' }, { translateY: 2 }], marginRight: -14 }} />
        <PlayingCard card="7D" width={40} style={{ transform: [{ rotate: '18deg' }, { translateY: 8 }] }} />
      </View>
    </View>
  );
}

function ConnectArt() {
  const cell = 18;
  const grid = [
    [0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 2, 0, 0, 0],
    [0, 0, 1, 1, 0, 0, 0],
    [0, 2, 1, 2, 1, 0, 0],
    [1, 2, 2, 1, 2, 1, 0],
  ];
  const w = cell * 7;
  const h = cell * 6;
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
      <Defs>
        <LinearGradient id="pv-c4" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#2F6BE0" />
          <Stop offset="1" stopColor="#1A47A8" />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={W} height={H} fill="#0E1E44" />
      <G transform={`translate(${(W - w) / 2} ${(H - h) / 2 + 4})`}>
        <Rect x={-4} y={-4} width={w + 8} height={h + 8} rx={6} fill="url(#pv-c4)" />
        {grid.map((row, r) =>
          row.map((v, c) => <Circle key={`${r}-${c}`} cx={c * cell + cell / 2} cy={r * cell + cell / 2} r={cell * 0.38} fill={v === 1 ? '#E63946' : v === 2 ? '#F6C343' : '#0E1E44'} stroke="#123B8F" strokeWidth={1} />),
        )}
      </G>
    </Svg>
  );
}

function TruthArt() {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#1B1430', alignItems: 'center', justifyContent: 'center' }]}>
      <View style={{ flexDirection: 'row' }}>
        <View style={[styles.todCard, { backgroundColor: '#3BA3FF', transform: [{ rotate: '-10deg' }], marginRight: -10 }]}>
          <Text variant="tiny" style={{ color: '#fff', letterSpacing: 1.5 }}>
            TRUTH
          </Text>
        </View>
        <View style={[styles.todCard, { backgroundColor: '#FF4D6D', transform: [{ rotate: '9deg' }, { translateY: 4 }] }]}>
          <Text variant="tiny" style={{ color: '#fff', letterSpacing: 1.5 }}>
            DARE
          </Text>
        </View>
      </View>
    </View>
  );
}

function WolfArt() {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="pv-night" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#060B1E" />
            <Stop offset="1" stopColor="#24346A" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={W} height={H} fill="url(#pv-night)" />
        {[
          [14, 12], [40, 22], [70, 8], [100, 18], [140, 10], [126, 34], [24, 40], [150, 48],
        ].map(([x, y], i) => (
          <Circle key={i} cx={x} cy={y} r={i % 2 ? 0.9 : 1.4} fill="#fff" opacity={0.7} />
        ))}
        <Path d={`M0 ${H} L0 78 L18 70 L30 76 L44 64 L60 74 L78 60 L96 72 L112 62 L130 74 L146 66 L${W} 74 L${W} ${H} Z`} fill="#050914" />
      </Svg>
      <View style={{ position: 'absolute', right: 18, top: 10 }}>
        <Moon size={30} color="#F4E7B8" fill="#F4E7B8" />
      </View>
      <View style={{ position: 'absolute', left: 22, bottom: 14 }}>
        <PawPrint size={24} color="#E5484D" />
      </View>
    </View>
  );
}

/** Realistic mini illustration for a game's card (no cartoon art). */
export const GamePreview = memo(function GamePreview({ type, height = 100 }: { type: GameType; height?: number }) {
  return (
    <View style={{ height, alignSelf: 'stretch', borderRadius: 14, overflow: 'hidden' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {type === 'chess' ? <ChessArt /> : null}
      {type === 'ludo' ? <LudoArt /> : null}
      {type === 'crazy_eights' ? <CardsArt /> : null}
      {type === 'four_in_a_row' ? <ConnectArt /> : null}
      {type === 'truth_or_dare' ? <TruthArt /> : null}
      {type === 'werewolf' ? <WolfArt /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  todCard: { width: 58, height: 78, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)' },
});
