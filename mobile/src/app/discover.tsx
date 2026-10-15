import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { BadgeCheck, Ban, Check, Flag, Hand, MessageSquarePlus, MoreHorizontal, PartyPopper, RotateCcw, SearchX, SlidersHorizontal, X } from 'lucide-react-native';

import { useBlock, useInterests, useMe } from '@/api/hooks';
import { useDeck, useSwipe, useUndoPass, type CommentContext, type DeckFilters, type DiscoverCard } from '@/api/discover-extra';
import { MatchModalHost, showMatch } from '@/components/discover/MatchModal';
import { openReport } from '@/components/safety/ReportSheet';
import { Badge, Button, Chip, EmptyState, ErrorState, Header, IconButton, Input, ListGroup, ListRow, PressableScale, Screen, Sheet, Skeleton, Text, confirm } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { clockTime, VIBE_LABELS } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const SWIPE_THRESHOLD = 110;

type Note = { comment: string; context: CommentContext };
type NoteTarget = { card: DiscoverCard; context: CommentContext; label: string; photoUrl?: string | null };

export default function Discover() {
  const { colors, reduceMotion } = useTheme();
  const { width } = useWindowDimensions();
  const [filters, setFilters] = useState<DeckFilters>({});
  const deck = useDeck(filters);
  const swipe = useSwipe();
  const undo = useUndoPass();
  const block = useBlock();

  const [queue, setQueue] = useState<DiscoverCard[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [lastPass, setLastPass] = useState<DiscoverCard | null>(null);
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [menuCard, setMenuCard] = useState<DiscoverCard | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // A fresh deck from the server replaces the local queue.
  useEffect(() => {
    if (!deck.data) return;
    setQueue(deck.data.cards);
    setRemaining(deck.data.remaining_today);
    setLastPass(null);
  }, [deck.data]);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const flinging = useRef(false);
  const pending = useRef<{ card: DiscoverCard; note?: Note } | null>(null);

  const removeCard = useCallback((id: string) => setQueue((q) => q.filter((c) => c.user.id !== id)), []);

  const commit = useCallback(
    async (card: DiscoverCard, decision: 'like' | 'pass', note?: Note) => {
      removeCard(card.user.id);
      translateX.value = 0;
      translateY.value = 0;
      setLastPass(decision === 'pass' ? card : null);
      setRemaining((r) => (r == null ? r : Math.max(0, r - 1)));
      try {
        const res = await swipe.mutateAsync({ target_id: card.user.id, decision, comment: note?.comment, comment_context: note?.context });
        setRemaining(res.remaining_today);
        if (res.matched && res.friend) showMatch({ friend: res.friend, conversation_id: res.conversation_id });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'daily_limit_reached') {
          setRemaining(0);
          setQueue([]);
          return;
        }
        // Gone (blocked, hidden themselves) or already decided: just move on.
        if (e instanceof ApiError && (e.status === 404 || e.status === 409)) return;
        toast.error("That didn't go through", errorMessage(e));
        setQueue((q) => [card, ...q.filter((c) => c.user.id !== card.user.id)]);
        setRemaining((r) => (r == null ? r : r + 1));
        setLastPass(null);
      }
    },
    [removeCard, swipe, translateX, translateY],
  );

  const onFlung = useCallback(
    (decision: 'like' | 'pass') => {
      const p = pending.current;
      pending.current = null;
      flinging.current = false;
      if (p) commit(p.card, decision, p.note);
    },
    [commit],
  );

  const fling = useCallback(
    (decision: 'like' | 'pass', note?: Note) => {
      const card = queue[0];
      if (!card || flinging.current) return;
      flinging.current = true;
      pending.current = { card, note };
      haptic.light();
      const toX = (decision === 'like' ? 1 : -1) * width * 1.4;
      translateX.value = withTiming(toX, { duration: reduceMotion ? 0 : 230 }, (done) => {
        if (done) runOnJS(onFlung)(decision);
      });
    },
    [queue, width, reduceMotion, translateX, onFlung],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-14, 14])
        .onUpdate((e) => {
          translateX.value = e.translationX;
          translateY.value = e.translationY * 0.2;
        })
        .onEnd((e) => {
          const projected = e.translationX + e.velocityX * 0.15;
          if (Math.abs(projected) > SWIPE_THRESHOLD) {
            runOnJS(fling)(projected > 0 ? 'like' : 'pass');
          } else {
            translateX.value = withSpring(0, { damping: 16 });
            translateY.value = withSpring(0, { damping: 16 });
          }
        }),
    [fling, translateX, translateY],
  );

  const topStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${interpolate(translateX.value, [-width, 0, width], [-10, 0, 10], Extrapolation.CLAMP)}deg` },
    ],
  }));
  const nextStyle = useAnimatedStyle(() => {
    const p = Math.min(Math.abs(translateX.value) / SWIPE_THRESHOLD, 1);
    return { transform: [{ scale: 0.94 + 0.06 * p }], opacity: 0.6 + 0.4 * p };
  });
  const likeStamp = useAnimatedStyle(() => ({ opacity: interpolate(translateX.value, [20, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP) }));
  const passStamp = useAnimatedStyle(() => ({ opacity: interpolate(translateX.value, [-SWIPE_THRESHOLD, -20], [1, 0], Extrapolation.CLAMP) }));

  const doUndo = async () => {
    const card = lastPass;
    if (!card) return;
    try {
      const res = await undo.mutateAsync();
      setRemaining(res.remaining_today);
      setLastPass(null);
      if (res.undone) {
        haptic.tap();
        setQueue((q) => [card, ...q.filter((c) => c.user.id !== card.user.id)]);
      }
    } catch (e) {
      toast.error("Couldn't bring them back", errorMessage(e));
    }
  };

  const blockCard = async (card: DiscoverCard) => {
    const ok = await confirm({
      title: `Block ${card.user.display_name}?`,
      message: "They won't be able to find you, message you or join your hangouts. They aren't told.",
      confirmLabel: 'Block',
      destructive: true,
    });
    if (!ok) return;
    try {
      await block.mutateAsync({ userId: card.user.id, block: true });
      removeCard(card.user.id);
      haptic.success();
      toast.success(`${card.user.display_name} is blocked`);
    } catch (e) {
      toast.error("Couldn't block", errorMessage(e));
    }
  };

  const filtersOn = !!filters.verifiedOnly || !!filters.interestId;
  const resetsAt = deck.data?.resets_at;
  const top = queue[0];
  const next = queue[1];

  let body: ReactNode;
  if (deck.isLoading) {
    body = <Skeleton height={520} rounded={radius.xxl} />;
  } else if (deck.isError) {
    body = <ErrorState error={deck.error} onRetry={() => deck.refetch()} />;
  } else if (!top) {
    const caughtUp = remaining === 0 || !filtersOn;
    body = caughtUp ? (
      <EmptyState
        icon={PartyPopper}
        title="You're all caught up"
        message={`New people tomorrow at ${resetsAt ? clockTime(resetsAt) : 'midnight'}. Meanwhile, your new friends are a message away.`}
        action="Find a hangout"
        onAction={() => router.push('/(tabs)/hangouts' as Href)}
        secondaryAction={remaining ? 'Check again' : undefined}
        onSecondaryAction={() => deck.refetch()}
      />
    ) : (
      <EmptyState icon={SearchX} title="No one matches these filters" message="Try a different interest, or show everyone." action="Clear filters" onAction={() => setFilters({})} />
    );
  } else {
    body = (
      <View style={{ flex: 1 }}>
        {next ? (
          <Animated.View key={next.user.id} style={[StyleSheet.absoluteFill, nextStyle]} pointerEvents="none">
            <SwipeCard card={next} />
          </Animated.View>
        ) : null}
        <GestureDetector gesture={pan}>
          <Animated.View key={top.user.id} style={[StyleSheet.absoluteFill, topStyle]}>
            <SwipeCard
              card={top}
              onMenu={() => setMenuCard(top)}
              onNote={(context, label, photoUrl) => setNoteTarget({ card: top, context, label, photoUrl })}
            />
            <Animated.View style={[styles.stamp, styles.stampLike, { borderColor: colors.success }, likeStamp]} pointerEvents="none">
              <Text variant="heading" style={{ color: colors.success }}>
                👋 BE FRIENDS
              </Text>
            </Animated.View>
            <Animated.View style={[styles.stamp, styles.stampPass, { borderColor: colors.textMuted }, passStamp]} pointerEvents="none">
              <Text variant="heading" style={{ color: colors.textMuted }}>
                SKIP
              </Text>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>
    );
  }

  return (
    <Screen
      header={
        <Header
          title="Friend Swipe"
          subtitle={remaining != null ? `${remaining} left today · Friends, not dating` : 'Friends, not dating'}
          right={
            <>
              {lastPass ? <IconButton icon={RotateCcw} label="Bring back the last person you skipped" onPress={doUndo} disabled={undo.isPending} /> : null}
              <IconButton icon={SlidersHorizontal} label="Filters" active={filtersOn} onPress={() => setFiltersOpen(true)} />
            </>
          }
        />
      }
    >
      <View style={{ flex: 1, paddingTop: space.sm }}>{body}</View>

      {top ? (
        <View style={styles.actions}>
          <RoundAction icon={X} label="Skip" onPress={() => fling('pass')} tone="muted" />
          <RoundAction icon={Hand} label="Be friends" onPress={() => fling('like')} tone="primary" big />
        </View>
      ) : null}

      <NoteSheet target={noteTarget} onClose={() => setNoteTarget(null)} onSend={(note) => {
        setNoteTarget(null);
        // Let the sheet close before the card flies away.
        setTimeout(() => fling('like', note), 220);
      }} />
      <CardMenu
        card={menuCard}
        onClose={() => setMenuCard(null)}
        onReport={(card) => openReport({ targetType: 'user', targetId: card.user.id, subject: `${card.user.display_name}'s profile`, blockUserId: card.user.id, onBlocked: () => removeCard(card.user.id) })}
        onBlock={blockCard}
      />
      <FiltersSheet visible={filtersOpen} value={filters} onClose={() => setFiltersOpen(false)} onApply={(f) => { setFilters(f); setFiltersOpen(false); }} />
      <MatchModalHost local />
    </Screen>
  );
}

// ---------- Card ----------
function SwipeCard({ card, onMenu, onNote }: { card: DiscoverCard; onMenu?: () => void; onNote?: (context: CommentContext, label: string, photoUrl?: string | null) => void }) {
  const { colors } = useTheme();
  const interactive = !!onNote;
  const common = new Set(card.common_interests.map((i) => i.id));
  const interests = [...card.interests].sort((a, b) => Number(common.has(b.id)) - Number(common.has(a.id)));

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, shadowColor: colors.shadow }]}>
      <ScrollView showsVerticalScrollIndicator={false} scrollEnabled={interactive} contentContainerStyle={{ paddingBottom: space.xl }}>
        <PhotoCarousel card={card} onMenu={onMenu} onNote={onNote} />
        <View style={{ padding: space.lg, gap: space.lg }}>
          {card.common_ground.length ? (
            <View style={{ gap: space.sm }}>
              <Text variant="label" tone="muted">
                You both
              </Text>
              <View style={styles.wrap}>
                {card.common_ground.map((c) => (
                  <Chip key={c} label={c} selected tone="success" size="sm" />
                ))}
              </View>
            </View>
          ) : null}

          {card.bio ? <Text style={{ lineHeight: 23 }}>{card.bio}</Text> : null}

          {card.prompts.map((p) => (
            <PressableScale
              key={p.key}
              disabled={!interactive}
              scaleTo={0.985}
              onPress={() => onNote?.({ type: 'prompt', prompt_key: p.key }, `${p.text} ${p.answer}`)}
              accessibilityLabel={`${p.text} ${p.answer}`}
              accessibilityHint="Add a note and say you'd like to be friends"
              style={[styles.prompt, { backgroundColor: colors.surfaceAlt }]}
            >
              <Text variant="caption" tone="muted">
                {p.text}
              </Text>
              <Text variant="subheading">{p.answer}</Text>
              {interactive ? (
                <View style={styles.noteHint}>
                  <MessageSquarePlus size={14} color={colors.primary} />
                  <Text variant="tiny" tone="primary">
                    Add a note
                  </Text>
                </View>
              ) : null}
            </PressableScale>
          ))}

          {interests.length ? (
            <View style={{ gap: space.sm }}>
              <Text variant="label" tone="muted">
                Interests
              </Text>
              <View style={styles.wrap}>
                {interests.map((i) => (
                  <Chip key={i.id} label={i.name} selected={common.has(i.id)} icon={common.has(i.id) ? Check : undefined} tone="success" size="sm" />
                ))}
              </View>
            </View>
          ) : null}

          <Text variant="caption" tone="faint" center>
            Friends, not dating. They'll only know you said hi if they say hi too.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function PhotoCarousel({ card, onMenu, onNote }: { card: DiscoverCard; onMenu?: () => void; onNote?: (context: CommentContext, label: string, photoUrl?: string | null) => void }) {
  const { colors } = useTheme();
  const [index, setIndex] = useState(0);
  const photos = card.photos;
  const photo = photos[Math.min(index, photos.length - 1)];
  const name = card.user.display_name;

  const note = () => photo && onNote?.({ type: 'photo', photo_id: photo.id }, `${name}'s photo`, photo.url);

  return (
    <View style={[styles.photo, { backgroundColor: colors.surfaceAlt }]}>
      {photo?.url ? (
        <Image source={{ uri: photo.url }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={120} accessibilityLabel={`${name}, photo ${index + 1} of ${photos.length}`} />
      ) : card.user.photo_url ? (
        <Image source={{ uri: card.user.photo_url }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
      ) : null}

      {/* Tap left / right to flip through photos; long press to add a note. */}
      <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
        <Pressable style={{ flex: 1 }} onPress={() => setIndex((i) => Math.max(0, i - 1))} onLongPress={note} accessibilityLabel="Previous photo" disabled={!onNote} />
        <Pressable style={{ flex: 1 }} onPress={() => setIndex((i) => Math.min(photos.length - 1, i + 1))} onLongPress={note} accessibilityLabel="Next photo" disabled={!onNote} />
      </View>

      {photos.length > 1 ? (
        <View style={styles.segments} pointerEvents="none">
          {photos.map((p, i) => (
            <View key={p.id} style={[styles.segment, { backgroundColor: i === index ? '#fff' : 'rgba(255,255,255,0.4)' }]} />
          ))}
        </View>
      ) : null}

      {card.daily_pick ? (
        <View style={styles.pick} pointerEvents="none">
          <Badge label="⭐ Daily pick" tone="warning" />
        </View>
      ) : null}
      {onMenu ? <IconButton icon={MoreHorizontal} label={`More options for ${name}`} size={38} variant="filled" onPress={onMenu} style={styles.menu} /> : null}

      <View style={styles.caption} pointerEvents="box-none">
        <View style={{ flex: 1 }} pointerEvents="none">
          <View style={styles.nameRow}>
            <Text variant="title" style={styles.onPhoto} numberOfLines={1}>
              {name}
            </Text>
            {card.verified ? <BadgeCheck size={22} color="#fff" fill={colors.primary} accessibilityLabel="Verified" /> : null}
          </View>
          <Text variant="caption" style={styles.onPhoto} numberOfLines={1}>
            {[card.user.username ? `@${card.user.username}` : null, card.vibe ? VIBE_LABELS[card.vibe] ?? null : null, card.mutual_friend_count ? `${card.mutual_friend_count} mutual` : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        {onNote && photo ? <IconButton icon={MessageSquarePlus} label={`Add a note about ${name}'s photo`} size={40} variant="filled" onPress={note} /> : null}
      </View>
    </View>
  );
}

function RoundAction({ icon: Icon, label, onPress, tone, big }: { icon: typeof X; label: string; onPress: () => void; tone: 'primary' | 'muted'; big?: boolean }) {
  const { colors } = useTheme();
  const size = big ? 72 : 60;
  const bg = tone === 'primary' ? colors.primary : colors.surface;
  const fg = tone === 'primary' ? colors.onPrimary : colors.textMuted;
  return (
    <View style={{ alignItems: 'center', gap: space.xs }}>
      <PressableScale
        onPress={onPress}
        hapticFeedback="tap"
        accessibilityLabel={label}
        scaleTo={0.92}
        style={[styles.round, { width: size, height: size, backgroundColor: bg, borderColor: colors.border, shadowColor: colors.shadow }]}
      >
        <Icon size={big ? 32 : 26} color={fg} strokeWidth={2.4} />
      </PressableScale>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}

// ---------- Sheets ----------
function NoteSheet({ target, onClose, onSend }: { target: NoteTarget | null; onClose: () => void; onSend: (note: Note) => void }) {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  useEffect(() => {
    if (target) setText('');
  }, [target]);
  const comment = text.trim();

  return (
    <Sheet visible={!!target} onClose={onClose} title="Add a note (optional)">
      {target ? (
        <View style={{ gap: space.md }}>
          <View style={[styles.quote, { backgroundColor: colors.surfaceAlt }]}>
            {target.photoUrl ? <Image source={{ uri: target.photoUrl }} style={styles.quoteImg} contentFit="cover" /> : null}
            <Text variant="caption" tone="muted" style={{ flex: 1 }} numberOfLines={3}>
              {target.label}
            </Text>
          </View>
          <Input value={text} onChangeText={setText} placeholder="Say something friendly…" multiline maxLength={300} counter autoFocus />
          <Text variant="caption" tone="faint">
            {target.card.user.display_name} only sees your note if they say hi too. Then it's the first message in your chat.
          </Text>
          <Button title="Send & be friends 👋" onPress={() => onSend({ comment, context: target.context })} disabled={!comment} fullWidth />
          <Button title="Cancel" variant="secondary" onPress={onClose} fullWidth />
        </View>
      ) : null}
    </Sheet>
  );
}

function CardMenu({ card, onClose, onReport, onBlock }: { card: DiscoverCard | null; onClose: () => void; onReport: (c: DiscoverCard) => void; onBlock: (c: DiscoverCard) => void }) {
  const run = (fn: (c: DiscoverCard) => void) => () => {
    const c = card;
    onClose();
    if (c) setTimeout(() => fn(c), 250);
  };
  return (
    <Sheet visible={!!card} onClose={onClose} title={card?.user.display_name}>
      <ListGroup>
        <ListRow icon={Flag} iconTone="warning" title="Report" subtitle="Confidential. They won't know it was you." onPress={run(onReport)} />
        <ListRow icon={Ban} title="Block" destructive onPress={run(onBlock)} />
      </ListGroup>
    </Sheet>
  );
}

function FiltersSheet({ visible, value, onClose, onApply }: { visible: boolean; value: DeckFilters; onClose: () => void; onApply: (f: DeckFilters) => void }) {
  const interests = useInterests();
  const me = useMe();
  const [draft, setDraft] = useState<DeckFilters>(value);
  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  const mine = new Set((me.data?.interests ?? []).map((i) => i.id));
  const options = [...(interests.data ?? [])].sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id))).slice(0, 30);

  return (
    <Sheet visible={visible} onClose={onClose} title="Filters" scroll>
      <View style={{ gap: space.lg }}>
        <ListGroup>
          <ListRow icon={BadgeCheck} iconTone="primary" title="Verified people only" subtitle="People who passed a selfie check." toggle={{ value: !!draft.verifiedOnly, onChange: (v) => setDraft((d) => ({ ...d, verifiedOnly: v })) }} />
        </ListGroup>
        <View style={{ gap: space.sm }}>
          <Text variant="label" tone="muted">
            Into a specific interest
          </Text>
          <View style={styles.wrap}>
            <Chip label="Any" selected={!draft.interestId} onPress={() => setDraft((d) => ({ ...d, interestId: null }))} />
            {options.map((i) => (
              <Chip key={i.id} label={i.name} selected={draft.interestId === i.id} onPress={() => setDraft((d) => ({ ...d, interestId: i.id }))} />
            ))}
          </View>
        </View>
        <Button title="Show people" onPress={() => onApply(draft)} fullWidth />
        <Button title="Clear filters" variant="ghost" onPress={() => onApply({})} fullWidth />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, borderRadius: radius.xxl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  photo: { width: '100%', aspectRatio: 4 / 5 },
  segments: { position: 'absolute', top: space.sm, left: space.sm, right: space.sm, flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 3, borderRadius: 2 },
  pick: { position: 'absolute', top: space.lg, left: space.md },
  menu: { position: 'absolute', top: space.lg, right: space.md },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.lg,
    paddingTop: space.xxxl,
    backgroundColor: 'rgba(10,10,18,0.38)',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  onPhoto: { color: '#fff', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  prompt: { padding: space.lg, borderRadius: radius.lg, gap: space.xs },
  noteHint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.xs },
  stamp: { position: 'absolute', top: space.xxxl + space.lg, paddingHorizontal: space.md, paddingVertical: space.xs, borderWidth: 3, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.25)' },
  stampLike: { left: space.xl, transform: [{ rotate: '-12deg' }] },
  stampPass: { right: space.xl, transform: [{ rotate: '12deg' }] },
  actions: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: space.huge, paddingVertical: space.md },
  round: { alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  quote: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md },
  quoteImg: { width: 44, height: 55, borderRadius: radius.sm },
});
