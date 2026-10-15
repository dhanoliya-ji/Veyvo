import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LifeBuoy, RotateCcw } from 'lucide-react-native';

import { Button, Text } from '@/components/ui';
import { reportError } from '@/lib/crash';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space } from '@/theme/tokens';

type Props = {
  children: ReactNode;
  /** Called when Restart is tapped, just before the boundary resets (e.g. to send the person somewhere safe). */
  onRestart?: () => void;
};
type State = { error: Error | null };

/**
 * Catches render errors below it, reports them (anonymously, see lib/crash.ts) and shows a calm
 * "Something went wrong" screen with a Restart button instead of a blank or frozen app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { isFatal: true, source: 'boundary', extraStack: info.componentStack ?? undefined });
  }

  restart = () => {
    this.props.onRestart?.();
    // Reset on the next tick so a navigation started in onRestart lands first.
    setTimeout(() => this.setState({ error: null }), 0);
  };

  render() {
    if (this.state.error) return <CrashScreen onRestart={this.restart} />;
    return this.props.children;
  }
}

/** Go back to Home with a fresh route, so the broken screen isn't simply reopened. */
export function restartToHome(delayMs = 0) {
  const go = () => {
    try {
      router.replace('/home');
    } catch {
      /* the navigator is still mounting; the AuthGate will route us */
    }
  };
  if (delayMs > 0) setTimeout(go, delayMs);
  else go();
}

function CrashScreen({ onRestart }: { onRestart: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + space.huge, paddingBottom: insets.bottom + space.xl }]} accessibilityRole="alert">
      <View style={styles.center}>
        <View style={[styles.halo, { backgroundColor: colors.primarySoft }]}>
          <View style={[styles.icon, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <LifeBuoy size={34} color={colors.primary} strokeWidth={2} />
          </View>
        </View>
        <Text variant="title" center>
          Something went wrong
        </Text>
        <Text tone="muted" center style={{ maxWidth: 320 }}>
          Sorry about that. This part of Veyvo hit a snag. Your account and chats are fine — tap Restart to head back home.
        </Text>
        <Text variant="caption" tone="faint" center style={{ maxWidth: 300 }}>
          We keep an anonymous note of what broke so we can fix it. It never includes your messages, name or email.
        </Text>
      </View>
      <Button title="Restart" icon={RotateCcw} size="lg" onPress={onRestart} fullWidth />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: screenPadding, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  halo: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center', marginBottom: space.lg },
  icon: { width: 76, height: 76, borderRadius: radius.xxl, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
});
