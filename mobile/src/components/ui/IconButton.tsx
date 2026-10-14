import type { ComponentType } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideProps } from 'lucide-react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/tokens';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

type Props = {
  icon: ComponentType<LucideProps>;
  onPress?: () => void;
  label: string;
  variant?: 'plain' | 'filled' | 'primary' | 'danger' | 'accent';
  size?: number;
  badge?: number;
  active?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Icon-only button. `label` is required: it's the screen-reader name. */
export function IconButton({ icon: Icon, onPress, label, variant = 'plain', size = 44, badge, active, disabled, style }: Props) {
  const { colors } = useTheme();
  const bg = {
    plain: 'transparent',
    filled: colors.surfaceAlt,
    primary: colors.primary,
    danger: colors.danger,
    accent: colors.accentSoft,
  }[variant];
  const fg = { plain: colors.text, filled: colors.text, primary: colors.onPrimary, danger: '#FFFFFF', accent: colors.accent }[variant];

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      hapticFeedback="tap"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      hitSlop={size < 44 ? (44 - size) / 2 : 0}
      style={[styles.base, { width: size, height: size, borderRadius: radius.pill, backgroundColor: active ? colors.primarySoft : bg }, style]}
    >
      <Icon size={Math.round(size * 0.48)} color={active ? colors.primary : fg} strokeWidth={2.1} />
      {badge ? (
        <View style={[styles.badge, { backgroundColor: colors.accent, borderColor: colors.bg }]}>
          <Text variant="tiny" style={{ color: colors.onAccent }}>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 2,
    right: 0,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
});
