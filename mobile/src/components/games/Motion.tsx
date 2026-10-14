import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { Text, type TextProps } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';

/** Number that counts up from its previous value. Static when reduce-motion is on. */
export function CountUp({ value, duration = 700, prefix = '', suffix = '', style, ...text }: { value: number; duration?: number; prefix?: string; suffix?: string; style?: StyleProp<TextStyle> } & Omit<TextProps, 'children'>) {
  const { reduceMotion } = useTheme();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduceMotion || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = Date.now();
    const a = from.current;
    let raf = 0;
    const step = () => {
      const p = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      setShown(Math.round(a + (value - a) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value, duration, reduceMotion]);
  return (
    <Text {...text} style={style} accessibilityLabel={`${prefix}${value}${suffix}`}>
      {prefix}
      {shown.toLocaleString()}
      {suffix}
    </Text>
  );
}

/** Pops its children in (scale + fade) whenever `popKey` changes. */
export function Pop({ popKey, children, style }: { popKey: string | number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { reduceMotion } = useTheme();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    scale.value = 0.4;
    opacity.value = 0;
    scale.value = withSpring(1, { damping: 11, stiffness: 220 });
    opacity.value = withTiming(1, { duration: 160 });
  }, [popKey, reduceMotion, scale, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/** Small "thump" when `pulseKey` changes, e.g. on lock-in. */
export function Pulse({ pulseKey, children, style }: { pulseKey: string | number | null; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { reduceMotion } = useTheme();
  const scale = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion || pulseKey === null) return;
    scale.value = withSequence(withTiming(1.05, { duration: 110 }), withSpring(1, { damping: 12, stiffness: 260 }));
  }, [pulseKey, reduceMotion, scale]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/**
 * Bar that shrinks to empty at `endsAt` (device clock, ms); `now` is the parent's ticking clock. `totalMs` is the full phase length.
 * With reduce-motion on it simply reflects the parent's re-renders without animating.
 */
export function TimerBar({ endsAt, now, totalMs, height = 8, color }: { endsAt: number; now: number; totalMs: number; height?: number; color?: string }) {
  const { colors, reduceMotion } = useTheme();
  const remaining = Math.max(0, endsAt - now);
  const frac = totalMs > 0 ? Math.max(0, Math.min(1, remaining / totalMs)) : 0;
  const width = useSharedValue(frac);
  // Only restart when the deadline moves noticeably (new phase or a clock correction).
  const deadlineKey = Math.round(endsAt / 250);
  useEffect(() => {
    if (reduceMotion) return;
    const left = Math.max(0, endsAt - Date.now());
    width.value = totalMs > 0 ? Math.min(1, left / totalMs) : 0;
    width.value = withTiming(0, { duration: left, easing: Easing.linear });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineKey, totalMs, reduceMotion]);
  const animated = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));
  const fill = color ?? (frac < 0.25 ? colors.accent : colors.primary);
  return (
    <View
      style={{ height, borderRadius: height, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}
      accessibilityRole="progressbar"
      accessibilityLabel="Time remaining"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(frac * 100) }}
    >
      {reduceMotion ? (
        <View style={{ height: '100%', width: `${frac * 100}%`, borderRadius: height, backgroundColor: fill }} />
      ) : (
        <Animated.View style={[{ height: '100%', borderRadius: height, backgroundColor: fill }, animated]} />
      )}
    </View>
  );
}

/** Horizontal result bar that grows to `fraction`. */
export function GrowBar({ fraction, color, height = 10, delay = 0, track }: { fraction: number; color: string; height?: number; delay?: number; track?: string }) {
  const { colors, reduceMotion } = useTheme();
  const f = Math.max(0, Math.min(1, fraction));
  const w = useSharedValue(reduceMotion ? f : 0);
  useEffect(() => {
    if (reduceMotion) {
      w.value = f;
      return;
    }
    const t = setTimeout(() => {
      w.value = withTiming(f, { duration: 650, easing: Easing.out(Easing.cubic) });
    }, delay);
    return () => clearTimeout(t);
  }, [f, delay, reduceMotion, w]);
  const animated = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: track ?? colors.surfaceAlt, overflow: 'hidden' }}>
      <Animated.View style={[{ height: '100%', borderRadius: height, backgroundColor: color }, animated]} />
    </View>
  );
}
