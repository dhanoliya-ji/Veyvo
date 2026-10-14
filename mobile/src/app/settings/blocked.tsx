import { FlatList, View } from 'react-native';
import { UserX } from 'lucide-react-native';

import { useBlock, useBlocked } from '@/api/hooks';
import { UserRow } from '@/components/cards';
import { Button, EmptyState, ErrorState, Header, RowSkeleton, Screen, Text, confirm } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { toast } from '@/stores/toast';
import { space } from '@/theme/tokens';

export default function BlockedAccounts() {
  const blocked = useBlocked();
  const block = useBlock();

  return (
    <Screen header={<Header title="Blocked accounts" />}>
      <Text tone="muted" style={{ marginBottom: space.lg }}>
        Blocked people can't find you, message you, invite you or see your rooms. They aren't told that you blocked them.
      </Text>
      {blocked.isLoading ? <RowSkeleton count={4} /> : null}
      {blocked.isError ? <ErrorState error={blocked.error} onRetry={() => blocked.refetch()} /> : null}
      {blocked.data ? (
        <FlatList
          data={blocked.data}
          keyExtractor={(b) => b.id}
          ItemSeparatorComponent={() => <View style={{ height: space.xs }} />}
          ListEmptyComponent={<EmptyState icon={UserX} title="No one is blocked" message="If someone makes you uncomfortable, you can block them from their profile, a chat or a room." />}
          renderItem={({ item }) => (
            <UserRow
              user={item}
              subtitle={`Blocked · ${timeAgo(item.blocked_at)}`}
              onPress={() => undefined}
              right={
                <Button
                  title="Unblock"
                  size="sm"
                  variant="secondary"
                  loading={block.isPending && block.variables?.userId === item.id}
                  onPress={async () => {
                    if (!(await confirm({ title: `Unblock ${item.display_name}?`, message: 'They will be able to find you and send requests again.', confirmLabel: 'Unblock' }))) return;
                    try {
                      await block.mutateAsync({ userId: item.id, block: false });
                      toast.success(`${item.display_name} unblocked`);
                    } catch (e) {
                      toast.error("Couldn't unblock", errorMessage(e));
                    }
                  }}
                />
              }
            />
          )}
        />
      ) : null}
    </Screen>
  );
}
