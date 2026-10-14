import { useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Inbox, Search, Sparkles, Users, X } from 'lucide-react-native';

import { useFriendRequests, useFriends, useRespondRequest, useSuggestions } from '@/api/hooks';
import type { Friend, FriendRequest, UserSummary } from '@/api/types';
import { useDebounced } from '@/api/social-extra';
import { UserRow } from '@/components/cards';
import { AddFriendButton, FriendshipMeter, OnlineLabel } from '@/components/social';
import { Button, EmptyState, ErrorState, Header, IconButton, Input, RowSkeleton, Screen, SegmentedControl, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { timeAgo, VIBE_LABELS } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { screenPadding, space } from '@/theme/tokens';

type Tab = 'friends' | 'requests' | 'suggestions';

export default function Friends() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const initial: Tab = params.tab === 'requests' || params.tab === 'suggestions' ? params.tab : 'friends';
  const [tab, setTab] = useState<Tab>(initial);
  const requests = useFriendRequests();
  const incoming = requests.data?.filter((r) => r.direction === 'incoming').length ?? 0;

  useEffect(() => {
    if (params.tab === 'requests' || params.tab === 'suggestions' || params.tab === 'friends') setTab(params.tab);
  }, [params.tab]);

  return (
    <Screen
      padded={false}
      header={
        <View style={{ paddingBottom: space.md }}>
          <Header title="Friends" right={<IconButton icon={Search} label="Find people" onPress={() => router.push('/explore')} />} />
          <View style={{ paddingHorizontal: screenPadding }}>
            <SegmentedControl<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'friends', label: 'Friends' },
                { value: 'requests', label: incoming ? `Requests (${incoming})` : 'Requests' },
                { value: 'suggestions', label: 'Suggestions' },
              ]}
            />
          </View>
        </View>
      }
    >
      {tab === 'friends' ? <FriendsTab /> : tab === 'requests' ? <RequestsTab /> : <SuggestionsTab />}
    </Screen>
  );
}

function useRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };
  return { refreshing, onRefresh };
}

function NoFriendsYet() {
  return (
    <EmptyState
      icon={Users}
      title="No friends yet"
      message="Friendships on Veyvo start in hangouts and games. Find people who share your interests, or try a quick Icebreaker."
      action="Explore"
      onAction={() => router.push('/explore')}
      secondaryAction="Try Icebreaker"
      onSecondaryAction={() => router.push('/games/icebreaker')}
    />
  );
}

// ---------- Friends ----------
function FriendsTab() {
  const { colors, reduceMotion } = useTheme();
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 300);
  const friends = useFriends(term || undefined);
  // Keep the last list on screen while a new search loads, so results don't flash.
  const last = useRef<Friend[] | undefined>(undefined);
  if (friends.data) last.current = friends.data;
  const list = friends.data ?? last.current;
  const { refreshing, onRefresh } = useRefresh(friends.refetch);

  if (!list && friends.isLoading) {
    return (
      <View style={styles.pad}>
        <RowSkeleton count={6} />
      </View>
    );
  }
  if (!list && friends.isError) return <ErrorState error={friends.error} onRetry={() => friends.refetch()} />;
  if (!term && !q && list?.length === 0) return <NoFriendsYet />;

  return (
    <FlatList
      data={list ?? []}
      keyExtractor={(f) => f.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.pad, { paddingBottom: space.huge }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
      ListHeaderComponent={
        <View style={{ marginBottom: space.md }}>
          <Input icon={Search} value={q} onChangeText={setQ} placeholder="Search your friends" accessibilityLabel="Search your friends" autoCapitalize="none" autoCorrect={false} maxLength={40} />
        </View>
      }
      ListEmptyComponent={<EmptyState compact icon={Search} title={`No friends match "${q.trim()}"`} message="Check the spelling, or search everyone on Explore." action="Search Explore" onAction={() => router.push('/explore')} />}
      renderItem={({ item }) => (
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180)}>
          <UserRow
            user={item}
            online={item.online === true}
            subtitle={item.vibe ? VIBE_LABELS[item.vibe] : `Friends since ${new Date(item.since).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`}
            right={
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                {item.online === true ? <OnlineLabel small /> : null}
                <FriendshipMeter level={item.friendship_level} progress={item.friendship_progress} />
              </View>
            }
          />
        </Animated.View>
      )}
    />
  );
}

// ---------- Requests ----------
function RequestsTab() {
  const { colors, reduceMotion } = useTheme();
  const requests = useFriendRequests();
  const respond = useRespondRequest();
  const [busy, setBusy] = useState<Record<string, 'accept' | 'decline' | 'cancel'>>({});
  const { refreshing, onRefresh } = useRefresh(requests.refetch);

  const act = async (r: FriendRequest, action: 'accept' | 'decline' | 'cancel') => {
    if (busy[r.id]) return;
    setBusy((b) => ({ ...b, [r.id]: action }));
    try {
      await respond.mutateAsync({ requestId: r.id, action, userId: r.user.id });
      if (action === 'accept') {
        haptic.success();
        toast.success(`You and ${r.user.display_name} are friends now`);
      } else {
        haptic.light();
      }
    } catch (e) {
      haptic.error();
      toast.error("That didn't work", errorMessage(e));
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[r.id];
        return next;
      });
    }
  };

  if (requests.isLoading) {
    return (
      <View style={styles.pad}>
        <RowSkeleton count={4} />
      </View>
    );
  }
  if (requests.isError) return <ErrorState error={requests.error} onRetry={() => requests.refetch()} />;

  const incoming = requests.data?.filter((r) => r.direction === 'incoming') ?? [];
  const outgoing = requests.data?.filter((r) => r.direction === 'outgoing') ?? [];
  type Row = { kind: 'header'; title: string; key: string } | { kind: 'req'; req: FriendRequest; key: string };
  const rows: Row[] = [
    ...(incoming.length ? [{ kind: 'header' as const, title: `Received · ${incoming.length}`, key: 'h-in' }] : []),
    ...incoming.map((req) => ({ kind: 'req' as const, req, key: req.id })),
    ...(outgoing.length ? [{ kind: 'header' as const, title: `Sent · ${outgoing.length}`, key: 'h-out' }] : []),
    ...outgoing.map((req) => ({ kind: 'req' as const, req, key: req.id })),
  ];

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.key}
      contentContainerStyle={[styles.pad, { paddingBottom: space.huge, flexGrow: 1 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
      ListEmptyComponent={
        <EmptyState
          icon={Inbox}
          title="No pending requests"
          message="When someone wants to be friends, it'll show up here. You can also meet people in hangouts or Icebreaker."
          action="Explore"
          onAction={() => router.push('/explore')}
          secondaryAction="Try Icebreaker"
          onSecondaryAction={() => router.push('/games/icebreaker')}
        />
      }
      renderItem={({ item }) => {
        if (item.kind === 'header') {
          return (
            <Text variant="tiny" tone="faint" style={styles.groupTitle} accessibilityRole="header">
              {item.title.toUpperCase()}
            </Text>
          );
        }
        const r = item.req;
        const pending = busy[r.id];
        return (
          <Animated.View layout={reduceMotion ? undefined : LinearTransition} entering={reduceMotion ? undefined : FadeIn.duration(180)}>
            <UserRow
              user={r.user}
              subtitle={r.direction === 'incoming' ? `Wants to be friends · ${timeAgo(r.created_at)}` : `Sent ${timeAgo(r.created_at)}`}
              right={
                r.direction === 'incoming' ? (
                  <View style={styles.actions}>
                    <IconButton icon={X} variant="filled" label={`Decline ${r.user.display_name}`} disabled={!!pending} onPress={() => act(r, 'decline')} />
                    <Button title="Accept" icon={Check} size="sm" loading={pending === 'accept'} disabled={!!pending} onPress={() => act(r, 'accept')} accessibilityLabel={`Accept ${r.user.display_name}`} />
                  </View>
                ) : (
                  <Button title="Cancel" size="sm" variant="secondary" loading={pending === 'cancel'} disabled={!!pending} onPress={() => act(r, 'cancel')} accessibilityLabel={`Cancel request to ${r.user.display_name}`} />
                )
              }
            />
          </Animated.View>
        );
      }}
    />
  );
}

// ---------- Suggestions ----------
function SuggestionsTab() {
  const { colors } = useTheme();
  const suggestions = useSuggestions();
  // Freeze the list once loaded so people don't vanish from under your finger after tapping Add.
  const [frozen, setFrozen] = useState<UserSummary[] | null>(null);
  useEffect(() => {
    if (suggestions.data && !frozen) setFrozen(suggestions.data);
  }, [suggestions.data, frozen]);
  const { refreshing, onRefresh } = useRefresh(async () => {
    const res = await suggestions.refetch();
    if (res.data) setFrozen(res.data);
  });

  if (suggestions.isLoading) {
    return (
      <View style={styles.pad}>
        <RowSkeleton count={5} />
      </View>
    );
  }
  if (suggestions.isError && !frozen) return <ErrorState error={suggestions.error} onRetry={() => suggestions.refetch()} />;
  const list = frozen ?? suggestions.data ?? [];

  return (
    <FlatList
      data={list}
      keyExtractor={(u) => u.id}
      contentContainerStyle={[styles.pad, { paddingBottom: space.huge, flexGrow: 1 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
      ListHeaderComponent={
        list.length ? (
          <Text variant="caption" tone="muted" style={{ marginBottom: space.sm }}>
            People who share your interests or friends. Only people who choose to be discoverable appear here.
          </Text>
        ) : null
      }
      ListEmptyComponent={
        <EmptyState
          icon={Sparkles}
          title="No suggestions right now"
          message="Add more interests or join a hangout, and we'll suggest people you might click with."
          action="Explore"
          onAction={() => router.push('/explore')}
          secondaryAction="Try Icebreaker"
          onSecondaryAction={() => router.push('/games/icebreaker')}
        />
      }
      renderItem={({ item }) => <UserRow user={item} subtitle={`Level ${item.level}${item.username ? ` · @${item.username}` : ''}`} right={<AddFriendButton userId={item.id} />} />}
    />
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: screenPadding },
  groupTitle: { marginTop: space.lg, marginBottom: space.xs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
