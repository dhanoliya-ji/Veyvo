import { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Clock, Compass, Search, SearchX, Sparkles, Users, X } from 'lucide-react-native';

import { qk, useCommunities, useInterests, useRecommendedCommunities, useRooms, useSearch, useSuggestions } from '@/api/hooks';
import type { Interest, SearchResults } from '@/api/types';
import { useDebounced } from '@/api/social-extra';
import { CommunityCard, RoomCard, UserRow } from '@/components/cards';
import { PersonCard } from '@/components/social';
import { Chip, EmptyState, ErrorState, Header, Input, PressableScale, RoomCardSkeleton, RowSkeleton, Screen, SectionHeader, Skeleton, Text } from '@/components/ui';
import { useTabBarInset } from '@/components/TabBar';
import { usePreferences } from '@/stores/preferences';
import { useTheme } from '@/theme/ThemeProvider';
import { screenPadding, space } from '@/theme/tokens';

type Scope = 'all' | 'people' | 'rooms' | 'communities';
const SCOPES: { value: Scope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'people', label: 'People' },
  { value: 'rooms', label: 'Hangouts' },
  { value: 'communities', label: 'Communities' },
];

export default function Explore() {
  const { reduceMotion } = useTheme();
  const qc = useQueryClient();
  const tabInset = useTabBarInset();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [interestId, setInterestId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const term = useDebounced(query.trim(), 350);
  const searching = query.trim().length > 0;
  const addRecent = usePreferences((s) => s.addRecentSearch);

  const remember = () => {
    if (term.length >= 2) addRecent(term);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.suggestions }),
        qc.invalidateQueries({ queryKey: qk.communitiesAll }),
        qc.invalidateQueries({ queryKey: qk.roomsAll }),
        qc.invalidateQueries({ queryKey: qk.interests }),
        term ? qc.invalidateQueries({ queryKey: qk.search(term) }) : Promise.resolve(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Screen
      scroll
      edges={['top']}
      bottomInset={tabInset}
      refreshing={refreshing}
      onRefresh={onRefresh}
      header={
        <View style={{ paddingBottom: space.md }}>
          <Header title="Explore" back={false} large />
          <View style={{ paddingHorizontal: screenPadding, gap: space.md }}>
          <Input
            icon={Search}
            value={query}
            onChangeText={setQuery}
            placeholder="Search people, hangouts, communities"
            accessibilityLabel="Search"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            maxLength={60}
            onSubmitEditing={() => {
              const q = query.trim();
              if (q.length >= 2) addRecent(q);
            }}
          />
          {searching ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
              {SCOPES.map((s) => (
                <Chip key={s.value} label={s.label} selected={scope === s.value} onPress={() => setScope(s.value)} />
              ))}
              <Chip label="Clear search" icon={X} onPress={() => { setQuery(''); setScope('all'); }} />
            </ScrollView>
          ) : null}
          </View>
        </View>
      }
    >
      {searching ? (
        <SearchView key="search" term={term} pending={term !== query.trim()} scope={scope} onResultTap={remember} onPickInterest={(i) => { setQuery(''); setInterestId(i.id); }} />
      ) : (
        <Animated.View key="discover" entering={reduceMotion ? undefined : FadeIn.duration(200)} style={{ gap: space.xxl }}>
          <RecentSearches onPick={setQuery} />
          <InterestBrowser selected={interestId} onSelect={setInterestId} />
          {interestId == null ? <Discovery /> : null}
        </Animated.View>
      )}
    </Screen>
  );
}

// ---------- Search ----------
function SearchView({ term, pending, scope, onResultTap, onPickInterest }: { term: string; pending: boolean; scope: Scope; onResultTap: () => void; onPickInterest: (i: Interest) => void }) {
  const search = useSearch(term);
  const interests = useInterests();

  if (!term || pending || search.isLoading) {
    return (
      <View style={{ gap: space.lg }} accessibilityLabel="Searching">
        <RowSkeleton count={4} />
      </View>
    );
  }
  if (search.isError) return <ErrorState error={search.error} onRetry={() => search.refetch()} />;

  const data: SearchResults = search.data ?? { users: [], rooms: [], communities: [] };
  const show = (s: Scope) => scope === 'all' || scope === s;
  const users = show('people') ? data.users : [];
  const rooms = show('rooms') ? data.rooms : [];
  const communities = show('communities') ? data.communities : [];
  const total = users.length + rooms.length + communities.length;

  if (total === 0) {
    const ideas = (interests.data ?? []).slice(0, 8);
    return (
      <View>
        <EmptyState icon={SearchX} title={`No matches for "${term}"`} message={scope === 'all' ? 'Try a different name or a broader word. Some people choose not to appear in search.' : 'Try "All" or a different word.'} />
        {ideas.length ? (
          <View style={{ gap: space.md }}>
            <Text variant="label" tone="muted">
              Or browse by interest
            </Text>
            <View style={styles.wrap}>
              {ideas.map((i) => (
                <Chip key={i.id} label={i.name} onPress={() => onPickInterest(i)} />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(160)} style={{ gap: space.xxl }}>
      {users.length ? (
        <View>
          <SectionHeader title="People" subtitle={`${users.length} found`} />
          {users.map((u) => (
            <UserRow key={u.id} user={u} onPress={() => { onResultTap(); router.push(`/user/${u.id}`); }} />
          ))}
        </View>
      ) : null}
      {rooms.length ? (
        <View style={{ gap: space.md }}>
          <SectionHeader title="Hangouts" />
          {rooms.map((r) => (
            <RoomCard key={r.id} room={r} width="100%" onPress={() => { onResultTap(); router.push(`/room/${r.id}`); }} />
          ))}
        </View>
      ) : null}
      {communities.length ? (
        <View style={{ gap: space.sm }}>
          <SectionHeader title="Communities" />
          {communities.map((c) => (
            <PressableWrap key={c.id} onPress={onResultTap}>
              <CommunityCard community={c} />
            </PressableWrap>
          ))}
        </View>
      ) : null}
    </Animated.View>
  );
}

/** Records the search as "recent" when a community card (which navigates itself) is tapped. */
function PressableWrap({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return <View onTouchEnd={onPress}>{children}</View>;
}

// ---------- Discovery ----------
function RecentSearches({ onPick }: { onPick: (q: string) => void }) {
  const { colors } = useTheme();
  const recent = usePreferences((s) => s.recentSearches);
  const clear = usePreferences((s) => s.clearRecentSearches);
  if (!recent.length) return null;
  return (
    <View>
      <SectionHeader title="Recent searches" action="Clear" onAction={clear} />
      <View style={styles.wrap}>
        {recent.map((q) => (
          <PressableScale key={q} onPress={() => onPick(q)} accessibilityLabel={`Search again for ${q}`} style={[styles.recent, { backgroundColor: colors.surfaceAlt }]}>
            <Clock size={14} color={colors.textMuted} />
            <Text variant="label" tone="muted" numberOfLines={1}>
              {q}
            </Text>
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

function InterestBrowser({ selected, onSelect }: { selected: number | null; onSelect: (id: number | null) => void }) {
  const interests = useInterests();
  const current = interests.data?.find((i) => i.id === selected) ?? null;

  return (
    <View style={{ gap: space.lg }}>
      <View>
        <SectionHeader title="Browse by interest" action={selected != null ? 'Reset' : undefined} onAction={() => onSelect(null)} />
        {interests.isLoading ? (
          <View style={styles.chipRowStatic}>
            {[80, 64, 96, 72].map((w) => (
              <Skeleton key={w} width={w} height={36} rounded={18} />
            ))}
          </View>
        ) : interests.isError ? (
          <ErrorState error={interests.error} onRetry={() => interests.refetch()} compact />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -screenPadding }} contentContainerStyle={[styles.chipRow, { paddingHorizontal: screenPadding }]}>
            <Chip label="All" selected={selected == null} onPress={() => onSelect(null)} />
            {(interests.data ?? []).map((i) => (
              <Chip key={i.id} label={i.name} selected={selected === i.id} onPress={() => onSelect(selected === i.id ? null : i.id)} />
            ))}
          </ScrollView>
        )}
      </View>
      {current ? <InterestResults interest={current} onReset={() => onSelect(null)} /> : null}
    </View>
  );
}

function InterestResults({ interest, onReset }: { interest: Interest; onReset: () => void }) {
  const { reduceMotion } = useTheme();
  const rooms = useRooms({ interest_id: interest.id });
  const communities = useCommunities({ interest_id: interest.id });
  const nothing = rooms.data?.length === 0 && communities.data?.length === 0;

  return (
    <Animated.View key={interest.id} entering={reduceMotion ? undefined : FadeIn.duration(200)} style={{ gap: space.xxl }}>
      {nothing ? (
        <EmptyState
          compact
          icon={Compass}
          title={`Nothing in ${interest.name} yet`}
          message="Be the first: start a hangout for this interest, or browse everything."
          action="Start a hangout"
          onAction={() => router.push('/room/create')}
          secondaryAction="Show everything"
          onSecondaryAction={onReset}
        />
      ) : (
        <>
          <View style={{ gap: space.md }}>
            <SectionHeader title={`${interest.name} hangouts`} />
            {rooms.isLoading ? <RoomCardSkeleton /> : null}
            {rooms.isError ? <ErrorState error={rooms.error} onRetry={() => rooms.refetch()} compact /> : null}
            {rooms.data?.length === 0 ? (
              <Text tone="muted">No hangouts for {interest.name} right now.</Text>
            ) : (
              rooms.data?.map((r) => <RoomCard key={r.id} room={r} width="100%" />)
            )}
          </View>
          <View style={{ gap: space.sm }}>
            <SectionHeader title={`${interest.name} communities`} />
            {communities.isLoading ? <RowSkeleton count={2} /> : null}
            {communities.isError ? <ErrorState error={communities.error} onRetry={() => communities.refetch()} compact /> : null}
            {communities.data?.length === 0 ? (
              <Text tone="muted">No communities for {interest.name} yet.</Text>
            ) : (
              communities.data?.map((c) => <CommunityCard key={c.id} community={c} />)
            )}
          </View>
        </>
      )}
    </Animated.View>
  );
}

function Discovery() {
  const suggestions = useSuggestions();
  const communities = useRecommendedCommunities();
  const upcoming = useRooms({ status: 'scheduled' });
  const publicUpcoming = useMemo(() => (upcoming.data ?? []).filter((r) => r.visibility === 'public'), [upcoming.data]);

  return (
    <>
      <View>
        <SectionHeader title="People you may like" subtitle="Based on shared interests and friends" action="See all" onAction={() => router.push('/friends?tab=suggestions')} />
        {suggestions.isLoading ? (
          <View style={styles.chipRowStatic}>
            {[0, 1, 2].map((k) => (
              <Skeleton key={k} width={148} height={180} rounded={20} />
            ))}
          </View>
        ) : suggestions.isError ? (
          <ErrorState error={suggestions.error} onRetry={() => suggestions.refetch()} compact />
        ) : suggestions.data?.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -screenPadding }} contentContainerStyle={[styles.rail, { paddingHorizontal: screenPadding }]}>
            {suggestions.data.map((u) => (
              <PersonCard key={u.id} user={u} />
            ))}
          </ScrollView>
        ) : (
          <EmptyState compact icon={Sparkles} title="No suggestions yet" message="Add a few interests or join a hangout and we'll find people you'd get along with." action="Try Icebreaker" onAction={() => router.push('/games/icebreaker')} />
        )}
      </View>

      <View style={{ gap: space.sm }}>
        <SectionHeader title="Communities for you" />
        {communities.isLoading ? <RowSkeleton count={3} /> : null}
        {communities.isError ? <ErrorState error={communities.error} onRetry={() => communities.refetch()} compact /> : null}
        {communities.data?.length === 0 ? <EmptyState compact icon={Users} title="No suggestions right now" message="Pick an interest above to find your people." /> : null}
        {communities.data?.slice(0, 6).map((c) => (
          <CommunityCard key={c.id} community={c} />
        ))}
      </View>

      <View>
        <SectionHeader title="Upcoming events" subtitle="Times shown in your time zone" />
        {upcoming.isLoading ? (
          <View style={styles.chipRowStatic}>
            <RoomCardSkeleton />
          </View>
        ) : upcoming.isError ? (
          <ErrorState error={upcoming.error} onRetry={() => upcoming.refetch()} compact />
        ) : publicUpcoming.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -screenPadding }} contentContainerStyle={[styles.rail, { paddingHorizontal: screenPadding }]}>
            {publicUpcoming.map((r) => (
              <RoomCard key={r.id} room={r} />
            ))}
          </ScrollView>
        ) : (
          <EmptyState compact icon={CalendarClock} title="Nothing scheduled yet" message="Plan something and others can save the date." action="Schedule a hangout" onAction={() => router.push('/room/create')} />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  chipRow: { gap: space.sm, alignItems: 'center' },
  chipRowStatic: { flexDirection: 'row', gap: space.sm, overflow: 'hidden' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  rail: { gap: space.md },
  recent: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 44, borderRadius: 999, maxWidth: 220 },
});
