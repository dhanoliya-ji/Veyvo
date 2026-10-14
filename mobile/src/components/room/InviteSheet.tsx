import { useState } from 'react';
import { View } from 'react-native';
import { Check, Search, UserPlus } from 'lucide-react-native';

import { useFriends, useRoomAction } from '@/api/hooks';
import { UserRow } from '@/components/cards';
import { Button, EmptyState, ErrorState, Input, RowSkeleton, Sheet, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { space } from '@/theme/tokens';

type Props = { roomId: string; visible: boolean; onClose: () => void; presentIds: Set<string> };

export function InviteSheet({ roomId, visible, onClose, presentIds }: Props) {
  const [query, setQuery] = useState('');
  const friends = useFriends(query.trim() || undefined);
  const { invite } = useRoomAction(roomId);
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<string | null>(null);

  const send = async (userId: string, name: string) => {
    setPending(userId);
    try {
      await invite.mutateAsync(userId);
      haptic.success();
      setSent((s) => ({ ...s, [userId]: true }));
    } catch (e) {
      toast.error(`Couldn't invite ${name}`, errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Invite friends" scroll>
      <View style={{ gap: space.md }}>
        <Input icon={Search} placeholder="Search friends" value={query} onChangeText={setQuery} accessibilityLabel="Search friends" autoCorrect={false} />
        {friends.isLoading ? (
          <RowSkeleton count={4} />
        ) : friends.isError ? (
          <ErrorState error={friends.error} onRetry={() => friends.refetch()} compact />
        ) : !friends.data?.length ? (
          <EmptyState icon={UserPlus} compact title={query ? 'No friends match' : 'No friends yet'} message={query ? undefined : 'Add friends from people you meet in hangouts, then invite them here.'} />
        ) : (
          friends.data.map((f) => {
            const inside = presentIds.has(f.id);
            const done = sent[f.id];
            return (
              <UserRow
                key={f.id}
                user={f}
                online={f.online}
                onPress={() => undefined}
                subtitle={inside ? 'Already here' : undefined}
                right={
                  inside ? (
                    <Text variant="caption" tone="muted">
                      Here
                    </Text>
                  ) : (
                    <Button
                      title={done ? 'Invited' : 'Invite'}
                      icon={done ? Check : undefined}
                      size="sm"
                      variant={done ? 'secondary' : 'primary'}
                      disabled={done}
                      loading={pending === f.id}
                      onPress={() => send(f.id, f.display_name)}
                      accessibilityLabel={done ? `${f.display_name} invited` : `Invite ${f.display_name}`}
                    />
                  )
                }
              />
            );
          })
        )}
      </View>
    </Sheet>
  );
}
