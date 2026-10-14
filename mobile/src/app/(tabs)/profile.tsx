import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Flame,
  Gavel,
  Gem,
  Heart,
  MessageCircle,
  Palette,
  Pencil,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react-native';

import { useCommunities, useFriends, useMe, useProfile } from '@/api/hooks';
import { Avatar } from '@/components/avatar/Avatar';
import { CommunityCard } from '@/components/cards';
import { useTabBarInset } from '@/components/TabBar';
import { Badge, Button, Card, Chip, ErrorState, IconButton, ListGroup, ListRow, PressableScale, ProgressBar, SectionHeader, Skeleton, Text } from '@/components/ui';
import { VIBE_LABELS } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space } from '@/theme/tokens';

const KUDOS_LABELS: Record<string, string> = {
  funny: 'Funny',
  kind: 'Kind',
  great_listener: 'Great listener',
  smart: 'Big brain',
  creative: 'Creative',
  great_host: 'Great host',
};

function Stat({ value, label, onPress }: { value: string | number; label: string; onPress?: () => void }) {
  return (
    <PressableScale onPress={onPress} disabled={!onPress} style={styles.stat} accessibilityLabel={`${value} ${label}`}>
      <Text variant="heading">{value}</Text>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </PressableScale>
  );
}

export default function Profile() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = useTabBarInset();
  const me = useMe();
  const friends = useFriends();
  const mine = useProfile(me.data?.id ?? '');
  const communities = useCommunities({ mine: true });

  if (me.isError && !me.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top, justifyContent: 'center' }}>
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      </View>
    );
  }
  const m = me.data;
  const kudos = Object.entries(mine.data?.kudos ?? {}).filter(([, n]) => n > 0);
  const isStaff = m?.role === 'moderator' || m?.role === 'admin';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: bottom, paddingHorizontal: screenPadding }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={me.isRefetching}
            onRefresh={() => {
              me.refetch();
              friends.refetch();
              mine.refetch();
              communities.refetch();
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        <View style={styles.topBar}>
          <Text variant="title" accessibilityRole="header">
            Profile
          </Text>
          <IconButton icon={Settings} label="Settings" variant="filled" onPress={() => router.push('/settings')} />
        </View>

        {/* Identity card */}
        <Card style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xxl }}>
          {m ? (
            <PressableScale onPress={() => router.push('/avatar')} accessibilityLabel="Edit your avatar">
              <Avatar config={m.avatar} size={112} />
              <View style={[styles.editBadge, { backgroundColor: colors.primary, borderColor: colors.surface }]}>
                <Palette size={14} color={colors.onPrimary} />
              </View>
            </PressableScale>
          ) : (
            <Skeleton width={112} height={112} rounded={56} />
          )}
          <Text variant="title" center numberOfLines={1}>
            {m?.display_name ?? ' '}
          </Text>
          {m?.username ? (
            <Text tone="muted" center>
              @{m.username}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', justifyContent: 'center' }}>
            {m?.vibe ? <Badge label={VIBE_LABELS[m.vibe] ?? m.vibe} tone="success" /> : null}
            {m?.plus_active ? <Badge label="Plus" tone="primary" /> : null}
            {isStaff ? <Badge label={m?.role === 'admin' ? 'Admin' : 'Moderator'} tone="accent" /> : null}
          </View>
          {m?.bio ? (
            <Text tone="muted" center style={{ maxWidth: 320, marginTop: space.xs }}>
              {m.bio}
            </Text>
          ) : null}
          {m ? (
            <View style={{ alignSelf: 'stretch', gap: 6, marginTop: space.md, paddingHorizontal: space.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="label">Level {m.level}</Text>
                <Text variant="caption" tone="muted">
                  {Math.round(m.level_progress * 100)}% to level {m.level + 1}
                </Text>
              </View>
              <ProgressBar value={m.level_progress} />
            </View>
          ) : null}
          <View style={styles.stats}>
            <Stat value={friends.data?.length ?? '–'} label="Friends" onPress={() => router.push('/friends')} />
            <Stat value={m?.streak.current ?? '–'} label="Day streak" onPress={() => router.push('/quests')} />
            <Stat value={m?.gems ?? '–'} label="Gems" onPress={() => router.push('/shop')} />
          </View>
          <Button title="Edit profile" icon={Pencil} variant="secondary" size="sm" onPress={() => router.push('/settings/profile')} />
        </Card>

        {/* Interests */}
        <View style={{ marginTop: space.xxl }}>
          <SectionHeader title="Interests" action="Edit" onAction={() => router.push('/settings/interests')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {m?.interests.map((i) => <Chip key={i.id} label={i.name} />)}
          </View>
        </View>

        {/* Kudos */}
        <View style={{ marginTop: space.xxl }}>
          <SectionHeader title="Kudos" subtitle="What people appreciate about hanging out with you" />
          {kudos.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {kudos.map(([tag, n]) => (
                <View key={tag} style={[styles.kudo, { backgroundColor: colors.accentSoft }]}>
                  <Heart size={14} color={colors.accent} />
                  <Text variant="label" tone="accent">
                    {KUDOS_LABELS[tag] ?? tag} · {n}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text tone="muted">Join hangouts and games — people can send you kudos after hanging out.</Text>
          )}
        </View>

        {/* Communities */}
        <View style={{ marginTop: space.xxl }}>
          <SectionHeader title="Communities" action="Browse" onAction={() => router.push('/hangouts')} />
          {communities.data?.length ? (
            <View style={{ gap: space.sm }}>
              {communities.data.map((c) => (
                <CommunityCard key={c.id} community={c} />
              ))}
            </View>
          ) : (
            <Text tone="muted">You haven't joined any communities yet.</Text>
          )}
        </View>

        <View style={{ marginTop: space.xxl, gap: space.lg }}>
          <ListGroup>
            <ListRow icon={Users} iconTone="primary" title="Friends" onPress={() => router.push('/friends')} />
            <ListRow icon={MessageCircle} iconTone="primary" title="Messages" onPress={() => router.push('/messages')} />
            <ListRow icon={Trophy} iconTone="warning" title="Quests & streak" onPress={() => router.push('/quests')} />
            <ListRow icon={Sparkles} iconTone="accent" title="Moments" subtitle="Your highlights, ready to share" onPress={() => router.push('/moments')} />
            <ListRow icon={ShoppingBag} iconTone="accent" title="Shop" subtitle="Avatar items and room scenes" onPress={() => router.push('/shop')} />
          </ListGroup>
          <ListGroup>
            <ListRow icon={ShieldCheck} iconTone="success" title="Safety centre" subtitle="Blocking, reporting and your privacy" onPress={() => router.push('/safety')} />
            {isStaff ? <ListRow icon={Gavel} iconTone="accent" title="Moderation" subtitle="Review reports" onPress={() => router.push('/moderation')} /> : null}
            <ListRow icon={Settings} title="Settings" onPress={() => router.push('/settings')} />
          </ListGroup>
          {m?.streak.freezes ? (
            <View style={[styles.freeze, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Flame size={16} color={colors.warning} />
              <Gem size={14} color={colors.primary} />
              <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                You have {m.streak.freezes} streak {m.streak.freezes === 1 ? 'freeze' : 'freezes'} — miss a day and your streak stays safe.
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.lg },
  editBadge: { position: 'absolute', right: 2, bottom: 2, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 3 },
  stats: { flexDirection: 'row', alignSelf: 'stretch', justifyContent: 'space-around', marginVertical: space.md },
  stat: { alignItems: 'center', minWidth: 72, paddingVertical: space.xs },
  kudo: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, height: 32, borderRadius: radius.pill },
  freeze: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
