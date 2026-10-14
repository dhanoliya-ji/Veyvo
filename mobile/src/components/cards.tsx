import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { BookOpen, CalendarClock, Lock, MessageSquareText, Mic, Users } from 'lucide-react-native';

import type { Community, Room, UserSummary } from '@/api/types';
import { Avatar } from '@/components/avatar/Avatar';
import { SceneBackground } from '@/components/scene/SceneBackground';
import { Badge, PressableScale, Text } from '@/components/ui';
import { LiveDot } from '@/components/LiveDot';
import { eventTime, plural, VIBE_LABELS } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

export function AvatarStack({ people, size = 26, max = 4, extra = 0 }: { people: UserSummary[]; size?: number; max?: number; extra?: number }) {
  const { colors } = useTheme();
  const shown = people.slice(0, max);
  const more = extra + Math.max(0, people.length - max);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {shown.map((p, i) => (
        <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -size * 0.32, borderRadius: size, borderWidth: 2, borderColor: colors.surface }}>
          <Avatar config={p.avatar} size={size} />
        </View>
      ))}
      {more > 0 ? (
        <Text variant="caption" tone="muted" style={{ marginLeft: 6 }}>
          +{more}
        </Text>
      ) : null}
    </View>
  );
}

/** Card for a live or scheduled hangout. Counts come straight from the server. */
export function RoomCard({ room, width = 264, onPress }: { room: Room; width?: number | `${number}%`; onPress?: () => void }) {
  const { colors } = useTheme();
  const live = room.status === 'live';
  const FormatIcon = room.kind === 'study' ? BookOpen : room.format === 'voice' ? Mic : MessageSquareText;
  const label = `${room.title}. ${live ? `${plural(room.participant_count, 'person', 'people')} inside` : room.scheduled_for ? `Starts ${eventTime(room.scheduled_for)}` : ''}. Hosted by ${room.host?.display_name ?? 'someone'}.`;

  return (
    <PressableScale
      onPress={onPress ?? (() => router.push(`/room/${room.id}`))}
      scaleTo={0.98}
      accessibilityLabel={label}
      accessibilityHint={live ? 'Opens the hangout' : 'Opens hangout details'}
      style={[styles.roomCard, { width, backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.scene}>
        <SceneBackground scene={room.scene} />
        <View style={styles.sceneTop}>
          {live ? (
            <View style={[styles.livePill, { backgroundColor: 'rgba(16,17,26,0.72)' }]}>
              <LiveDot />
              <Text variant="tiny" style={{ color: '#F5F5FB' }}>
                LIVE · {room.participant_count}/{room.capacity}
              </Text>
            </View>
          ) : room.scheduled_for ? (
            <View style={[styles.livePill, { backgroundColor: 'rgba(16,17,26,0.72)' }]}>
              <CalendarClock size={12} color="#F5F5FB" />
              <Text variant="tiny" style={{ color: '#F5F5FB' }}>
                {eventTime(room.scheduled_for)}
              </Text>
            </View>
          ) : (
            <View />
          )}
          {room.visibility === 'private' ? (
            <View style={[styles.iconPill, { backgroundColor: 'rgba(16,17,26,0.72)' }]} accessibilityLabel="Invite only">
              <Lock size={12} color="#F5F5FB" />
            </View>
          ) : null}
        </View>
        {room.participants_preview.length ? (
          <View style={styles.sceneBottom}>
            <AvatarStack people={room.participants_preview} size={28} extra={Math.max(0, room.participant_count - room.participants_preview.length)} />
          </View>
        ) : null}
      </View>
      <View style={{ padding: space.md, gap: 6 }}>
        <Text variant="subheading" numberOfLines={1}>
          {room.title}
        </Text>
        <View style={styles.metaRow}>
          <FormatIcon size={13} color={colors.textMuted} />
          <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
            {room.kind === 'study' ? 'Study room' : room.format === 'voice' ? 'Voice' : 'Text'} · {room.host?.display_name ?? 'Host left'}
          </Text>
          {room.friends_inside > 0 ? <Badge label={`${room.friends_inside} friend${room.friends_inside > 1 ? 's' : ''}`} tone="success" /> : null}
        </View>
      </View>
    </PressableScale>
  );
}

export function CommunityCard({ community, compact }: { community: Community; compact?: boolean }) {
  const { colors } = useTheme();
  const initials = community.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const hues = [colors.primary, colors.accent, colors.success, colors.warning];
  const hue = hues[community.name.length % hues.length];
  return (
    <PressableScale
      onPress={() => router.push(`/community/${community.id}`)}
      scaleTo={0.98}
      accessibilityLabel={`${community.name}, ${plural(community.member_count, 'member')}`}
      style={[styles.community, compact && { width: 200 }, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.communityIcon, { backgroundColor: `${hue}26` }]}>
        <Text variant="heading" style={{ color: hue }}>
          {initials}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="subheading" numberOfLines={1} style={{ flexShrink: 1 }}>
            {community.name}
          </Text>
          {community.visibility === 'private' ? <Lock size={12} color={colors.textMuted} /> : null}
        </View>
        <View style={styles.metaRow}>
          <Users size={12} color={colors.textMuted} />
          <Text variant="caption" tone="muted">
            {plural(community.member_count, 'member')}
          </Text>
          {community.live_rooms > 0 ? (
            <>
              <LiveDot />
              <Text variant="caption" tone="success">
                {community.live_rooms} live
              </Text>
            </>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}

export function UserRow({ user, subtitle, right, onPress, online }: { user: UserSummary; subtitle?: string; right?: ReactNode; onPress?: () => void; online?: boolean | null }) {
  const sub = subtitle ?? (user.vibe ? VIBE_LABELS[user.vibe] : user.username ? `@${user.username}` : undefined);
  return (
    <PressableScale
      onPress={onPress ?? (() => router.push(`/user/${user.id}`))}
      scaleTo={0.99}
      style={styles.userRow}
      accessibilityLabel={`${user.display_name}${sub ? `, ${sub}` : ''}`}
    >
      <Avatar config={user.avatar} size={46} online={online} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {user.display_name}
        </Text>
        {sub ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {right}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  roomCard: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  scene: { height: 120, overflow: 'hidden' },
  sceneTop: { flexDirection: 'row', justifyContent: 'space-between', padding: space.sm },
  sceneBottom: { position: 'absolute', left: space.sm, bottom: space.sm },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, height: 24, borderRadius: radius.pill },
  iconPill: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  community: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  communityIcon: { width: 46, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
});
