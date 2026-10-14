import type { ComponentType, ReactNode } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { ChevronRight, type LucideProps } from 'lucide-react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

type Props = {
  icon?: ComponentType<LucideProps>;
  iconTone?: 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'neutral';
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  toggle?: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean };
  right?: ReactNode;
  destructive?: boolean;
};

export function ListRow({ icon: Icon, iconTone = 'neutral', title, subtitle, value, onPress, toggle, right, destructive }: Props) {
  const { colors } = useTheme();
  const tones = {
    primary: [colors.primarySoft, colors.primary],
    accent: [colors.accentSoft, colors.accent],
    success: [colors.successSoft, colors.success],
    warning: [colors.warningSoft, colors.warning],
    danger: [colors.dangerSoft, colors.danger],
    neutral: [colors.surfaceAlt, colors.textMuted],
  }[destructive ? 'danger' : iconTone];

  const inner = (
    <>
      {Icon ? (
        <View style={[styles.icon, { backgroundColor: tones[0] }]}>
          <Icon size={18} color={tones[1]} strokeWidth={2.1} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" style={destructive ? { color: colors.danger } : undefined}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="label" tone="muted" numberOfLines={1} style={{ maxWidth: 140 }}>
          {value}
        </Text>
      ) : null}
      {right}
      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onChange}
          disabled={toggle.disabled}
          trackColor={{ false: colors.borderStrong, true: colors.primary }}
          thumbColor="#FFFFFF"
          accessibilityLabel={title}
        />
      ) : onPress ? (
        <ChevronRight size={18} color={colors.textFaint} />
      ) : null}
    </>
  );

  if (toggle) {
    return (
      <PressableScale
        onPress={() => !toggle.disabled && toggle.onChange(!toggle.value)}
        scaleTo={0.99}
        style={styles.row}
        accessibilityRole="switch"
        accessibilityState={{ checked: toggle.value, disabled: toggle.disabled }}
        accessibilityLabel={title}
        accessibilityHint={subtitle}
      >
        {inner}
      </PressableScale>
    );
  }
  if (onPress) {
    return (
      <PressableScale onPress={onPress} scaleTo={0.99} style={styles.row} accessibilityLabel={title} accessibilityHint={subtitle}>
        {inner}
      </PressableScale>
    );
  }
  return <View style={styles.row}>{inner}</View>;
}

export function ListGroup({ children, title }: { children: ReactNode; title?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      {title ? (
        <Text variant="tiny" tone="faint" style={{ marginLeft: space.xs, textTransform: 'uppercase' }}>
          {title}
        </Text>
      ) : null}
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 14, minHeight: 56 },
  icon: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  group: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
