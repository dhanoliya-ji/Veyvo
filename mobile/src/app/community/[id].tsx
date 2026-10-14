import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ban, Check, Clock, Ellipsis, Flag, Globe, Lock, LogOut, MessageSquareText, Plus, Shield, ShieldCheck, ShieldOff, Tent, Trash2, UserMinus, Users } from 'lucide-react-native';

import {
  useCommunity,
  useCommunityActions,
  useCommunityMembers,
  useCommunityPosts,
  useInterests,
  useMe,
  useRooms,
} from '@/api/hooks';
import type { Community, CommunityMember, CommunityPost } from '@/api/types';
import { Avatar } from '@/components/avatar/Avatar';
import { RoomCard, UserRow } from '@/components/cards';
import { LiveDot } from '@/components/LiveDot';
import { openReport } from '@/components/safety/ReportSheet';
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Header,
  IconButton,
  Input,
  ListGroup,
  ListRow,
  PressableScale,
  RoomCardSkeleton,
  RowSkeleton,
  Screen,
  SegmentedControl,
  Sheet,
  Skeleton,
  Text,
  confirm,
} from '@/components/ui';
import { RANK_LABELS } from '@/api/moments-extra';
import { LeaderboardTab } from '@/components/moments/LeaderboardTab';
import { errorMessage } from '@/lib/api';
import { plural, timeAgo } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

type Tab = 'posts' | 'hangouts' | 'members' | 'ranks';

export default function CommunityScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = String(rawId ?? '');
  const { colors } = useTheme();
  const me = useMe();
  const community = useCommunity(id);
  const interests = useInterests();
  const actions = useCommunityActions(id);
  const [tab, setTab] = useState<Tab>('posts');
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const c = community.data;
  const isMember = !!c && (c.membership === 'owner' || c.membership === 'moderator' || c.membership === 'member');
  const isStaff = !!c && (c.membership === 'owner' || c.membership === 'moderator');
  const isPlatformStaff = me.data?.role === 'moderator' || me.data?.role === 'admin';
  const canView = !!c && (c.visibility === 'public' || isMember || isPlatformStaff);
  const topic = interests.data?.find((i) => i.id === c?.interest_id);

  const posts = useCommunityPosts(id, canView && tab === 'posts');
  const liveRooms = useRooms({ community_id: id });
  const soonRooms = useRooms({ community_id: id, status: 'scheduled' });
  const members = useCommunityMembers(id, 'active', canView && tab === 'members');
  const pending = useCommunityMembers(id, 'pending', isStaff && tab === 'members');

  const refresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([community.refetch(), canView ? posts.refetch() : null, liveRooms.refetch(), soonRooms.refetch(), canView ? members.refetch() : null, isStaff ? pending.refetch() : null]);
    setRefreshing(false);
  };

  const join = async () => {
    try {
      const res = await actions.join.mutateAsync();
      haptic.success();
      if (res.status === 'pending') toast.success('Request sent', 'A moderator will review it. We will let you know.');
      else toast.success(`Welcome to ${c?.name ?? 'the community'}`);
    } catch (e) {
      toast.error("Couldn't join", errorMessage(e));
    }
  };

  const leave = async (pendingRequest = false) => {
    setMenuOpen(false);
    const ok = await confirm({
      title: pendingRequest ? 'Cancel your request?' : `Leave ${c?.name}?`,
      message: pendingRequest ? undefined : c?.visibility === 'private' ? "You'll need to request again to come back." : 'You can rejoin anytime.',
      confirmLabel: pendingRequest ? 'Cancel request' : 'Leave',
      cancelLabel: pendingRequest ? 'Keep request' : 'Stay',
      destructive: !pendingRequest,
    });
    if (!ok) return;
    try {
      await actions.leave.mutateAsync();
      toast.success(pendingRequest ? 'Request cancelled' : 'You left the community');
    } catch (e) {
      toast.error("Couldn't do that", errorMessage(e));
    }
  };

  const report = () => {
    setMenuOpen(false);
    if (c) openReport({ targetType: 'community', targetId: c.id, subject: `the community “${c.name}”` });
  };

  if (community.isLoading) {
    return (
      <Screen header={<Header />}>
        <View style={{ gap: space.lg, paddingTop: space.md }}>
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
            <Skeleton width={64} height={64} rounded={radius.lg} />
            <View style={{ flex: 1, gap: space.sm }}>
              <Skeleton width="70%" height={20} />
              <Skeleton width="40%" height={14} />
            </View>
          </View>
          <Skeleton height={48} rounded={radius.lg} />
          <RowSkeleton count={3} />
        </View>
      </Screen>
    );
  }
  if (community.isError || !c) {
    return (
      <Screen header={<Header />}>
        <ErrorState error={community.error} onRetry={() => community.refetch()} />
      </Screen>
    );
  }

  const live = liveRooms.data?.length ?? 0;

  return (
    <Screen
      scroll
      refreshing={refreshing}
      onRefresh={refresh}
      header={<Header title={c.name} right={<IconButton icon={Ellipsis} label="Community options" onPress={() => setMenuOpen(true)} />} />}
    >
      {/* Hero */}
      <View style={{ gap: space.lg, paddingTop: space.sm }}>
        <View style={styles.hero}>
          <CommunityBadge community={c} size={64} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="title" numberOfLines={2} accessibilityRole="header">
              {c.name}
            </Text>
            <View style={styles.meta}>
              {c.visibility === 'private' ? <Lock size={12} color={colors.textMuted} /> : <Globe size={12} color={colors.textMuted} />}
              <Text variant="caption" tone="muted">
                {c.visibility === 'private' ? 'Private' : 'Public'} · {plural(c.member_count, 'member')}
              </Text>
              {c.live_rooms > 0 ? (
                <>
                  <LiveDot />
                  <Text variant="caption" tone="success">
                    {c.live_rooms} live
                  </Text>
                </>
              ) : null}
            </View>
            {topic ? <Badge label={topic.name} tone="primary" /> : null}
          </View>
        </View>

        <MembershipAction community={c} busy={actions.join.isPending || actions.leave.isPending} onJoin={join} onCancel={() => leave(true)} />

        {c.description ? <Text variant="body">{c.description}</Text> : null}

        {c.rules.length ? (
          <Card style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Shield size={16} color={colors.primary} />
              <Text variant="subheading">Community rules</Text>
            </View>
            {c.rules.map((r, i) => (
              <View key={`${i}-${r}`} style={{ flexDirection: 'row', gap: space.sm }}>
                <Text variant="label" tone="primary" style={{ width: 16 }}>
                  {i + 1}
                </Text>
                <Text variant="body" style={{ flex: 1 }}>
                  {r}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}
      </View>

      {!canView ? (
        <Card style={{ marginTop: space.xl }}>
          <EmptyState
            compact
            icon={Lock}
            title="This community is private"
            message={c.membership === 'pending' ? "Your request is waiting for a moderator. You'll see everything once you're in." : "Request to join to see what's inside."}
          />
        </Card>
      ) : (
        <View style={{ marginTop: space.xl, gap: space.lg }}>
          <SegmentedControl<Tab>
            options={[
              { value: 'posts', label: 'Posts' },
              { value: 'hangouts', label: live ? `Hangouts · ${live}` : 'Hangouts' },
              { value: 'members', label: 'Members' },
              { value: 'ranks', label: 'Ranks' },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === 'posts' ? <PostsTab communityId={id} isMember={isMember} isStaff={isStaff} meId={me.data?.id} posts={posts} /> : null}
          {tab === 'hangouts' ? <HangoutsTab communityId={id} isMember={isMember} live={liveRooms} soon={soonRooms} /> : null}
          {tab === 'ranks' ? <LeaderboardTab communityId={id} /> : null}
          {tab === 'members' ? <MembersTab communityId={id} community={c} meId={me.data?.id} members={members} pending={pending} isStaff={isStaff} /> : null}
        </View>
      )}

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={c.name}>
        <ListGroup>
          {isMember && c.membership !== 'owner' ? (
            <>
              <ListRow icon={LogOut} title="Leave community" onPress={() => leave(false)} />
              <Divider inset={64} />
            </>
          ) : null}
          <ListRow icon={Flag} destructive title="Report community" onPress={report} />
        </ListGroup>
      </Sheet>
    </Screen>
  );
}

function CommunityBadge({ community, size }: { community: Pick<Community, 'name'>; size: number }) {
  const { colors } = useTheme();
  const initials =
    community.name
      .split(' ')
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?';
  const hues = [colors.primary, colors.accent, colors.success, colors.warning];
  const hue = hues[community.name.length % hues.length];
  return (
    <View style={{ width: size, height: size, borderRadius: radius.lg, backgroundColor: `${hue}26`, alignItems: 'center', justifyContent: 'center' }}>
      <Text variant="title" style={{ color: hue }}>
        {initials}
      </Text>
    </View>
  );
}

function MembershipAction({ community, busy, onJoin, onCancel }: { community: Community; busy: boolean; onJoin: () => void; onCancel: () => void }) {
  const { colors } = useTheme();
  switch (community.membership) {
    case 'none':
      return (
        <Button
          title={community.visibility === 'private' ? 'Request to join' : 'Join community'}
          icon={Plus}
          fullWidth
          loading={busy}
          onPress={onJoin}
          accessibilityHint={community.visibility === 'private' ? 'A moderator reviews requests' : undefined}
        />
      );
    case 'pending':
      return (
        <View style={{ gap: space.xs }}>
          <Button title="Request sent" icon={Clock} variant="secondary" fullWidth disabled />
          <Button title="Cancel request" variant="ghost" onPress={onCancel} disabled={busy} />
        </View>
      );
    case 'owner':
      return <Badge label="You own this community" tone="warning" />;
    case 'moderator':
      return <Badge label="You're a moderator here" tone="primary" />;
    default:
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Check size={16} color={colors.success} />
          <Text variant="label" tone="success">
            You're a member
          </Text>
        </View>
      );
  }
}

// ---------- Posts ----------
function PostsTab({
  communityId,
  isMember,
  isStaff,
  meId,
  posts,
}: {
  communityId: string;
  isMember: boolean;
  isStaff: boolean;
  meId: string | undefined;
  posts: ReturnType<typeof useCommunityPosts>;
}) {
  const { colors } = useTheme();
  const actions = useCommunityActions(communityId);
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState<CommunityPost | null>(null);

  const submit = async () => {
    const content = draft.trim();
    if (!content) return;
    try {
      await actions.post.mutateAsync(content);
      haptic.success();
      setDraft('');
    } catch (e) {
      toast.error("Couldn't post", errorMessage(e));
    }
  };

  const remove = async (p: CommunityPost) => {
    setSelected(null);
    const ok = await confirm({ title: 'Remove this post?', message: 'It will be removed for everyone.', confirmLabel: 'Remove', destructive: true });
    if (!ok) return;
    try {
      await actions.removePost.mutateAsync(p.id);
      toast.success('Post removed');
    } catch (e) {
      toast.error("Couldn't remove it", errorMessage(e));
    }
  };

  return (
    <View style={{ gap: space.md }}>
      {isMember ? (
        <Card style={{ gap: space.sm }}>
          <Input placeholder="Share something with the community" value={draft} onChangeText={setDraft} multiline maxLength={1000} counter accessibilityLabel="New post" />
          <Button title="Post" icon={MessageSquareText} onPress={submit} loading={actions.post.isPending} disabled={!draft.trim()} style={{ alignSelf: 'flex-end' }} />
        </Card>
      ) : (
        <Text variant="caption" tone="muted">
          Join to post and reply.
        </Text>
      )}
      {posts.isLoading ? (
        <RowSkeleton count={3} />
      ) : posts.isError ? (
        <ErrorState error={posts.error} onRetry={() => posts.refetch()} compact />
      ) : !posts.data?.length ? (
        <EmptyState compact icon={MessageSquareText} title="No posts yet" message={isMember ? 'Start the conversation. Say hi, share a plan, or ask a question.' : undefined} />
      ) : (
        posts.data.map((p) => {
          const mine = p.author.id === meId;
          return (
            <PressableScale
              key={p.id}
              scaleTo={0.99}
              delayLongPress={350}
              onLongPress={() => setSelected(p)}
              accessibilityLabel={`${p.author.display_name}, ${timeAgo(p.created_at)}: ${p.content}`}
              accessibilityHint="Long press for options"
              accessibilityActions={[{ name: 'longpress', label: 'Post options' }]}
              onAccessibilityAction={() => setSelected(p)}
              style={[styles.post, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={styles.postHead}>
                <Avatar config={p.author.avatar} size={36} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {mine ? 'You' : p.author.display_name}
                  </Text>
                  <Text variant="caption" tone="faint">
                    {timeAgo(p.created_at)}
                  </Text>
                </View>
                <IconButton icon={Ellipsis} size={36} label="Post options" onPress={() => setSelected(p)} />
              </View>
              <Text variant="body">{p.content}</Text>
            </PressableScale>
          );
        })
      )}

      <Sheet visible={!!selected} onClose={() => setSelected(null)} title="Post">
        {selected ? (
          <ListGroup>
            {selected.author.id !== meId ? (
              <ListRow
                icon={Flag}
                destructive
                title="Report post"
                onPress={() => {
                  const p = selected;
                  setSelected(null);
                  openReport({ targetType: 'community_post', targetId: p.id, subject: `this post from ${p.author.display_name}`, blockUserId: p.author.id });
                }}
              />
            ) : null}
            {selected.author.id !== meId && (selected.author.id === meId || isStaff) ? <Divider inset={64} /> : null}
            {selected.author.id === meId || isStaff ? <ListRow icon={Trash2} destructive title="Remove post" onPress={() => remove(selected)} /> : null}
          </ListGroup>
        ) : null}
      </Sheet>
    </View>
  );
}

// ---------- Hangouts ----------
function HangoutsTab({
  communityId,
  isMember,
  live,
  soon,
}: {
  communityId: string;
  isMember: boolean;
  live: ReturnType<typeof useRooms>;
  soon: ReturnType<typeof useRooms>;
}) {
  return (
    <View style={{ gap: space.md }}>
      {isMember ? (
        <Button title="Host a hangout here" icon={Tent} fullWidth onPress={() => router.push({ pathname: '/room/create', params: { community_id: communityId } })} />
      ) : null}
      <Text variant="subheading">Live now</Text>
      {live.isLoading ? (
        <RoomCardSkeleton />
      ) : live.isError ? (
        <ErrorState error={live.error} onRetry={() => live.refetch()} compact />
      ) : live.data?.length ? (
        live.data.map((r) => <RoomCard key={r.id} room={r} width="100%" />)
      ) : (
        <Text variant="body" tone="muted">
          Nothing live right now.{isMember ? ' Open one and the community can drop in.' : ''}
        </Text>
      )}
      {soon.data?.length ? (
        <>
          <Text variant="subheading" style={{ marginTop: space.sm }}>
            Starting soon
          </Text>
          {soon.data.map((r) => (
            <RoomCard key={r.id} room={r} width="100%" />
          ))}
        </>
      ) : null}
    </View>
  );
}

// ---------- Members ----------
function MembersTab({
  communityId,
  community,
  meId,
  members,
  pending,
  isStaff,
}: {
  communityId: string;
  community: Community;
  meId: string | undefined;
  members: ReturnType<typeof useCommunityMembers>;
  pending: ReturnType<typeof useCommunityMembers>;
  isStaff: boolean;
}) {
  const actions = useCommunityActions(communityId);
  const [managing, setManaging] = useState<CommunityMember | null>(null);
  const isOwner = community.membership === 'owner';
  const sorted = useMemo(() => {
    const order: Record<string, number> = { owner: 0, moderator: 1, member: 2 };
    return [...(members.data ?? [])].sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3));
  }, [members.data]);

  const manage = async (m: CommunityMember, action: 'approve' | 'remove' | 'ban' | 'make_moderator' | 'make_member', done: string) => {
    setManaging(null);
    if (action === 'ban' || action === 'remove') {
      const ok = await confirm({
        title: action === 'ban' ? `Ban ${m.display_name}?` : m.status === 'pending' ? `Decline ${m.display_name}?` : `Remove ${m.display_name}?`,
        message: action === 'ban' ? "They'll be removed and can't rejoin." : undefined,
        confirmLabel: action === 'ban' ? 'Ban' : m.status === 'pending' ? 'Decline' : 'Remove',
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      await actions.manage.mutateAsync({ userId: m.id, action });
      haptic.success();
      toast.success(done);
    } catch (e) {
      toast.error("Couldn't do that", errorMessage(e));
    }
  };

  const canManage = (m: CommunityMember) => isStaff && m.id !== meId && m.role !== 'owner' && (m.role !== 'moderator' || isOwner);
  const roleBadge = (role: string) => (role === 'owner' ? <Badge label="Owner" tone="warning" /> : role === 'moderator' ? <Badge label="Mod" tone="primary" /> : null);

  return (
    <View style={{ gap: space.lg }}>
      {isStaff ? (
        <View style={{ gap: space.sm }}>
          <Text variant="subheading">Requests to join</Text>
          {pending.isLoading ? (
            <RowSkeleton count={1} />
          ) : pending.isError ? (
            <ErrorState error={pending.error} onRetry={() => pending.refetch()} compact />
          ) : pending.data?.length ? (
            pending.data.map((m) => (
              <UserRow
                key={m.id}
                user={m}
                subtitle="Wants to join"
                right={
                  <View style={{ flexDirection: 'row', gap: space.xs }}>
                    <Button title="Approve" size="sm" onPress={() => manage(m, 'approve', `${m.display_name} is in`)} accessibilityLabel={`Approve ${m.display_name}`} />
                    <IconButton icon={UserMinus} size={36} variant="filled" label={`Decline ${m.display_name}`} onPress={() => manage(m, 'remove', 'Request declined')} />
                  </View>
                }
              />
            ))
          ) : (
            <Text variant="caption" tone="muted">
              No pending requests.
            </Text>
          )}
        </View>
      ) : null}

      <View style={{ gap: space.xs }}>
        <Text variant="subheading">{plural(community.member_count, 'member')}</Text>
        {members.isLoading ? (
          <RowSkeleton count={4} />
        ) : members.isError ? (
          <ErrorState error={members.error} onRetry={() => members.refetch()} compact />
        ) : !sorted.length ? (
          <EmptyState compact icon={Users} title="No members to show" />
        ) : (
          sorted.map((m) => (
            <UserRow
              key={m.id}
              user={m}
              subtitle={[m.id === meId ? 'You' : null, m.rank ? RANK_LABELS[m.rank] : null].filter(Boolean).join(' · ') || undefined}
              onPress={canManage(m) ? () => setManaging(m) : undefined}
              right={roleBadge(m.role)}
            />
          ))
        )}
      </View>

      <Sheet visible={!!managing} onClose={() => setManaging(null)} title={managing?.display_name}>
        {managing ? (
          <ListGroup>
            <ListRow
              icon={Users}
              title="View profile"
              onPress={() => {
                const m = managing;
                setManaging(null);
                router.push(`/user/${m.id}`);
              }}
            />
            {isOwner && managing.role === 'member' ? (
              <>
                <Divider inset={64} />
                <ListRow icon={ShieldCheck} iconTone="primary" title="Make moderator" onPress={() => manage(managing, 'make_moderator', `${managing.display_name} is now a moderator`)} />
              </>
            ) : null}
            {isOwner && managing.role === 'moderator' ? (
              <>
                <Divider inset={64} />
                <ListRow icon={ShieldOff} title="Remove moderator" onPress={() => manage(managing, 'make_member', `${managing.display_name} is a member again`)} />
              </>
            ) : null}
            <Divider inset={64} />
            <ListRow icon={UserMinus} destructive title="Remove from community" onPress={() => manage(managing, 'remove', `${managing.display_name} was removed`)} />
            <Divider inset={64} />
            <ListRow icon={Ban} destructive title="Ban from community" onPress={() => manage(managing, 'ban', `${managing.display_name} was banned`)} />
          </ListGroup>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  post: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.md, gap: space.sm },
  postHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
