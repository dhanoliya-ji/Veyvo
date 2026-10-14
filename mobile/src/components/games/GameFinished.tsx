import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { router } from 'expo-router';
import { ArrowLeft, Gem, Heart, RotateCcw, Share2, Trophy } from 'lucide-react-native';

import { endReason, GAME_REWARDS, scoreLabel } from '@/api/games-extra';
import { qk, useCreateGame } from '@/api/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { Confetti } from './Confetti';
import { GameBoard } from './GameBoard';
import { playerOf, type GameCtx } from './GameParts';
import { KudosSheet } from './KudosSheet';
import { Podium, Scoreboard, type RankedEntry } from './Scoreboard';

export function GameFinished({ ctx, onBack }: { ctx: GameCtx; onBack: () => void }) {
  const { colors, reduceMotion } = useTheme();
  const { game, meId } = ctx;
  const qc = useQueryClient();
  const create = useCreateGame();
  const [kudosOpen, setKudosOpen] = useState(false);
  const [burst, setBurst] = useState<number | null>(null);

  const entries = useMemo<RankedEntry[]>(
    () =>
      [...(game.results ?? [])]
        .sort((a, b) => a.rank - b.rank)
        .map((r) => ({ id: r.player_id, player: playerOf(game, r.player_id), rank: r.rank, score: r.score, label: scoreLabel(game, r.score, r.role) })),
    [game],
  );
  const winners = entries.length > 1 && entries.some((e) => e.rank !== 1) ? entries.filter((e) => e.rank === 1) : [];
  const allTied = entries.length > 1 && entries.every((e) => e.rank === 1);
  const me = entries.find((e) => e.id === meId);
  const iWon = !!me && winners.some((e) => e.id === meId);
  const wasPlayer = !!me;
  const others = game.players.filter((p) => p.id !== meId);
  const reason = endReason(game);

  useEffect(() => {
    if (iWon) {
      haptic.success();
      setBurst(Date.now());
    } else if (wasPlayer) haptic.light();
  }, [iWon, wasPlayer]);

  const playAgain = () => {
    if (create.isPending) return;
    create.mutate(
      { game_type: game.game_type, room_id: game.room_id ?? undefined },
      {
        onSuccess: (g) => {
          haptic.success();
          qc.invalidateQueries({ queryKey: qk.myGames });
          router.replace(`/game/${g.id}`);
        },
        onError: (e) => {
          haptic.error();
          toast.error("Couldn't start a new game", errorMessage(e));
        },
      },
    );
  };

  const werewolfWinner = game.game_type === 'werewolf' ? (game.board as { winner?: string } | null)?.winner : null;
  const headline = werewolfWinner
    ? werewolfWinner === 'village'
      ? 'The village wins!'
      : 'The wolves win!'
    : allTied
      ? "It's a draw"
      : winners.length === 0
        ? 'Game over'
        : iWon
          ? winners.length > 1
            ? 'You tied for the win!'
            : 'You won!'
          : winners.length > 1
            ? "It's a tie!"
            : `${winners[0].player?.display_name ?? 'Someone'} wins!`;

  return (
    <View style={{ gap: space.xl }}>
      <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(300)} style={{ alignItems: 'center', gap: space.xs }}>
        <Trophy size={32} color={colors.gold} />
        <Text variant="display" center accessibilityRole="header">
          {headline}
        </Text>
        {reason ? (
          <Text tone="muted" center>
            {reason}
          </Text>
        ) : null}
        {game.game_type === 'werewolf' && me ? (
          <Text variant="bodyStrong" center tone={iWon ? 'success' : 'muted'}>
            {iWon ? 'Your side won.' : 'Your side lost this time.'}
          </Text>
        ) : null}
      </Animated.View>

      {entries.length > 1 && !allTied ? <Podium entries={entries} meId={meId} /> : null}

      {wasPlayer ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.warningSoft, borderColor: 'transparent' }}>
          <Gem size={22} color={colors.gold} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">+{GAME_REWARDS.play} gems for playing</Text>
            <Text variant="caption" tone="muted">
              {iWon ? `Winner bonus: +${GAME_REWARDS.win} gems. Nice one!` : `Winners get +${GAME_REWARDS.win} more. XP too.`}
            </Text>
          </View>
        </Card>
      ) : null}

      <View style={{ gap: space.md }}>
        <Text variant="heading">Final standings</Text>
        <Scoreboard entries={entries} meId={meId} hostId={game.host_id} />
      </View>

      <View style={{ gap: space.sm }}>
        <Button title="Play again" icon={RotateCcw} size="lg" onPress={playAgain} loading={create.isPending} fullWidth accessibilityHint="Starts a new game of the same kind that you host" />
        {wasPlayer ? <Button title="Share your moment" icon={Share2} variant="secondary" size="lg" onPress={() => router.push('/moments')} fullWidth /> : null}
        {others.length && wasPlayer ? <Button title="Give kudos" icon={Heart} variant="secondary" size="lg" onPress={() => setKudosOpen(true)} fullWidth /> : null}
        <Button title={game.room_id ? 'Back to the hangout' : 'Back to Games'} icon={ArrowLeft} variant="ghost" onPress={onBack} fullWidth />
      </View>

      {game.board ? (
        <View style={{ gap: space.md }}>
          <Text variant="heading">{game.game_type === 'werewolf' ? 'Roles revealed' : 'Final position'}</Text>
          <GameBoard ctx={{ ...ctx, readOnly: true }} />
        </View>
      ) : null}

      <KudosSheet visible={kudosOpen} onClose={() => setKudosOpen(false)} people={others} />
      <Confetti burstKey={burst} count={30} originY={0.15} />
    </View>
  );
}
