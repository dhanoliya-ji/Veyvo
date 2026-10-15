import { useMemo, useState, type ComponentType } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { router, type Href } from 'expo-router';
import {
  AlertTriangle,
  Award,
  Bell,
  BellOff,
  CalendarClock,
  CheckCheck,
  Gamepad2,
  Hand,
  Handshake,
  Heart,
  Mail,
  PartyPopper,
  ShieldCheck,
  Tent,
  UserPlus,
  Users,
  type LucideProps,
} from 'lucide-react-native';

import { useMarkNotificationsRead, useNotifications } from '@/api/hooks';
import type { Notification } from '@/api/types';
import { useKudosLabels } from '@/api/social-extra';
import { UserPhoto } from '@/components/UserPhoto';
import { Button, EmptyState, ErrorState, Header, PressableScale, RowSkeleton, Screen, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space } from '@/theme/tokens';

type Tone = 'primary' | 'accent' | 'success' | 'warning' | 'danger';
type Meta = { icon: ComponentType<LucideProps>; tone: Tone; text: string; detail?: string; warning?: boolean };

function others(n: Notification) {
  return n.count > 1 ? ` and ${n.count - 1} other${n.count - 1 === 1 ? '' : 's'}` : '';
}

function describe(n: Notification, kudos: Record<string, string>): Meta {
  const who = `${n.actor?.display_name ?? 'Someone'}${others(n)}`;
  switch (n.type) {
    case 'friend_request':
      return { icon: UserPlus, tone: 'primary', text: `${who} sent you a friend request` };
    case 'friend_accepted':
      return { icon: Handshake, tone: 'success', text: `${who} accepted your friend request. Say hi!` };
    case 'room_invite':
      return { icon: Tent, tone: 'accent', text: `${who} invited you to ${n.data?.title ? `"${n.data.title}"` : 'a hangout'}` };
    case 'room_starting':
      return { icon: CalendarClock, tone: 'accent', text: `${n.data?.title ? `"${n.data.title}"` : 'A hangout you saved'} is starting now` };
    case 'game_invite':
      return { icon: Gamepad2, tone: 'primary', text: `${who} invited you to play${n.data?.game_name ? ` ${n.data.game_name}` : n.data?.game_type ? ` ${n.data.game_type}` : ''}` };
    case 'kudos': {
      // Kudos are anonymous: never show who sent them.
      const label = n.data?.tag ? kudos[n.data.tag] ?? n.data.tag : null;
      return {
        icon: Award,
        tone: 'warning',
        text: n.count > 1 ? `You got ${n.count} vibes from people you hung out with` : `Someone sent you a vibe${label ? `: ${label}` : ''}`,
      };
    }
    case 'match':
      return { icon: Heart, tone: 'success', text: `It's a match! You and ${n.actor?.display_name ?? 'someone new'} are friends now. Say hi!` };
    case 'wave':
      return { icon: Hand, tone: 'accent', text: `${who} waved at you 👋` };
    case 'squad_added':
      return { icon: Users, tone: 'primary', text: `${who} added you to ${n.data?.name ? `the squad "${n.data.name}"` : 'a squad'}` };
    case 'squad_message':
      return { icon: Users, tone: 'primary', text: `${who} wrote in ${n.data?.name ? `"${n.data.name}"` : 'your squad'}` };
    case 'squad_night':
      return { icon: Users, tone: 'warning', text: n.data?.message ? String(n.data.message) : 'Squad night starts in 15 minutes 🔥' };
    case 'pen_pal_matched':
      return { icon: Mail, tone: 'accent', text: 'You have a new pen pal. Write the first letter ✉️' };
    case 'letter_arrived':
      return { icon: Mail, tone: 'accent', text: n.data?.message ? String(n.data.message) : 'A letter from your pen pal just arrived ✉️' };
    case 'pen_pal_friends':
      return { icon: PartyPopper, tone: 'success', text: 'You and your pen pal are friends now 🎉' };
    case 'milestone':
      return {
        icon: PartyPopper,
        tone: 'success',
        text: n.data?.message ? String(n.data.message) : `You and ${n.actor?.display_name ?? 'a friend'} hit a friendship milestone 🎉`,
        detail: n.data?.cta === 'hang_out' ? 'Celebrate with a call or a game. Tap to hang out.' : undefined,
      };
    case 'icebreaker_connected':
      return { icon: PartyPopper, tone: 'success', text: `You and ${n.actor?.display_name ?? 'your Icebreaker match'} are friends now` };
    case 'moderation_warning':
      return { icon: AlertTriangle, tone: 'danger', text: 'Notice about your account', detail: n.data?.reason ? String(n.data.reason) : 'Please review our community guidelines.', warning: true };
    case 'security':
      return { icon: ShieldCheck, tone: 'warning', text: n.data?.message ? String(n.data.message) : 'There was a security change on your account. If this wasn\'t you, change your password.' };
    default:
      return { icon: Bell, tone: 'primary', text: n.data?.message ? String(n.data.message) : 'You have a new update' };
  }
}

function routeFor(n: Notification): string | null {
  if (n.type === 'friend_request') return '/friends?tab=requests';
  if (n.type === 'kudos') return '/profile';
  switch (n.entity_type) {
    case 'user':
      return n.entity_id ? `/user/${n.entity_id}` : n.actor ? `/user/${n.actor.id}` : null;
    case 'room':
      return n.entity_id ? `/room/${n.entity_id}` : null;
    case 'game':
      return n.entity_id ? `/game/${n.entity_id}` : null;
    case 'friend_request':
      return '/friends?tab=requests';
    case 'conversation':
      return n.entity_id ? `/messages/${n.entity_id}` : null;
    case 'squad':
      return n.entity_id ? `/squads/${n.entity_id}` : '/squads';
    case 'pen_pal':
      return n.entity_id ? `/letters/${n.entity_id}` : '/letters';
    default:
      return n.actor ? `/user/${n.actor.id}` : null;
  }
}

export default function Notifications() {
  const { colors } = useTheme();
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();
  const kudos = useKudosLabels();
  const [refreshing, setRefreshing] = useState(false);

  const sections = useMemo(() => {
    const list = notifications.data ?? [];
    const unread = list.filter((n) => !n.read_at);
    const dayAgo = Date.now() - 86_400_000;
    const read = list.filter((n) => n.read_at);
    const today = read.filter((n) => new Date(n.created_at).getTime() >= dayAgo);
    const earlier = read.filter((n) => new Date(n.created_at).getTime() < dayAgo);
    return [
      { title: 'New', data: unread },
      { title: 'Today', data: today },
      { title: 'Earlier', data: earlier },
    ].filter((s) => s.data.length);
  }, [notifications.data]);

  const unreadCount = notifications.data?.filter((n) => !n.read_at).length ?? 0;

  const markAll = async () => {
    try {
      await markRead.mutateAsync();
      haptic.success();
    } catch (e) {
      toast.error("Couldn't mark as read", errorMessage(e));
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await notifications.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Screen
      padded={false}
      header={
        <Header
          title="Notifications"
          subtitle={unreadCount ? `${unreadCount} new` : undefined}
          right={unreadCount ? <Button title="Mark all read" icon={CheckCheck} variant="ghost" size="sm" onPress={markAll} loading={markRead.isPending} accessibilityLabel="Mark all notifications as read" /> : undefined}
        />
      }
    >
      {notifications.isLoading ? (
        <View style={{ padding: screenPadding }}>
          <RowSkeleton count={7} />
        </View>
      ) : notifications.isError ? (
        <ErrorState error={notifications.error} onRetry={() => notifications.refetch()} />
      ) : sections.length === 0 ? (
        <EmptyState icon={BellOff} title="You're all caught up" message="Friend requests, invites and vibes will show up here." action="Explore hangouts" onAction={() => router.push('/explore')} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(n) => n.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: space.huge }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
          renderSectionHeader={({ section }) => (
            <Text variant="tiny" tone="faint" style={styles.sectionTitle} accessibilityRole="header">
              {section.title.toUpperCase()}
            </Text>
          )}
          renderItem={({ item }) => <NotificationRow n={item} meta={describe(item, kudos)} />}
          ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        />
      )}
    </Screen>
  );
}

function NotificationRow({ n, meta }: { n: Notification; meta: Meta }) {
  const { colors, reduceMotion } = useTheme();
  const unread = !n.read_at;
  const target = routeFor(n);
  const toneMap: Record<Tone, [string, string]> = {
    primary: [colors.primarySoft, colors.primary],
    accent: [colors.accentSoft, colors.accent],
    success: [colors.successSoft, colors.success],
    warning: [colors.warningSoft, colors.warning],
    danger: [colors.dangerSoft, colors.danger],
  };
  const [soft, strong] = toneMap[meta.tone];
  const Icon = meta.icon;
  const showActor = !!n.actor && n.type !== 'kudos';
  const label = `${unread ? 'Unread. ' : ''}${meta.text}${meta.detail ? `. ${meta.detail}` : ''}. ${timeAgo(n.created_at)}`;

  const content = (
    <>
      <View>
        {showActor && n.actor ? (
          <>
            <UserPhoto user={n.actor} size={46} />
            <View style={[styles.typeBadge, { backgroundColor: strong, borderColor: colors.surface }]}>
              <Icon size={11} color={colors.surface} strokeWidth={2.6} />
            </View>
          </>
        ) : (
          <View style={[styles.iconCircle, { backgroundColor: soft }]}>
            <Icon size={20} color={strong} />
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant={unread ? 'bodyStrong' : 'body'} style={meta.warning ? { color: colors.danger } : undefined}>
          {meta.text}
        </Text>
        {meta.detail ? (
          <View style={[styles.warning, { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]}>
            <Text variant="caption" style={{ color: colors.text }}>
              {meta.detail}
            </Text>
          </View>
        ) : null}
        <Text variant="caption" tone={unread ? 'primary' : 'faint'}>
          {timeAgo(n.created_at)}
          {unread ? ' · New' : ''}
        </Text>
      </View>
      {unread ? <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} accessibilityElementsHidden /> : null}
    </>
  );

  const rowStyle = [styles.row, { backgroundColor: unread ? colors.primarySoft : colors.surface, borderColor: meta.warning ? colors.danger : colors.border }];

  return (
    <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180)}>
      {target ? (
        <PressableScale onPress={() => router.push(target as Href)} scaleTo={0.99} style={rowStyle} accessibilityLabel={label}>
          {content}
        </PressableScale>
      ) : (
        <View style={rowStyle} accessible accessibilityLabel={label}>
          {content}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { marginTop: space.lg, marginBottom: space.sm, marginLeft: space.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, minHeight: 64 },
  iconCircle: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  typeBadge: { position: 'absolute', right: -3, bottom: -3, width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  warning: { padding: space.sm, borderRadius: radius.sm, borderLeftWidth: 3 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: 8 },
});
