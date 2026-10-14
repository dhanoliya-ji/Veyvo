import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Lock, MessageCircle, Send } from 'lucide-react-native';

import type { RoomMessage } from '@/api/types';
import { UserPhoto } from '@/components/UserPhoto';
import { openReport } from '@/components/safety/ReportSheet';
import { IconButton, PressableScale, Skeleton, Text } from '@/components/ui';
import { clockTime } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, radius, space } from '@/theme/tokens';

type Props = {
  messages: RoomMessage[] | undefined;
  loading: boolean;
  meId: string | undefined;
  /** When set, the composer is replaced by this notice (e.g. focus time in study rooms). */
  lockedReason: string | null;
  onSend: (content: string) => Promise<boolean>;
};

export function ChatPanel({ messages, loading, meId, lockedReason, onSend }: Props) {
  const { colors } = useTheme();
  const list = useRef<FlatList<RoomMessage>>(null);
  const nearBottom = useRef(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const count = messages?.length ?? 0;

  useEffect(() => {
    if (count && nearBottom.current) requestAnimationFrame(() => list.current?.scrollToEnd({ animated: true }));
  }, [count]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    nearBottom.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 80;
  };

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    nearBottom.current = true;
    const ok = await onSend(content);
    if (ok) setDraft('');
    setSending(false);
  };

  return (
    <View style={{ flex: 1 }}>
      {loading ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton width="60%" height={14} />
          <Skeleton width="80%" height={14} />
          <Skeleton width="45%" height={14} />
        </View>
      ) : count === 0 ? (
        <View style={styles.empty}>
          <MessageCircle size={22} color={colors.textFaint} />
          <Text variant="caption" tone="muted" center>
            No messages yet. Say hi, everyone can see the chat.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={list}
          data={messages}
          keyExtractor={(m) => m.id}
          onScroll={onScroll}
          scrollEventThrottle={64}
          contentContainerStyle={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.sm }}
          onContentSizeChange={() => nearBottom.current && list.current?.scrollToEnd({ animated: false })}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item, index }) => {
            const prev = messages![index - 1];
            const grouped = prev && prev.sender.id === item.sender.id && new Date(item.created_at).getTime() - new Date(prev.created_at).getTime() < 120_000;
            const mine = item.sender.id === meId;
            return (
              <PressableScale
                scaleTo={0.99}
                delayLongPress={350}
                onLongPress={
                  mine
                    ? undefined
                    : () => openReport({ targetType: 'room_message', targetId: item.id, subject: `this message from ${item.sender.display_name}`, blockUserId: item.sender.id })
                }
                accessibilityLabel={`${item.sender.display_name}${mine ? ' (you)' : ''}: ${item.content}. ${clockTime(item.created_at)}`}
                accessibilityHint={mine ? undefined : 'Long press to report'}
                accessibilityActions={mine ? undefined : [{ name: 'longpress', label: 'Report message' }]}
                onAccessibilityAction={
                  mine
                    ? undefined
                    : () => openReport({ targetType: 'room_message', targetId: item.id, subject: `this message from ${item.sender.display_name}`, blockUserId: item.sender.id })
                }
                style={styles.msg}
              >
                <View style={{ width: 30 }}>{grouped ? null : <UserPhoto user={item.sender} size={30} />}</View>
                <View style={{ flex: 1 }}>
                  {grouped ? null : (
                    <View style={styles.msgHead}>
                      <Text variant="label" style={{ color: mine ? colors.primary : colors.text }} numberOfLines={1}>
                        {mine ? 'You' : item.sender.display_name}
                      </Text>
                      <Text variant="tiny" tone="faint">
                        {clockTime(item.created_at)}
                      </Text>
                    </View>
                  )}
                  <Text variant="body">{item.content}</Text>
                </View>
              </PressableScale>
            );
          }}
        />
      )}
      {lockedReason ? (
        <View style={[styles.locked, { backgroundColor: colors.surfaceAlt }]} accessibilityLiveRegion="polite">
          <Lock size={14} color={colors.textMuted} />
          <Text variant="label" tone="muted">
            {lockedReason}
          </Text>
        </View>
      ) : (
        <View style={[styles.composer, { borderTopColor: colors.border }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message the room"
            placeholderTextColor={colors.textFaint}
            selectionColor={colors.primary}
            maxLength={500}
            multiline
            accessibilityLabel="Message the room"
            style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt, fontFamily: fonts.regular }]}
            onSubmitEditing={send}
            blurOnSubmit={false}
            returnKeyType="send"
            submitBehavior="submit"
          />
          <IconButton icon={Send} label="Send message" variant={draft.trim() ? 'primary' : 'filled'} onPress={send} disabled={!draft.trim() || sending} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  msg: { flexDirection: 'row', gap: space.sm },
  msgHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  locked: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: 44, marginHorizontal: space.md, marginBottom: space.sm, borderRadius: radius.md },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 44, maxHeight: 110, borderRadius: radius.lg, paddingHorizontal: space.md, paddingTop: 11, paddingBottom: 11, fontSize: 15 },
});
