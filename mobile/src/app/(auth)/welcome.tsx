import { Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { BadgeCheck, Gamepad2, ShieldCheck, Video } from 'lucide-react-native';

import { Button, Screen, Text } from '@/components/ui';
import { LEGAL_URLS } from '@/lib/config';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const FEATURES = [
  { icon: Video, title: 'Video & voice hangouts', body: 'Drop into live rooms or call your friends face to face.' },
  { icon: Gamepad2, title: 'Real games together', body: 'Chess, Ludo, cards, Werewolf and more — with people, not bots.' },
  { icon: BadgeCheck, title: 'Real, verified people', body: 'Photo profiles with selfie verification. Adults 18+ only.' },
];

export default function Welcome() {
  const { colors } = useTheme();
  return (
    <Screen scroll contentStyle={{ flexGrow: 1 }}>
      <View style={styles.brandRow}>
        <View style={[styles.logo, { backgroundColor: colors.primary }]}>
          <Text variant="heading" style={{ color: colors.onPrimary }}>
            V
          </Text>
        </View>
        <Text variant="heading">Veyvo</Text>
      </View>

      <Animated.View entering={FadeInDown.duration(500)} style={{ marginTop: space.xxl, gap: space.md }}>
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <View key={title} style={[styles.feature, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.featureIcon, { backgroundColor: colors.primarySoft }]}>
              <Icon size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">{title}</Text>
              <Text variant="caption" tone="muted">
                {body}
              </Text>
            </View>
          </View>
        ))}
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(120).duration(500)} style={{ marginTop: space.xxl, gap: space.sm }}>
        <Text variant="display">Your next great conversation starts here.</Text>
        <Text variant="body" tone="muted">
          Find your people, play together, and make everyday moments more social.
        </Text>
      </Animated.View>

      <View style={[styles.safety, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <ShieldCheck size={20} color={colors.success} />
        <Text variant="caption" tone="muted" style={{ flex: 1 }}>
          Adults 18+ only. Cameras are off until you turn them on, and you decide who can reach you.
        </Text>
      </View>

      <View style={{ flex: 1 }} />
      <View style={{ gap: space.sm, marginTop: space.xxl }}>
        <Button title="Create account" size="lg" onPress={() => router.push('/register')} fullWidth />
        <Button title="Log in" size="lg" variant="secondary" onPress={() => router.push('/login')} fullWidth />
      </View>
      <Text variant="caption" tone="faint" center style={{ marginTop: space.lg }}>
        By continuing you agree to our{' '}
        <Text variant="caption" tone="primary" onPress={() => Linking.openURL(LEGAL_URLS.terms)} accessibilityRole="link">
          Terms
        </Text>{' '}
        and{' '}
        <Text variant="caption" tone="primary" onPress={() => Linking.openURL(LEGAL_URLS.privacy)} accessibilityRole="link">
          Privacy Policy
        </Text>
        .
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  logo: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  feature: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  featureIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  safety: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, marginTop: space.xl },
});
