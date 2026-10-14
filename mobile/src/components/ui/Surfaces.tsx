import type { ComponentType, ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideProps } from 'lucide-react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export function Card({ children, style, onPress, padded = true, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; padded?: boolean; accessibilityLabel?: string }) {
  const { colors } = useTheme();
  const base = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, padded && { padding: space.lg }, style];
  if (onPress) {
    return (
      <PressableScale onPress={onPress} style={base} scaleTo={0.985} accessibilityLabel={accessibilityLabel}>
        {children}
      </PressableScale>
    );
  }
  return <View style={base}>{children}</View>;
}

export function Chip({
  label,
  selected,
  onPress,
  icon: Icon,
  tone = 'default',
  size = 'md',
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: ComponentType<LucideProps>;
  tone?: 'default' | 'accent' | 'success' | 'warning';
  size?: 'sm' | 'md';
}) {
  const { colors } = useTheme();
  const toneColor = { default: colors.primary, accent: colors.accent, success: colors.success, warning: colors.warning }[tone];
  const content = (
    <>
      {Icon ? <Icon size={size === 'sm' ? 12 : 14} color={selected ? toneColor : colors.textMuted} strokeWidth={2.2} /> : null}
      <Text variant={size === 'sm' ? 'tiny' : 'label'} style={{ color: selected ? toneColor : colors.textMuted }} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  const style = [
    styles.chip,
    size === 'sm' && styles.chipSm,
    {
      backgroundColor: selected ? `${toneColor}22` : colors.surfaceAlt,
      borderColor: selected ? toneColor : 'transparent',
    },
  ];
  if (!onPress) return <View style={style}>{content}</View>;
  return (
    <PressableScale
      onPress={onPress}
      style={style}
      hapticFeedback="tap"
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!selected }}
      accessibilityLabel={label}
    >
      {content}
    </PressableScale>
  );
}

export function Badge({ label, tone = 'primary' }: { label: string; tone?: 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'neutral' }) {
  const { colors } = useTheme();
  const map = {
    primary: [colors.primarySoft, colors.primary],
    accent: [colors.accentSoft, colors.accent],
    success: [colors.successSoft, colors.success],
    warning: [colors.warningSoft, colors.warning],
    danger: [colors.dangerSoft, colors.danger],
    neutral: [colors.surfaceAlt, colors.textMuted],
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: map[0] }]}>
      <Text variant="tiny" style={{ color: map[1] }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function SectionHeader({ title, action, onAction, subtitle }: { title: string; action?: string; onAction?: () => void; subtitle?: string }) {
  return (
    <View style={styles.section}>
      <View style={{ flex: 1 }}>
        <Text variant="heading" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action && onAction ? (
        <PressableScale onPress={onAction} hitSlop={10} accessibilityLabel={`${action}: ${title}`}>
          <Text variant="label" tone="primary">
            {action}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: inset }} />;
}

export function ProgressBar({ value, color, height = 6, track }: { value: number; color?: string; height?: number; track?: string }) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      style={{ height, borderRadius: height, backgroundColor: track ?? colors.surfaceAlt, overflow: 'hidden' }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
    >
      <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: height, backgroundColor: color ?? colors.primary }} />
    </View>
  );
}

export function SegmentedControl<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segment, { backgroundColor: colors.surfaceAlt }]} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <PressableScale
            key={o.value}
            onPress={() => onChange(o.value)}
            hapticFeedback="tap"
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segmentItem, active && { backgroundColor: colors.surface, shadowColor: colors.shadow, shadowOpacity: 0.12, shadowRadius: 6, elevation: 2 }]}
          >
            <Text variant="label" style={{ color: active ? colors.text : colors.textMuted }} numberOfLines={1}>
              {o.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: radius.pill, borderWidth: 1.5 },
  chipSm: { height: 26, paddingHorizontal: 10, gap: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  section: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: space.md, gap: space.md },
  segment: { flexDirection: 'row', padding: 4, borderRadius: radius.md, gap: 4 },
  segmentItem: { flex: 1, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
});
