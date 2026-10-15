import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Flame, Plus, UsersRound, Video } from 'lucide-react-native';

import { squadNightLabel, useSquads, type Squad } from '@/api/squads-extra';
import { UserPhoto } from '@/components/UserPhoto';
import { Badge, Card, EmptyState, ErrorState, Header, IconButton, RowSkeleton, Screen, Text } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space } from '@/theme/tokens';

export default function Squads() {
  const { colors } = useTheme();
  const squads = useSquads();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await squads.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Screen
      padded={false}
      header={<Header title="Squads" subtitle="Your small crews, up to 8 friends" right={<IconButton icon={Plus} variant="primary" label="Create a squad" onPress={() => router.push('/squads/create' as Href)} />} />}
    >
      {squads.isLoading ? (
        <View style={styles.pad}>
          <RowSkeleton count={4} />
        </View>
      ) : squads.isError ? (
        <ErrorState error={squads.error} onRetry={() => squads.refetch()} />
      ) : !squads.data?.length ? (
        <EmptyState
          icon={UsersRound}
          title="No squads yet"
          message="Gather up to 8 friends for a group chat, video hangouts and a weekly squad night."
          action="Create a squad"
          onAction={() => router.push('/squads/create' as Href)}
        />
      ) : (
        <FlatList
          data={squads.data}
          keyExtractor={(s) => s.id}
          contentContainerStyle={[styles.pad, { gap: space.md, paddingBottom: space.huge }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
          renderItem={({ item }) => <SquadCard squad={item} />}
        />
      )}
    </Screen>
  );
}

function SquadCard({ squad }: { squad: Squad }) {
  const { colors } = useTheme();
  const night = squadNightLabel(squad);
  const preview = squad.last_message
    ? squad.last_message.removed
      ? 'Message removed'
      : `${squad.last_message.sender.display_name}: ${squad.last_message.content}`
    : 'Say hi to your squad 👋';
  return (
    <Card onPress={() => router.push(`/squads/${squad.id}` as Href)} accessibilityLabel={`${squad.name}. ${squad.member_count} people. ${squad.unread_count ? `${squad.unread_count} unread` : ''}`}>
      <View style={styles.row}>
        <View style={[styles.emoji, { backgroundColor: colors.primarySoft }]}>
          <Text style={{ fontSize: 26, lineHeight: 32 }}>{squad.emoji}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.titleRow}>
            <Text variant="subheading" numberOfLines={1} style={{ flexShrink: 1 }}>
              {squad.name}
            </Text>
            {squad.streak_weeks > 0 ? (
              <View style={styles.streak} accessibilityLabel={`${squad.streak_weeks} week streak`}>
                <Flame size={14} color={colors.warning} />
                <Text variant="caption" tone="warning">
                  {squad.streak_weeks}
                </Text>
              </View>
            ) : null}
            <View style={{ flex: 1 }} />
            {squad.last_message ? (
              <Text variant="caption" tone="faint">
                {timeAgo(squad.last_message.created_at)}
              </Text>
            ) : null}
          </View>
          <Text variant="body" tone={squad.unread_count ? 'default' : 'muted'} numberOfLines={1}>
            {preview}
          </Text>
        </View>
        {squad.unread_count ? <Badge label={String(squad.unread_count)} tone="accent" /> : null}
      </View>
      <View style={[styles.row, { marginTop: space.md }]}>
        <View style={styles.faces}>
          {squad.members.slice(0, 5).map((m, i) => (
            <View key={m.user.id} style={{ marginLeft: i ? -10 : 0, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.surface }}>
              <UserPhoto user={m.user} size={28} showVerified={false} />
            </View>
          ))}
        </View>
        <Text variant="caption" tone="muted" style={{ flex: 1 }} numberOfLines={1}>
          {night ? `Squad night ${night}` : `${squad.member_count} ${squad.member_count === 1 ? 'person' : 'people'}`}
        </Text>
        {squad.live_room_id ? (
          <View style={styles.live}>
            <Video size={14} color={colors.success} />
            <Text variant="caption" tone="success">
              {squad.present_count ? `${squad.present_count} hanging out` : 'Hangout open'}
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: screenPadding, paddingTop: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  emoji: { width: 52, height: 52, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  faces: { flexDirection: 'row' },
  live: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
