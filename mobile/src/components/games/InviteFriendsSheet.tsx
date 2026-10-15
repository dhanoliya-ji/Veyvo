import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { CheckCircle2, Circle, Search, Send } from 'lucide-react-native';

import { useFriends } from '@/api/hooks';
import { MAX_GAME_INVITES, useInviteToGame } from '@/api/invites-extra';
import { UserPhoto } from '@/components/UserPhoto';
import { Button, Input, PressableScale, Sheet, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

type Props = {
  gameId: string;
  gameName: string;
  visible: boolean;
  onClose: () => void;
  /** People already in the game (hidden from the list). */
  excludeIds?: string[];
};

/** Pick friends (with search) and send them a game invite. */
export function InviteFriendsSheet({ gameId, gameName, visible, onClose, excludeIds = [] }: Props) {
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const friends = useFriends();
  const invite = useInviteToGame(gameId);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (friends.data ?? []).filter(
      (f) =>
        !excludeIds.includes(f.id) &&
        (!term || f.display_name.toLowerCase().includes(term) || (f.username ?? '').toLowerCase().includes(term)),
    );
  }, [friends.data, q, excludeIds]);

  const close = () => {
    setQ('');
    setPicked([]);
    onClose();
  };

  const toggle = (id: string) => {
    haptic.light();
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_GAME_INVITES ? p : [...p, id]));
  };

  const send = () => {
    if (!picked.length || invite.isPending) return;
    invite.mutate(picked, {
      onSuccess: (res) => {
        haptic.success();
        const sent = res.invited.length;
        toast.show({
          title: sent ? `Invited ${sent} friend${sent === 1 ? '' : 's'} to ${gameName}` : 'Everyone you picked is already here',
          message: res.skipped.length ? `${res.skipped.length} couldn't be invited right now.` : undefined,
          tone: 'success',
        });
        close();
      },
      onError: (e) => {
        haptic.error();
        toast.error("Couldn't send invites", errorMessage(e));
      },
    });
  };

  return (
    <Sheet visible={visible} onClose={close} title="Invite friends" scroll>
      <View style={{ gap: space.md }}>
        <Input icon={Search} placeholder="Search friends" value={q} onChangeText={setQ} autoCorrect={false} autoCapitalize="none" />
        {friends.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: space.lg }} />
        ) : list.length === 0 ? (
          <Text tone="muted" center style={{ marginVertical: space.lg }}>
            {(friends.data ?? []).length === 0 ? 'Add some friends first, then invite them to play.' : 'No friends match that search.'}
          </Text>
        ) : (
          <View style={{ gap: space.xs }}>
            {list.map((f) => {
              const on = picked.includes(f.id);
              const Check = on ? CheckCircle2 : Circle;
              return (
                <PressableScale
                  key={f.id}
                  onPress={() => toggle(f.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`Invite ${f.display_name}`}
                  style={[styles.row, { backgroundColor: on ? colors.primarySoft : colors.surface }]}
                >
                  <UserPhoto user={f} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {f.display_name}
                    </Text>
                    {f.online ? (
                      <Text variant="caption" tone="muted">
                        Online now
                      </Text>
                    ) : null}
                  </View>
                  <Check size={22} color={on ? colors.primary : colors.textFaint} />
                </PressableScale>
              );
            })}
          </View>
        )}
        <Button
          title={picked.length ? `Send invite${picked.length === 1 ? '' : 's'} (${picked.length})` : 'Pick friends to invite'}
          icon={Send}
          onPress={send}
          loading={invite.isPending}
          disabled={!picked.length}
          fullWidth
        />
        {picked.length >= MAX_GAME_INVITES ? (
          <Text variant="caption" tone="muted" center>
            You can invite up to {MAX_GAME_INVITES} friends at a time.
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, paddingHorizontal: space.md, borderRadius: radius.lg },
});
