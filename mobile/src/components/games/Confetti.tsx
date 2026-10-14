import { memo, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { useTheme } from '@/theme/ThemeProvider';

/** Small deterministic PRNG so each burst looks random but rendering stays pure. */
function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(value: string | number): number {
  const str = String(value);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

type Piece = { dx: number; dy: number; rot: number; delay: number; color: string; w: number; h: number; round: boolean };

const ConfettiPiece = memo(function ConfettiPiece({ piece, originX, originY }: { piece: Piece; originX: number; originY: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(piece.delay, withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }));
  }, [piece.delay, t]);
  const style = useAnimatedStyle(() => {
    const p = t.value;
    // Burst outward, then let gravity pull the piece down as it fades.
    return {
      opacity: p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25,
      transform: [
        { translateX: piece.dx * p },
        { translateY: piece.dy * p + 160 * p * p },
        { rotate: `${piece.rot * p}deg` },
        { scale: p < 0.1 ? p * 10 : 1 },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        { position: 'absolute', left: originX, top: originY, width: piece.w, height: piece.h, backgroundColor: piece.color, borderRadius: piece.round ? piece.w : 2 },
        style,
      ]}
    />
  );
});

/**
 * Celebration burst made from simple animated views. Change `burstKey` to fire again.
 * Renders nothing when reduce-motion is on.
 */
export function Confetti({ burstKey, count = 22, originX = 0.5, originY = 0.35 }: { burstKey: number | string | null; count?: number; originX?: number; originY?: number }) {
  const { colors, reduceMotion } = useTheme();
  const palette = [colors.primary, colors.accent, colors.success, colors.gold, '#5AA9E6'];
  const pieces = useMemo<Piece[]>(() => {
    const rand = seeded(hash(burstKey ?? 0));
    return Array.from({ length: count }, (_, i) => {
      const angle = (Math.PI * 2 * i) / count + rand() * 0.5;
      const dist = 90 + rand() * 110;
      return {
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist - 60,
        rot: (rand() - 0.5) * 720,
        delay: rand() * 120,
        color: palette[i % palette.length],
        w: 6 + rand() * 6,
        h: 8 + rand() * 8,
        round: rand() > 0.6,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burstKey, count]);
  if (reduceMotion || burstKey === null) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ position: 'absolute', left: `${originX * 100}%`, top: `${originY * 100}%` }}>
        {pieces.map((p, i) => (
          <ConfettiPiece key={`${burstKey}-${i}`} piece={p} originX={0} originY={0} />
        ))}
      </View>
    </View>
  );
}
