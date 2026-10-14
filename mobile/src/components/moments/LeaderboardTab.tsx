import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Trophy } from 'lucide-react-native';

import { RANK_LABELS, useLeaderboard, type LeaderboardEntry } from '@/api/moments-extra';
import { UserPhoto } from '@/components/UserPhoto';
import { Badge, EmptyState, ErrorState, PressableScale, RowSkeleton, SegmentedControl, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const TIER_TONE = { newcomer: 'neutral', regular: 'primary', core: 'success', legend: 'warning' } as const;

export function RankBadge({ tier }: { tier: string }) {
  return <Badge label={RANK_LABELS[tier] ?? tier} tone={TIER_TONE[tier as keyof typeof TIER_TONE] ?? 'neutral'} />;
}

function PodiumSpot({ entry, place }: { entry: LeaderboardEntry; place: 1 | 2 | 3 }) {
  const { colors } = useTheme();
  const height = place === 1 ? 92 : place === 2 ? 70 : 56;
  const tint = place === 1 ? colors.gold : place === 2 ? colors.textMuted : colors.accent;
  return (
    <PressableScale
      onPress={() => router.push(`/user/${entry.user.id}`)}
      style={styles.podiumSpot}
      accessibilityLabel={`Place ${place}: ${entry.user.display_name}, ${entry.points} points`}
    >
      <UserPhoto user={entry.user} size={place === 1 ? 64 : 52} />
      <Text variant="label" numberOfLines={1} style={{ maxWidth: 96 }}>
        {entry.user.display_name}
      </Text>
      <View style={[styles.block, { height, backgroundColor: `${tint}26`, borderColor: tint }]}>
        <Text variant="heading" style={{ color: tint }}>
          {place}
        </Text>
        <Text variant="caption" tone="muted">
          {entry.points} pts
        </Text>
      </View>
    </PressableScale>
  );
}

/** Weekly community leaderboard. Points come only from real activity tracked by the server. */
export function LeaderboardTab({ communityId }: { communityId: string }) {
  const { colors } = useTheme();
  const [week, setWeek] = useState<'current' | 'previous'>('current');
  const board = useLeaderboard(communityId, week);
  const entries = board.data?.entries ?? [];
  const [first, second, third] = entries;
  const rest = entries.slice(3);
  const me = board.data?.me;

  return (
    <View style={{ gap: space.lg }}>
      <SegmentedControl
        value={week}
        onChange={setWeek}
        options={[
          { value: 'current', label: 'This week' },
          { value: 'previous', label: 'Last week' },
        ]}
      />
      <Text variant="caption" tone="faint">
        Earn points by posting, hosting and joining community hangouts, and playing games together. Resets every Monday (UTC).
      </Text>
      {board.isLoading ? <RowSkeleton count={4} /> : null}
      {board.isError ? <ErrorState error={board.error} onRetry={() => board.refetch()} compact /> : null}
      {board.isSuccess && !entries.length ? (
        <EmptyState compact icon={Trophy} title="No points yet" message={week === 'current' ? 'Be the first on the board this week.' : 'Nobody scored last week.'} />
      ) : null}
      {first ? (
        <View style={styles.podium}>
          {second ? <PodiumSpot entry={second} place={2} /> : <View style={styles.podiumSpot} />}
          <PodiumSpot entry={first} place={1} />
          {third ? <PodiumSpot entry={third} place={3} /> : <View style={styles.podiumSpot} />}
        </View>
      ) : null}
      {rest.map((e) => (
        <PressableScale
          key={e.user.id}
          onPress={() => router.push(`/user/${e.user.id}`)}
          style={[styles.row, { backgroundColor: e.user.id === me?.user.id ? colors.primarySoft : colors.surface, borderColor: colors.border }]}
          accessibilityLabel={`Rank ${e.rank}: ${e.user.display_name}, ${e.points} points`}
        >
          <Text variant="bodyStrong" tone="muted" style={{ width: 28 }}>
            {e.rank}
          </Text>
          <UserPhoto user={e.user} size={36} />
          <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
            {e.user.display_name}
          </Text>
          <RankBadge tier={e.tier} />
          <Text variant="label">{e.points}</Text>
        </PressableScale>
      ))}
      {me && me.rank > 20 ? (
        <View style={[styles.row, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}>
          <Text variant="bodyStrong" tone="primary" style={{ width: 28 }}>
            {me.rank}
          </Text>
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            You
          </Text>
          <Text variant="label">{me.points} pts</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  podium: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.sm },
  podiumSpot: { flex: 1, alignItems: 'center', gap: 6 },
  block: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderWidth: 1.5, borderBottomWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
