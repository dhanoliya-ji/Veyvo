import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { BookOpen, Coffee, Gamepad2, Plus, Sparkles, Tent, Users } from 'lucide-react-native';

import { useCommunities, useInterests, useRecommendedCommunities, useRooms, type RoomFilters } from '@/api/hooks';
import { CommunityCard, RoomCard } from '@/components/cards';
import { resolveCategories } from '@/components/room/constants';
import { useTabBarInset } from '@/components/TabBar';
import { Button, Card, Chip, ErrorState, PressableScale, RoomCardSkeleton, RowSkeleton, Screen, SectionHeader, SegmentedControl, Skeleton, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space } from '@/theme/tokens';

type FormatFilter = 'all' | 'voice' | 'text' | 'study';

const FORMAT_OPTIONS: { value: FormatFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'voice', label: 'Voice' },
  { value: 'text', label: 'Text' },
  { value: 'study', label: 'Study' },
];

export default function Hangouts() {
  const { colors } = useTheme();
  const tabInset = useTabBarInset();
  const interests = useInterests();
  const categories = useMemo(() => resolveCategories(interests.data), [interests.data]);
  const [interestId, setInterestId] = useState<number | null>(null);
  const [format, setFormat] = useState<FormatFilter>('all');

  const filters = useMemo<RoomFilters>(() => {
    const f: RoomFilters = {};
    if (interestId) f.interest_id = interestId;
    if (format === 'voice') f.format = 'voice';
    if (format === 'text') f.format = 'text';
    if (format === 'study') f.kind = 'study';
    return f;
  }, [interestId, format]);

  const live = useRooms(filters);
  const soon = useRooms({ ...filters, status: 'scheduled' });
  const mine = useCommunities({ mine: true });
  const recommended = useRecommendedCommunities();

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([live.refetch(), soon.refetch(), mine.refetch(), recommended.refetch()]);
    setRefreshing(false);
  };

  const category = categories.find((c) => c.interestId === interestId);
  const chattingId = categories.find((c) => c.slug === 'just-chatting')?.interestId;
  const gamingId = categories.find((c) => c.slug === 'gaming')?.interestId;
  const filtered = !!interestId || format !== 'all';

  const presets: { key: string; label: string; icon: typeof Tent; params: Record<string, string> }[] = [
    { key: 'study', label: 'Start a study room', icon: BookOpen, params: { kind: 'study' } },
    { key: 'chat', label: 'Start a chill chat', icon: Coffee, params: chattingId ? { interest_id: String(chattingId) } : {} },
    ...(gamingId ? [{ key: 'gaming', label: 'Start a gaming hangout', icon: Gamepad2, params: { interest_id: String(gamingId) } }] : []),
  ];

  return (
    <Screen scroll edges={['top']} padded={false} refreshing={refreshing} onRefresh={refresh} bottomInset={tabInset}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="display" accessibilityRole="header">
            Hangouts
          </Text>
          <Text variant="body" tone="muted">
            Drop into a room, or open your own.
          </Text>
        </View>
        <Button title="Create" icon={Plus} size="md" onPress={() => router.push('/room/create')} accessibilityLabel="Create a hangout" />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel="Categories">
        <Chip label="Everything" selected={!interestId} onPress={() => setInterestId(null)} />
        {interests.isLoading
          ? [80, 64, 96, 72].map((w) => <Skeleton key={w} width={w} height={36} rounded={18} />)
          : categories.map((c) => (
              <Chip key={c.slug} label={c.label} icon={c.icon} selected={interestId === c.interestId} onPress={() => setInterestId(interestId === c.interestId ? null : c.interestId)} />
            ))}
      </ScrollView>

      <View style={{ paddingHorizontal: screenPadding, marginBottom: space.xl }}>
        <SegmentedControl options={FORMAT_OPTIONS} value={format} onChange={setFormat} />
      </View>

      {/* Live now */}
      <View style={styles.section}>
        <SectionHeader title="Live now" subtitle={category ? `${category.label} hangouts happening right now` : 'Hangouts happening right now'} />
        {live.isLoading ? (
          <View style={{ gap: space.md }}>
            <RoomCardSkeleton />
            <RoomCardSkeleton />
          </View>
        ) : live.isError ? (
          <Card>
            <ErrorState error={live.error} onRetry={() => live.refetch()} compact />
          </Card>
        ) : live.data && live.data.length > 0 ? (
          <View style={{ gap: space.md }}>
            {live.data.map((room) => (
              <RoomCard key={room.id} room={room} width="100%" />
            ))}
          </View>
        ) : (
          <QuietState
            title={filtered ? `No ${category ? `${category.label.toLowerCase()} ` : ''}hangouts live right now` : "It's quiet right now"}
            message="Be the one who gets it going. Open a room and people who share your interests can drop in."
            presets={presets}
            onClearFilters={filtered ? () => (setInterestId(null), setFormat('all')) : undefined}
            createParams={interestId ? { interest_id: String(interestId) } : format === 'study' ? { kind: 'study' } : {}}
          />
        )}
      </View>

      {/* Starting soon */}
      {soon.isLoading || soon.isError || (soon.data && soon.data.length > 0) ? (
        <View style={{ marginBottom: space.xxl }}>
          <View style={{ paddingHorizontal: screenPadding }}>
            <SectionHeader title="Starting soon" subtitle="Times shown in your time zone" />
          </View>
          {soon.isLoading ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hscroll}>
              <RoomCardSkeleton />
              <RoomCardSkeleton />
            </ScrollView>
          ) : soon.isError ? (
            <View style={{ paddingHorizontal: screenPadding }}>
              <ErrorState error={soon.error} onRetry={() => soon.refetch()} compact />
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hscroll}>
              {soon.data!.map((room) => (
                <RoomCard key={room.id} room={room} />
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}

      {/* Your communities */}
      <View style={styles.section}>
        <SectionHeader title="Your communities" />
        {mine.isLoading ? (
          <RowSkeleton count={2} />
        ) : mine.isError ? (
          <ErrorState error={mine.error} onRetry={() => mine.refetch()} compact />
        ) : mine.data && mine.data.length > 0 ? (
          <View style={{ gap: space.sm }}>
            {mine.data.map((c) => (
              <CommunityCard key={c.id} community={c} />
            ))}
          </View>
        ) : (
          <Card style={{ alignItems: 'center', gap: space.sm }}>
            <Users size={22} color={colors.primary} />
            <Text variant="bodyStrong" center>
              Find your people
            </Text>
            <Text variant="caption" tone="muted" center>
              Communities are home bases for a shared interest, with posts and their own hangouts.
            </Text>
          </Card>
        )}
      </View>

      {/* Explore communities */}
      <View style={styles.section}>
        <SectionHeader title="Communities to explore" subtitle="Picked from your interests" />
        {recommended.isLoading ? (
          <RowSkeleton count={3} />
        ) : recommended.isError ? (
          <ErrorState error={recommended.error} onRetry={() => recommended.refetch()} compact />
        ) : recommended.data && recommended.data.length > 0 ? (
          <View style={{ gap: space.sm }}>
            {recommended.data.map((c) => (
              <CommunityCard key={c.id} community={c} />
            ))}
          </View>
        ) : (
          <Text variant="body" tone="muted">
            Nothing new to suggest yet. Start one around something you love.
          </Text>
        )}
        <Button title="Start a community" icon={Sparkles} variant="secondary" fullWidth onPress={() => router.push('/community/create')} style={{ marginTop: space.lg }} />
      </View>
    </Screen>
  );
}

function QuietState({
  title,
  message,
  presets,
  onClearFilters,
  createParams,
}: {
  title: string;
  message: string;
  presets: { key: string; label: string; icon: typeof Tent; params: Record<string, string> }[];
  onClearFilters?: () => void;
  createParams: Record<string, string>;
}) {
  const { colors } = useTheme();
  return (
    <Card style={{ gap: space.md }}>
      <View style={{ alignItems: 'center', gap: space.sm, paddingTop: space.sm }}>
        <View style={[styles.quietIcon, { backgroundColor: colors.primarySoft }]}>
          <Tent size={26} color={colors.primary} />
        </View>
        <Text variant="heading" center>
          {title}
        </Text>
        <Text variant="body" tone="muted" center style={{ maxWidth: 320 }}>
          {message}
        </Text>
      </View>
      <Button title="Start a hangout" icon={Plus} fullWidth onPress={() => router.push({ pathname: '/room/create', params: createParams })} />
      <View style={{ gap: space.sm }}>
        <Text variant="tiny" tone="faint" style={{ textTransform: 'uppercase' }}>
          Quick start
        </Text>
        {presets.map((p) => {
          const Icon = p.icon;
          return (
            <PressableScale
              key={p.key}
              onPress={() => router.push({ pathname: '/room/create', params: p.params })}
              hapticFeedback="tap"
              accessibilityLabel={p.label}
              style={[styles.preset, { backgroundColor: colors.surfaceAlt }]}
            >
              <Icon size={18} color={colors.primary} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {p.label}
              </Text>
              <Plus size={16} color={colors.textMuted} />
            </PressableScale>
          );
        })}
      </View>
      {onClearFilters ? <Button title="Clear filters" variant="ghost" onPress={onClearFilters} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: screenPadding, paddingTop: space.lg, paddingBottom: space.lg },
  chips: { gap: space.sm, paddingHorizontal: screenPadding, paddingBottom: space.md },
  section: { paddingHorizontal: screenPadding, marginBottom: space.xxl },
  hscroll: { gap: space.md, paddingHorizontal: screenPadding },
  quietIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  preset: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 52, borderRadius: radius.lg },
});
