import { StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, CheckCircle2, Info, WifiOff, XCircle } from 'lucide-react-native';

import { useNetwork } from '@/stores/network';
import { useToasts } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export function Toaster() {
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { toasts, dismiss } = useToasts();
  const icons = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
  const tint = { success: colors.success, error: colors.danger, info: colors.primary, warning: colors.warning };
  return (
    <View pointerEvents="box-none" style={[styles.toaster, { top: insets.top + space.sm }]}>
      {toasts.map((t) => {
        const Icon = icons[t.tone];
        return (
          <Animated.View
            key={t.id}
            entering={reduceMotion ? undefined : FadeInUp.springify().damping(18)}
            exiting={reduceMotion ? undefined : FadeOutUp.duration(160)}
            layout={reduceMotion ? undefined : LinearTransition}
          >
            <PressableScale
              onPress={() => dismiss(t.id)}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              accessibilityLabel={`${t.title}${t.message ? `. ${t.message}` : ''}`}
              style={[styles.toast, { backgroundColor: colors.surfaceRaised, borderColor: colors.border, shadowColor: colors.shadow }]}
            >
              <Icon size={20} color={tint[t.tone]} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{t.title}</Text>
                {t.message ? (
                  <Text variant="caption" tone="muted">
                    {t.message}
                  </Text>
                ) : null}
              </View>
            </PressableScale>
          </Animated.View>
        );
      })}
    </View>
  );
}

/** Shown whenever the device reports no connection. */
export function OfflineBanner() {
  const online = useNetwork((s) => s.online);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (online) return null;
  return (
    <View pointerEvents="none" style={[styles.offline, { bottom: insets.bottom + 92 }]}>
      <View style={[styles.offlinePill, { backgroundColor: colors.text }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <WifiOff size={14} color={colors.bg} />
        <Text variant="label" style={{ color: colors.bg }}>
          You're offline. Changes will sync when you reconnect.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toaster: { position: 'absolute', left: space.lg, right: space.lg, gap: space.sm, zIndex: 1000 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  offline: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 999 },
  offlinePill: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: 10, borderRadius: radius.pill },
});
