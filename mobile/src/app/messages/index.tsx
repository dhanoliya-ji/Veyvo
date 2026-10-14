import { useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { MessageCircleHeart, UserPlus } from 'lucide-react-native';

import { useConversations, useMe } from '@/api/hooks';
import type { Conversation } from '@/api/types';
import { Avatar } from '@/components/avatar/Avatar';
import { EmptyState, ErrorState, Header, IconButton, PressableScale, RowSkeleton, Screen, Text } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space } from '@/theme/tokens';

export default function Messages() {
  const { colors } = useTheme();
  const me = useMe();
  const conversations = useConversations();
  const [refreshing, setRefreshing] = useState(false);

  const sorted = useMemo(
    () =>
      [...(conversations.data ?? [])].sort((a, b) => {
        const ta = new Date(a.last_message_at ?? a.last_message?.created_at ?? 0).getTime();
        const tb = new Date(b.last_message_at ?? b.last_message?.created_at ?? 0).getTime();
        return tb - ta;
      }),
    [conversations.data],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await conversations.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const unreadTotal = sorted.reduce((n, c) => n + c.unread_count, 0);

  return (
    <Screen
      padded={false}
      header={<Header title="Messages" subtitle={unreadTotal ? `${unreadTotal} unread` : undefined} right={<IconButton icon={UserPlus} label="Friends" onPress={() => router.push('/friends')} />} />}
    >
      {conversations.isLoading ? (
        <View style={{ paddingHorizontal: screenPadding, paddingTop: space.md }}>
          <RowSkeleton count={7} />
        </View>
      ) : conversations.isError ? (
        <ErrorState error={conversations.error} onRetry={() => conversations.refetch()} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={MessageCircleHeart}
          title="No messages yet"
          message="Messages are for friends. Make a friend first — then you can chat one-on-one here."
          action="Find friends"
          onAction={() => router.push('/friends')}
          secondaryAction="Try Icebreaker"
          onSecondaryAction={() => router.push('/games/icebreaker')}
        />
      ) : (
        <FlashList
          data={sorted}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => <ConversationRow conversation={item} myId={me.data?.id} />}
          contentContainerStyle={{ paddingBottom: space.huge }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
        />
      )}
    </Screen>
  );
}

function ConversationRow({ conversation: c, myId }: { conversation: Conversation; myId?: string }) {
  const { colors } = useTheme();
  const last = c.last_message;
  const deleted = !!last && last.content === '';
  const mine = !!last && !!myId && last.sender_id === myId;
  const preview = !last ? 'Say hi 👋' : deleted ? 'Message deleted' : `${mine ? 'You: ' : ''}${last.content.replace(/\s+/g, ' ')}`;
  const unread = c.unread_count > 0;
  const when = timeAgo(c.last_message_at ?? last?.created_at);
  const online = c.online === true;

  const label = [
    c.other_user.display_name,
    online ? 'online' : null,
    unread ? `${c.unread_count} unread` : null,
    deleted ? 'Message deleted' : preview,
    when,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <PressableScale onPress={() => router.push(`/messages/${c.id}`)} scaleTo={0.99} accessibilityLabel={label} accessibilityHint="Opens the chat" style={styles.row}>
      <Avatar config={c.other_user.avatar} size={52} online={online} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.top}>
          <Text variant={unread ? 'bodyStrong' : 'subheading'} numberOfLines={1} style={{ flex: 1 }}>
            {c.other_user.display_name}
          </Text>
          <Text variant="caption" tone={unread ? 'primary' : 'faint'}>
            {when}
          </Text>
        </View>
        <View style={styles.top}>
          <Text
            variant={unread ? 'label' : 'body'}
            numberOfLines={1}
            style={[{ flex: 1 }, deleted && { fontStyle: 'italic' }, { color: unread ? colors.text : colors.textMuted }]}
          >
            {preview}
          </Text>
          {unread ? (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text variant="tiny" style={{ color: colors.onPrimary }}>
                {c.unread_count > 99 ? '99+' : c.unread_count}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: screenPadding, paddingVertical: space.md, minHeight: 72 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
