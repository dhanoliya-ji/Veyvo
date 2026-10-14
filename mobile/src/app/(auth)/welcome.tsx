import { Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ShieldCheck } from 'lucide-react-native';

import { SceneStage, type StageSeat } from '@/components/scene/SceneStage';
import { Button, Screen, Text } from '@/components/ui';
import { LEGAL_URLS } from '@/lib/config';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

// Illustration only — these characters are artwork, not real users or live activity.
const HERO: StageSeat[] = [
  { id: 'a', name: 'Draw', avatar: { skin: '#C68642', hair: 'afro', hairColor: '#1F1A17', outfit: 'hoodie', outfitColor: '#FF8F9A', eyes: 'happy', mouth: 'grin', bg: '#3A2340' } },
  { id: 'b', name: 'Chat', avatar: { skin: '#FFDFC4', hair: 'bob', hairColor: '#B5651D', outfit: 'sweater', outfitColor: '#43CFA0', accessory: 'glasses', eyes: 'round', mouth: 'smile', bg: '#1F3B3A' } },
  { id: 'c', name: 'Play', avatar: { skin: '#8D5524', hair: 'braids', hairColor: '#4A3226', outfit: 'tee', outfitColor: '#FFC857', accessory: 'headphones', eyes: 'sparkle', mouth: 'smile', bg: '#3B3020' }, speaking: true, level: 0.6 },
  { id: 'd', name: 'Study', avatar: { skin: '#F0C8A0', hair: 'short', hairColor: '#7C6CF2', outfit: 'collar', outfitColor: '#5AA9E6', eyes: 'wink', mouth: 'calm', bg: '#20304A' } },
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

      <Animated.View entering={FadeInDown.duration(500)} style={{ marginTop: space.xl }} accessible accessibilityLabel="Illustration of friends hanging out around a campfire">
        <SceneStage scene="campfire" seats={HERO} height={230} />
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
          Adults 18+ only. Cartoon avatars instead of photos, and you decide who can reach you.
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
  safety: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, marginTop: space.xl },
});
