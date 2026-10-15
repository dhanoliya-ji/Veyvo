import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, Ban, Eraser, Flag, Lock, MessageCircleHeart, MoreHorizontal, SendHorizontal, Sparkles, UserRound } from 'lucide-react-native';

import { sendTextRequest, sendVoiceRequest, type ReplyContext } from '@/api/connect-extra';
import { markConversationRead, qk, useBlock, useConversation, useDeleteMessage, useMe, useMessages } from '@/api/hooks';
import type { Conversation, LocalMessage, Page } from '@/api/types';
import { patchCachedMessage, useClearConversation } from '@/api/social-extra';
import { CallButton } from '@/components/CallButton';
import { HangOutSheet } from '@/components/HangOutSheet';
import { ReplyChip, ReplyContextPreview } from '@/components/chat/ReplyContext';
import { VoiceBubble } from '@/components/chat/VoiceBubble';
import { RecordingBar, VoiceRecordButton, type RecordingState } from '@/components/chat/VoiceRecordButton';
import { UserPhoto } from '@/components/UserPhoto';
import { openReport } from '@/components/safety/ReportSheet';
import { EmptyState, ErrorState, IconButton, ListGroup, ListRow, PressableScale, RowSkeleton, Screen, Sheet, Text, confirm } from '@/components/ui';
import { upsertMessage } from '@/hooks/useRealtimeSync';
import { ApiError, errorMessage } from '@/lib/api';
import { clientId, clockTime, dayLabel } from '@/lib/format';
import { formatDuration, isAudioSupported } from '@/lib/audio';
import { haptic } from '@/lib/haptics';
import { realtime } from '@/lib/realtime';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, radius, screenPadding, space } from '@/theme/tokens';

const MAX_LENGTH = 2000;
const GROUP_GAP_MS = 5 * 60_000;
const TYPING_HIDE_MS = 5000;
const TYPING_RESEND_MS = 3000;
const TYPING_IDLE_MS = 4000;

const ts = (iso: string) => new Date(iso).getTime();
const dayKey = (iso: string) => new Date(iso).toDateString();
const isLocal = (m: LocalMessage) => m.id.startsWith('local-');

export default function Chat() {
  const params = useLocalSearchParams<{
    id: string;
    replyType?: string;
    replyPhotoId?: string;
    replyPhotoUrl?: string;
    replyPromptKey?: string;
    replyText?: string;
  }>();
  const id = params.id ?? '';
  const qc = useQueryClient();
  const { colors } = useTheme();
  const me = useMe();
  const myId = me.data?.id;
  const conv = useConversation(id);
  const messages = useMessages(id);
  const del = useDeleteMessage();
  const [outbox, setOutbox] = useState<Record<string, LocalMessage>>({});
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [menu, setMenu] = useState(false);
  const [hangOut, setHangOut] = useState(false);
  const [recording, setRecording] = useState<RecordingState | null>(null);
  // Voice notes waiting to be (re)sent: client id -> local file.
  const voiceFiles = useRef<Record<string, { uri: string; durationMs: number }>>({});

  // ----- "Replying to…" from a profile photo or prompt (route params) -----
  const [reply, setReply] = useState<ReplyContext | null>(null);
  useEffect(() => {
    const type = params.replyType;
    if (type === 'photo' && params.replyPhotoId) {
      setReply({ type: 'photo', photo_id: params.replyPhotoId, photo_url: params.replyPhotoUrl, text: params.replyText?.slice(0, 150) || undefined });
    } else if (type === 'prompt' && params.replyPromptKey) {
      setReply({ type: 'prompt', prompt_key: params.replyPromptKey, text: params.replyText?.slice(0, 150) || undefined });
    }
  }, [params.replyType, params.replyPhotoId, params.replyPhotoUrl, params.replyPromptKey, params.replyText]);
  const mountedAt = useRef(Date.now());
  const myIdRef = useRef(myId);
  myIdRef.current = myId;

  const other = conv.data?.other_user;
  const name = other?.display_name ?? 'them';
  const canMessage = conv.data?.can_message ?? false;
  const ready = !!messages.data && !!myId;

  // ----- Merge the server cache with local outgoing messages (never drop an unsent message) -----
  const items = useMemo(() => {
    const cached = (messages.data?.pages ?? []).flatMap((p) => p.items);
    const out: LocalMessage[] = [];
    const ids = new Set<string>();
    const byClient = new Map<string, number>();
    for (const m of cached) {
      if (ids.has(m.id)) continue;
      ids.add(m.id);
      if (m.sender_id === myId) byClient.set(m.client_id, out.length);
      out.push(m);
    }
    for (const local of Object.values(outbox)) {
      const at = byClient.get(local.client_id);
      if (at === undefined) out.push(local);
      else if (isLocal(out[at])) out[at] = local; // our state is fresher than the cached placeholder
    }
    return out.sort((a, b) => ts(b.created_at) - ts(a.created_at));
  }, [messages.data, outbox, myId]);

  // ----- Mark read on open and whenever a new message from them arrives -----
  const newestIncoming = items.find((m) => m.sender_id !== myId)?.id;
  useEffect(() => {
    if (!id || !ready) return;
    qc.setQueryData<Conversation[]>(qk.conversations, (list) => list?.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)));
    markConversationRead(id)
      .then(() => {
        qc.invalidateQueries({ queryKey: qk.conversations });
        qc.invalidateQueries({ queryKey: qk.home });
      })
      .catch(() => undefined);
  }, [id, ready, newestIncoming, qc]);

  // ----- Incoming typing indicator -----
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const hide = () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      setTyping(false);
    };
    const offs = [
      realtime.on('typing.started', (e) => {
        if (e.data?.conversation_id !== id) return;
        setTyping(true);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTyping(false), TYPING_HIDE_MS);
      }),
      realtime.on('typing.stopped', (e) => {
        if (e.data?.conversation_id === id) hide();
      }),
      realtime.on('message.created', (e) => {
        if (e.data?.conversation_id === id && e.data?.sender_id !== myIdRef.current) hide();
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, [id]);

  // ----- Outgoing typing (throttled) -----
  const amTyping = useRef(false);
  const lastTypingSent = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTyping = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (amTyping.current) realtime.send({ type: 'typing', conversation_id: id, is_typing: false });
    amTyping.current = false;
    lastTypingSent.current = 0;
  }, [id]);
  useEffect(() => stopTyping, [stopTyping]);

  const onChangeText = (t: string) => {
    setText(t);
    if (!canMessage) return;
    if (!t.trim()) {
      stopTyping();
      return;
    }
    const now = Date.now();
    if (!amTyping.current || now - lastTypingSent.current > TYPING_RESEND_MS) {
      if (realtime.send({ type: 'typing', conversation_id: id, is_typing: true })) {
        amTyping.current = true;
        lastTypingSent.current = now;
      }
    }
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  // ----- Optimistic sending -----
  const deliver = useCallback(
    async (local: LocalMessage) => {
      const cid = local.client_id;
      const pendingMsg: LocalMessage = { ...local, pending: true, failed: false };
      setOutbox((o) => ({ ...o, [cid]: pendingMsg }));
      upsertMessage(qc, pendingMsg);
      patchCachedMessage(qc, id, local.sender_id, cid, { pending: true, failed: false });
      try {
        const file = voiceFiles.current[cid];
        const saved =
          local.kind === 'voice' && file
            ? await sendVoiceRequest(id, file.uri, cid, file.durationMs)
            : await sendTextRequest(id, local.content, cid, local.context as ReplyContext | null | undefined);
        delete voiceFiles.current[cid];
        upsertMessage(qc, saved);
        setOutbox((o) => {
          const next = { ...o };
          delete next[cid];
          return next;
        });
        qc.invalidateQueries({ queryKey: qk.conversations });
      } catch (e) {
        haptic.error();
        patchCachedMessage(qc, id, local.sender_id, cid, { pending: false, failed: true });
        setOutbox((o) => ({ ...o, [cid]: { ...local, pending: false, failed: true } }));
        if (e instanceof ApiError && (e.status === 403 || e.status === 422)) {
          toast.error('Message not sent', errorMessage(e));
          qc.invalidateQueries({ queryKey: qk.conversation(id) });
        }
      }
    },
    [id, qc],
  );

  const onSend = () => {
    const content = text.trim();
    if (!content || !ready || !myId || !canMessage || content.length > MAX_LENGTH) return;
    const cid = clientId();
    const local: LocalMessage = { id: `local-${cid}`, conversation_id: id, sender_id: myId, client_id: cid, content, created_at: new Date().toISOString(), pending: true, context: reply };
    setText('');
    setReply(null);
    stopTyping();
    haptic.light();
    deliver(local);
  };

  const onVoiceRecorded = (uri: string, durationMs: number) => {
    if (!ready || !myId || !canMessage) return;
    const cid = clientId();
    voiceFiles.current[cid] = { uri, durationMs };
    const local: LocalMessage = {
      id: `local-${cid}`,
      conversation_id: id,
      sender_id: myId,
      client_id: cid,
      content: '🎙️ Voice note',
      kind: 'voice',
      media_url: uri,
      duration_ms: durationMs,
      created_at: new Date().toISOString(),
      pending: true,
    };
    deliver(local);
  };

  const discard = useCallback(
    (m: LocalMessage) => {
      setOutbox((o) => {
        const next = { ...o };
        delete next[m.client_id];
        return next;
      });
      qc.setQueryData<InfiniteData<Page<LocalMessage>>>(qk.messages(id), (data) =>
        data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((x) => !(isLocal(x) && x.client_id === m.client_id)) })) } : data,
      );
    },
    [id, qc],
  );

  // ----- Long-press actions -----
  const onLongPress = useCallback(
    async (m: LocalMessage) => {
      if (m.content === '' || m.pending) return;
      const mine = m.sender_id === myIdRef.current;
      haptic.medium();
      if (m.failed) {
        const ok = await confirm({ title: 'Delete unsent message?', message: "It hasn't been delivered. You can also tap it to try again.", confirmLabel: 'Delete', destructive: true });
        if (ok) discard(m);
        return;
      }
      if (mine) {
        const ok = await confirm({ title: 'Delete message?', message: 'It will be removed for both of you and show as "Message deleted".', confirmLabel: 'Delete', destructive: true });
        if (!ok) return;
        try {
          await del.mutateAsync(m.id);
          upsertMessage(qc, { ...m, content: '' });
          qc.invalidateQueries({ queryKey: qk.conversations });
        } catch (e) {
          toast.error("Couldn't delete message", errorMessage(e));
        }
      } else {
        openReport({ targetType: 'message', targetId: m.id, subject: 'this message', blockUserId: m.sender_id });
      }
    },
    [del, discard, qc],
  );

  // ----- "Seen" receipt (only when the server shares read times) -----
  const otherRead = conv.data?.other_last_read_at;
  const lastMine = items.find((m) => m.sender_id === myId && !m.pending && !m.failed && !isLocal(m));
  const seenId = otherRead && lastMine && ts(otherRead) >= ts(lastMine.created_at) ? lastMine.id : null;

  const notFound = (conv.error instanceof ApiError && conv.error.status === 404) || (messages.error instanceof ApiError && messages.error.status === 404);

  const header = (
    <ChatHeader
      conversation={conv.data}
      typing={typing}
      onMenu={() => setMenu(true)}
      onHangOut={() => setHangOut(true)}
    />
  );

  if (notFound) {
    return (
      <Screen header={header}>
        <EmptyState icon={MessageCircleHeart} title="Chat not available" message="This conversation doesn't exist or is no longer available." action="Back to messages" onAction={() => router.replace('/messages')} />
      </Screen>
    );
  }

  return (
    <Screen
      padded={false}
      keyboard
      header={header}
      footer={
        conv.data && !canMessage ? (
          <View style={[styles.locked, { backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityLiveRegion="polite">
            <Lock size={18} color={colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">You can't message each other right now</Text>
              <Text variant="caption" tone="muted">
                Messages are open between friends who both allow them. Your history is still here.
              </Text>
            </View>
          </View>
        ) : (
          <View style={{ gap: space.xs }}>
            {reply ? <ReplyChip context={reply} otherName={name} onDismiss={() => setReply(null)} /> : null}
            <Composer
              value={text}
              onChange={onChangeText}
              onSend={onSend}
              disabled={!ready || !conv.data}
              name={name}
              recording={recording}
              onRecordingChange={setRecording}
              onVoiceRecorded={onVoiceRecorded}
            />
          </View>
        )
      }
    >
      {messages.isLoading || (conv.isLoading && !conv.data) ? (
        <View style={{ padding: screenPadding }}>
          <RowSkeleton count={6} />
        </View>
      ) : messages.isError && !messages.data ? (
        <ErrorState error={messages.error} onRetry={() => messages.refetch()} />
      ) : items.length === 0 ? (
        <View style={styles.emptyWrap}>
          {other ? <UserPhoto user={other} size={84} /> : null}
          <Text variant="heading" center>
            Say hi to {name} 👋
          </Text>
          <Text tone="muted" center style={{ maxWidth: 280 }}>
            {canMessage ? 'Start with something you both enjoy — a hangout you shared, or an interest in common.' : "You can't message each other right now."}
          </Text>
          {typing ? <TypingBubble name={name} /> : null}
        </View>
      ) : (
        <FlatList
          inverted
          data={items}
          keyExtractor={(m) => `${m.sender_id}:${m.client_id || m.id}`}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={{ paddingHorizontal: space.md, paddingVertical: space.md }}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (messages.hasNextPage && !messages.isFetchingNextPage) messages.fetchNextPage();
          }}
          ListHeaderComponent={typing ? <TypingBubble name={name} /> : null}
          ListFooterComponent={
            messages.isFetchingNextPage ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: space.lg }} accessibilityLabel="Loading earlier messages" />
            ) : !messages.hasNextPage ? (
              <Text variant="caption" tone="faint" center style={{ marginVertical: space.lg }}>
                This is the start of your chat with {name}.
              </Text>
            ) : null
          }
          renderItem={({ item, index }) => {
            const older = items[index + 1];
            const newer = items[index - 1];
            const sameGroup = (a?: LocalMessage, b?: LocalMessage) =>
              !!a && !!b && a.sender_id === b.sender_id && dayKey(a.created_at) === dayKey(b.created_at) && Math.abs(ts(a.created_at) - ts(b.created_at)) < GROUP_GAP_MS;
            return (
              <MessageRow
                message={item}
                mine={item.sender_id === myId}
                senderName={item.sender_id === myId ? 'You' : name}
                otherName={name}
                showDay={!older || dayKey(older.created_at) !== dayKey(item.created_at)}
                joinOlder={sameGroup(item, older)}
                joinNewer={sameGroup(item, newer)}
                seen={item.id === seenId}
                animate={ts(item.created_at) > mountedAt.current}
                onRetry={deliver}
                onLongPress={onLongPress}
              />
            );
          }}
        />
      )}

      <ChatMenu conversation={conv.data} visible={menu} onClose={() => setMenu(false)} />
      {other ? <HangOutSheet user={other} visible={hangOut} onClose={() => setHangOut(false)} inChat /> : null}
    </Screen>
  );
}

// ---------- Header ----------
function ChatHeader({ conversation, typing, onMenu, onHangOut }: { conversation?: Conversation; typing: boolean; onMenu: () => void; onHangOut: () => void }) {
  const other = conversation?.other_user;
  const online = conversation?.online === true;
  const status = typing ? 'typing…' : online ? 'Online' : other?.username ? `@${other.username}` : undefined;
  return (
    <View style={styles.header}>
      <IconButton icon={ArrowLeft} label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/messages'))} />
      {other ? (
        <PressableScale onPress={() => router.push(`/user/${other.id}`)} style={styles.headerWho} accessibilityLabel={`${other.display_name}${status ? `, ${status}` : ''}. View profile`}>
          <UserPhoto user={other} size={38} online={online} />
          <View style={{ flex: 1 }}>
            <Text variant="subheading" numberOfLines={1}>
              {other.display_name}
            </Text>
            {status ? (
              <Text variant="caption" tone={typing || online ? 'success' : 'muted'} numberOfLines={1}>
                {status}
              </Text>
            ) : null}
          </View>
        </PressableScale>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {other && conversation?.can_message ? <CallButton userId={other.id} name={other.display_name} format="voice" compact /> : null}
      {other && conversation?.can_message ? <IconButton icon={Sparkles} label={`Hang out with ${other.display_name}`} onPress={onHangOut} /> : null}
      {other ? <IconButton icon={MoreHorizontal} label="Chat options" onPress={onMenu} /> : null}
    </View>
  );
}

function ChatMenu({ conversation, visible, onClose }: { conversation?: Conversation; visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const block = useBlock();
  const clear = useClearConversation();
  if (!conversation) return null;
  const other = conversation.other_user;
  const refresh = () => qc.invalidateQueries({ queryKey: qk.conversation(conversation.id) });

  const run = (fn: () => void) => () => {
    onClose();
    setTimeout(fn, 250);
  };

  const doBlock = async () => {
    const ok = await confirm({
      title: `Block ${other.display_name}?`,
      message: "They won't be able to message you, find you or join your hangouts, and your friendship ends. They aren't told.",
      confirmLabel: 'Block',
      destructive: true,
    });
    if (!ok) return;
    try {
      await block.mutateAsync({ userId: other.id, block: true });
      haptic.success();
      toast.success(`${other.display_name} is blocked`);
      refresh();
    } catch (e) {
      toast.error("Couldn't block", errorMessage(e));
    }
  };

  const doClear = async () => {
    const ok = await confirm({ title: 'Clear chat for you?', message: `This hides the history on your side only. ${other.display_name} still sees their copy.`, confirmLabel: 'Clear chat', destructive: true });
    if (!ok) return;
    try {
      await clear.mutateAsync(conversation.id);
      haptic.success();
      toast.success('Chat cleared');
    } catch (e) {
      toast.error("Couldn't clear chat", errorMessage(e));
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={other.display_name}>
      <ListGroup>
        <ListRow icon={UserRound} iconTone="primary" title="View profile" onPress={run(() => router.push(`/user/${other.id}`))} />
        <ListRow icon={Eraser} title="Clear chat for me" subtitle="Only hides your copy" onPress={run(doClear)} />
        <ListRow
          icon={Flag}
          iconTone="warning"
          title={`Report ${other.display_name}`}
          subtitle="Confidential. They won't know it was you."
          onPress={run(() => openReport({ targetType: 'user', targetId: other.id, subject: other.display_name, blockUserId: other.id, onBlocked: refresh }))}
        />
        <ListRow icon={Ban} title={`Block ${other.display_name}`} destructive onPress={run(doBlock)} />
      </ListGroup>
    </Sheet>
  );
}

// ---------- Messages ----------
type RowProps = {
  message: LocalMessage;
  mine: boolean;
  senderName: string;
  otherName: string;
  showDay: boolean;
  joinOlder: boolean;
  joinNewer: boolean;
  seen: boolean;
  animate: boolean;
  onRetry: (m: LocalMessage) => void;
  onLongPress: (m: LocalMessage) => void;
};

const MessageRow = memo(function MessageRow({ message: m, mine, senderName, otherName, showDay, joinOlder, joinNewer, seen, animate, onRetry, onLongPress }: RowProps) {
  const { colors, reduceMotion } = useTheme();
  const deleted = m.content === '';
  const voice = m.kind === 'voice' && !deleted;
  const showMeta = !joinNewer || m.failed || m.pending || seen;
  const big = radius.xl;
  const small = 6;
  const corners = mine
    ? { borderTopRightRadius: joinOlder ? small : big, borderBottomRightRadius: joinNewer ? small : big }
    : { borderTopLeftRadius: joinOlder ? small : big, borderBottomLeftRadius: joinNewer ? small : big };

  const status = m.failed ? 'Not sent' : m.pending ? 'Sending' : seen ? 'Seen' : '';
  const body = deleted ? 'Message deleted' : voice ? `Voice note, ${formatDuration(m.duration_ms ?? 0)}` : m.content;
  const a11y = `${senderName}: ${body}. ${clockTime(m.created_at)}${status ? `. ${status}` : ''}`;

  return (
    <Animated.View entering={animate && !reduceMotion ? FadeInDown.duration(220) : undefined} style={{ marginTop: joinOlder ? 2 : space.sm }}>
      {showDay ? (
        <View style={styles.dayWrap} accessibilityRole="header">
          <View style={[styles.dayPill, { backgroundColor: colors.surfaceAlt }]}>
            <Text variant="tiny" tone="muted">
              {dayLabel(m.created_at)}
            </Text>
          </View>
        </View>
      ) : null}
      <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
        {m.context && !deleted ? <ReplyContextPreview context={m.context} mine={mine} otherName={otherName} /> : null}
        <PressableScale
          onPress={m.failed ? () => onRetry(m) : undefined}
          onLongPress={() => onLongPress(m)}
          delayLongPress={300}
          scaleTo={0.98}
          accessibilityLabel={a11y}
          accessibilityHint={m.failed ? 'Double tap to try sending again' : deleted ? undefined : mine ? 'Long press to delete' : 'Long press to report'}
          style={[
            styles.bubble,
            corners,
            mine
              ? { backgroundColor: m.failed ? colors.dangerSoft : colors.primary, opacity: m.pending ? 0.7 : 1 }
              : { backgroundColor: colors.surfaceAlt },
            deleted && { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
          ]}
        >
          {deleted ? (
            <Text variant="body" tone="faint" style={{ fontStyle: 'italic' }}>
              Message deleted
            </Text>
          ) : voice ? (
            <VoiceBubble url={m.media_url} durationMs={m.duration_ms} mine={mine} failed={m.failed} />
          ) : (
            <Text variant="body" selectable={false} style={{ color: mine && !m.failed ? colors.onPrimary : colors.text }}>
              {m.content}
            </Text>
          )}
        </PressableScale>
        {showMeta ? (
          <View style={[styles.meta, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
            {m.failed ? (
              <PressableScale onPress={() => onRetry(m)} hitSlop={10} style={styles.retry} accessibilityLabel="Not sent. Tap to retry">
                <AlertCircle size={13} color={colors.danger} />
                <Text variant="caption" tone="danger">
                  Not sent · Tap to retry
                </Text>
              </PressableScale>
            ) : (
              <Text variant="caption" tone="faint">
                {m.pending ? 'Sending…' : clockTime(m.created_at)}
                {seen ? ' · Seen' : ''}
              </Text>
            )}
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
});

function TypingBubble({ name }: { name: string }) {
  const { colors, reduceMotion } = useTheme();
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(160)}
      exiting={reduceMotion ? undefined : FadeOut.duration(160)}
      style={[styles.typing, { backgroundColor: colors.surfaceAlt }]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${name} is typing`}
    >
      <View style={styles.dots}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.dot, { backgroundColor: colors.textMuted, opacity: 0.4 + i * 0.25 }]} />
        ))}
      </View>
      <Text variant="caption" tone="muted">
        {name} is typing
      </Text>
    </Animated.View>
  );
}

// ---------- Composer ----------
type ComposerProps = {
  value: string;
  onChange: (t: string) => void;
  onSend: () => void;
  disabled: boolean;
  name: string;
  recording: RecordingState | null;
  onRecordingChange: (state: RecordingState | null) => void;
  onVoiceRecorded: (uri: string, durationMs: number) => void;
};

function Composer({ value, onChange, onSend, disabled, name, recording, onRecordingChange, onVoiceRecorded }: ComposerProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const trimmed = value.trim();
  const near = value.length > MAX_LENGTH - 200;
  const voiceAvailable = isAudioSupported();
  return (
    <View style={{ gap: space.xs }}>
      <View style={styles.composer}>
        {recording ? (
          <RecordingBar state={recording} />
        ) : (
          <View style={[styles.inputWrap, { backgroundColor: colors.surface, borderColor: focused ? colors.primary : colors.border }]}>
            <TextInput
              value={value}
              onChangeText={onChange}
              placeholder={`Message ${name}`}
              placeholderTextColor={colors.textFaint}
              selectionColor={colors.primary}
              multiline
              maxLength={MAX_LENGTH}
              editable={!disabled}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              accessibilityLabel={`Message ${name}`}
              style={[styles.input, { color: colors.text, fontFamily: fonts.regular }]}
            />
          </View>
        )}
        {trimmed || !voiceAvailable ? (
          <IconButton icon={SendHorizontal} variant="primary" label="Send message" disabled={disabled || !trimmed} onPress={onSend} size={48} />
        ) : (
          <VoiceRecordButton disabled={disabled} onRecordingChange={onRecordingChange} onRecorded={onVoiceRecorded} />
        )}
      </View>
      {near ? (
        <Text variant="caption" tone={value.length >= MAX_LENGTH ? 'danger' : 'faint'} style={{ textAlign: 'right', marginRight: 60 }}>
          {value.length}/{MAX_LENGTH}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, minHeight: 60 },
  headerWho: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  dayWrap: { alignItems: 'center', marginVertical: space.md },
  dayPill: { paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.pill },
  bubble: { maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.xl, minHeight: 38, justifyContent: 'center' },
  meta: { flexDirection: 'row', marginTop: 3, marginHorizontal: space.xs },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 24 },
  typing: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.xl, marginTop: space.sm },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  inputWrap: { flex: 1, borderWidth: 1.5, borderRadius: radius.xl, paddingHorizontal: space.md, minHeight: 48, justifyContent: 'center' },
  input: { fontSize: 16, maxHeight: 120, paddingTop: 12, paddingBottom: 12, textAlignVertical: 'center' },
  locked: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
