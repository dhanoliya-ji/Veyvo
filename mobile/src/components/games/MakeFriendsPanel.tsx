import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Check, Sparkles, UserPlus } from 'lucide-react-native';

import { isApiError } from '@/api/games-extra';
import { useConfig, useFriends, useGiveKudos, useSendFriendRequest } from '@/api/hooks';
import type { UserSummary } from '@/api/types';
import { UserPhoto } from '@/components/UserPhoto';
import { Button, Card, Chip, PressableScale, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

type FriendState = 'friends' | 'sent' | 'closed';

/** Shown after a game: add the people you played with, or send them a Vibe. */
export function MakeFriendsPanel({ people }: { people: UserSummary[] }) {
  const { colors } = useTheme();
  const friends = useFriends();
  const config = useConfig();
  const sendRequest = useSendFriendRequest();
  const giveVibe = useGiveKudos();
  const [states, setStates] = useState<Record<string, FriendState>>({});
  const [vibeFor, setVibeFor] = useState<string | null>(null);
  const [vibed, setVibed] = useState<Record<string, string>>({});
  const friendIds = useMemo(() => new Set((friends.data ?? []).map((f) => f.id)), [friends.data]);
  // Tags come from the server so names stay in sync.
  const tags = Object.entries(config.data?.kudos_tags ?? {});

  if (!people.length) return null;

  const add = (p: UserSummary) => {
    if (sendRequest.isPending) return;
    sendRequest.mutate(
      { userId: p.id, source: 'game' },
      {
        onSuccess: (res) => {
          haptic.success();
          if (res.status === 'accepted') {
            setStates((s) => ({ ...s, [p.id]: 'friends' }));
            toast.success(`You and ${p.display_name} are now friends`);
          } else {
            setStates((s) => ({ ...s, [p.id]: 'sent' }));
            toast.success('Friend request sent', `${p.display_name} will see it in their requests.`);
          }
        },
        onError: (e) => {
          if (isApiError(e, 409, 'already_friends')) setStates((s) => ({ ...s, [p.id]: 'friends' }));
          else if (isApiError(e, 409, 'request_pending')) setStates((s) => ({ ...s, [p.id]: 'sent' }));
          else if (isApiError(e, 403)) {
            setStates((s) => ({ ...s, [p.id]: 'closed' }));
            toast.show({ title: "They aren't taking requests right now", message: errorMessage(e) });
          } else {
            haptic.error();
            toast.error("Couldn't send the request", errorMessage(e));
          }
        },
      },
    );
  };

  const vibe = (p: UserSummary, tag: string, label: string) => {
    giveVibe.mutate(
      { userId: p.id, tag },
      {
        onSuccess: () => {
          haptic.success();
          setVibed((v) => ({ ...v, [p.id]: label }));
          setVibeFor(null);
          toast.success(`Vibe sent to ${p.display_name}`, `"${label}". That'll make their day.`);
        },
        onError: (e) => {
          if (isApiError(e, 409)) {
            setVibed((v) => ({ ...v, [p.id]: '' }));
            setVibeFor(null);
            toast.show({ title: 'Already sent today', message: `You've already sent ${p.display_name} a Vibe today.` });
          } else {
            haptic.error();
            toast.error("Couldn't send your Vibe", errorMessage(e));
          }
        },
      },
    );
  };

  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: 2 }}>
        <Text variant="heading">Had fun? Stay in touch</Text>
        <Text variant="caption" tone="muted">
          Add the people you played with, or send a Vibe to say thanks.
        </Text>
      </View>
      {people.map((p) => {
        const state: FriendState | undefined = friendIds.has(p.id) ? 'friends' : states[p.id];
        const sentVibe = vibed[p.id];
        return (
          <Card key={p.id} style={{ gap: space.md }}>
            <View style={styles.row}>
              <PressableScale onPress={() => router.push(`/user/${p.id}`)} accessibilityLabel={`Open ${p.display_name}'s profile`} style={styles.person}>
                <UserPhoto user={p} size={44} />
                <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                  {p.display_name}
                </Text>
              </PressableScale>
              {state === 'friends' ? (
                <View style={styles.done}>
                  <Check size={14} color={colors.success} />
                  <Text variant="caption" tone="success">
                    Friends
                  </Text>
                </View>
              ) : state === 'sent' ? (
                <View style={styles.done}>
                  <Check size={14} color={colors.textMuted} />
                  <Text variant="caption" tone="muted">
                    Request sent
                  </Text>
                </View>
              ) : state === 'closed' ? null : (
                <Button title="Add friend" size="sm" icon={UserPlus} onPress={() => add(p)} accessibilityLabel={`Add ${p.display_name} as a friend`} />
              )}
            </View>
            {sentVibe !== undefined ? (
              <Text variant="caption" tone="success">
                {sentVibe ? `You sent "${sentVibe}".` : 'Vibe already sent today.'}
              </Text>
            ) : vibeFor === p.id ? (
              <View style={styles.tags}>
                {tags.length === 0 ? (
                  <Text variant="caption" tone="muted">
                    Loading...
                  </Text>
                ) : (
                  tags.map(([tag, label]) => <Chip key={tag} label={label} onPress={() => vibe(p, tag, label)} />)
                )}
              </View>
            ) : (
              <Button title="Send a Vibe" size="sm" variant="secondary" icon={Sparkles} onPress={() => setVibeFor(p.id)} accessibilityLabel={`Send ${p.display_name} a Vibe`} />
            )}
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  person: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  done: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
