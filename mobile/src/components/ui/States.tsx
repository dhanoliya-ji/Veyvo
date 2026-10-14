import { useEffect, type ComponentType } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { CloudOff, RefreshCw, ShieldAlert, type LucideProps } from 'lucide-react-native';

import { ApiError, errorMessage } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { Button } from './Button';
import { Text } from './Text';

export function Skeleton({ width = '100%', height = 16, rounded = radius.sm, style }: { width?: DimensionValue; height?: number; rounded?: number; style?: StyleProp<ViewStyle> }) {
  const { colors, reduceMotion } = useTheme();
  const opacity = useSharedValue(0.55);
  useEffect(() => {
    if (!reduceMotion) opacity.value = withRepeat(withTiming(1, { duration: 750 }), -1, true);
  }, [opacity, reduceMotion]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ width, height, borderRadius: rounded, backgroundColor: colors.skeleton }, animated, style]} accessibilityElementsHidden />;
}

/** Skeleton shaped like a room card. */
export function RoomCardSkeleton() {
  const { colors } = useTheme();
  return (
    <View style={[styles.skelCard, { backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityLabel="Loading">
      <Skeleton height={110} rounded={radius.lg} />
      <Skeleton width="70%" height={18} style={{ marginTop: space.md }} />
      <Skeleton width="45%" height={12} style={{ marginTop: space.sm }} />
    </View>
  );
}

export function RowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View style={{ gap: space.lg }} accessibilityLabel="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Skeleton width={48} height={48} rounded={24} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width="55%" height={14} />
            <Skeleton width="80%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
  onAction,
  secondaryAction,
  onSecondaryAction,
  compact,
}: {
  icon: ComponentType<LucideProps>;
  title: string;
  message?: string;
  action?: string;
  onAction?: () => void;
  secondaryAction?: string;
  onSecondaryAction?: () => void;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.empty, compact && { paddingVertical: space.xl }]}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
        <Icon size={26} color={colors.primary} strokeWidth={2} />
      </View>
      <Text variant="heading" center>
        {title}
      </Text>
      {message ? (
        <Text variant="body" tone="muted" center style={{ maxWidth: 300 }}>
          {message}
        </Text>
      ) : null}
      {action && onAction ? <Button title={action} onPress={onAction} style={{ marginTop: space.sm }} /> : null}
      {secondaryAction && onSecondaryAction ? <Button title={secondaryAction} variant="ghost" onPress={onSecondaryAction} /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const offline = error instanceof ApiError && error.isNetwork;
  const forbidden = error instanceof ApiError && (error.status === 403 || error.status === 404);
  return (
    <EmptyState
      compact={compact}
      icon={offline ? CloudOff : forbidden ? ShieldAlert : RefreshCw}
      title={offline ? "You're offline" : forbidden ? 'Not available' : "Couldn't load this"}
      message={errorMessage(error)}
      action={onRetry && !forbidden ? 'Try again' : undefined}
      onAction={onRetry}
    />
  );
}

const styles = StyleSheet.create({
  skelCard: { width: 260, padding: space.md, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  empty: { alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.huge, paddingHorizontal: space.xl },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
});
