import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';

import { CARD_BACKS, CHESS_THEMES, LUDO_THEMES } from '@/lib/themes';

type Props = { slot: 'chess_board' | 'card_back' | 'ludo_board'; value: string; size: number };

/** A realistic miniature of a game theme: a chess board corner, a card back, or a Ludo board. */
export function ThemePreview({ slot, value, size }: Props) {
  if (slot === 'chess_board') {
    const t = CHESS_THEMES[value] ?? CHESS_THEMES.classic;
    const n = 4;
    const sq = 100 / n;
    return (
      <Svg width={size} height={size} viewBox="-6 -6 112 112">
        <Rect x={-6} y={-6} width={112} height={112} rx={8} fill={t.frame} />
        {Array.from({ length: n * n }).map((_, i) => {
          const r = Math.floor(i / n);
          const c = i % n;
          return <Rect key={i} x={c * sq} y={r * sq} width={sq} height={sq} fill={(r + c) % 2 === 0 ? t.light : t.dark} />;
        })}
        {/* a knight silhouette for character */}
        <Path d="M58 80 L82 80 L80 72 C79 62 76 52 70 46 C72 42 71 38 68 36 L64 40 C58 40 52 46 50 54 L56 56 L52 62 L58 64 Z" fill="#F8F8F8" stroke="#222" strokeWidth={2} />
      </Svg>
    );
  }
  if (slot === 'card_back') {
    const t = CARD_BACKS[value] ?? CARD_BACKS.navy;
    const w = size * 0.72;
    return (
      <Svg width={w} height={size} viewBox="0 0 72 100">
        <Rect x={1} y={1} width={70} height={98} rx={7} fill={t.border} stroke="rgba(0,0,0,0.25)" strokeWidth={1} />
        <Rect x={5} y={5} width={62} height={90} rx={4} fill={t.base} />
        <G stroke={t.pattern} strokeWidth={2}>
          {Array.from({ length: 12 }).map((_, i) => (
            <Line key={`a${i}`} x1={5 + i * 8} y1={5} x2={-40 + i * 8} y2={95} />
          ))}
          {Array.from({ length: 12 }).map((_, i) => (
            <Line key={`b${i}`} x1={-40 + i * 8} y1={5} x2={5 + i * 8} y2={95} />
          ))}
        </G>
        <Rect x={5} y={5} width={62} height={90} rx={4} fill="none" stroke={t.border} strokeWidth={1.5} />
        <Circle cx={36} cy={50} r={11} fill={t.base} stroke={t.border} strokeWidth={1.5} />
        <Path d="M36 43 L42 50 L36 57 L30 50 Z" fill={t.border} />
      </Svg>
    );
  }
  const t = LUDO_THEMES[value] ?? LUDO_THEMES.classic;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Rect x={0} y={0} width={100} height={100} rx={8} fill={t.board} />
      <Rect x={4} y={4} width={36} height={36} rx={4} fill={t.red} />
      <Rect x={60} y={4} width={36} height={36} rx={4} fill={t.green} />
      <Rect x={4} y={60} width={36} height={36} rx={4} fill={t.blue} />
      <Rect x={60} y={60} width={36} height={36} rx={4} fill={t.yellow} />
      {[
        [22, 22, t.red],
        [78, 22, t.green],
        [22, 78, t.blue],
        [78, 78, t.yellow],
      ].map(([x, y, c]) => (
        <G key={`${x}-${y}`}>
          <Circle cx={x as number} cy={y as number} r={11} fill={t.track} />
          <Circle cx={x as number} cy={y as number} r={6} fill={c as string} stroke="rgba(0,0,0,0.3)" strokeWidth={1} />
        </G>
      ))}
      <Rect x={40} y={4} width={20} height={92} fill={t.track} />
      <Rect x={4} y={40} width={92} height={20} fill={t.track} />
      <Path d="M40 40 L60 40 L50 50 Z" fill={t.green} />
      <Path d="M60 40 L60 60 L50 50 Z" fill={t.yellow} />
      <Path d="M60 60 L40 60 L50 50 Z" fill={t.blue} />
      <Path d="M40 60 L40 40 L50 50 Z" fill={t.red} />
    </Svg>
  );
}
