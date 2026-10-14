import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Check, Heart, UserPlus } from 'lucide-react-native';

import { useSendFriendRequest } from '@/api/hooks';
import type { UserSummary } from '@/api/types';
import { Avatar } from '@/components/avatar/Avatar';
import { Button, PressableScale, ProgressBar, Text } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { VIBE_LABELS } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

/** Text + dot so online status is never conveyed by colour alone. Render only when the API says `online === true`. */
export function OnlineLabel({ small }: { small?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.online}>
      <View style={[styles.onlineDot, { backgroundColor: colors.success }]} />
      <Text variant={small ? 'tiny' : 'caption'} tone="success">
        Online
      </Text>
    </View>
  );
}

/** Compact friendship level meter used in friend lists and profiles. */
export function FriendshipMeter({ level, progress, width = 72 }: { level: number; progress: number; width?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ width, gap: 4 }} accessible accessibilityLabel={`Friendship level ${level}, ${Math.round(progress * 100)} percent to the next level`}>
      <View style={styles.meterLabel}>
        <Heart size={11} color={colors.accent} fill={colors.accent} />
        <Text variant="tiny" tone="muted">
          Lv {level}
        </Text>
      </View>
      <ProgressBar value={progress} height={4} color={colors.accent} />
    </View>
  );
}

/** "Add" button that sends a friend request and remembers it locally so the row doesn't flicker back. */
export function AddFriendButton({ userId, source = 'suggestion', size = 'sm' }: { userId: string; source?: string; size?: 'sm' | 'md' }) {
  const send = useSendFriendRequest();
  const [state, setState] = useState<'idle' | 'sent' | 'friends'>('idle');

  const onPress = async () => {
    if (send.isPending || state !== 'idle') return;
    try {
      const res = await send.mutateAsync({ userId, source });
      haptic.success();
      if (res.status === 'accepted') {
        setState('friends');
        toast.success("You're friends now");
      } else {
        setState('sent');
      }
    } catch (e) {
      haptic.error();
      if (e instanceof ApiError && e.code === 'request_pending') setState('sent');
      else toast.error("Couldn't send request", errorMessage(e));
    }
  };

  if (state !== 'idle') {
    return <Button title={state === 'friends' ? 'Friends' : 'Requested'} icon={Check} size={size} variant="secondary" disabled accessibilityLabel={state === 'friends' ? 'You are friends' : 'Friend request sent'} />;
  }
  return <Button title="Add" icon={UserPlus} size={size} variant="primary" loading={send.isPending} onPress={onPress} accessibilityLabel="Send friend request" />;
}

/** Vertical card for horizontal "people you may like" rails. */
export function PersonCard({ user }: { user: UserSummary }) {
  const { colors } = useTheme();
  const sub = user.vibe ? VIBE_LABELS[user.vibe] : user.username ? `@${user.username}` : `Level ${user.level}`;
  return (
    <View style={[styles.personCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <PressableScale
        onPress={() => router.push(`/user/${user.id}`)}
        style={{ alignItems: 'center', gap: space.xs, alignSelf: 'stretch' }}
        accessibilityLabel={`${user.display_name}, ${sub}. Open profile`}
      >
        <Avatar config={user.avatar} size={64} />
        <Text variant="bodyStrong" numberOfLines={1} center>
          {user.display_name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1} center>
          {sub}
        </Text>
      </PressableScale>
      <AddFriendButton userId={user.id} />
    </View>
  );
}

const styles = StyleSheet.create({
  online: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  meterLabel: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  personCard: {
    width: 148,
    padding: space.md,
    gap: space.md,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
});
