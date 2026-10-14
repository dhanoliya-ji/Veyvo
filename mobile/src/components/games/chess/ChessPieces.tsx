import { memo } from 'react';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

/*
 * Piece silhouettes on a 45x45 grid, adapted from Colin M. L. Burnett's classic chess set
 * (Wikimedia Commons, licensed GPLv2+ / GFDL / BSD). Drawn with react-native-svg so they look the same on every device
 * (Unicode chess glyphs render as emoji on some Android builds).
 */

type Kind = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
type Shape = { body: string[]; details?: string[]; outlineDetails?: string[]; circles?: [number, number, number][]; whiteDetails?: boolean };

const SHAPES: Record<Kind, Shape> = {
  p: {
    body: [
      'M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03C15.41 27.09 11 31.58 11 39.5h23c0-7.92-4.41-12.41-7.41-13.47C28.06 24.84 29 23.03 29 21c0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z',
    ],
  },
  r: {
    body: ['M9 39h27v-3H9v3z', 'M12 36v-4h21v4H12z', 'M11 14V9h4v2h5V9h5v2h5V9h4v5z', 'M34 14l-3 3H14l-3-3z', 'M31 17v12.5H14V17z', 'M31 29.5l1.5 2.5h-20l1.5-2.5z'],
    details: ['M12 35.5h21', 'M13 31.5h19', 'M14 29.5h17', 'M14 16.5h17', 'M11 14h23'],
  },
  n: {
    body: [
      'M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21',
      'M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.04-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-1-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-2 2.5-3c1 0 1 3 1 3',
    ],
  },
  b: {
    body: [
      'M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.46 3-2 3-2z',
      'M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z',
    ],
    circles: [[22.5, 8, 2.5]],
    details: ['M17.5 26h10M15 30h15M22.5 15.5v5M20 18h5'],
    whiteDetails: true,
  },
  q: {
    body: [
      'M9 26c8.5-1.5 21-1.5 27 0l2.5-12.5L31 25l-.3-14.1-5.2 13.6-3-14.5-3 14.5-5.2-13.6L14 25 6.5 13.5 9 26z',
      'M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1 2.5-1 2.5-1.5 1.5 0 2.5 0 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z',
    ],
    circles: [
      [6, 12, 2],
      [14, 9, 2],
      [22.5, 8, 2],
      [31, 9, 2],
      [39, 12, 2],
    ],
    details: ['M11.5 30c3.5-1 18.5-1 22 0', 'M12 33.5c6-1 15-1 21 0'],
  },
  k: {
    body: [
      'M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5',
      'M12.5 37c5.5 3.5 14.5 3.5 20 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-2.5-7.5-12-10.5-16-4-3 6 6 10.5 6 10.5v7z',
    ],
    outlineDetails: ['M22.5 11.63V6', 'M20 8h5'],
    details: ['M12.5 30c5.5-3 14.5-3 20 0', 'M12.5 33.5c5.5-3 14.5-3 20 0', 'M12.5 37c5.5-3 14.5-3 20 0'],
    whiteDetails: true,
  },
};

const WHITE = { fill: '#FBFAF6', outline: '#1E1E1E', detail: '#1E1E1E' };
const BLACK = { fill: '#2A2A2C', outline: '#050505', detail: '#D8D8D8' };

/** One piece drawn inside an existing <Svg>, occupying a `size` square at (x, y). `piece` uses FEN letters. */
export const PieceGlyph = memo(function PieceGlyph({ piece, x, y, size, shadow = true }: { piece: string; x: number; y: number; size: number; shadow?: boolean }) {
  const kind = piece.toLowerCase() as Kind;
  const shape = SHAPES[kind];
  if (!shape) return null;
  const white = piece === piece.toUpperCase();
  const c = white ? WHITE : BLACK;
  const details = white && !shape.whiteDetails ? undefined : shape.details;
  const k = size / 45;
  return (
    <G transform={`translate(${x} ${y}) scale(${k})`}>
      {shadow ? (
        <G transform="translate(1 1.6)" opacity={0.28}>
          {shape.body.map((d) => (
            <Path key={d} d={d} fill="#000" />
          ))}
          {shape.circles?.map(([cx, cy, r]) => <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="#000" />)}
        </G>
      ) : null}
      {shape.outlineDetails?.map((d) => <Path key={d} d={d} fill="none" stroke={c.outline} strokeWidth={1.5} strokeLinecap="round" />)}
      {shape.body.map((d) => (
        <Path key={d} d={d} fill={c.fill} stroke={c.outline} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {shape.circles?.map(([cx, cy, r]) => <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill={c.fill} stroke={c.outline} strokeWidth={1.5} />)}
      {details?.map((d) => <Path key={d} d={d} fill="none" stroke={c.detail} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />)}
      {kind === 'n' ? (
        <>
          <Circle cx={9} cy={25.5} r={0.9} fill={c.detail} />
          <Ellipse cx={14.5} cy={15.5} rx={0.7} ry={1.5} fill={c.detail} transform="rotate(30 14.5 15.5)" />
        </>
      ) : null}
    </G>
  );
});

/** Stand-alone piece icon (captured pieces, promotion picker). */
export function PieceIcon({ piece, size = 20 }: { piece: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <PieceGlyph piece={piece} x={0} y={0} size={size} shadow={size > 28} />
    </Svg>
  );
}

export const PIECE_NAMES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function pieceName(piece: string): string {
  return `${piece === piece.toUpperCase() ? 'white' : 'black'} ${PIECE_NAMES[piece.toLowerCase()] ?? 'piece'}`;
}
