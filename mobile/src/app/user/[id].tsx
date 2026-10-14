import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Award,
  Ban,
  Check,
  Clock,
  Flag,
  Heart,
  Lock,
  MessageCircle,
  MoreHorizontal,
  PencilLine,
  ShieldOff,
  UserMinus,
  UserPlus,
  UserRoundX,
  Users,
  X,
} from 'lucide-react-native';

import { qk, useBlock, useGiveKudos, useProfile, useRemoveFriend, useRespondRequest, useSendFriendRequest, useStartConversation } from '@/api/hooks';
import type { PublicProfile } from '@/api/types';
import { KUDOS_EMOJI, useKudosLabels } from '@/api/social-extra';
import { Avatar } from '@/components/avatar/Avatar';
import { openReport } from '@/components/safety/ReportSheet';
import { OnlineLabel } from '@/components/social';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, Header, IconButton, ListGroup, ListRow, PressableScale, ProgressBar, Screen, SectionHeader, Sheet, Skeleton, Text, confirm } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { plural, VIBE_LABELS } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/queryClient';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

export default function UserProfile() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const profile = useProfile(id);
  const [menu, setMenu] = useState(false);
  const [kudosOpen, setKudosOpen] = useState(false);
  const p = profile.data;

  const unavailable = profile.error instanceof ApiError && profile.error.status === 404;
  const showMenu = !!p && p.relationship !== 'self';

  return (
    <Screen
      scroll
      onRefresh={() => profile.refetch()}
      refreshing={profile.isRefetching}
      header={<Header title={p && p.relationship !== 'blocked' ? p.display_name : undefined} right={showMenu ? <IconButton icon={MoreHorizontal} label="More options" onPress={() => setMenu(true)} /> : undefined} />}
    >
      {profile.isLoading ? <ProfileSkeleton /> : null}
      {unavailable ? (
        <EmptyState icon={UserRoundX} title="This person isn't available" message="Their account may have been closed, or they can't be viewed right now." action="Go back" onAction={() => (router.canGoBack() ? router.back() : router.replace('/home'))} />
      ) : profile.isError ? (
        <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
      ) : null}
      {p ? p.relationship === 'blocked' ? <BlockedView p={p} /> : <ProfileBody p={p} onKudos={() => setKudosOpen(true)} /> : null}

      {p ? <OverflowMenu p={p} visible={menu} onClose={() => setMenu(false)} onKudos={() => setKudosOpen(true)} /> : null}
      {p ? <KudosSheet p={p} visible={kudosOpen} onClose={() => setKudosOpen(false)} /> : null}
    </Screen>
  );
}

function ProfileSkeleton() {
  return (
    <View style={{ alignItems: 'center', gap: space.md, paddingTop: space.lg }} accessibilityLabel="Loading profile">
      <Skeleton width={120} height={120} rounded={60} />
      <Skeleton width={160} height={22} />
      <Skeleton width={110} height={14} />
      <Skeleton width="100%" height={48} rounded={radius.lg} style={{ marginTop: space.lg }} />
      <Skeleton width="100%" height={96} rounded={radius.xl} />
    </View>
  );
}

function BlockedView({ p }: { p: PublicProfile }) {
  const block = useBlock();
  const unblock = async () => {
    const ok = await confirm({ title: `Unblock ${p.display_name}?`, message: "They'll be able to find you and send you a friend request again. You won't automatically become friends.", confirmLabel: 'Unblock' });
    if (!ok) return;
    try {
      await block.mutateAsync({ userId: p.id, block: false });
      haptic.success();
      toast.success(`${p.display_name} is unblocked`);
    } catch (e) {
      toast.error("Couldn't unblock", errorMessage(e));
    }
  };
  return (
    <View style={{ alignItems: 'center', gap: space.md, paddingTop: space.xl }}>
      <View style={{ opacity: 0.5 }}>
        <Avatar config={p.avatar} size={96} />
      </View>
      <Text variant="title" center>
        {p.display_name}
      </Text>
      <Badge label="Blocked" tone="danger" />
      <Text tone="muted" center style={{ maxWidth: 300 }}>
        You blocked this person. They can't find you, message you or join you in hangouts. They aren't told.
      </Text>
      <Button title="Unblock" icon={ShieldOff} variant="secondary" loading={block.isPending} onPress={unblock} style={{ marginTop: space.md }} />
    </View>
  );
}

function ProfileBody({ p, onKudos }: { p: PublicProfile; onKudos: () => void }) {
  const { colors, reduceMotion } = useTheme();
  const labels = useKudosLabels();
  const shared = new Set(p.shared_interest_ids);
  const interests = [...p.interests].sort((a, b) => Number(shared.has(b.id)) - Number(shared.has(a.id)));
  const kudosEntries = Object.entries(p.kudos).filter(([tag]) => labels[tag]);
  const kudosTotal = kudosEntries.reduce((n, [, c]) => n + c, 0);
  const isFriend = p.relationship === 'friends';

  return (
    <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(220)} style={{ gap: space.xl }}>
      {/* Hero */}
      <View style={{ alignItems: 'center', gap: space.sm, paddingTop: space.sm }}>
        <Avatar config={p.avatar} size={120} online={p.online === true} label={`${p.display_name}'s avatar`} />
        <Text variant="title" center>
          {p.display_name}
        </Text>
        {p.username ? (
          <Text tone="muted" center>
            @{p.username}
          </Text>
        ) : null}
        <View style={styles.badges}>
          <Badge label={`Level ${p.level}`} tone="primary" />
          {p.vibe ? <Badge label={VIBE_LABELS[p.vibe] ?? p.vibe} tone="accent" /> : null}
          {isFriend ? <Badge label="Friends" tone="success" /> : null}
        </View>
        {p.online === true ? <OnlineLabel /> : null}
      </View>

      <Actions p={p} onKudos={onKudos} />

      {/* Stats */}
      {p.relationship !== 'self' ? (
        <View style={[styles.stats, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Stat icon={Users} value={String(p.mutual_friends)} label={p.mutual_friends === 1 ? 'mutual friend' : 'mutual friends'} />
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <Stat icon={Award} value={p.limited ? '–' : String(kudosTotal)} label="kudos" />
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <Stat icon={Heart} value={String(p.shared_interest_ids.length)} label="in common" />
        </View>
      ) : null}

      {p.limited ? (
        <Card style={styles.lockCard}>
          <View style={[styles.lockIcon, { backgroundColor: colors.primarySoft }]}>
            <Lock size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">Friends-only profile</Text>
            <Text variant="caption" tone="muted">
              {p.display_name} shares their bio, interests and kudos with friends only.
            </Text>
          </View>
        </Card>
      ) : null}

      {isFriend && p.friendship_level != null ? (
        <Card style={{ gap: space.sm }}>
          <View style={styles.rowBetween}>
            <View style={styles.inline}>
              <Heart size={16} color={colors.accent} fill={colors.accent} />
              <Text variant="bodyStrong">Friendship level {p.friendship_level}</Text>
            </View>
            <Text variant="caption" tone="muted">
              {Math.round((p.friendship_progress ?? 0) * 100)}%
            </Text>
          </View>
          <ProgressBar value={p.friendship_progress ?? 0} color={colors.accent} height={8} />
          <Text variant="caption" tone="muted">
            Grows as you chat, hang out and play together.
          </Text>
        </Card>
      ) : null}

      {!p.limited && p.bio ? (
        <View>
          <SectionHeader title="About" />
          <Text style={{ lineHeight: 23 }}>{p.bio}</Text>
        </View>
      ) : null}

      {interests.length ? (
        <View>
          <SectionHeader title="Interests" subtitle={p.shared_interest_ids.length && p.relationship !== 'self' ? `You share ${plural(p.shared_interest_ids.length, 'interest')}` : undefined} />
          <View style={styles.wrap}>
            {interests.map((i) => (
              <Chip key={i.id} label={shared.has(i.id) ? `${i.name} · shared` : i.name} selected={shared.has(i.id)} icon={shared.has(i.id) ? Check : undefined} tone="success" />
            ))}
          </View>
        </View>
      ) : null}

      {!p.limited && kudosEntries.length ? (
        <View>
          <SectionHeader title="Kudos" subtitle={kudosTotal ? 'Given anonymously by people they hung out with' : 'No kudos yet'} />
          <View style={styles.kudosGrid}>
            {kudosEntries.map(([tag, count]) => (
              <View
                key={tag}
                style={[styles.kudo, { backgroundColor: count ? colors.surface : colors.surfaceAlt, borderColor: colors.border, opacity: count ? 1 : 0.6 }]}
                accessible
                accessibilityLabel={`${labels[tag]}: ${count}`}
              >
                <Text style={{ fontSize: 22 }}>{KUDOS_EMOJI[tag] ?? '✨'}</Text>
                <View style={{ flex: 1 }}>
                  <Text variant="label" numberOfLines={1}>
                    {labels[tag]}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {count}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
}

function Stat({ icon: Icon, value, label }: { icon: typeof Users; value: string; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${value} ${label}`}>
      <View style={styles.inline}>
        <Icon size={14} color={colors.textMuted} />
        <Text variant="heading">{value}</Text>
      </View>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function Actions({ p, onKudos }: { p: PublicProfile; onKudos: () => void }) {
  const send = useSendFriendRequest();
  const respond = useRespondRequest();
  const start = useStartConversation();

  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.profile(p.id) });

  const addFriend = async () => {
    try {
      const res = await send.mutateAsync({ userId: p.id, source: 'profile' });
      haptic.success();
      toast.success(res.status === 'accepted' ? `You and ${p.display_name} are friends now` : 'Friend request sent');
    } catch (e) {
      haptic.error();
      toast.error("Couldn't send request", errorMessage(e));
      refresh();
    }
  };

  const answer = async (action: 'accept' | 'decline' | 'cancel') => {
    if (!p.friend_request_id) return;
    try {
      await respond.mutateAsync({ requestId: p.friend_request_id, action, userId: p.id });
      if (action === 'accept') {
        haptic.success();
        toast.success(`You and ${p.display_name} are friends now`);
      } else {
        haptic.light();
      }
    } catch (e) {
      toast.error("That didn't work", errorMessage(e));
      refresh();
    }
  };

  const message = async () => {
    try {
      const conv = await start.mutateAsync(p.id);
      queryClient.setQueryData(qk.conversation(conv.id), conv);
      router.push(`/messages/${conv.id}`);
    } catch (e) {
      toast.error("Couldn't open chat", errorMessage(e));
      refresh();
    }
  };

  const busy = respond.isPending;

  switch (p.relationship) {
    case 'self':
      return <Button title="Edit profile" icon={PencilLine} variant="secondary" onPress={() => router.push('/settings/profile')} fullWidth />;
    case 'friends':
      return (
        <View style={{ gap: space.sm }}>
          <View style={styles.actionRow}>
            {p.can_message ? (
              <Button title="Message" icon={MessageCircle} onPress={message} loading={start.isPending} style={{ flex: 1 }} />
            ) : null}
            <Button title="Give kudos" icon={Award} variant="secondary" onPress={onKudos} style={{ flex: 1 }} />
          </View>
          {!p.can_message ? (
            <Text variant="caption" tone="muted" center>
              Messaging is turned off for one of you, so chat isn't available.
            </Text>
          ) : null}
        </View>
      );
    case 'request_sent':
      return (
        <View style={{ gap: space.sm }}>
          <View style={styles.actionRow}>
            <Button title="Requested" icon={Clock} variant="secondary" disabled style={{ flex: 1 }} accessibilityLabel="Friend request sent" />
            <Button title="Cancel request" variant="outline" onPress={() => answer('cancel')} loading={busy} disabled={!p.friend_request_id} style={{ flex: 1 }} />
          </View>
        </View>
      );
    case 'request_received':
      return (
        <Card style={{ gap: space.md }}>
          <Text variant="bodyStrong" center>
            {p.display_name} wants to be friends
          </Text>
          <View style={styles.actionRow}>
            <Button title="Accept" icon={Check} onPress={() => answer('accept')} disabled={busy} loading={busy && respond.variables?.action === 'accept'} style={{ flex: 1 }} />
            <Button title="Decline" icon={X} variant="secondary" onPress={() => answer('decline')} disabled={busy} loading={busy && respond.variables?.action === 'decline'} style={{ flex: 1 }} />
          </View>
        </Card>
      );
    case 'none':
    default:
      return p.can_friend_request ? (
        <Button title="Add friend" icon={UserPlus} onPress={addFriend} loading={send.isPending} fullWidth />
      ) : (
        <Card style={styles.lockCard}>
          <NoRequests />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            {p.mutual_friends === 0
              ? `${p.display_name} isn't accepting friend requests from new people right now. Meeting in a hangout or through a mutual friend can help.`
              : `${p.display_name} isn't accepting friend requests right now.`}
          </Text>
        </Card>
      );
  }
}

function NoRequests() {
  const { colors } = useTheme();
  return <Lock size={18} color={colors.textMuted} />;
}

function OverflowMenu({ p, visible, onClose, onKudos }: { p: PublicProfile; visible: boolean; onClose: () => void; onKudos: () => void }) {
  const block = useBlock();
  const remove = useRemoveFriend();
  const blocked = p.relationship === 'blocked';

  const run = (fn: () => void) => () => {
    onClose();
    setTimeout(fn, 250);
  };

  const toggleBlock = async () => {
    const ok = await confirm(
      blocked
        ? { title: `Unblock ${p.display_name}?`, message: "They'll be able to find you again. You won't automatically become friends.", confirmLabel: 'Unblock' }
        : {
            title: `Block ${p.display_name}?`,
            message: "They won't be able to find you, message you or join your hangouts, and any friendship ends. They aren't told.",
            confirmLabel: 'Block',
            destructive: true,
          },
    );
    if (!ok) return;
    try {
      await block.mutateAsync({ userId: p.id, block: !blocked });
      haptic.success();
      toast.success(blocked ? `${p.display_name} is unblocked` : `${p.display_name} is blocked`);
    } catch (e) {
      toast.error(blocked ? "Couldn't unblock" : "Couldn't block", errorMessage(e));
    }
  };

  const removeFriend = async () => {
    const ok = await confirm({ title: `Remove ${p.display_name}?`, message: "You'll stop being friends and can't message each other. They aren't notified.", confirmLabel: 'Remove friend', destructive: true });
    if (!ok) return;
    try {
      await remove.mutateAsync(p.id);
      haptic.light();
      toast.show({ title: `Removed ${p.display_name} from friends` });
    } catch (e) {
      toast.error("Couldn't remove friend", errorMessage(e));
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={p.display_name}>
      <ListGroup>
        {!blocked && p.relationship !== 'friends' ? <ListRow icon={Award} iconTone="primary" title="Give kudos" subtitle="For people you've hung out or played with" onPress={run(onKudos)} /> : null}
        {p.relationship === 'friends' ? <ListRow icon={UserMinus} title="Remove friend" onPress={run(removeFriend)} /> : null}
        <ListRow
          icon={Flag}
          iconTone="warning"
          title="Report"
          subtitle="Confidential. They won't know it was you."
          onPress={run(() => openReport({ targetType: 'user', targetId: p.id, subject: `${p.display_name}'s profile`, blockUserId: blocked ? undefined : p.id }))}
        />
        <ListRow icon={blocked ? ShieldOff : Ban} title={blocked ? 'Unblock' : 'Block'} destructive={!blocked} onPress={run(toggleBlock)} />
      </ListGroup>
    </Sheet>
  );
}

function KudosSheet({ p, visible, onClose }: { p: PublicProfile; visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const labels = useKudosLabels();
  const give = useGiveKudos();
  const [picked, setPicked] = useState<string | null>(null);

  const submit = async (tag: string) => {
    if (give.isPending) return;
    setPicked(tag);
    try {
      await give.mutateAsync({ userId: p.id, tag });
      haptic.success();
      toast.success('Kudos sent', `${p.display_name} won't see who it's from.`);
      onClose();
    } catch (e) {
      haptic.warning();
      if (e instanceof ApiError && e.status === 409) {
        toast.show({ title: 'Already sent today', message: `You can give ${p.display_name} kudos again tomorrow.`, tone: 'info' });
        onClose();
      } else if (e instanceof ApiError && e.status === 403) {
        toast.show({ title: 'Not yet', message: "Kudos are for people you've hung out or played with. Join a hangout together first.", tone: 'info' });
        onClose();
      } else {
        toast.error("Couldn't send kudos", errorMessage(e));
      }
    } finally {
      setPicked(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={`Give ${p.display_name} kudos`}>
      <Text tone="muted" style={{ marginBottom: space.lg }}>
        Say what made hanging out great. Kudos are anonymous — one per person per day.
      </Text>
      <View style={styles.kudosGrid}>
        {Object.entries(labels).map(([tag, label]) => (
          <PressableScale
            key={tag}
            onPress={() => submit(tag)}
            disabled={give.isPending}
            hapticFeedback="tap"
            accessibilityLabel={`Give kudos: ${label}`}
            style={[styles.kudoPick, { backgroundColor: picked === tag ? colors.primarySoft : colors.surfaceAlt, borderColor: picked === tag ? colors.primary : 'transparent' }]}
          >
            <Text style={{ fontSize: 26 }}>{KUDOS_EMOJI[tag] ?? '✨'}</Text>
            <Text variant="label" center numberOfLines={1}>
              {label}
            </Text>
          </PressableScale>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm, marginTop: space.xs },
  stats: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, paddingVertical: space.md },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: space.xs },
  statDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  lockCard: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  lockIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionRow: { flexDirection: 'row', gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  kudosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  kudo: { flexDirection: 'row', alignItems: 'center', gap: space.sm, width: '48.5%', padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  kudoPick: { width: '31.5%', minHeight: 84, alignItems: 'center', justifyContent: 'center', gap: space.xs, padding: space.sm, borderRadius: radius.lg, borderWidth: 1.5 },
});
