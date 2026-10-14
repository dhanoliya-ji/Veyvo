import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight, CircleCheck, Gift, Hash, MessageCircleHeart, Play, Sparkles, Target, Users } from 'lucide-react-native';

import { GAME_META, GAME_TYPES, isApiError, playersLabel, useGameCatalog, type GameType } from '@/api/games-extra';
import { useCreateGame, useDaily, useJoinByCode, useMe, useMyGames, useQuests } from '@/api/hooks';
import type { GameView } from '@/api/types';
import { AvatarStack } from '@/components/cards';
import { GamePreview } from '@/components/games/GamePreview';
import { GemPill } from '@/components/games/Scoreboard';
import { Badge, Button, Card, EmptyState, ErrorState, Input, PressableScale, ProgressBar, RowSkeleton, Screen, SectionHeader, Skeleton, Text } from '@/components/ui';
import { useTabBarInset } from '@/components/TabBar';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space } from '@/theme/tokens';

const CODE_LENGTH = 6;
const GRID_GAP = space.md;

function gameStatus(g: GameView, meId: string | undefined): string {
  const active = g.players.filter((p) => p.active).length;
  if (g.status === 'lobby') return `In the lobby · ${active}/${g.max_players}`;
  const turn = (g.board as { turn?: string | null } | null)?.turn;
  if (meId && (turn === meId || (g.game_type === 'werewolf' && g.legal_actions.some((a) => a.type !== 'advance')))) return 'Your move!';
  return 'In progress';
}

export default function GamesTab() {
  const { colors } = useTheme();
  const bottom = useTabBarInset();
  const { width } = useWindowDimensions();
  const cardWidth = Math.floor((width - screenPadding * 2 - GRID_GAP) / 2);
  const me = useMe();
  const myGames = useMyGames();
  const daily = useDaily();
  const quests = useQuests();
  const create = useCreateGame();
  const catalog = useGameCatalog();
  const joinByCode = useJoinByCode();
  const [creating, setCreating] = useState<GameType | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);

  const start = (type: GameType) => {
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
    await Promise.allSettled([myGames.refetch(), daily.refetch(), quests.refetch(), me.refetch(), catalog.refetch()]);
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
        Real classics with friends and new people. Every finished game earns gems.
      </Text>

      {/* Game catalogue */}
      <View style={styles.grid}>
        {GAME_TYPES.map((type) => {
          const meta = GAME_META[type];
          const info = catalog.data?.find((c) => c.key === type);
          const players = playersLabel(info?.min_players ?? meta.minPlayers, info?.max_players ?? meta.maxPlayers);
          const busy = creating === type;
          return (
            <PressableScale
              key={type}
              onPress={() => start(type)}
              disabled={create.isPending}
              hapticFeedback="light"
              accessibilityRole="button"
              accessibilityLabel={`Play ${info?.name ?? meta.name}. ${info?.tagline ?? meta.tagline}. ${players}`}
              accessibilityState={{ busy, disabled: create.isPending }}
              style={[styles.gameCard, { backgroundColor: colors.surface, borderColor: colors.border, width: cardWidth }]}
            >
              <GamePreview type={type} height={96} />
              <View style={{ gap: 2, paddingHorizontal: space.xs }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {info?.name ?? meta.name}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={2} style={{ minHeight: 32 }}>
                  {info?.tagline ?? meta.tagline}
                </Text>
              </View>
              <View style={styles.cardFooter}>
                <View style={styles.players}>
                  <Users size={12} color={colors.textFaint} />
                  <Text variant="tiny" tone="faint">
                    {players}
                  </Text>
                </View>
                <View style={[styles.playPill, { backgroundColor: colors.primary }]}>
                  <Play size={11} color={colors.onPrimary} fill={colors.onPrimary} />
                  <Text variant="tiny" style={{ color: colors.onPrimary }}>
                    {busy ? '…' : 'Play'}
                  </Text>
                </View>
              </View>
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
              <Card key={g.id} onPress={() => router.push(`/game/${g.id}`)} accessibilityLabel={`${GAME_META[g.game_type].name}, ${gameStatus(g, me.data?.id)}, ${g.players.filter((p) => p.active).length} players. Open`} style={styles.gameRow}>
                <View style={styles.thumb}>
                  <GamePreview type={g.game_type} height={44} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">{GAME_META[g.game_type].name}</Text>
                  <Text variant="caption" tone="muted">
                    {gameStatus(g, me.data?.id)} · code {g.code}
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  gameCard: { padding: space.sm, gap: space.sm, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs, paddingBottom: space.xs },
  players: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  playPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, height: 24, borderRadius: radius.pill },
  thumb: { width: 56, borderRadius: radius.md, overflow: 'hidden' },
  gameRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  smallIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
