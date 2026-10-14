import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Flag, HandHeart, Lock, MessageCircle, MessageCircleHeart, Search, ShieldCheck, Sparkles, Timer, UserRound } from 'lucide-react-native';

import { hoursMinutes, isApiError, msLeft, useIcebreakerSession, useNow } from '@/api/games-extra';
import { icebreakerApi, qk, useBlock, useIcebreaker, useMe, useStartConversation } from '@/api/hooks';
import type { IcebreakerSession } from '@/api/types';
import { UserPhoto } from '@/components/UserPhoto';
import { Confetti } from '@/components/games/Confetti';
import { openReport } from '@/components/safety/ReportSheet';
import { Button, Card, Chip, EmptyState, ErrorState, Header, Input, RowSkeleton, Screen, Text, confirm } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const MAX_ANSWER = 200;

function SearchingRings() {
  const { colors, reduceMotion } = useTheme();
  return (
    <View style={styles.rings} accessibilityLabel="Searching for a match">
      {!reduceMotion ? [0, 1, 2].map((i) => <Ring key={i} delay={i * 600} color={colors.primary} />) : null}
      <View style={[styles.ringCore, { backgroundColor: colors.primary }]}>
        <Search size={30} color={colors.onPrimary} />
      </View>
    </View>
  );
}

function Ring({ delay, color }: { delay: number; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false));
  }, [delay, t]);
  const style = useAnimatedStyle(() => ({ opacity: 0.5 * (1 - t.value), transform: [{ scale: 0.6 + t.value * 1.2 }] }));
  return <Animated.View style={[styles.ring, { borderColor: color }, style]} />;
}

export default function Icebreaker() {
  const { colors } = useTheme();
  const qc = useQueryClient();
  const me = useMe();
  const current = useIcebreaker();
  const [trackedId, setTrackedId] = useState<string | null>(null);
  const session = useIcebreakerSession(trackedId);
  const [mode, setMode] = useState<'intro' | 'waiting'>('intro');
  const [interestId, setInterestId] = useState<number | null>(null);
  const [joining, setJoining] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [waitStarted, setWaitStarted] = useState(0);
  const now = useNow(1000);

  // Pick up a match from the current-session endpoint (on open, on realtime "matched", or by polling).
  useEffect(() => {
    const id = current.data?.id;
    if (id && id !== trackedId) {
      setTrackedId(id);
      setMode('intro');
      haptic.success();
    }
  }, [current.data?.id, trackedId]);

  // While waiting, poll as a backup to the realtime "matched" event.
  const refetchCurrent = useRef(current.refetch);
  useEffect(() => {
    refetchCurrent.current = current.refetch;
  });
  useEffect(() => {
    if (mode !== 'waiting') return;
    const t = setInterval(() => refetchCurrent.current(), 5000);
    return () => clearInterval(t);
  }, [mode]);

  const s: IcebreakerSession | null | undefined = session.data ?? (current.data && current.data.id === trackedId ? current.data : null);
  const allowed = me.data?.privacy.allow_icebreakers !== false && !disabled;

  const join = async () => {
    setJoining(true);
    try {
      const res = await icebreakerApi.join(interestId);
      if (res.status === 'matched' && res.session) {
        haptic.success();
        qc.setQueryData([...qk.icebreaker, 'session', res.session.id], res.session);
        setTrackedId(res.session.id);
      } else {
        setWaitStarted(Date.now());
        setMode('waiting');
      }
    } catch (e) {
      haptic.error();
      if (isApiError(e, 403, 'icebreakers_disabled')) setDisabled(true);
      else toast.error("Couldn't start matching", errorMessage(e));
    } finally {
      setJoining(false);
    }
  };

  const cancelWaiting = async () => {
    setMode('intro');
    try {
      await icebreakerApi.leave();
    } catch {
      /* the queue entry expires on its own */
    }
  };

  // Leave the queue if the screen closes while waiting.
  useEffect(() => {
    if (mode !== 'waiting') return;
    return () => {
      icebreakerApi.leave().catch(() => undefined);
    };
  }, [mode]);

  const reset = () => {
    setTrackedId(null);
    setMode('intro');
    qc.invalidateQueries({ queryKey: qk.icebreaker });
  };

  let body;
  if (current.isLoading || (trackedId && session.isLoading && !s)) {
    body = <RowSkeleton count={3} />;
  } else if (trackedId && s) {
    body = <SessionView session={s} now={now} onReset={reset} />;
  } else if (trackedId && session.isError) {
    body = <ErrorState error={session.error} onRetry={() => session.refetch()} />;
  } else if (current.isError && mode === 'intro' && !trackedId) {
    body = <ErrorState error={current.error} onRetry={() => current.refetch()} />;
  } else if (!allowed) {
    body = (
      <EmptyState
        icon={Lock}
        title="Icebreakers are turned off"
        message="You've chosen not to be matched with new people. You can turn Icebreaker matches on in Privacy settings any time."
        action="Open Privacy settings"
        onAction={() => router.push('/settings/privacy')}
      />
    );
  } else if (mode === 'waiting') {
    const waited = now - waitStarted;
    body = (
      <View style={{ alignItems: 'center', gap: space.lg, paddingTop: space.xxl }}>
        <SearchingRings />
        <Text variant="title" center accessibilityLiveRegion="polite">
          Finding someone…
        </Text>
        <Text tone="muted" center style={{ maxWidth: 300 }}>
          {interestId ? `Looking for someone into ${me.data?.interests.find((i) => i.id === interestId)?.name ?? 'the same thing'}.` : 'Looking for anyone who shares an interest with you.'} You can leave this screen open.
        </Text>
        {waited > 90_000 ? (
          <Text variant="caption" tone="muted" center style={{ maxWidth: 300 }}>
            It's a bit quiet right now. Keep waiting, or cancel and try "Any interest" for a faster match.
          </Text>
        ) : null}
        <Button title="Cancel" variant="secondary" onPress={cancelWaiting} />
      </View>
    );
  } else {
    body = (
      <View style={{ gap: space.xl }}>
        <View style={{ alignItems: 'center', gap: space.md, paddingTop: space.md }}>
          <View style={[styles.heroIcon, { backgroundColor: colors.successSoft }]}>
            <MessageCircleHeart size={34} color={colors.success} />
          </View>
          <Text variant="title" center>
            Icebreaker Match
          </Text>
          <Text tone="muted" center style={{ maxWidth: 320 }}>
            Get paired with someone who shares an interest. Answer 3 light questions. If you both want to, you become friends. Nobody sees who passed.
          </Text>
        </View>
        <Card style={{ gap: space.md }}>
          <Text variant="bodyStrong">Match on</Text>
          <View style={styles.chips}>
            <Chip label="Any interest" selected={interestId === null} onPress={() => setInterestId(null)} icon={Sparkles} />
            {me.data?.interests.map((i) => (
              <Chip key={i.id} label={i.name} selected={interestId === i.id} onPress={() => setInterestId(i.id)} />
            ))}
          </View>
        </Card>
        <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]}>
          <ShieldCheck size={18} color={colors.success} />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            Matches last 15 minutes. You can end, report or block at any point, and your partner only sees your profile picture and display name.
          </Text>
        </View>
        <Button title="Find a match" icon={Search} size="lg" onPress={join} loading={joining} fullWidth />
      </View>
    );
  }

  return (
    <Screen scroll keyboard header={<Header title="Icebreaker Match" />}>
      {body}
    </Screen>
  );
}

function SessionView({ session: s, now, onReset }: { session: IcebreakerSession; now: number; onReset: () => void }) {
  const { colors, reduceMotion } = useTheme();
  const qc = useQueryClient();
  const block = useBlock();
  const startChat = useStartConversation();
  const [answers, setAnswers] = useState<string[]>(() => s.questions.map(() => ''));
  const [busy, setBusy] = useState<null | 'answers' | 'connect' | 'pass' | 'end'>(null);
  const partner = s.partner;
  const left = msLeft(s.expires_at, 0, now);
  const expired = s.status === 'active' && left <= 0;
  const key = [...qk.icebreaker, 'session', s.id];

  const update = (next: IcebreakerSession) => qc.setQueryData(key, next);
  const handleError = (e: unknown, fallback: string) => {
    if (isApiError(e, 409, 'icebreaker_ended')) {
      qc.invalidateQueries({ queryKey: qk.icebreaker });
      toast.show({ title: 'This icebreaker has ended' });
    } else {
      haptic.error();
      toast.error(fallback, errorMessage(e));
    }
  };

  const submit = async () => {
    setBusy('answers');
    try {
      update(await icebreakerApi.answers(s.id, answers.map((a) => a.trim())));
      haptic.success();
    } catch (e) {
      handleError(e, "Couldn't send your answers");
    } finally {
      setBusy(null);
    }
  };

  const decide = async (decision: 'connect' | 'pass') => {
    setBusy(decision);
    try {
      const next = await icebreakerApi.decide(s.id, decision);
      update(next);
      haptic[decision === 'connect' ? 'success' : 'light']();
      qc.invalidateQueries({ queryKey: qk.quests });
      if (next.status === 'connected') qc.invalidateQueries({ queryKey: qk.friendsAll });
    } catch (e) {
      handleError(e, "Couldn't save your choice");
    } finally {
      setBusy(null);
    }
  };

  const end = async () => {
    const ok = await confirm({ title: 'End this icebreaker?', message: `${partner.display_name} will just see that it ended.`, confirmLabel: 'End', destructive: true });
    if (!ok) return;
    setBusy('end');
    try {
      await icebreakerApi.end(s.id);
    } catch {
      /* already over */
    }
    setBusy(null);
    qc.invalidateQueries({ queryKey: qk.icebreaker });
  };

  const doBlock = async () => {
    const ok = await confirm({ title: `Block ${partner.display_name}?`, message: "They won't be able to find you, message you or be matched with you again. They won't be told.", confirmLabel: 'Block', destructive: true });
    if (!ok) return;
    try {
      if (s.status === 'active') await icebreakerApi.end(s.id).catch(() => undefined);
      await block.mutateAsync({ userId: partner.id, block: true });
      toast.success(`${partner.display_name} is blocked`);
      qc.invalidateQueries({ queryKey: qk.icebreaker });
    } catch (e) {
      toast.error("Couldn't block", errorMessage(e));
    }
  };

  const report = () =>
    openReport({
      targetType: 'user',
      targetId: partner.id,
      subject: partner.display_name,
      blockUserId: partner.id,
      onBlocked: () => {
        icebreakerApi.end(s.id).catch(() => undefined);
        qc.invalidateQueries({ queryKey: qk.icebreaker });
      },
    });

  const message = () =>
    startChat.mutate(partner.id, {
      onSuccess: (c) => router.push(`/messages/${c.id}`),
      onError: (e) => toast.error("Couldn't open a chat", errorMessage(e)),
    });

  const partnerCard = (
    <View style={[styles.partner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <UserPhoto user={partner} size={56} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="heading" numberOfLines={1}>
          {partner.display_name}
        </Text>
        <Text variant="caption" tone="muted">
          {s.interest ? `You both like ${s.interest.name}` : 'You share an interest'}
        </Text>
      </View>
      {s.status === 'active' && !expired ? (
        <View style={styles.timer} accessibilityLabel={`${Math.ceil(left / 60000)} minutes left`}>
          <Timer size={13} color={colors.textMuted} />
          <Text variant="caption" tone="muted">
            {hoursMinutes(left)}
          </Text>
        </View>
      ) : null}
    </View>
  );

  const safety = (
    <View style={styles.safetyRow}>
      <Button title="Report" icon={Flag} variant="ghost" size="sm" onPress={report} />
      <Button title="Block" icon={Ban} variant="ghost" size="sm" onPress={doBlock} />
      {s.status === 'active' && !expired ? <Button title="End" variant="ghost" size="sm" onPress={end} loading={busy === 'end'} /> : null}
    </View>
  );

  // ----- Finished states -----
  if (s.status === 'connected') {
    return (
      <View style={{ gap: space.xl, alignItems: 'stretch' }}>
        <Animated.View entering={reduceMotion ? undefined : FadeIn} style={{ alignItems: 'center', gap: space.md, paddingTop: space.lg }}>
          <UserPhoto user={partner} size={96} />
          <Text variant="title" center>
            You're friends now!
          </Text>
          <Text tone="muted" center>
            You and {partner.display_name} both chose to connect.
          </Text>
        </Animated.View>
        <Button title={`Message ${partner.display_name}`} icon={MessageCircle} size="lg" onPress={message} loading={startChat.isPending} fullWidth />
        <Button title="View profile" icon={UserRound} variant="secondary" size="lg" onPress={() => router.push(`/user/${partner.id}`)} fullWidth />
        <Button title="Find another match" variant="ghost" onPress={onReset} />
        {safety}
        <Confetti burstKey={s.id} count={26} originY={0.2} />
      </View>
    );
  }
  if (s.status === 'ended' || expired) {
    return (
      <View style={{ gap: space.lg }}>
        <EmptyState
          icon={HandHeart}
          title={expired ? 'This icebreaker timed out' : 'This icebreaker has wrapped up'}
          message={expired ? 'Matches last 15 minutes. Thanks for saying hi!' : 'Thanks for being open to meeting someone new. Every conversation is good practice.'}
          action="Find another match"
          onAction={onReset}
        />
        {safety}
      </View>
    );
  }

  // ----- Active -----
  const iAnswered = !!s.my_answers;
  const bothAnswered = !!s.partner_answers;
  return (
    <View style={{ gap: space.lg }}>
      {partnerCard}

      {!iAnswered ? (
        <View style={{ gap: space.lg }}>
          <Text tone="muted">Answer these honestly — there are no wrong answers. You'll see each other's once you've both replied.</Text>
          {s.questions.map((q, i) => (
            <Input
              key={i}
              label={`${i + 1}. ${q}`}
              value={answers[i]}
              onChangeText={(t) => setAnswers((a) => a.map((x, j) => (j === i ? t : x)))}
              maxLength={MAX_ANSWER}
              counter
              multiline
              placeholder="Your answer"
            />
          ))}
          <Button title="Send answers" size="lg" onPress={submit} loading={busy === 'answers'} disabled={answers.some((a) => !a.trim())} fullWidth />
        </View>
      ) : !bothAnswered ? (
        <View style={{ gap: space.lg }}>
          <Card style={{ alignItems: 'center', gap: space.sm }}>
            <SearchingRings />
            <Text variant="heading" center accessibilityLiveRegion="polite">
              Waiting for {partner.display_name}…
            </Text>
            <Text variant="caption" tone="muted" center>
              Their answers appear here as soon as they’re done.
            </Text>
          </Card>
          <Text variant="label" tone="muted">
            Your answers
          </Text>
          {s.questions.map((q, i) => (
            <View key={i} style={{ gap: 2 }}>
              <Text variant="caption" tone="muted">
                {q}
              </Text>
              <Text>{s.my_answers?.[i]}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={{ gap: space.lg }}>
          {s.questions.map((q, i) => (
            <Animated.View key={i} entering={reduceMotion ? undefined : FadeIn.delay(i * 150)} style={{ gap: space.sm }}>
              <Text variant="bodyStrong">{q}</Text>
              <View style={styles.answers}>
                <View style={[styles.answer, { backgroundColor: colors.primarySoft }]}>
                  <Text variant="tiny" tone="primary">
                    YOU
                  </Text>
                  <Text>{s.my_answers?.[i]}</Text>
                </View>
                <View style={[styles.answer, { backgroundColor: colors.surfaceAlt }]}>
                  <Text variant="tiny" tone="muted" numberOfLines={1}>
                    {partner.display_name.toUpperCase()}
                  </Text>
                  <Text>{s.partner_answers?.[i]}</Text>
                </View>
              </View>
            </Animated.View>
          ))}
          {s.my_decision ? (
            <Card style={{ alignItems: 'center', gap: space.xs }}>
              <Text variant="heading" center accessibilityLiveRegion="polite">
                {s.my_decision === 'connect' ? 'You chose to connect' : 'You chose to pass'}
              </Text>
              <Text variant="caption" tone="muted" center>
                Waiting for {partner.display_name} to decide. They'll never see what you picked.
              </Text>
            </Card>
          ) : (
            <View style={{ gap: space.sm }}>
              <Text variant="heading" center>
                Want to be friends?
              </Text>
              <Text variant="caption" tone="muted" center>
                If you both choose Connect, you'll become friends. If either of you passes, it just ends — nobody sees who passed.
              </Text>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button title="Pass" variant="secondary" size="lg" onPress={() => decide('pass')} loading={busy === 'pass'} disabled={!!busy} style={{ flex: 1 }} />
                <Button title="Connect" icon={HandHeart} size="lg" onPress={() => decide('connect')} loading={busy === 'connect'} disabled={!!busy} style={{ flex: 1 }} />
              </View>
            </View>
          )}
        </View>
      )}
      {safety}
    </View>
  );
}

const styles = StyleSheet.create({
  heroIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  note: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.lg, alignItems: 'flex-start' },
  rings: { width: 140, height: 140, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 120, height: 120, borderRadius: 60, borderWidth: 3 },
  ringCore: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  partner: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  safetyRow: { flexDirection: 'row', justifyContent: 'center', gap: space.sm, flexWrap: 'wrap' },
  answers: { flexDirection: 'row', gap: space.sm },
  answer: { flex: 1, padding: space.md, borderRadius: radius.lg, gap: 4 },
});
