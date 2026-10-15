import { StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';
import { X } from 'lucide-react-native';

import { UserPhoto } from '@/components/UserPhoto';
import { Button, IconButton, Text } from '@/components/ui';
import { useGameInviteBanner } from '@/hooks/useGameInvites';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

/** "Maya invited you to Chess — Join". Render once in the root layout, next to <Toaster />. */
export function GameInviteBanner() {
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { invite, dismiss } = useGameInviteBanner();
  // Already looking at that game: no need for a banner.
  if (!invite || pathname === `/game/${invite.game_id}`) return null;
  const from = invite.from?.display_name ?? 'A friend';

  const join = () => {
    dismiss();
    router.push(`/game/${invite.game_id}`);
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + space.sm }]}>
      <Animated.View
        key={invite.game_id}
        entering={reduceMotion ? undefined : FadeInUp.springify().damping(18)}
        exiting={reduceMotion ? undefined : FadeOutUp.duration(160)}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.card, { backgroundColor: colors.surfaceRaised, borderColor: colors.border, shadowColor: colors.shadow }]}
      >
        <UserPhoto user={invite.from} size={40} />
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {from} invited you to {invite.game_name}
          </Text>
          <Text variant="caption" tone="muted">
            Jump in before it starts 🎲
          </Text>
        </View>
        <Button title="Join" size="sm" onPress={join} />
        <IconButton icon={X} label="Dismiss invite" onPress={dismiss} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, zIndex: 1001 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 9,
  },
});
