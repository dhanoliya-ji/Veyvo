import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { ChevronRight, Hand } from 'lucide-react-native';

import { useDeck } from '@/api/discover-extra';
import { PressableScale, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

/** Prominent entry card for Friend Swipe (used at the top of Explore). */
export function FriendSwipeEntry() {
  const { colors } = useTheme();
  const deck = useDeck();
  const count = deck.data?.cards.length ?? 0;
  const status = deck.data ? (count ? `${count} new ${count === 1 ? 'person' : 'people'} today` : "You're all caught up for today") : 'Meet people who share your interests';

  return (
    <PressableScale
      onPress={() => router.push('/discover' as Href)}
      scaleTo={0.985}
      accessibilityLabel={`Friend Swipe. ${status}`}
      accessibilityHint="Opens Friend Swipe"
      style={[styles.card, { backgroundColor: colors.primary }]}
    >
      <View style={[styles.icon, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
        <Hand size={26} color={colors.onPrimary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="heading" style={{ color: colors.onPrimary }}>
          Friend Swipe
        </Text>
        <Text variant="caption" style={{ color: colors.onPrimary, opacity: 0.85 }}>
          Friends, not dating. {status}.
        </Text>
      </View>
      <ChevronRight size={22} color={colors.onPrimary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.xl },
  icon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
