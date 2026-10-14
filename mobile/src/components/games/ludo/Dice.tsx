import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { PressableScale } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.27, 0.27],
    [0.73, 0.73],
  ],
  3: [
    [0.27, 0.27],
    [0.5, 0.5],
    [0.73, 0.73],
  ],
  4: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  5: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.5, 0.5],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  6: [
    [0.27, 0.25],
    [0.73, 0.25],
    [0.27, 0.5],
    [0.73, 0.5],
    [0.27, 0.75],
    [0.73, 0.75],
  ],
};

/** Ivory die with depth, bevel and recessed pips. */
function DieFace({ value, size }: { value: number | null; size: number }) {
  const depth = size * 0.08;
  const face = size - depth;
  const r = face * 0.18;
  return (
    <Svg width={size} height={size}>
      <Defs>
        <LinearGradient id="dieFace" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.55" stopColor="#F4F1EA" />
          <Stop offset="1" stopColor="#DCD6CA" />
        </LinearGradient>
        <RadialGradient id="diePip" cx="40%" cy="35%" r="65%">
          <Stop offset="0" stopColor="#4A4A4A" />
          <Stop offset="1" stopColor="#0E0E0E" />
        </RadialGradient>
      </Defs>
      {/* side / depth */}
      <Rect x={depth} y={depth} width={face} height={face} rx={r} fill="#A69E8F" />
      <Rect x={depth * 0.5} y={depth * 0.5} width={face} height={face} rx={r} fill="#C8C1B3" />
      <Rect x={0} y={0} width={face} height={face} rx={r} fill="url(#dieFace)" stroke="#BDB5A6" strokeWidth={1} />
      {(value ? PIPS[value] : []).map(([px, py], i) => (
        <Circle key={i} cx={px * face} cy={py * face} r={face * 0.085} fill={value === 1 ? '#B3261E' : 'url(#diePip)'} />
      ))}
    </Svg>
  );
}

/**
 * Animated die. `rollKey` changes whenever the server reports a new roll; the die tumbles through faces and lands
 * on `value`. The value always comes from the server.
 */
export function Dice({ value, rollKey, size = 64, onPress, disabled, label }: { value: number | null; rollKey: number | null; size?: number; onPress?: () => void; disabled?: boolean; label: string }) {
  const { reduceMotion } = useTheme();
  const rot = useSharedValue(0);
  const scale = useSharedValue(1);
  const lift = useSharedValue(0);
  const [face, setFace] = useState<number | null>(value);
  const first = useRef(true);

  useEffect(() => {
    if (first.current || reduceMotion || rollKey === null) {
      first.current = false;
      setFace(value);
      return;
    }
    rot.value = 0;
    rot.value = withTiming(720, { duration: 650, easing: Easing.out(Easing.cubic) });
    scale.value = withSequence(withTiming(1.18, { duration: 180 }), withSpring(1, { damping: 9, stiffness: 180 }));
    lift.value = withSequence(withTiming(-14, { duration: 200, easing: Easing.out(Easing.quad) }), withSpring(0, { damping: 7, stiffness: 200 }));
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      if (n >= 7) {
        clearInterval(t);
        setFace(value);
      } else setFace(1 + ((n * 7 + (value ?? 3)) % 6));
    }, 80);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollKey]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: lift.value }, { rotate: `${rot.value}deg` }, { scale: scale.value }] }));
  const die = (
    <Animated.View style={style}>
      <DieFace value={face} size={size} />
    </Animated.View>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label}>
        {die}
      </View>
    );
  }
  return (
    <PressableScale onPress={onPress} disabled={disabled} hapticFeedback="medium" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}>
      {die}
    </PressableScale>
  );
}
