import type { ComponentType } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bell,
  CalendarClock,
  ChevronRight,
  Flame,
  Gamepad2,
  Gem,
  MessageCircle,
  Search,
  Sparkles,
  Tent,
  Trophy,
  UserPlus,
  type LucideProps,
} from 'lucide-react-native';

import { useAnswerDaily, useClaimQuest, useHome, useMe } from '@/api/hooks';
import type { DailyQuestion, Quest } from '@/api/types';
import { Avatar } from '@/components/avatar/Avatar';
import { CommunityCard, RoomCard } from '@/components/cards';
import { EventBanner } from '@/components/moments/EventBanner';
import { useTabBarInset } from '@/components/TabBar';
import { Button, Card, EmptyState, ErrorState, IconButton, PressableScale, ProgressBar, RoomCardSkeleton, SectionHeader, Skeleton, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { eventTime } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space } from '@/theme/tokens';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function QuickTile({ icon: Icon, title, subtitle, tint, onPress }: { icon: ComponentType<LucideProps>; title: string; subtitle: string; tint: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} hapticFeedback="tap" accessibilityLabel={`${title}. ${subtitle}`} style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.tileIcon, { backgroundColor: `${tint}22` }]}>
        <Icon size={20} color={tint} strokeWidth={2.2} />
      </View>
      <Text variant="bodyStrong" numberOfLines={1}>
        {title}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={2}>
        {subtitle}
      </Text>
    </PressableScale>
  );
}

function DailyCard({ daily }: { daily: DailyQuestion }) {
  const { colors } = useTheme();
  const answer = useAnswerDaily();
  const answered = daily.my_choice !== null;
  const total = daily.total ?? 0;

  const choose = async (i: number) => {
    try {
      const res = await answer.mutateAsync(i);
      haptic.success();
      if (res.reward) toast.success(`+${res.reward.gems} gems`, 'Thanks for answering today’s question!');
    } catch (e) {
      toast.error("Couldn't save your answer", errorMessage(e));
    }
  };

  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Sparkles size={16} color={colors.accent} />
        <Text variant="tiny" tone="accent" style={{ textTransform: 'uppercase' }}>
          Daily question
        </Text>
        {answered && total ? (
          <Text variant="caption" tone="faint" style={{ marginLeft: 'auto' }}>
            {total} {total === 1 ? 'answer' : 'answers'} worldwide
          </Text>
        ) : null}
      </View>
      <Text variant="heading">{daily.question}</Text>
      <View style={{ gap: space.sm }}>
        {daily.options.map((opt, i) => {
          const count = daily.results?.[i] ?? 0;
          const pct = total ? Math.round((count / total) * 100) : 0;
          const mine = daily.my_choice === i;
          if (answered) {
            return (
              <View key={opt} style={[styles.result, { backgroundColor: colors.surfaceAlt, borderColor: mine ? colors.primary : 'transparent' }]} accessibilityLabel={`${opt}: ${pct} percent${mine ? ', your answer' : ''}`}>
                <View style={[StyleSheet.absoluteFill, { width: `${pct}%`, backgroundColor: mine ? colors.primarySoft : colors.border, borderRadius: radius.md }]} />
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  {opt}
                  {mine ? '  ·  You' : ''}
                </Text>
                <Text variant="label" tone={mine ? 'primary' : 'muted'}>
                  {pct}%
                </Text>
              </View>
            );
          }
          return (
            <PressableScale
              key={opt}
              onPress={() => choose(i)}
              disabled={answer.isPending}
              hapticFeedback="tap"
              style={[styles.option, { backgroundColor: colors.surfaceAlt }]}
              accessibilityLabel={`Answer: ${opt}`}
            >
              <Text variant="bodyStrong">{opt}</Text>
            </PressableScale>
          );
        })}
      </View>
      {!answered ? (
        <Text variant="caption" tone="faint">
          Answer to see how the world voted · +10 gems
        </Text>
      ) : null}
    </Card>
  );
}

function QuestsCard({ quests }: { quests: Quest[] }) {
  const { colors } = useTheme();
  const claim = useClaimQuest();
  const open = quests.filter((q) => !q.claimed);
  if (!open.length) return null;
  const done = quests.filter((q) => q.completed).length;
  const show = [...open].sort((a, b) => Number(b.completed) - Number(a.completed)).slice(0, 3);

  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Trophy size={16} color={colors.warning} />
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          Your first week
        </Text>
        <Text variant="caption" tone="muted">
          {done}/{quests.length} done
        </Text>
      </View>
      <ProgressBar value={done / quests.length} color={colors.warning} />
      {show.map((q) => (
        <View key={q.key} style={styles.questRow}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="body" numberOfLines={1}>
              {q.title}
            </Text>
            {q.target > 1 && !q.completed ? <ProgressBar value={q.progress / q.target} height={4} /> : null}
          </View>
          {q.completed ? (
            <Button
              title={`Claim ${q.gems}`}
              icon={Gem}
              size="sm"
              loading={claim.isPending && claim.variables === q.key}
              onPress={async () => {
                try {
                  const r = await claim.mutateAsync(q.key);
                  haptic.success();
                  toast.success(`+${r.gems} gems, +${r.xp} XP`, r.leveled_up ? `Level up! You're now level ${r.level}.` : undefined);
                } catch (e) {
                  toast.error("Couldn't claim", errorMessage(e));
                }
              }}
            />
          ) : (
            <Text variant="caption" tone="faint">
              +{q.gems} gems
            </Text>
          )}
        </View>
      ))}
      <Button title="See all quests" variant="ghost" size="sm" onPress={() => router.push('/quests')} />
    </Card>
  );
}

export default function Home() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = useTabBarInset();
  const me = useMe();
  const home = useHome();
  const data = home.data;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: bottom }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={home.isRefetching} onRefresh={() => home.refetch()} tintColor={colors.primary} colors={[colors.primary]} progressBackgroundColor={colors.surface} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <PressableScale onPress={() => router.push('/profile')} accessibilityLabel="Your profile">
            <Avatar config={me.data?.avatar} size={44} />
          </PressableScale>
          <View style={{ flex: 1 }}>
            <Text variant="caption" tone="muted">
              {greeting()}
            </Text>
            <Text variant="heading" numberOfLines={1}>
              {me.data?.display_name ?? ' '}
            </Text>
          </View>
          <IconButton icon={Search} label="Search" onPress={() => router.push('/explore')} />
          <IconButton icon={MessageCircle} label="Messages" badge={data?.unread_messages} onPress={() => router.push('/messages')} />
          <IconButton icon={Bell} label="Notifications" badge={data?.unread_notifications} onPress={() => router.push('/notifications')} />
        </View>

        {/* Status strip */}
        {me.data ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            <PressableScale onPress={() => router.push('/quests')} style={[styles.pill, { backgroundColor: colors.warningSoft }]} accessibilityLabel={`${me.data.streak.current} day streak`}>
              <Flame size={14} color={colors.warning} />
              <Text variant="label" style={{ color: colors.warning }}>
                {me.data.streak.current} day streak
              </Text>
            </PressableScale>
            <PressableScale onPress={() => router.push('/shop')} style={[styles.pill, { backgroundColor: colors.primarySoft }]} accessibilityLabel={`${me.data.gems} gems`}>
              <Gem size={14} color={colors.primary} />
              <Text variant="label" tone="primary">
                {me.data.gems} gems
              </Text>
            </PressableScale>
            <View style={[styles.pill, { backgroundColor: colors.surfaceAlt }]}>
              <Text variant="label" tone="muted">
                Level {me.data.level}
              </Text>
              <View style={{ width: 44 }}>
                <ProgressBar value={me.data.level_progress} height={4} />
              </View>
            </View>
          </ScrollView>
        ) : null}

        <View style={{ paddingHorizontal: screenPadding, gap: space.xxl }}>
          {data && data.pending_requests > 0 ? (
            <PressableScale onPress={() => router.push('/friends')} style={[styles.banner, { backgroundColor: colors.accentSoft }]} accessibilityLabel={`${data.pending_requests} friend requests waiting`}>
              <UserPlus size={18} color={colors.accent} />
              <Text variant="bodyStrong" style={{ flex: 1, color: colors.accent }}>
                {data.pending_requests} friend {data.pending_requests === 1 ? 'request' : 'requests'} waiting
              </Text>
              <ChevronRight size={18} color={colors.accent} />
            </PressableScale>
          ) : null}

          <EventBanner />

          {/* Quick actions */}
          <Animated.View entering={FadeInDown.duration(350)}>
            <SectionHeader title="Find your next hangout" />
            <View style={styles.grid}>
              <QuickTile icon={Tent} title="Join a room" subtitle="Drop into a live hangout" tint={colors.primary} onPress={() => router.push('/hangouts')} />
              <QuickTile icon={Sparkles} title="Icebreaker" subtitle="Meet someone who shares an interest" tint={colors.accent} onPress={() => router.push('/games/icebreaker')} />
              <QuickTile icon={Gamepad2} title="Quick game" subtitle="Trivia or Doodle & Guess" tint={colors.success} onPress={() => router.push('/games')} />
              <QuickTile icon={Search} title="Explore" subtitle="Find people and communities" tint={colors.warning} onPress={() => router.push('/explore')} />
            </View>
          </Animated.View>

          {home.isError && !data ? <ErrorState error={home.error} onRetry={() => home.refetch()} /> : null}

          {/* Friends' rooms */}
          {data?.friends_rooms.length ? (
            <View>
              <SectionHeader title="Your friends are hanging out" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md, paddingRight: screenPadding }} style={{ marginHorizontal: -screenPadding, paddingLeft: screenPadding }}>
                {data.friends_rooms.map((r) => (
                  <RoomCard key={r.id} room={r} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* Live now */}
          <View>
            <SectionHeader title="Live now" action={data?.live_rooms.length ? 'See all' : undefined} onAction={() => router.push('/hangouts')} />
            {home.isLoading ? (
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <RoomCardSkeleton />
                <RoomCardSkeleton />
              </View>
            ) : data?.live_rooms.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md, paddingRight: screenPadding }} style={{ marginHorizontal: -screenPadding, paddingLeft: screenPadding }}>
                {data.live_rooms.map((r) => (
                  <RoomCard key={r.id} room={r} />
                ))}
              </ScrollView>
            ) : data ? (
              <Card>
                <EmptyState
                  compact
                  icon={Tent}
                  title="It's quiet right now"
                  message="Be the first to open a room. People who share your interests can drop in."
                  action="Start a hangout"
                  onAction={() => router.push('/room/create')}
                  secondaryAction="Try an Icebreaker instead"
                  onSecondaryAction={() => router.push('/games/icebreaker')}
                />
              </Card>
            ) : null}
          </View>

          {/* Daily question */}
          {home.isLoading ? <Skeleton height={220} rounded={radius.xl} /> : data ? <DailyCard daily={data.daily} /> : null}

          {/* Quests */}
          {data ? <QuestsCard quests={data.quests} /> : null}

          {/* Upcoming */}
          {data?.upcoming.length ? (
            <View>
              <SectionHeader title="Coming up" subtitle="Shown in your time zone" />
              <View style={{ gap: space.sm }}>
                {data.upcoming.map((r) => (
                  <PressableScale
                    key={r.id}
                    onPress={() => router.push(`/room/${r.id}`)}
                    style={[styles.eventRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    accessibilityLabel={`${r.title}, ${r.scheduled_for ? eventTime(r.scheduled_for) : ''}`}
                  >
                    <View style={[styles.eventIcon, { backgroundColor: colors.primarySoft }]}>
                      <CalendarClock size={18} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {r.title}
                      </Text>
                      <Text variant="caption" tone="muted">
                        {r.scheduled_for ? eventTime(r.scheduled_for) : ''} · {r.host?.display_name ?? 'Host'}
                      </Text>
                    </View>
                    <ChevronRight size={18} color={colors.textFaint} />
                  </PressableScale>
                ))}
              </View>
            </View>
          ) : null}

          {/* Communities */}
          {data?.my_communities.length ? (
            <View>
              <SectionHeader title="Your communities" />
              <View style={{ gap: space.sm }}>
                {data.my_communities.slice(0, 4).map((c) => (
                  <CommunityCard key={c.id} community={c} />
                ))}
              </View>
            </View>
          ) : null}

          {data ? (
            <View>
              <SectionHeader title="For you" subtitle="Based on your interests" />
              {data.recommended_communities.length ? (
                <View style={{ gap: space.sm }}>
                  {data.recommended_communities.map((c) => (
                    <CommunityCard key={c.id} community={c} />
                  ))}
                </View>
              ) : (
                <Card>
                  <Text tone="muted">
                    No suggestions yet. Add more interests or start a community around something you love.
                  </Text>
                  <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
                    <Button title="Edit interests" variant="secondary" size="sm" onPress={() => router.push('/settings/interests')} />
                    <Button title="Start a community" variant="ghost" size="sm" onPress={() => router.push('/community/create')} />
                  </View>
                </Card>
              )}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingLeft: screenPadding, paddingRight: space.sm, marginBottom: space.md },
  strip: { gap: space.sm, paddingHorizontal: screenPadding, marginBottom: space.xl },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, height: 32, borderRadius: radius.pill },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: { width: '47.8%', padding: space.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, gap: 6 },
  tileIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  option: { minHeight: 48, justifyContent: 'center', paddingHorizontal: space.lg, borderRadius: radius.md },
  result: { minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1.5 },
  questRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 40 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  eventIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
