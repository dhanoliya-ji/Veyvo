import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { minutesLeft, useFreeFriends, type FreeFriend } from '@/api/connect-extra';
import { HangOutSheet } from '@/components/HangOutSheet';
import { UserPhoto } from '@/components/UserPhoto';
import { PressableScale, SectionHeader, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

/** "Free now" row of friends who said they're free to talk. Renders nothing when nobody is free. */
export function FreeFriendsStrip() {
  const { colors } = useTheme();
  const free = useFreeFriends();
  const [picked, setPicked] = useState<FreeFriend | null>(null);
  const items = (free.data ?? []).filter((f) => minutesLeft(f.free_until) > 0);
  if (!items.length) return null;

  return (
    <View style={{ gap: space.sm }}>
      <SectionHeader title="Free now 🟢" subtitle="Friends who are up for a call or a game" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((f) => (
          <PressableScale
            key={f.id}
            onPress={() => setPicked(f)}
            style={styles.item}
            accessibilityLabel={`${f.display_name} is free to talk for ${minutesLeft(f.free_until)} more minutes. Hang out`}
          >
            <View>
              <UserPhoto user={f} size={60} online={f.online === true} />
              <View style={[styles.badge, { backgroundColor: colors.success, borderColor: colors.bg }]} />
            </View>
            <Text variant="caption" numberOfLines={1} style={{ maxWidth: 72 }}>
              {f.display_name}
            </Text>
          </PressableScale>
        ))}
      </ScrollView>
      {picked ? <HangOutSheet user={picked} visible onClose={() => setPicked(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.md, paddingVertical: space.xs },
  item: { alignItems: 'center', gap: 4, width: 72 },
  badge: {
    position: 'absolute',
    left: 2,
    top: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
});
