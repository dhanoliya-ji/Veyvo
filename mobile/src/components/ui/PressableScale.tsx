import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressableScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  hapticFeedback?: 'tap' | 'light' | 'medium' | false;
};

/** Pressable with immediate, subtle scale feedback (disabled when reduce-motion is on). */
export function PressableScale({ style, scaleTo = 0.97, hapticFeedback = false, onPressIn, onPressOut, onPress, disabled, ...rest }: PressableScaleProps) {
  const { reduceMotion } = useTheme();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled}
      onPressIn={(e) => {
        if (!reduceMotion) scale.value = withTiming(scaleTo, { duration: 90 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reduceMotion) scale.value = withSpring(1, { damping: 15, stiffness: 300 });
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (hapticFeedback) haptic[hapticFeedback]();
        onPress?.(e);
      }}
      style={[animated, style, disabled && { opacity: 0.5 }]}
      {...rest}
    />
  );
}
