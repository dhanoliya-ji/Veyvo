import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, Ban, CalendarClock, Crown, Flame, Flag, LogOut, MoreHorizontal, SendHorizontal, UserMinus, UserPlus, UsersRound, Video } from 'lucide-react-native';

import { useBlock, useFriends, useMe } from '@/api/hooks';
import {
  MAX_SQUAD_SIZE,
  WEEKDAYS,
  localToUtc,
  markSquadRead,
  sendSquadMessage,
  squadKeys,
  squadNightLabel,
  useAddSquadMember,
  useLeaveSquad,
  useRemoveSquadMember,
  useSquad,
  useSquadMessages,
  useStartSquadHangout,
  useUpdateSquad,
  utcToLocal,
  type Squad,
  type SquadMember,
  type SquadMessage,
} from '@/api/squads-extra';
import { UserPhoto } from '@/components/UserPhoto';
import { openReport } from '@/components/safety/ReportSheet';
import { Button, Chip, EmptyState, ErrorState, IconButton, Input, ListGroup, ListRow, PressableScale, RowSkeleton, Screen, Sheet, Text, confirm } from '@/components/ui';
import { upsertSquadMessage } from '@/hooks/useSquadsRealtime';
import { ApiError, errorMessage } from '@/lib/api';
import { clientId, clockTime, dayLabel } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, radius, screenPadding, space } from '@/theme/tokens';

const MAX_LENGTH = 2000;
const ts = (iso: string) => new Date(iso).getTime();
const dayKey = (iso: string) => new Date(iso).toDateString();

export default function SquadChat() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const me = useMe();
  const myId = me.data?.id;
  const squad = useSquad(id);
  const messages = useSquadMessages(id);
  const hangout = useStartSquadHangout(id);
  const [text, setText] = useState('');
  const [outbox, setOutbox] = useState<Record<string, SquadMessage>>({});
  const [sheet, setSheet] = useState<'menu' | 'night' | 'add' | null>(null);

  const items = useMemo(() => {
    const cached = (messages.data?.pages ?? []).flatMap((p) => p.items);
    const seen = new Set(cached.map((m) => m.client_id).filter(Boolean));
    const ids = new Set<string>();
    const out = cached.filter((m) => (ids.has(m.id) ? false : (ids.add(m.id), true)));
    for (const local of Object.values(outbox)) if (!seen.has(local.client_id)) out.push(local);
    return out.sort((a, b) => ts(b.created_at) - ts(a.created_at));
  }, [messages.data, outbox]);

  const newest = items[0]?.id;
  useEffect(() => {
    if (!id || !messages.data) return;
    markSquadRead(id)
      .then(() => qc.invalidateQueries({ queryKey: squadKeys.all }))
      .catch(() => undefined);
  }, [id, newest, messages.data, qc]);

  const deliver = useCallback(
    async (local: SquadMessage) => {
      const cid = local.client_id as string;
      setOutbox((o) => ({ ...o, [cid]: { ...local, pending: true, failed: false } }));
      try {
        const saved = await sendSquadMessage(id, local.content, cid);
        upsertSquadMessage(qc, saved);
        setOutbox((o) => {
          const next = { ...o };
          delete next[cid];
          return next;
        });
        qc.invalidateQueries({ queryKey: squadKeys.all });
      } catch (e) {
        haptic.error();
        setOutbox((o) => ({ ...o, [cid]: { ...local, pending: false, failed: true } }));
        if (e instanceof ApiError && (e.status === 404 || e.status === 422)) toast.error('Message not sent', errorMessage(e));
      }
    },
    [id, qc],
  );

  const onSend = () => {
    const content = text.trim();
    if (!content || !me.data || content.length > MAX_LENGTH) return;
    const cid = clientId();
    const sender = { id: me.data.id, username: me.data.username ?? null, display_name: me.data.display_name, avatar: {}, level: 1, vibe: null, photo_url: me.data.photo_url ?? null };
    setText('');
    haptic.light();
    deliver({ id: `local-${cid}`, squad_id: id, sender, client_id: cid, content, removed: false, created_at: new Date().toISOString(), pending: true });
  };

  const onLongPress = useCallback((m: SquadMessage) => {
    if (m.removed || m.pending || m.sender.id === myId || m.id.startsWith('local-')) return;
    haptic.medium();
    openReport({ targetType: 'squad_message', targetId: m.id, subject: 'this message', blockUserId: m.sender.id });
  }, [myId]);

  const startHangout = async () => {
    try {
      const room = await hangout.mutateAsync();
      haptic.success();
      router.push(`/room/${room.id}`);
    } catch (e) {
      toast.error("Couldn't start the hangout", errorMessage(e));
    }
  };

  const notFound = squad.error instanceof ApiError && squad.error.status === 404;
  const s = squad.data;
  const header = (
    <View style={styles.header}>
      <IconButton icon={ArrowLeft} label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/squads' as Href))} />
      {s ? (
        <PressableScale onPress={() => setSheet('menu')} style={styles.headerWho} accessibilityLabel={`${s.name}, ${s.member_count} people. Squad details`}>
          <Text style={{ fontSize: 26, lineHeight: 32 }}>{s.emoji}</Text>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text variant="subheading" numberOfLines={1} style={{ flexShrink: 1 }}>
                {s.name}
              </Text>
              {s.streak_weeks > 0 ? (
                <>
                  <Flame size={14} color={colors.warning} />
                  <Text variant="caption" tone="warning">
                    {s.streak_weeks}
                  </Text>
                </>
              ) : null}
            </View>
            <View style={styles.faces}>
              {s.members.slice(0, 6).map((m, i) => (
                <View key={m.user.id} style={{ marginLeft: i ? -6 : 0 }}>
                  <UserPhoto user={m.user} size={18} showVerified={false} />
                </View>
              ))}
              <Text variant="caption" tone="muted" style={{ marginLeft: 6 }}>
                {s.member_count} {s.member_count === 1 ? 'person' : 'people'}
              </Text>
            </View>
          </View>
        </PressableScale>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {s ? <IconButton icon={MoreHorizontal} label="Squad options" onPress={() => setSheet('menu')} /> : null}
    </View>
  );

  if (notFound) {
    return (
      <Screen header={header}>
        <EmptyState icon={UsersRound} title="Squad not available" message="This squad doesn't exist or you're no longer in it." action="Back to squads" onAction={() => router.replace('/squads' as Href)} />
      </Screen>
    );
  }

  return (
    <Screen padded={false} keyboard header={header} footer={<Composer value={text} onChange={setText} onSend={onSend} disabled={!s || !me.data} />}>
      {s ? (
        <View style={[styles.hangoutBar, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Video size={18} color={s.live_room_id ? colors.success : colors.primary} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">{s.live_room_id ? (s.present_count ? `${s.present_count} hanging out now` : 'Hangout is open') : 'Squad hangout'}</Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {squadNightLabel(s) ? `Squad night ${squadNightLabel(s)}` : 'Video and voice, just your squad'}
            </Text>
          </View>
          <Button title={s.live_room_id ? 'Join' : 'Start squad hangout'} size="sm" onPress={startHangout} loading={hangout.isPending} />
        </View>
      ) : null}
      {messages.isLoading || squad.isLoading ? (
        <View style={{ padding: screenPadding }}>
          <RowSkeleton count={6} />
        </View>
      ) : messages.isError && !messages.data ? (
        <ErrorState error={messages.error} onRetry={() => messages.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={UsersRound} title="Start the squad chat" message="Plan your next hangout, or just say hi 👋" />
      ) : (
        <FlatList
          inverted
          data={items}
          keyExtractor={(m) => m.client_id || m.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space.md, paddingVertical: space.md }}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (messages.hasNextPage && !messages.isFetchingNextPage) messages.fetchNextPage();
          }}
          ListFooterComponent={messages.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ marginVertical: space.lg }} /> : null}
          renderItem={({ item, index }) => {
            const older = items[index + 1];
            return (
              <MessageRow
                message={item}
                mine={item.sender.id === myId}
                showDay={!older || dayKey(older.created_at) !== dayKey(item.created_at)}
                showName={!older || older.sender.id !== item.sender.id || dayKey(older.created_at) !== dayKey(item.created_at)}
                onRetry={deliver}
                onLongPress={onLongPress}
              />
            );
          }}
        />
      )}

      {s ? (
        <>
          <SquadMenu squad={s} myId={myId} visible={sheet === 'menu'} onClose={() => setSheet(null)} onNight={() => setSheet('night')} onAdd={() => setSheet('add')} />
          {sheet === 'night' ? <NightSheet squad={s} visible onClose={() => setSheet(null)} /> : null}
          <AddSheet squad={s} visible={sheet === 'add'} onClose={() => setSheet(null)} />
        </>
      ) : null}
    </Screen>
  );
}

// ---------- Messages ----------
const MessageRow = memo(function MessageRow({
  message: m,
  mine,
  showDay,
  showName,
  onRetry,
  onLongPress,
}: {
  message: SquadMessage;
  mine: boolean;
  showDay: boolean;
  showName: boolean;
  onRetry: (m: SquadMessage) => void;
  onLongPress: (m: SquadMessage) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginTop: showName ? space.md : 2 }}>
      {showDay ? (
        <View style={styles.dayWrap}>
          <View style={[styles.dayPill, { backgroundColor: colors.surfaceAlt }]}>
            <Text variant="tiny" tone="muted">
              {dayLabel(m.created_at)}
            </Text>
          </View>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
        {!mine ? <View style={{ width: 28 }}>{showName ? <UserPhoto user={m.sender} size={28} showVerified={false} /> : null}</View> : null}
        <View style={{ maxWidth: '78%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
          {showName && !mine ? (
            <Text variant="caption" tone="muted" style={{ marginBottom: 2, marginLeft: 4 }}>
              {m.sender.display_name}
            </Text>
          ) : null}
          <PressableScale
            onPress={m.failed ? () => onRetry(m) : undefined}
            onLongPress={() => onLongPress(m)}
            delayLongPress={300}
            scaleTo={0.98}
            accessibilityLabel={`${mine ? 'You' : m.sender.display_name}: ${m.removed ? 'Message removed' : m.content}. ${clockTime(m.created_at)}`}
            accessibilityHint={m.failed ? 'Double tap to try again' : !mine && !m.removed ? 'Long press to report' : undefined}
            style={[
              styles.bubble,
              mine ? { backgroundColor: m.failed ? colors.dangerSoft : colors.primary, opacity: m.pending ? 0.7 : 1 } : { backgroundColor: colors.surfaceAlt },
              m.removed && { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
            ]}
          >
            {m.removed ? (
              <Text tone="faint" style={{ fontStyle: 'italic' }}>
                Message removed
              </Text>
            ) : (
              <Text style={{ color: mine && !m.failed ? colors.onPrimary : colors.text }}>{m.content}</Text>
            )}
          </PressableScale>
          {m.failed ? (
            <PressableScale onPress={() => onRetry(m)} style={styles.retry} accessibilityLabel="Not sent. Tap to retry">
              <AlertCircle size={13} color={colors.danger} />
              <Text variant="caption" tone="danger">
                Not sent · Tap to retry
              </Text>
            </PressableScale>
          ) : null}
        </View>
      </View>
    </View>
  );
});

function Composer({ value, onChange, onSend, disabled }: { value: string; onChange: (t: string) => void; onSend: () => void; disabled: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.composer}>
      <View style={[styles.inputWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="Message your squad"
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.primary}
          multiline
          maxLength={MAX_LENGTH}
          editable={!disabled}
          accessibilityLabel="Message your squad"
          style={[styles.input, { color: colors.text, fontFamily: fonts.regular }]}
        />
      </View>
      <IconButton icon={SendHorizontal} variant="primary" label="Send message" disabled={disabled || !value.trim()} onPress={onSend} size={48} />
    </View>
  );
}

// ---------- Menu: members, squad night, leave ----------
function SquadMenu({ squad, myId, visible, onClose, onNight, onAdd }: { squad: Squad; myId?: string; visible: boolean; onClose: () => void; onNight: () => void; onAdd: () => void }) {
  const owner = squad.my_role === 'owner';
  const leave = useLeaveSquad();
  const remove = useRemoveSquadMember(squad.id);
  const block = useBlock();
  const [member, setMember] = useState<SquadMember | null>(null);
  const night = squadNightLabel(squad);

  const later = (fn: () => void) => () => {
    onClose();
    setTimeout(fn, 250);
  };

  const doLeave = async () => {
    const ok = await confirm({
      title: `Leave ${squad.name}?`,
      message: owner && squad.member_count > 1 ? 'The person who has been in the squad longest becomes the owner.' : squad.member_count === 1 ? "You're the last one here, so the squad will be deleted." : "You can be added back by a friend in the squad.",
      confirmLabel: 'Leave squad',
      destructive: true,
    });
    if (!ok) return;
    try {
      await leave.mutateAsync(squad.id);
      router.replace('/squads' as Href);
    } catch (e) {
      toast.error("Couldn't leave", errorMessage(e));
    }
  };

  const doRemove = async (m: SquadMember) => {
    const ok = await confirm({ title: `Remove ${m.user.display_name}?`, message: "They'll lose access to the squad chat and hangouts.", confirmLabel: 'Remove', destructive: true });
    if (!ok) return;
    try {
      await remove.mutateAsync(m.user.id);
      toast.success(`${m.user.display_name} was removed`);
    } catch (e) {
      toast.error("Couldn't remove", errorMessage(e));
    }
  };

  const doBlock = async (m: SquadMember) => {
    const ok = await confirm({
      title: `Block ${m.user.display_name}?`,
      message: "You won't see each other's messages in this squad or anywhere else on Veyvo, and your friendship ends. They aren't told.",
      confirmLabel: 'Block',
      destructive: true,
    });
    if (!ok) return;
    try {
      await block.mutateAsync({ userId: m.user.id, block: true });
      toast.success(`${m.user.display_name} is blocked`);
    } catch (e) {
      toast.error("Couldn't block", errorMessage(e));
    }
  };

  return (
    <>
      <Sheet visible={visible} onClose={onClose} title={`${squad.emoji} ${squad.name}`} scroll>
        <View style={{ gap: space.lg }}>
          {squad.streak_weeks > 0 ? (
            <Text tone="warning" variant="bodyStrong">
              🔥 {squad.streak_weeks} week streak. Hang out together each week to keep it going!
            </Text>
          ) : (
            <Text tone="muted">Hang out together in a squad hangout (two or more of you) each week to build a streak 🔥</Text>
          )}
          <ListGroup>
            <ListRow
              icon={CalendarClock}
              iconTone="primary"
              title="Squad night"
              subtitle={night ?? (owner ? 'Pick a weekly time to hang out' : 'Not set yet')}
              onPress={owner ? later(onNight) : undefined}
            />
            {squad.member_count < MAX_SQUAD_SIZE ? <ListRow icon={UserPlus} iconTone="primary" title="Add a friend" subtitle={`${squad.member_count}/${MAX_SQUAD_SIZE} people`} onPress={later(onAdd)} /> : null}
          </ListGroup>
          <ListGroup title="Members">
            {squad.members.map((m) => (
              <ListRow
                key={m.user.id}
                icon={m.role === 'owner' ? Crown : UsersRound}
                iconTone={m.role === 'owner' ? 'warning' : 'neutral'}
                title={m.user.id === myId ? `${m.user.display_name} (you)` : m.user.display_name}
                subtitle={m.role === 'owner' ? 'Owner' : undefined}
                onPress={m.user.id === myId ? undefined : later(() => setMember(m))}
              />
            ))}
          </ListGroup>
          <ListGroup>
            <ListRow icon={LogOut} title="Leave squad" destructive onPress={later(doLeave)} />
          </ListGroup>
        </View>
      </Sheet>
      <Sheet visible={!!member} onClose={() => setMember(null)} title={member?.user.display_name}>
        {member ? (
          <ListGroup>
            <ListRow icon={UsersRound} iconTone="primary" title="View profile" onPress={() => { setMember(null); router.push(`/user/${member.user.id}`); }} />
            {owner ? <ListRow icon={UserMinus} title="Remove from squad" destructive onPress={() => { setMember(null); setTimeout(() => doRemove(member), 250); }} /> : null}
            <ListRow
              icon={Flag}
              iconTone="warning"
              title={`Report ${member.user.display_name}`}
              subtitle="Confidential. They won't know it was you."
              onPress={() => { setMember(null); setTimeout(() => openReport({ targetType: 'user', targetId: member.user.id, subject: member.user.display_name, blockUserId: member.user.id }), 250); }}
            />
            <ListRow icon={Ban} title={`Block ${member.user.display_name}`} destructive onPress={() => { setMember(null); setTimeout(() => doBlock(member), 250); }} />
          </ListGroup>
        ) : null}
      </Sheet>
    </>
  );
}

function NightSheet({ squad, visible, onClose }: { squad: Squad; visible: boolean; onClose: () => void }) {
  const update = useUpdateSquad(squad.id);
  const current = squad.weekly_day !== null && squad.weekly_time ? utcToLocal(squad.weekly_day, squad.weekly_time) : null;
  const [day, setDay] = useState<number>(current?.day ?? 4);
  const [time, setTime] = useState(current?.time ?? '20:00');
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);


  const save = async (clear = false) => {
    try {
      await update.mutateAsync(clear ? { weekly_day: null, weekly_time: null } : localToUtc(day, time));
      haptic.success();
      toast.success(clear ? 'Squad night turned off' : 'Squad night saved. Everyone gets a reminder 15 minutes before.');
      onClose();
    } catch (e) {
      toast.error("Couldn't save", errorMessage(e));
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Squad night">
      <View style={{ gap: space.lg }}>
        <Text tone="muted">A weekly time for your squad. It's shown in everyone's own time zone.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {WEEKDAYS.map((d, i) => (
            <Chip key={d} label={d.slice(0, 3)} selected={day === i} onPress={() => setDay(i)} />
          ))}
        </ScrollView>
        <Input label="Time (24-hour, your local time)" value={time} onChangeText={setTime} placeholder="20:00" keyboardType="numbers-and-punctuation" maxLength={5} error={time && !valid ? 'Use HH:MM, for example 20:30' : undefined} />
        <Button title="Save squad night" onPress={() => save()} disabled={!valid} loading={update.isPending} fullWidth />
        {current ? <Button title="Turn off squad night" variant="ghost" onPress={() => save(true)} fullWidth /> : null}
      </View>
    </Sheet>
  );
}

function AddSheet({ squad, visible, onClose }: { squad: Squad; visible: boolean; onClose: () => void }) {
  const friends = useFriends();
  const add = useAddSquadMember(squad.id);
  const inSquad = new Set(squad.members.map((m) => m.user.id));
  const options = (friends.data ?? []).filter((f) => !inSquad.has(f.id));

  const doAdd = async (id: string, name: string) => {
    try {
      await add.mutateAsync(id);
      haptic.success();
      toast.success(`${name} joined ${squad.name}`);
      onClose();
    } catch (e) {
      toast.error("Couldn't add", errorMessage(e));
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Add a friend" scroll>
      {friends.isLoading ? (
        <RowSkeleton count={4} />
      ) : options.length === 0 ? (
        <Text tone="muted">All your friends are already here, or you haven't added any friends yet.</Text>
      ) : (
        <View style={{ gap: space.xs }}>
          {options.map((f) => (
            <PressableScale key={f.id} onPress={() => doAdd(f.id, f.display_name)} disabled={add.isPending} style={styles.friend} accessibilityLabel={`Add ${f.display_name}`}>
              <UserPhoto user={f} size={40} />
              <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                {f.display_name}
              </Text>
              <UserPlus size={18} />
            </PressableScale>
          ))}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, minHeight: 60 },
  headerWho: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  faces: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  hangoutBar: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginHorizontal: space.md, marginTop: space.xs, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  dayWrap: { alignItems: 'center', marginVertical: space.md },
  dayPill: { paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.pill },
  bubble: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.xl, minHeight: 38, justifyContent: 'center' },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 24 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  inputWrap: { flex: 1, borderWidth: 1.5, borderRadius: radius.xl, paddingHorizontal: space.md, minHeight: 48, justifyContent: 'center' },
  input: { fontSize: 16, maxHeight: 120, paddingTop: 12, paddingBottom: 12, textAlignVertical: 'center' },
  friend: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52 },
});
