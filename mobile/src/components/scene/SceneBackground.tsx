import { memo, type JSX } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import type { Scene } from '@/api/types';

export const SCENE_META: Record<Scene, { name: string; tint: string }> = {
  cafe: { name: 'Cosy café', tint: '#E7A86B' },
  campfire: { name: 'Campfire', tint: '#FF9F5A' },
  library: { name: 'Library', tint: '#C7A27A' },
  rooftop: { name: 'Rooftop', tint: '#9385FF' },
  beach: { name: 'Beach at dusk', tint: '#FF8F9A' },
  space: { name: 'Space station', tint: '#5AA9E6' },
};

/** Seat positions as fractions of the scene's width/height, front row last so it overlaps. */
export const SCENE_SEATS: [number, number][] = [
  [0.2, 0.62],
  [0.4, 0.58],
  [0.6, 0.58],
  [0.8, 0.62],
  [0.12, 0.84],
  [0.32, 0.86],
  [0.5, 0.88],
  [0.68, 0.86],
  [0.88, 0.84],
];

const W = 360;
const H = 220;

function Cafe() {
  return (
    <G>
      <Rect width={W} height={H} fill="url(#cafeWall)" />
      <Rect x={28} y={26} width={120} height={78} rx={10} fill="#1C2340" />
      <Path d="M28 80 L50 66 L66 74 L84 58 L104 70 L120 62 L148 76 L148 104 L28 104 Z" fill="#2B3561" />
      {[[44, 40], [70, 34], [96, 46], [128, 38]].map(([x, y]) => (
        <Circle key={`${x}`} cx={x} cy={y} r={1.6} fill="#FFE6A8" />
      ))}
      <Rect x={84} y={26} width={4} height={78} fill="#6B4630" />
      <Rect x={28} y={62} width={120} height={4} fill="#6B4630" />
      <Rect x={22} y={22} width={132} height={86} rx={12} fill="none" stroke="#6B4630" strokeWidth={6} />
      {[200, 252, 304].map((x) => (
        <G key={x}>
          <Path d={`M${x} 0 L${x} 30`} stroke="#3B2A22" strokeWidth={2} />
          <Path d={`M${x - 14} 44 Q${x} 26 ${x + 14} 44 Z`} fill="#F2B45B" />
          <Ellipse cx={x} cy={46} rx={9} ry={5} fill="#FFE6A8" opacity={0.55} />
        </G>
      ))}
      <Rect x={186} y={78} width={150} height={10} rx={3} fill="#5A3A28" />
      {[200, 226, 252, 286, 312].map((x, i) => (
        <Rect key={x} x={x} y={56 + (i % 2) * 4} width={14} height={22 - (i % 2) * 4} rx={3} fill={['#F2B45B', '#FF8F9A', '#9385FF', '#43CFA0', '#F5F5FB'][i]} opacity={0.9} />
      ))}
      <Path d="M330 120 C318 96 340 84 344 70 C350 86 360 98 346 120 Z" fill="#3E8E6A" />
      <Rect x={326} y={118} width={22} height={18} rx={4} fill="#B5651D" />
      <Rect y={128} width={W} height={92} fill="url(#cafeFloor)" />
    </G>
  );
}

function Campfire() {
  return (
    <G>
      <Rect width={W} height={H} fill="url(#nightSky)" />
      {[[30, 20], [80, 40], [130, 14], [190, 34], [240, 18], [300, 30], [340, 12], [60, 70], [270, 64], [160, 60]].map(([x, y]) => (
        <Circle key={`${x}-${y}`} cx={x} cy={y} r={1.3} fill="#FFFFFF" opacity={0.85} />
      ))}
      <Circle cx={300} cy={44} r={16} fill="#F5EBC8" />
      <Path d="M0 120 L30 70 L60 120 Z M40 124 L76 60 L112 124 Z M250 124 L290 58 L330 124 Z M300 120 L336 72 L372 120 Z" fill="#14233A" />
      <Rect y={118} width={W} height={102} fill="url(#grass)" />
      <Ellipse cx={180} cy={150} rx={60} ry={14} fill="#FFB35A" opacity={0.18} />
      <Path d="M160 152 L200 140 M162 140 L198 152" stroke="#6B4630" strokeWidth={7} strokeLinecap="round" />
      <Path d="M180 146 C164 132 170 116 180 104 C182 116 196 122 190 138 C196 132 198 126 196 120 C206 132 200 146 180 146 Z" fill="#FF8A3D" />
      <Path d="M180 146 C172 138 174 128 180 120 C182 128 190 132 186 142 Z" fill="#FFD166" />
    </G>
  );
}

function Library() {
  const shelves = [30, 74, 118];
  const bookColors = ['#9385FF', '#FF8F9A', '#43CFA0', '#FFC857', '#5AA9E6', '#C68642', '#E4572E'];
  return (
    <G>
      <Rect width={W} height={H} fill="#2A2235" />
      {[0, 1].map((side) => (
        <G key={side} transform={`translate(${side === 0 ? 14 : 214}, 0)`}>
          <Rect x={0} y={14} width={132} height={124} rx={6} fill="#4A3226" />
          {shelves.map((y) => (
            <G key={y}>
              <Rect x={6} y={y + 34} width={120} height={6} fill="#6B4630" />
              {Array.from({ length: 9 }).map((_, i) => (
                <Rect key={i} x={10 + i * 13} y={y + 6 + (i % 3) * 2} width={10} height={28 - (i % 3) * 2} rx={1.5} fill={bookColors[(i + y) % bookColors.length]} opacity={0.88} />
              ))}
            </G>
          ))}
        </G>
      ))}
      <Rect x={160} y={30} width={40} height={64} rx={20} fill="#1C2340" />
      <Circle cx={180} cy={52} r={7} fill="#F5EBC8" />
      <Rect y={136} width={W} height={84} fill="#3B2A22" />
      <Rect y={136} width={W} height={4} fill="#4A3226" />
    </G>
  );
}

function Rooftop() {
  return (
    <G>
      <Rect width={W} height={H} fill="url(#duskSky)" />
      {[[20, 40, 28, 80], [52, 20, 34, 100], [90, 54, 26, 66], [120, 30, 30, 90], [156, 60, 22, 60], [182, 16, 36, 104], [222, 44, 28, 76], [254, 26, 32, 94], [290, 52, 24, 68], [318, 34, 34, 86]].map(([x, y, w, h]) => (
        <G key={x}>
          <Rect x={x} y={y + 20} width={w} height={h} fill="#262148" />
          {Array.from({ length: Math.floor(h / 14) }).map((_, i) => (
            <Rect key={i} x={x + 6} y={y + 28 + i * 14} width={5} height={5} fill="#FFD98A" opacity={(i + x) % 3 === 0 ? 0.9 : 0.25} />
          ))}
        </G>
      ))}
      <Path d="M0 30 Q90 60 180 34 Q270 8 360 36" stroke="#2D2F45" strokeWidth={1.2} fill="none" />
      {Array.from({ length: 14 }).map((_, i) => {
        const x = 12 + i * 25;
        const y = 30 + Math.sin((i / 13) * Math.PI * 2) * 12 + 10;
        return <Circle key={i} cx={x} cy={y} r={3} fill={['#FFC857', '#FF8F9A', '#9385FF'][i % 3]} />;
      })}
      <Rect y={126} width={W} height={94} fill="#3A3550" />
      <Rect y={122} width={W} height={8} fill="#4A4566" />
    </G>
  );
}

function Beach() {
  return (
    <G>
      <Rect width={W} height={H} fill="url(#sunset)" />
      <Circle cx={180} cy={92} r={30} fill="#FFD166" opacity={0.95} />
      <Rect y={96} width={W} height={34} fill="#4B5BA8" />
      {[104, 112, 120].map((y) => (
        <Path key={y} d={`M${150 - (y - 100)} ${y} L${210 + (y - 100)} ${y}`} stroke="#FFD166" strokeWidth={2} opacity={0.5} />
      ))}
      <Path d="M300 128 C304 98 310 70 318 52" stroke="#5A3A28" strokeWidth={6} fill="none" />
      <Path d="M318 52 C300 44 288 50 280 60 M318 52 C330 40 346 42 354 50 M318 52 C312 34 320 24 330 22 M318 52 C336 56 342 66 344 76" stroke="#2F7A5A" strokeWidth={7} strokeLinecap="round" fill="none" />
      <Rect y={128} width={W} height={92} fill="#E9C38E" />
      <Path d="M0 128 Q90 136 180 128 Q270 120 360 128 L360 134 Q270 128 180 136 Q90 142 0 134 Z" fill="#F5F5FB" opacity={0.6} />
    </G>
  );
}

function Space() {
  return (
    <G>
      <Rect width={W} height={H} fill="#0B0D1E" />
      {Array.from({ length: 30 }).map((_, i) => (
        <Circle key={i} cx={(i * 73) % W} cy={(i * 41) % 120} r={i % 4 === 0 ? 1.6 : 0.9} fill="#FFFFFF" opacity={0.8} />
      ))}
      <Circle cx={92} cy={64} r={34} fill="#5AA9E6" />
      <Path d="M62 56 Q92 46 122 60" stroke="#3B7FBF" strokeWidth={6} fill="none" opacity={0.7} />
      <Ellipse cx={92} cy={64} rx={56} ry={10} stroke="#FFC857" strokeWidth={3} fill="none" opacity={0.75} />
      <Rect x={14} y={8} width={332} height={118} rx={26} fill="none" stroke="#2D2F45" strokeWidth={10} />
      <Rect y={126} width={W} height={94} fill="#1D2033" />
      {[40, 120, 200, 280].map((x) => (
        <Rect key={x} x={x} y={140} width={40} height={4} rx={2} fill="#43CFA0" opacity={0.5} />
      ))}
    </G>
  );
}

const SCENES: Record<Scene, () => JSX.Element> = { cafe: Cafe, campfire: Campfire, library: Library, rooftop: Rooftop, beach: Beach, space: Space };

/** Illustrated backdrop for a hangout. Scales to fill its container. */
export const SceneBackground = memo(function SceneBackground({ scene }: { scene: Scene }) {
  const Body = SCENES[scene] ?? Cafe;
  return (
    <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
      <Defs>
        <LinearGradient id="cafeWall" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#4A2F2A" />
          <Stop offset="1" stopColor="#3A2420" />
        </LinearGradient>
        <LinearGradient id="cafeFloor" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#6B4630" />
          <Stop offset="1" stopColor="#4A3226" />
        </LinearGradient>
        <LinearGradient id="nightSky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#141633" />
          <Stop offset="1" stopColor="#2A2650" />
        </LinearGradient>
        <LinearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1F3B3A" />
          <Stop offset="1" stopColor="#152A29" />
        </LinearGradient>
        <LinearGradient id="duskSky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#2A2650" />
          <Stop offset="1" stopColor="#6A4C8C" />
        </LinearGradient>
        <LinearGradient id="sunset" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#5B3B8C" />
          <Stop offset="0.6" stopColor="#FF8F9A" />
          <Stop offset="1" stopColor="#FFC27A" />
        </LinearGradient>
      </Defs>
      <Body />
    </Svg>
  );
});
