import type { ComponentType } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { LucideProps } from 'lucide-react-native';

import { PressableScale, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/tokens';

type Props = {
  icon: ComponentType<LucideProps>;
  label: string;
  onPress?: () => void;
  /** Visual emphasis: 'on' (primary fill), 'off' (neutral), 'warn' (e.g. muted), 'danger'. */
  tone?: 'on' | 'off' | 'warn' | 'danger';
  active?: boolean;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

/** Labelled control for the room's bottom bar. Always shows text, so state never relies on colour alone. */
export function ControlButton({ icon: Icon, label, onPress, tone = 'off', active, disabled, busy, accessibilityLabel, accessibilityHint }: Props) {
  const { colors } = useTheme();
  const palette = {
    on: { bg: colors.primary, fg: colors.onPrimary },
    off: { bg: colors.surfaceAlt, fg: colors.text },
    warn: { bg: colors.warningSoft, fg: colors.warning },
    danger: { bg: colors.danger, fg: '#FFFFFF' },
  }[tone];
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || busy}
      hapticFeedback="tap"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, busy: !!busy, selected: active }}
      style={styles.wrap}
    >
      <View style={[styles.circle, { backgroundColor: active && tone === 'off' ? colors.primarySoft : palette.bg }]}>
        {busy ? <ActivityIndicator color={palette.fg} size="small" /> : <Icon size={22} color={active && tone === 'off' ? colors.primary : palette.fg} strokeWidth={2.2} />}
      </View>
      <Text variant="tiny" tone="muted" numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ marginTop: 3 }}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', minWidth: 56, flexShrink: 1 },
  circle: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
