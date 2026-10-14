import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Brain, ChevronRight, CircleCheck, Gift, Hash, MessageCircleHeart, Palette, Sparkles, Target } from 'lucide-react-native';

import { GAME_META, isApiError } from '@/api/games-extra';
import { useCreateGame, useDaily, useJoinByCode, useMe, useMyGames, useQuests } from '@/api/hooks';
import type { GameView } from '@/api/types';
import { AvatarStack } from '@/components/cards';
import { GemPill } from '@/components/games/Scoreboard';
import { Badge, Button, Card, EmptyState, ErrorState, Input, PressableScale, ProgressBar, RowSkeleton, Screen, SectionHeader, Skeleton, Text } from '@/components/ui';
import { useTabBarInset } from '@/components/TabBar';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const CODE_LENGTH = 6;

function gameStatus(g: GameView): string {
  if (g.status === 'lobby') return 'In the lobby';
  if (g.round) return `Round ${g.round.index + 1} of ${g.round.total}`;
  return 'In progress';
}

export default function GamesTab() {
  const { colors } = useTheme();
  const bottom = useTabBarInset();
  const me = useMe();
  const myGames = useMyGames();
  const daily = useDaily();
  const quests = useQuests();
  const create = useCreateGame();
  const joinByCode = useJoinByCode();
  const [creating, setCreating] = useState<'trivia' | 'doodle' | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);

  const start = (type: 'trivia' | 'doodle') => {
    if (create.isPending) return;
    setCreating(type);
    create.mutate(
      { game_type: type },
      {
        onSuccess: (g) => {
          haptic.success();
          router.push(`/game/${g.id}`);
        },
        onError: (e) => {
          haptic.error();
          toast.error("Couldn't start a game", errorMessage(e));
        },
        onSettled: () => setCreating(null),
      },
    );
  };

  const join = () => {
    const c = code.trim().toUpperCase();
    if (c.length !== CODE_LENGTH) {
      setCodeError(`Codes are ${CODE_LENGTH} characters.`);
      return;
    }
    setCodeError(undefined);
    joinByCode.mutate(c, {
      onSuccess: (g) => {
        haptic.success();
        setCode('');
        router.push(`/game/${g.id}`);
      },
      onError: (e) => {
        haptic.error();
        setCodeError(isApiError(e, 404) ? 'No game with that code. Check it and try again.' : isApiError(e, 410) ? 'That game has already ended.' : errorMessage(e));
      },
    });
  };

  const refresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([myGames.refetch(), daily.refetch(), quests.refetch(), me.refetch()]);
    setRefreshing(false);
  };

  const questList = quests.data ?? [];
  const claimable = questList.filter((q) => q.completed && !q.claimed).length;
  const preview = [...questList]
    .filter((q) => !q.claimed)
    .sort((a, b) => Number(b.completed) - Number(a.completed) || b.progress / b.target - a.progress / a.target)
    .slice(0, 3);

  return (
    <Screen scroll bottomInset={bottom} refreshing={refreshing} onRefresh={refresh} edges={['top']}>
      <View style={styles.titleRow}>
        <Text variant="display" accessibilityRole="header">
          Games
        </Text>
        <GemPill gems={me.data?.gems} />
      </View>
      <Text tone="muted" style={{ marginBottom: space.lg }}>
        Quick games with friends and new people. Every finished game earns gems.
      </Text>

      {/* Hero cards */}
      <View style={styles.heroRow}>
        {(['trivia', 'doodle'] as const).map((type) => {
          const Icon = type === 'trivia' ? Brain : Palette;
          const tint = type === 'trivia' ? colors.primary : colors.accent;
          const soft = type === 'trivia' ? colors.primarySoft : colors.accentSoft;
          return (
            <PressableScale
              key={type}
              onPress={() => start(type)}
              disabled={create.isPending}
              hapticFeedback="light"
              accessibilityLabel={`Start ${GAME_META[type].name}`}
              accessibilityHint={GAME_META[type].tagline}
              accessibilityState={{ busy: creating === type }}
              style={[styles.hero, { backgroundColor: soft, borderColor: tint }]}
            >
              <View style={[styles.heroIcon, { backgroundColor: tint }]}>
                <Icon size={26} color={type === 'trivia' ? colors.onPrimary : colors.onAccent} />
              </View>
              <Text variant="heading">{GAME_META[type].name}</Text>
              <Text variant="caption" tone="muted" numberOfLines={3}>
                {GAME_META[type].tagline}
              </Text>
              <View style={{ flex: 1 }} />
              <Text variant="label" style={{ color: tint }}>
                {creating === type ? 'Starting…' : 'Start a game →'}
              </Text>
            </PressableScale>
          );
        })}
      </View>

      {/* Join with code */}
      <Card style={{ marginTop: space.lg, gap: space.sm }}>
        <Text variant="bodyStrong">Join with a code</Text>
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Input
              icon={Hash}
              value={code}
              onChangeText={(t) => {
                setCodeError(undefined);
                setCode(t.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, CODE_LENGTH));
              }}
              placeholder="ABC123"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={CODE_LENGTH}
              returnKeyType="go"
              onSubmitEditing={join}
              error={codeError}
              accessibilityLabel="Game code"
              style={{ letterSpacing: 3 }}
            />
          </View>
          <Button title="Join" onPress={join} loading={joinByCode.isPending} disabled={code.length !== CODE_LENGTH} style={{ height: 50 }} />
        </View>
      </Card>

      {/* Open games */}
      <View style={{ marginTop: space.xxl }}>
        <SectionHeader title="Your open games" />
        {myGames.isLoading ? (
          <RowSkeleton count={2} />
        ) : myGames.isError ? (
          <ErrorState error={myGames.error} onRetry={() => myGames.refetch()} compact />
        ) : !myGames.data?.length ? (
          <Text tone="muted">No games in progress. Start one above or join a friend's with their code.</Text>
        ) : (
          <View style={{ gap: space.sm }}>
            {myGames.data.map((g) => (
              <Card key={g.id} onPress={() => router.push(`/game/${g.id}`)} accessibilityLabel={`${GAME_META[g.game_type].name}, ${gameStatus(g)}, ${g.players.filter((p) => p.active).length} players. Open`} style={styles.gameRow}>
                <View style={[styles.smallIcon, { backgroundColor: g.game_type === 'trivia' ? colors.primarySoft : colors.accentSoft }]}>
                  {g.game_type === 'trivia' ? <Brain size={20} color={colors.primary} /> : <Palette size={20} color={colors.accent} />}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">{GAME_META[g.game_type].name}</Text>
                  <Text variant="caption" tone="muted">
                    {gameStatus(g)} · code {g.code}
                  </Text>
                </View>
                <AvatarStack people={g.players.filter((p) => p.active)} size={24} max={3} />
                <ChevronRight size={18} color={colors.textFaint} />
              </Card>
            ))}
          </View>
        )}
      </View>

      {/* Daily + Icebreaker */}
      <View style={{ marginTop: space.xxl, gap: space.md }}>
        <SectionHeader title="Daily" />
        {daily.isLoading ? (
          <Skeleton height={110} rounded={radius.xl} />
        ) : daily.isError ? (
          <ErrorState error={daily.error} onRetry={() => daily.refetch()} compact />
        ) : daily.data ? (
          <Card onPress={() => router.push('/games/daily')} accessibilityLabel={`Daily question: ${daily.data.question}. ${daily.data.my_choice !== null ? 'Answered. See results' : 'Answer for 10 gems'}`} style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Sparkles size={16} color={colors.gold} />
              <Text variant="label" tone="muted" style={{ flex: 1 }}>
                Daily question
              </Text>
              {daily.data.my_choice !== null ? <Badge label="Answered" tone="success" /> : <Badge label="+10 gems" tone="warning" />}
            </View>
            <Text variant="heading">{daily.data.question}</Text>
            <Text variant="label" tone="primary">
              {daily.data.my_choice !== null ? 'See how everyone answered →' : 'Answer now →'}
            </Text>
          </Card>
        ) : null}

        <Card onPress={() => router.push('/games/icebreaker')} accessibilityLabel="Icebreaker Match. Get paired with someone who shares an interest" style={styles.gameRow}>
          <View style={[styles.smallIcon, { backgroundColor: colors.successSoft }]}>
            <MessageCircleHeart size={20} color={colors.success} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">Icebreaker Match</Text>
            <Text variant="caption" tone="muted">
              Meet someone who shares an interest. 3 light questions, no pressure.
            </Text>
          </View>
          <ChevronRight size={18} color={colors.textFaint} />
        </Card>
      </View>

      {/* Quests */}
      <View style={{ marginTop: space.xxl }}>
        <SectionHeader title="Quests" subtitle={claimable ? `${claimable} ready to claim` : 'Small goals, nice rewards'} action="See all" onAction={() => router.push('/quests')} />
        {quests.isLoading ? (
          <RowSkeleton count={3} />
        ) : quests.isError ? (
          <ErrorState error={quests.error} onRetry={() => quests.refetch()} compact />
        ) : !preview.length ? (
          <EmptyState compact icon={CircleCheck} title="All quests claimed" message="Nice work. New ones show up as you keep hanging out." />
        ) : (
          <Card style={{ gap: space.lg }} onPress={() => router.push('/quests')} accessibilityLabel="Open quests">
            {preview.map((q) => (
              <View key={q.key} style={{ gap: space.xs }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  {q.completed ? <Gift size={16} color={colors.success} /> : <Target size={16} color={colors.textMuted} />}
                  <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {q.title}
                  </Text>
                  <Text variant="caption" style={{ color: q.completed ? colors.success : colors.textMuted }}>
                    {q.completed ? 'Ready to claim' : `${q.progress}/${q.target}`}
                  </Text>
                </View>
                <ProgressBar value={q.progress / q.target} color={q.completed ? colors.success : undefined} />
              </View>
            ))}
          </Card>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md, marginBottom: space.xs },
  heroRow: { flexDirection: 'row', gap: space.md },
  hero: { flex: 1, minHeight: 190, padding: space.lg, borderRadius: radius.xl, borderWidth: 1.5, gap: space.xs },
  heroIcon: { width: 48, height: 48, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  gameRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  smallIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
