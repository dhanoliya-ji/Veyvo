import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';

import { useDeck } from '@/api/discover-extra';
import { UserPhoto } from '@/components/UserPhoto';
import { PressableScale, Text } from '@/components/ui';
import { plural } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

/** "Your Daily Drop is here" — today's Friend Swipe picks. Renders nothing when there's no one new today. */
export function DailyDropBanner() {
  const { colors } = useTheme();
  const deck = useDeck();
  const cards = deck.data?.cards ?? [];
  if (!cards.length) return null;

  const picks = cards.filter((c) => c.daily_pick).length;
  const others = cards.length - picks;
  const subtitle = picks
    ? `⭐ ${plural(picks, 'pick')}${others ? ` + ${plural(others, 'person', 'people')}` : ''} to meet`
    : `${plural(cards.length, 'person', 'people')} you might get on with`;

  return (
    <PressableScale
      onPress={() => router.push('/discover' as Href)}
      scaleTo={0.985}
      accessibilityLabel={`Your Daily Drop is here. ${subtitle}`}
      accessibilityHint="Opens Friend Swipe"
      style={[styles.card, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}
    >
      <View style={styles.faces}>
        {cards.slice(0, 3).map((c, i) => (
          <View key={c.user.id} style={[styles.face, { marginLeft: i ? -14 : 0, borderColor: colors.surface, zIndex: 3 - i }]}>
            <UserPhoto user={c.user} size={40} showVerified={false} />
          </View>
        ))}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">Your Daily Drop is here ⭐</Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <ChevronRight size={20} color={colors.primary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, paddingRight: space.lg, borderRadius: radius.xl, borderWidth: 1 },
  faces: { flexDirection: 'row', alignItems: 'center' },
  face: { borderWidth: 2, borderRadius: 24 },
});
