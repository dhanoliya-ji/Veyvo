import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Flag, Gamepad2, Share2, X } from 'lucide-react-native';

import { GAME_META, isApiError, type GameAction } from '@/api/games-extra';
import { qk, useGame, useGameActions, useMe } from '@/api/hooks';
import { UserPhoto } from '@/components/UserPhoto';
import { GameBoard, turnIds } from '@/components/games/GameBoard';
import { GameFinished } from '@/components/games/GameFinished';
import { GameLobby, shareGameCode } from '@/components/games/GameLobby';
import { PlayerStrip, SpectatorBanner, type GameCtx } from '@/components/games/GameParts';
import { openReport } from '@/components/safety/ReportSheet';
import { Button, EmptyState, ErrorState, IconButton, PressableScale, Sheet, Skeleton, Text, confirm } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { realtime, useRealtimeStatus } from '@/lib/realtime';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space } from '@/theme/tokens';

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
  const [reportOpen, setReportOpen] = useState(false);

  // Latest values for long-lived realtime handlers.
  const latest = useRef({ version: 0, refetch: query.refetch });
  useLayoutEffect(() => {
    latest.current = { version: game?.version ?? 0, refetch: query.refetch };
  });
  const refetch = useCallback(() => {
    latest.current.refetch();
  }, []);

  // ----- Realtime: the server only broadcasts the new version; we refetch our personalised view. -----
  useEffect(() => {
    if (!id) return;
    const unsubscribe = realtime.subscribe(`game:${id}`);
    const offs = [
      realtime.on('game.state_updated', (e) => {
        if (e.data?.session_id === id && (e.data.version ?? Infinity) > latest.current.version) refetch();
      }),
      realtime.on('client.reconnected', refetch),
      realtime.on('client.foreground', refetch),
    ];
    return () => {
      offs.forEach((off) => off());
      unsubscribe();
    };
  }, [id, refetch]);

  const status = game?.status;
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

  // A gentle buzz when it becomes your turn (or a simultaneous phase needs you).
  const needsMe = !!game && game.status === 'active' && (turnIds({ game }).includes(meId) || (game.game_type === 'werewolf' && game.legal_actions.some((a) => a.type !== 'advance')));
  const prevNeedsMe = useRef(false);
  useEffect(() => {
    if (needsMe && !prevNeedsMe.current) haptic.medium();
    prevNeedsMe.current = needsMe;
  }, [needsMe]);

  const myPlayer = game?.players.find((p) => p.id === meId);
  const isPlayer = !!myPlayer?.active;
  const inProgress = status === 'lobby' || status === 'active';

  // ----- Actions: always sent with the version on screen; one at a time. -----
  const busy = useRef(false);
  const version = game?.version ?? 0;
  const actMutate = actions.act.mutateAsync;
  const act = useCallback(
    async (action: GameAction): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      try {
        await actMutate({ action, version });
        haptic.light();
        return true;
      } catch (e) {
        if (isApiError(e, 409)) {
          refetch(); // stale view or the game moved on: just catch up quietly
        } else if (isApiError(e, 422)) {
          haptic.error();
          toast.error("That move isn't allowed", errorMessage(e));
          refetch();
        } else {
          haptic.error();
          toast.error("Couldn't send your move", errorMessage(e));
        }
        return false;
      } finally {
        busy.current = false;
      }
    },
    [actMutate, version, refetch],
  );

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
      message:
        status === 'active'
          ? "You'll forfeit and won't get the end-of-game gems. The game carries on without you if enough players remain."
          : game?.host_id === meId
            ? 'Someone else will become the host.'
            : undefined,
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
    if (actions.join.isPending) return;
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

  const meta = game ? GAME_META[game.game_type] : null;

  // ----- Header -----
  const header = (
    <View style={{ paddingTop: insets.top, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
      <View style={styles.header}>
        <IconButton icon={X} label={isPlayer && inProgress ? 'Leave game' : 'Close'} onPress={leave} />
        <View style={{ flex: 1 }}>
          <Text variant="heading" numberOfLines={1}>
            {meta?.name ?? 'Game'}
          </Text>
          {game ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {game.status === 'lobby' ? 'Lobby' : game.status === 'active' ? 'In progress' : game.status === 'finished' ? 'Finished' : 'Cancelled'} · code {game.code}
              {rtStatus !== 'connected' && inProgress ? ' · reconnecting…' : ''}
            </Text>
          ) : null}
        </View>
        {game && meta && inProgress ? <IconButton icon={Share2} label={`Share game code ${game.code}`} onPress={() => shareGameCode(meta.name, game.code)} /> : null}
        {game && game.players.some((p) => p.id !== meId) ? <IconButton icon={Flag} label="Report a player" onPress={() => setReportOpen(true)} /> : null}
      </View>
      {game && game.status !== 'cancelled' ? <PlayerStrip game={game} meId={meId} activeIds={game.status === 'active' ? turnIds({ game }) : []} /> : null}
    </View>
  );

  let body: ReactNode;
  if (query.isLoading || (!game && !query.isError)) {
    body = (
      <View style={{ gap: space.lg, paddingTop: space.xl }} accessibilityLabel="Loading game">
        <Skeleton height={320} rounded={radius.xl} />
        <Skeleton height={56} rounded={radius.lg} />
        <Skeleton height={56} rounded={radius.lg} />
      </View>
    );
  } else if (query.isError || !game) {
    body =
      isApiError(query.error, 404) || isApiError(query.error, 410) ? (
        <EmptyState icon={Gamepad2} title="This game has ended" message="It may have been cancelled, or the link is out of date." action="Back to Games" onAction={() => router.replace('/games')} />
      ) : (
        <ErrorState error={query.error} onRetry={refetch} />
      );
  } else {
    const ctx: GameCtx = { game, meId, isPlayer, act, pending: actions.act.isPending, refetch, readOnly: false };
    if (game.status === 'cancelled') {
      body = (
        <EmptyState
          icon={Ban}
          title="This game was cancelled"
          message="Everyone left before it finished. No worries, start a new one any time."
          action={game.room_id ? 'Back to the hangout' : 'Back to Games'}
          onAction={exit}
        />
      );
    } else if (game.status === 'finished') {
      body = <GameFinished ctx={{ ...ctx, readOnly: true }} onBack={exit} />;
    } else if (game.status === 'lobby') {
      body = <GameLobby ctx={ctx} onJoin={join} joining={actions.join.isPending} onLeave={leave} />;
    } else if (!game.board) {
      body = <ErrorState error={null} onRetry={refetch} />;
    } else {
      body = (
        <View style={{ gap: space.lg }}>
          {!isPlayer ? <SpectatorBanner onJoin={join} loading={actions.join.isPending} canJoin={false} /> : null}
          <GameBoard ctx={ctx} />
        </View>
      );
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {header}
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: screenPadding, paddingTop: space.md, paddingBottom: insets.bottom + space.xxxl }}
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
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, minHeight: 56 },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 56 },
});
