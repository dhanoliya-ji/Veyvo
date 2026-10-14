import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { useTheme } from '@/theme/ThemeProvider';

/** Gently pulsing "live" indicator. Static when reduce-motion is on. */
export function LiveDot({ size = 8, color }: { size?: number; color?: string }) {
  const { colors, reduceMotion } = useTheme();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!reduceMotion) pulse.value = withRepeat(withTiming(1, { duration: 1400 }), -1, false);
  }, [pulse, reduceMotion]);
  const ring = useAnimatedStyle(() => ({ opacity: 0.6 * (1 - pulse.value), transform: [{ scale: 1 + pulse.value * 1.4 }] }));
  const c = color ?? colors.success;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size, backgroundColor: c }, ring]} />
      <View style={{ width: size, height: size, borderRadius: size, backgroundColor: c }} />
    </View>
  );
}
