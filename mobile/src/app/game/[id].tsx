import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Flag, Gamepad2, X } from 'lucide-react-native';

import { clockOffset, GAME_META, isApiError } from '@/api/games-extra';
import { qk, useGame, useGameActions, useMe } from '@/api/hooks';
import { UserPhoto } from '@/components/UserPhoto';
import { DoodleRound, type FeedItem } from '@/components/games/DoodleRound';
import type { CanvasHandle, Stroke } from '@/components/games/DrawingCanvas';
import { GameFinished } from '@/components/games/GameFinished';
import { GameLobby } from '@/components/games/GameLobby';
import { SpectatorBanner, type GameCtx } from '@/components/games/GameParts';
import { TriviaRound } from '@/components/games/TriviaRound';
import { openReport } from '@/components/safety/ReportSheet';
import { Button, EmptyState, ErrorState, IconButton, PressableScale, Sheet, Skeleton, Text, confirm } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { realtime, useRealtimeStatus } from '@/lib/realtime';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space } from '@/theme/tokens';

const MAX_PLAYERS = 12;

export default function GameScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const me = useMe();
  const query = useGame(id);
  const actions = useGameActions(id);
  const rtStatus = useRealtimeStatus((s) => s.status);
  const game = query.data;
  const meId = me.data?.id ?? '';

  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const canvasRef = useRef<CanvasHandle | null>(null);

  // Keep the latest values reachable from long-lived realtime handlers.
  const latest = useRef({ version: 0, round: 0, refetch: query.refetch });
  useLayoutEffect(() => {
    latest.current = { version: game?.version ?? 0, round: game?.round?.index ?? 0, refetch: query.refetch };
  });
  const refetch = useCallback(() => {
    latest.current.refetch();
  }, []);

  const offset = useMemo(() => clockOffset(game?.server_time, query.dataUpdatedAt), [game?.server_time, query.dataUpdatedAt]);

  // ----- Realtime -----
  useEffect(() => {
    if (!id) return;
    const unsubscribe = realtime.subscribe(`game:${id}`);
    const forUs = (data: any) => data?.session_id === id;
    let seq = 0;
    const push = (item: Omit<FeedItem, 'key' | 'round'>) =>
      setFeed((f) => [...f.slice(-30), { ...item, key: `${Date.now()}-${seq++}`, round: latest.current.round }]);
    const offs = [
      realtime.on('game.state_updated', (e) => {
        if (forUs(e.data) && (e.data.version ?? Infinity) > latest.current.version) refetch();
      }),
      realtime.on('game.guess', (e) => {
        if (forUs(e.data)) push({ kind: 'guess', userId: String(e.data.user_id), text: String(e.data.text ?? '') });
      }),
      realtime.on('game.correct_guess', (e) => {
        if (!forUs(e.data)) return;
        haptic.light();
        push({ kind: 'correct', userId: String(e.data.user_id) });
      }),
      realtime.on('game.stroke', (e) => {
        if (forUs(e.data)) canvasRef.current?.addRemote(e.data.stroke as Stroke);
      }),
      realtime.on('game.clear', (e) => {
        if (forUs(e.data)) canvasRef.current?.clear(false);
      }),
      realtime.on('client.reconnected', refetch),
      realtime.on('client.foreground', refetch),
    ];
    return () => {
      offs.forEach((off) => off());
      unsubscribe();
    };
  }, [id, refetch]);

  // ----- Phase timing: the server advances lazily, so fetch right after each phase should end. -----
  const endsAt = game?.round?.phase_ends_at ?? null;
  const status = game?.status;
  useEffect(() => {
    if (status !== 'active' || !endsAt) return;
    const ms = Date.parse(endsAt) - (Date.now() + offset);
    // If we're already past the deadline (server hasn't rolled over yet), retry shortly.
    const t = setTimeout(refetch, ms > 0 ? ms + 150 : 1000);
    return () => clearTimeout(t);
  }, [status, endsAt, offset, query.dataUpdatedAt, refetch]);

  // Fallback polling while the live connection is down.
  useEffect(() => {
    if (rtStatus === 'connected' || (status !== 'lobby' && status !== 'active')) return;
    const t = setInterval(refetch, 3000);
    return () => clearInterval(t);
  }, [rtStatus, status, refetch]);

  // Rewards land when the game finishes.
  const finishedOnce = useRef(false);
  useEffect(() => {
    if (status === 'finished' && !finishedOnce.current) {
      finishedOnce.current = true;
      qc.invalidateQueries({ queryKey: qk.me });
      qc.invalidateQueries({ queryKey: qk.quests });
      qc.invalidateQueries({ queryKey: qk.myGames });
    }
  }, [status, qc]);

  // Points gained per round, from server score differences (never computed from answers).
  const myPlayer = game?.players.find((p) => p.id === meId);
  const [base, setBase] = useState<Record<number, number>>({});
  const round = game?.round;
  useEffect(() => {
    if (!round || !myPlayer || base[round.index] !== undefined) return;
    const fresh =
      round.phase === 'countdown' ||
      (round.phase === 'question' && round.my_answer === null) ||
      (round.phase === 'drawing' && round.guessed_user_ids.length === 0);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fresh) setBase((b) => ({ ...b, [round.index]: myPlayer.score }));
  }, [round, myPlayer, base]);
  const roundGain = round && myPlayer && base[round.index] !== undefined ? myPlayer.score - base[round.index] : null;

  const isPlayer = !!myPlayer?.active;
  const inProgress = status === 'lobby' || status === 'active';

  // ----- Navigation -----
  const exit = useCallback(() => {
    const roomId = game?.room_id;
    if (roomId) router.dismissTo(`/room/${roomId}`);
    else if (router.canGoBack()) router.back();
    else router.replace('/games');
  }, [game?.room_id]);

  const leave = useCallback(async () => {
    if (!isPlayer || !inProgress) return exit();
    const ok = await confirm({
      title: status === 'active' ? 'Leave this game?' : 'Leave the lobby?',
      message: status === 'active' ? "The game carries on without you, and you won't get the end-of-game gems." : game?.host_id === meId ? 'Someone else will become the host.' : undefined,
      confirmLabel: 'Leave',
      destructive: true,
    });
    if (!ok) return;
    actions.leave.mutate(undefined, {
      onSettled: () => {
        qc.invalidateQueries({ queryKey: qk.game(id) });
        exit();
      },
    });
  }, [isPlayer, inProgress, status, game?.host_id, meId, actions.leave, qc, id, exit]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      leave();
      return true;
    });
    return () => sub.remove();
  }, [leave]);

  const join = () => {
    actions.join.mutate(undefined, {
      onSuccess: () => {
        haptic.success();
        qc.invalidateQueries({ queryKey: qk.myGames });
      },
      onError: (e) => {
        haptic.error();
        toast.error("Couldn't join", errorMessage(e));
        refetch();
      },
    });
  };

  // ----- Render -----
  const header = (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <IconButton icon={X} label={isPlayer && inProgress ? 'Leave game' : 'Close'} onPress={leave} />
      <View style={{ flex: 1 }}>
        <Text variant="heading" numberOfLines={1}>
          {game ? GAME_META[game.game_type].name : 'Game'}
        </Text>
        {game ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {game.status === 'lobby' ? `Lobby · code ${game.code}` : game.status === 'active' && game.round ? `Round ${game.round.index + 1} of ${game.round.total}` : game.status === 'finished' ? 'Finished' : game.status === 'cancelled' ? 'Cancelled' : ''}
            {rtStatus !== 'connected' && inProgress ? ' · reconnecting…' : ''}
          </Text>
        ) : null}
      </View>
      {game && game.players.some((p) => p.id !== meId) ? <IconButton icon={Flag} label="Report a player" onPress={() => setReportOpen(true)} /> : null}
    </View>
  );

  let body: ReactNode;
  if (query.isLoading || (!game && !query.isError)) {
    body = (
      <View style={{ gap: space.lg, paddingTop: space.xl }} accessibilityLabel="Loading game">
        <Skeleton height={120} rounded={radius.xl} />
        <Skeleton height={64} rounded={radius.lg} />
        <Skeleton height={64} rounded={radius.lg} />
        <Skeleton height={64} rounded={radius.lg} />
      </View>
    );
  } else if (query.isError || !game) {
    body = isApiError(query.error, 404) ? (
      <EmptyState icon={Gamepad2} title="This game has ended" message="It may have been cancelled, or the link is out of date." action="Back to Games" onAction={() => router.replace('/games')} />
    ) : (
      <ErrorState error={query.error} onRetry={refetch} />
    );
  } else {
    const ctx: GameCtx = { game, meId, offset, isPlayer, roundGain, refetch };
    const full = game.players.filter((p) => p.active).length >= MAX_PLAYERS;
    if (game.status === 'cancelled') {
      body = <EmptyState icon={Ban} title="This game was cancelled" message="Everyone left before it finished. No worries — start a new one any time." action={game.room_id ? 'Back to the hangout' : 'Back to Games'} onAction={exit} />;
    } else if (game.status === 'finished') {
      body = <GameFinished ctx={ctx} onBack={exit} />;
    } else if (game.status === 'lobby') {
      body = <GameLobby ctx={ctx} onJoin={join} joining={actions.join.isPending} />;
    } else if (!game.round) {
      body = <ErrorState error={null} onRetry={refetch} />;
    } else {
      body = (
        <View style={{ gap: space.lg }}>
          {!isPlayer ? <SpectatorBanner onJoin={join} loading={actions.join.isPending} full={full} /> : null}
          {game.game_type === 'trivia' ? <TriviaRound ctx={ctx} /> : <DoodleRound ctx={ctx} canvasRef={canvasRef} feed={feed} />}
        </View>
      );
    }
  }

  // The artist needs the page to stay still while drawing.
  const drawingLocked = !!game && game.game_type === 'doodle' && game.status === 'active' && game.round?.phase === 'drawing' && game.round.drawer_id === meId;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {header}
      <ScrollView
        style={{ flex: 1 }}
        scrollEnabled={!drawingLocked}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: screenPadding, paddingTop: space.sm, paddingBottom: insets.bottom + space.xxxl }}
      >
        {body}
      </ScrollView>

      <Sheet visible={reportOpen} onClose={() => setReportOpen(false)} title="Report a player" scroll>
        <Text tone="muted" style={{ marginBottom: space.md }}>
          Reports are private. The person won't know it was you.
        </Text>
        {game?.players
          .filter((p) => p.id !== meId)
          .map((p) => (
            <PressableScale
              key={p.id}
              onPress={() => {
                setReportOpen(false);
                openReport({ targetType: 'user', targetId: p.id, subject: p.display_name, blockUserId: p.id });
              }}
              accessibilityLabel={`Report ${p.display_name}`}
              style={[styles.reportRow, { borderColor: colors.border }]}
            >
              <UserPhoto user={p} size={40} />
              <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                {p.display_name}
              </Text>
              <Flag size={18} color={colors.danger} />
            </PressableScale>
          ))}
        <Button title="Cancel" variant="ghost" onPress={() => setReportOpen(false)} style={{ marginTop: space.sm }} />
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, minHeight: 56 },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 56 },
});
