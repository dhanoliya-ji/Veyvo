import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { ArrowLeft, Ban, Flag, Handshake, Mail, MoreHorizontal, PenLine, Send, Truck, XCircle } from 'lucide-react-native';

import { LETTER_MAX, LETTER_MIN, arrivesIn, useBefriendPal, useEndPenPal, useLetterThread, useSendLetter, type Letter } from '@/api/letters-extra';
import { UserPhoto } from '@/components/UserPhoto';
import { openReport } from '@/components/safety/ReportSheet';
import { Button, EmptyState, ErrorState, IconButton, ListGroup, ListRow, PressableScale, RowSkeleton, Screen, Sheet, Text, confirm } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, radius, screenPadding, space } from '@/theme/tokens';

// Warm "paper" tones that read well in both themes.
const PAPER = { light: '#FBF6EA', lightBorder: '#EADFC4', ink: '#3B3326', inkMuted: '#7D6F57' };

const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function LetterThread() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const thread = useLetterThread(id);
  const befriend = useBefriendPal(id);
  const [compose, setCompose] = useState(false);
  const [menu, setMenu] = useState(false);
  const pp = thread.data?.pen_pal;
  const name = pp?.pal.display_name ?? 'your pen pal';

  const header = (
    <View style={styles.header}>
      <IconButton icon={ArrowLeft} label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/letters' as Href))} />
      {pp ? (
        <View style={styles.headerWho} accessibilityLabel={`Pen pal ${name}`}>
          <UserPhoto user={pp.pal} size={38} />
          <View style={{ flex: 1 }}>
            <Text variant="subheading" numberOfLines={1}>
              {name}
            </Text>
            <Text variant="caption" tone="muted">
              {pp.status === 'friends' ? 'Pen pal · Friends' : 'Pen pal'}
            </Text>
          </View>
        </View>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {pp ? <IconButton icon={MoreHorizontal} label="Pen pal options" onPress={() => setMenu(true)} /> : null}
    </View>
  );

  if (thread.error instanceof ApiError && thread.error.status === 404) {
    return (
      <Screen header={header}>
        <EmptyState icon={Mail} title="Pen pal not available" message="This pen pal connection has ended." action="Back to Slow Letters" onAction={() => router.replace('/letters' as Href)} />
      </Screen>
    );
  }

  const onBefriend = async () => {
    try {
      const r = await befriend.mutateAsync();
      haptic.success();
      toast.success(r.status === 'friends' ? `You and ${name} are friends now 🎉` : `We'll tell ${name} you'd like to be friends.`);
    } catch (e) {
      toast.error("Couldn't send", errorMessage(e));
    }
  };

  const canWrite = !!pp && !pp.outgoing_arrives_at;

  return (
    <Screen
      padded={false}
      header={header}
      footer={
        pp ? (
          canWrite ? (
            <Button title={`Write to ${name}`} icon={PenLine} onPress={() => setCompose(true)} fullWidth />
          ) : (
            <View style={[styles.transit, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Truck size={18} color={colors.primary} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                Your letter is on its way — {arrivesIn(pp.outgoing_arrives_at as string)}
              </Text>
            </View>
          )
        ) : undefined
      }
    >
      {thread.isLoading ? (
        <View style={{ padding: screenPadding }}>
          <RowSkeleton count={4} />
        </View>
      ) : thread.isError || !thread.data || !pp ? (
        <ErrorState error={thread.error} onRetry={() => thread.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: screenPadding, gap: space.lg, paddingBottom: space.huge }}>
          {thread.data.letters.length === 0 && !pp.incoming_arrives_at ? (
            <EmptyState compact icon={Mail} title={`Say hello to ${name}`} message="Tell them a little about your day, your week, or something you love. Take your time — that's the point." />
          ) : null}
          {thread.data.letters.map((l) => (
            <LetterCard key={l.id} letter={l} name={name} />
          ))}
          {pp.incoming_arrives_at ? (
            <View style={[styles.incoming, { borderColor: colors.borderStrong }]} accessibilityLiveRegion="polite">
              <Mail size={20} color={colors.primary} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                A letter from {name} is on its way — {arrivesIn(pp.incoming_arrives_at)}
              </Text>
            </View>
          ) : null}
          {pp.status === 'active' ? (
            <View style={[styles.befriend, { backgroundColor: colors.surface }]}>
              <Handshake size={20} color={colors.success} />
              <View style={{ flex: 1, gap: 2 }}>
                {pp.asked_to_befriend ? (
                  <Text variant="bodyStrong">You asked to be friends. Waiting for {name}.</Text>
                ) : pp.can_befriend ? (
                  <Text variant="bodyStrong">{pp.pal_asked_to_befriend ? `${name} would like to be friends!` : 'You can become friends now'}</Text>
                ) : (
                  <Text variant="bodyStrong">Become friends after 3 letters each</Text>
                )}
                {!pp.can_befriend ? (
                  <Text variant="caption" tone="muted">
                    {pp.letters_needed_to_befriend} more {pp.letters_needed_to_befriend === 1 ? 'letter' : 'letters'} to go. Until then, letters are the only way to talk.
                  </Text>
                ) : null}
              </View>
              {pp.can_befriend && !pp.asked_to_befriend ? <Button title="Become friends" size="sm" variant="accent" onPress={onBefriend} loading={befriend.isPending} /> : null}
            </View>
          ) : null}
        </ScrollView>
      )}

      {pp ? <ComposeSheet id={id} name={name} visible={compose} onClose={() => setCompose(false)} /> : null}
      {pp ? <PalMenu id={id} name={name} visible={menu} onClose={() => setMenu(false)} /> : null}
    </Screen>
  );
}

function LetterCard({ letter: l, name }: { letter: Letter; name: string }) {
  const { colors } = useTheme();
  const onLongPress = () => {
    if (l.mine || l.removed) return;
    haptic.medium();
    openReport({ targetType: 'letter', targetId: l.id, subject: 'this letter' });
  };
  return (
    <PressableScale
      onLongPress={onLongPress}
      delayLongPress={400}
      scaleTo={0.99}
      accessibilityLabel={`${l.mine ? 'Your letter' : `Letter from ${name}`}. ${l.removed ? 'Removed' : l.content}`}
      accessibilityHint={!l.mine && !l.removed ? 'Long press to report' : undefined}
      style={[
        styles.paper,
        { backgroundColor: PAPER.light, borderColor: PAPER.lightBorder, alignSelf: l.mine ? 'flex-end' : 'flex-start', shadowColor: colors.shadow },
      ]}
    >
      <Text variant="caption" style={{ color: PAPER.inkMuted }}>
        {l.mine ? 'You wrote' : `${name} wrote`} · {longDate(l.sent_at)}
      </Text>
      {l.removed ? (
        <Text style={{ color: PAPER.inkMuted, fontStyle: 'italic' }}>This letter was removed.</Text>
      ) : (
        <Text style={[styles.ink, { color: PAPER.ink }]} selectable>
          {l.content}
        </Text>
      )}
      {l.mine ? (
        <Text variant="caption" style={{ color: PAPER.inkMuted, textAlign: 'right' }}>
          {l.delivered ? 'Delivered' : `On its way — ${arrivesIn(l.deliver_at)}`}
        </Text>
      ) : null}
    </PressableScale>
  );
}

function ComposeSheet({ id, name, visible, onClose }: { id: string; name: string; visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const send = useSendLetter(id);
  const [text, setText] = useState('');
  const length = text.trim().length;
  const ok = length >= LETTER_MIN && length <= LETTER_MAX;

  const onSend = async () => {
    try {
      const letter = await send.mutateAsync(text.trim());
      haptic.success();
      setText('');
      onClose();
      toast.success(`Letter sent ✉️ It ${arrivesIn(letter.deliver_at)}.`);
    } catch (e) {
      toast.error("Couldn't send your letter", errorMessage(e));
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={`Dear ${name},`}>
      <View style={{ gap: space.md }}>
        <View style={[styles.composeWrap, { backgroundColor: PAPER.light, borderColor: PAPER.lightBorder }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Take your time. Tell them about your day, a place you love, a song on repeat…"
            placeholderTextColor={PAPER.inkMuted}
            selectionColor={colors.primary}
            multiline
            maxLength={LETTER_MAX}
            accessibilityLabel={`Letter to ${name}`}
            style={[styles.composeInput, { color: PAPER.ink, fontFamily: fonts.regular }]}
          />
        </View>
        <Text variant="caption" tone={length > 0 && length < LETTER_MIN ? 'warning' : 'faint'} style={{ textAlign: 'right' }}>
          {length < LETTER_MIN ? `${LETTER_MIN - length} more characters to go · ` : ''}
          {text.length}/{LETTER_MAX}
        </Text>
        <Text variant="caption" tone="muted">
          Letters arrive after a few hours, longer the farther apart you are. You can write again once this one arrives.
        </Text>
        <Button title="Send letter" icon={Send} onPress={onSend} disabled={!ok} loading={send.isPending} fullWidth />
      </View>
    </Sheet>
  );
}

function PalMenu({ id, name, visible, onClose }: { id: string; name: string; visible: boolean; onClose: () => void }) {
  const end = useEndPenPal();
  const later = (fn: () => void) => () => {
    onClose();
    setTimeout(fn, 250);
  };

  const doEnd = async (block: boolean) => {
    const ok = await confirm({
      title: block ? `Block ${name}?` : `End pen pal with ${name}?`,
      message: block
        ? "Your letters end for both of you and you'll never be matched again. They aren't told it was a block."
        : 'Your letters disappear for both of you and you can find a new pen pal.',
      confirmLabel: block ? 'Block' : 'End pen pal',
      destructive: true,
    });
    if (!ok) return;
    try {
      await end.mutateAsync({ id, block });
      haptic.success();
      toast.success(block ? `${name} is blocked` : 'Pen pal ended');
      router.replace('/letters' as Href);
    } catch (e) {
      toast.error("Couldn't do that", errorMessage(e));
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={name}>
      <ListGroup>
        <ListRow
          icon={Flag}
          iconTone="warning"
          title="Report a letter"
          subtitle="Long-press any letter from them to report it. Confidential."
          onPress={later(() => toast.show({ title: 'Long-press the letter you want to report.', tone: 'info' }))}
        />
        <ListRow icon={XCircle} title="End pen pal" onPress={later(() => doEnd(false))} />
        <ListRow icon={Ban} title={`Block ${name}`} destructive onPress={later(() => doEnd(true))} />
      </ListGroup>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, minHeight: 60 },
  headerWho: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  paper: {
    width: '92%',
    padding: space.lg,
    gap: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  ink: { fontSize: 16, lineHeight: 25 },
  incoming: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed' },
  befriend: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg },
  transit: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  composeWrap: { borderWidth: 1, borderRadius: radius.md, padding: space.md, minHeight: 220 },
  composeInput: { fontSize: 16, lineHeight: 25, minHeight: 200, maxHeight: 360, textAlignVertical: 'top' },
});
