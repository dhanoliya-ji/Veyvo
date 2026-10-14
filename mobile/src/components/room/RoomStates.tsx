import type { ComponentType, ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { CalendarClock, CloudOff, DoorClosed, Flag, Lock, Play, SearchX, ShieldAlert, Tent, Users, type LucideProps } from 'lucide-react-native';

import type { RoomDetail } from '@/api/types';
import type { RoomErrorKind } from '@/api/rooms-extra';
import { UserRow } from '@/components/cards';
import { openReport } from '@/components/safety/ReportSheet';
import { Badge, Button, Card, Header, IconButton, Screen, Text } from '@/components/ui';
import { eventTime } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

export const leaveScreen = () => (router.canGoBack() ? router.back() : router.replace('/hangouts'));

function Centered({ icon: Icon, title, message, children, tone = 'primary' }: { icon: ComponentType<LucideProps>; title: string; message?: string; children?: ReactNode; tone?: 'primary' | 'danger' | 'muted' }) {
  const { colors } = useTheme();
  const tint = tone === 'danger' ? colors.danger : tone === 'muted' ? colors.textMuted : colors.primary;
  const bg = tone === 'danger' ? colors.dangerSoft : tone === 'muted' ? colors.surfaceAlt : colors.primarySoft;
  return (
    <Screen header={<Header close onBack={leaveScreen} />}>
      <View style={styles.center}>
        <View style={[styles.icon, { backgroundColor: bg }]}>
          <Icon size={28} color={tint} />
        </View>
        <Text variant="title" center accessibilityRole="header">
          {title}
        </Text>
        {message ? (
          <Text tone="muted" center style={{ maxWidth: 320 }}>
            {message}
          </Text>
        ) : null}
        <View style={{ gap: space.sm, alignSelf: 'stretch', marginTop: space.lg }}>{children}</View>
      </View>
    </Screen>
  );
}

export function JoiningView({ title }: { title?: string }) {
  const { colors } = useTheme();
  return (
    <Screen header={<Header close onBack={leaveScreen} />}>
      <View style={styles.center} accessibilityLiveRegion="polite" accessibilityLabel={title ? `Joining ${title}` : 'Joining hangout'}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text variant="heading" center>
          {title ? `Joining ${title}` : 'Finding your seat...'}
        </Text>
        <Text tone="muted" center>
          Getting you a seat.
        </Text>
      </View>
    </Screen>
  );
}

export function RoomErrorView({ kind, title, message, onRetry }: { kind: RoomErrorKind; title: string; message: string; onRetry?: () => void }) {
  const icon = kind === 'forbidden' ? Lock : kind === 'full' ? Users : kind === 'offline' ? CloudOff : kind === 'not_found' ? SearchX : kind === 'ended' ? DoorClosed : ShieldAlert;
  const canRetry = kind === 'full' || kind === 'offline' || kind === 'other';
  return (
    <Centered icon={icon} title={title} message={message} tone={kind === 'forbidden' ? 'danger' : 'primary'}>
      {canRetry && onRetry ? <Button title="Try again" onPress={onRetry} fullWidth /> : null}
      <Button title="Find another hangout" variant={canRetry ? 'secondary' : 'primary'} onPress={() => router.replace('/hangouts')} fullWidth />
    </Centered>
  );
}

export function EndedView({ reason }: { reason: 'host' | 'self' | 'ended' | 'removed' }) {
  const copy = {
    host: { title: 'The host ended this hangout', message: 'Thanks for hanging out. There are more rooms open right now.' },
    self: { title: 'You ended the hangout', message: 'Nice hosting. Everyone has been let out.' },
    ended: { title: 'This hangout has ended', message: 'Thanks for stopping by. There are more rooms open right now.' },
    removed: { title: 'You left this hangout', message: 'The host removed you from this room.' },
  }[reason];
  return (
    <Centered icon={DoorClosed} title={copy.title} message={copy.message} tone="muted">
      <Button title="Find another hangout" icon={Tent} onPress={() => router.replace('/hangouts')} fullWidth />
      <Button title="Start your own" variant="secondary" onPress={() => router.replace('/room/create')} fullWidth />
    </Centered>
  );
}

type ScheduledProps = { room: RoomDetail; isHost: boolean; starting: boolean; onStart: () => void; nowLive: boolean };

/** Event details for a hangout that hasn't started yet. Times shown in the viewer's time zone. */
export function ScheduledView({ room, isHost, starting, onStart, nowLive }: ScheduledProps) {
  const { colors } = useTheme();
  return (
    <Screen
      header={
        <Header
          close
          onBack={leaveScreen}
          right={
            <IconButton
              icon={Flag}
              label="Report this hangout"
              onPress={() => openReport({ targetType: 'room', targetId: room.id, subject: `the hangout “${room.title}”`, blockUserId: room.host?.id })}
            />
          }
        />
      }
      footer={
        nowLive ? (
          <Button title="It's live. Join now" icon={Play} size="lg" fullWidth onPress={onStart} loading={starting} />
        ) : isHost ? (
          <Button title="Start now" icon={Play} size="lg" fullWidth onPress={onStart} loading={starting} accessibilityHint="Opens the hangout and lets people in" />
        ) : undefined
      }
    >
      <ScrollView contentContainerStyle={{ gap: space.lg, paddingBottom: space.xxl }} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.primarySoft }]} />
          <View style={[styles.when, { backgroundColor: 'rgba(16,17,26,0.78)' }]}>
            <CalendarClock size={14} color="#F5F5FB" />
            <Text variant="label" style={{ color: '#F5F5FB' }}>
              {nowLive ? 'Live now' : room.scheduled_for ? eventTime(room.scheduled_for) : 'Scheduled'}
            </Text>
          </View>
        </View>
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Badge label={room.kind === 'study' ? 'Study room' : 'Hangout'} tone="primary" />
            <Badge label={room.format === 'voice' ? 'Voice' : 'Text'} tone="neutral" />
            {room.visibility === 'private' ? <Badge label="Invite-only" tone="neutral" /> : null}
          </View>
          <Text variant="title" accessibilityRole="header">
            {room.title}
          </Text>
          {room.scheduled_for ? (
            <Text tone="muted">
              Starts {eventTime(room.scheduled_for)} (your time) · up to {room.capacity} people
            </Text>
          ) : null}
        </View>
        {room.description ? <Text variant="body">{room.description}</Text> : null}
        {room.host ? (
          <Card padded={false} style={{ paddingHorizontal: space.md }}>
            <UserRow user={room.host} subtitle="Host" />
          </Card>
        ) : null}
        <Card style={{ gap: space.sm, backgroundColor: colors.surfaceAlt }}>
          <Text variant="label">
            {isHost ? "You're the host" : 'Coming up'}
          </Text>
          <Text variant="caption" tone="muted">
            {isHost
              ? 'Open the doors whenever you are ready. People can join as soon as you start.'
              : "The doors open when the host starts. Check back at the start time. If it's in your notifications, tap it to come straight here."}
          </Text>
        </Card>
        {room.rules.length ? (
          <View style={{ gap: space.xs }}>
            <Text variant="label" tone="muted">
              Room rules
            </Text>
            {room.rules.map((r) => (
              <Text key={r} variant="caption" tone="muted">
                • {r}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingBottom: space.huge },
  icon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  hero: { height: 180, borderRadius: radius.xl, overflow: 'hidden' },
  when: { position: 'absolute', left: space.md, bottom: space.md, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, height: 30, borderRadius: radius.pill },
});
