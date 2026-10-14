import type { ComponentType, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check, Minus, Plus, type LucideProps } from 'lucide-react-native';

import { PressableScale, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

export function FormSection({ title, hint, children, error }: { title: string; hint?: string; children: ReactNode; error?: string }) {
  return (
    <View style={{ gap: space.sm }}>
      <View>
        <Text variant="subheading" accessibilityRole="header">
          {title}
        </Text>
        {hint ? (
          <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export type Option<T extends string> = { value: T; title: string; description?: string; icon: ComponentType<LucideProps> };

/** Radio-style cards with an icon, title and a line of explanation. */
export function OptionCards<T extends string>({ options, value, onChange, columns = 2 }: { options: Option<T>[]; value: T; onChange: (v: T) => void; columns?: 1 | 2 }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.options, columns === 1 && { flexDirection: 'column' }]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const selected = o.value === value;
        const Icon = o.icon;
        return (
          <PressableScale
            key={o.value}
            onPress={() => onChange(o.value)}
            hapticFeedback="tap"
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`${o.title}${o.description ? `. ${o.description}` : ''}`}
            style={[
              styles.option,
              columns === 2 && { flex: 1 },
              { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : colors.surface },
            ]}
          >
            <View style={styles.optionTop}>
              <View style={[styles.optionIcon, { backgroundColor: selected ? colors.primary : colors.surfaceAlt }]}>
                <Icon size={18} color={selected ? colors.onPrimary : colors.textMuted} />
              </View>
              {selected ? <Check size={18} color={colors.primary} strokeWidth={2.6} /> : null}
            </View>
            <Text variant="bodyStrong">{o.title}</Text>
            {o.description ? (
              <Text variant="caption" tone="muted">
                {o.description}
              </Text>
            ) : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

export function Stepper({ label, value, min, max, step = 1, onChange, suffix }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string }) {
  const { colors } = useTheme();
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <View
      style={[styles.stepper, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value, text: `${value}${suffix ? ` ${suffix}` : ''}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onChange(clamp(value + (e.nativeEvent.actionName === 'increment' ? step : -step)))}
    >
      <Text variant="bodyStrong" style={{ flex: 1 }}>
        {label}
      </Text>
      <PressableScale
        onPress={() => onChange(clamp(value - step))}
        disabled={value <= min}
        hapticFeedback="tap"
        accessibilityLabel={`Decrease ${label}`}
        style={[styles.stepBtn, { backgroundColor: colors.surfaceAlt }]}
      >
        <Minus size={18} color={colors.text} />
      </PressableScale>
      <Text variant="heading" style={{ minWidth: 56, textAlign: 'center' }}>
        {value}
        {suffix ? (
          <Text variant="caption" tone="muted">
            {' '}
            {suffix}
          </Text>
        ) : null}
      </Text>
      <PressableScale
        onPress={() => onChange(clamp(value + step))}
        disabled={value >= max}
        hapticFeedback="tap"
        accessibilityLabel={`Increase ${label}`}
        style={[styles.stepBtn, { backgroundColor: colors.surfaceAlt }]}
      >
        <Plus size={18} color={colors.text} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', gap: space.sm },
  option: { borderWidth: 1.5, borderRadius: radius.lg, padding: space.md, gap: 4, minHeight: 44 },
  optionTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  optionIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, paddingLeft: space.lg, paddingRight: space.sm, minHeight: 60 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
