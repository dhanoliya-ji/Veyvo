import type { ComponentProps, ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Compass, Gamepad2, House, Tent, UserRound, type LucideProps } from 'lucide-react-native';

import { PressableScale, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

export const TAB_BAR_HEIGHT = 64;

/** Bottom padding screens inside tabs should add so content clears the floating bar. */
export function useTabBarInset() {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + Math.max(insets.bottom, space.sm) + space.lg;
}

const TABS: Record<string, { label: string; icon: ComponentType<LucideProps> }> = {
  home: { label: 'Home', icon: House },
  explore: { label: 'Explore', icon: Compass },
  hangouts: { label: 'Hangouts', icon: Tent },
  games: { label: 'Games', icon: Gamepad2 },
  profile: { label: 'Profile', icon: UserRound },
};

function TabItem({ name, focused, onPress, onLongPress }: { name: string; focused: boolean; onPress: () => void; onLongPress: () => void }) {
  const { colors, reduceMotion } = useTheme();
  const meta = TABS[name];
  const pill = useAnimatedStyle(() => ({
    opacity: withSpring(focused ? 1 : 0, { damping: 20 }),
    transform: [{ scale: reduceMotion ? 1 : withSpring(focused ? 1 : 0.6, { damping: 16 }) }],
  }));
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <PressableScale
      onPress={onPress}
      onLongPress={onLongPress}
      hapticFeedback="tap"
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={meta.label}
      style={styles.item}
    >
      <View style={styles.iconWrap}>
        <Animated.View style={[styles.pill, { backgroundColor: colors.primarySoft }, pill]} />
        <Icon size={22} color={focused ? colors.primary : colors.textMuted} strokeWidth={focused ? 2.4 : 2} />
      </View>
      <Text variant="tiny" style={{ color: focused ? colors.text : colors.textFaint }} maxFontSizeMultiplier={1.2}>
        {meta.label}
      </Text>
    </PressableScale>
  );
}

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
      <View
        accessibilityRole="tablist"
        style={[styles.bar, { backgroundColor: colors.tabBar, borderColor: colors.border, shadowColor: colors.shadow }]}
      >
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          return (
            <TabItem
              key={route.key}
              name={route.name}
              focused={focused}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.md },
  bar: {
    flexDirection: 'row',
    height: TAB_BAR_HEIGHT,
    borderRadius: radius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.xs,
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  iconWrap: { width: 52, height: 30, alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute', width: 52, height: 30, borderRadius: radius.pill },
});
