import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { router } from 'expo-router';
import { ArrowLeft, Gem, Heart, RotateCcw, Trophy } from 'lucide-react-native';

import { GAME_REWARDS } from '@/api/games-extra';
import { useCreateGame } from '@/api/hooks';
import { Button, Card, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { Confetti } from './Confetti';
import type { GameCtx } from './GameParts';
import { KudosSheet } from './KudosSheet';
import { Podium, Scoreboard } from './Scoreboard';

export function GameFinished({ ctx, onBack }: { ctx: GameCtx; onBack: () => void }) {
  const { colors, reduceMotion } = useTheme();
  const { game, meId, isPlayer } = ctx;
  const create = useCreateGame();
  const [kudosOpen, setKudosOpen] = useState(false);
  const [burst, setBurst] = useState<number | null>(null);

  // Players arrive sorted by score from the server; ties at the top share the win.
  const ranked = game.players;
  const top = ranked[0]?.score ?? 0;
  const winners = top > 0 && ranked.length > 1 ? ranked.filter((p) => p.score === top) : [];
  const iWon = winners.some((p) => p.id === meId);
  const others = ranked.filter((p) => p.id !== meId);
  const wasPlayer = ranked.some((p) => p.id === meId);

  useEffect(() => {
    haptic.success();
    if (wasPlayer) setBurst(Date.now());
  }, [wasPlayer]);

  const playAgain = () => {
    create.mutate(
      { game_type: game.game_type, room_id: game.room_id ?? undefined },
      {
        onSuccess: (g) => router.replace(`/game/${g.id}`),
        onError: (e) => toast.error("Couldn't start a new game", errorMessage(e)),
      },
    );
  };

  const headline = winners.length === 0 ? 'Game over' : winners.length > 1 ? "It's a tie!" : iWon ? 'You won!' : `${winners[0].display_name} wins!`;

  return (
    <View style={{ gap: space.xl }}>
      <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(300)} style={{ alignItems: 'center', gap: space.xs }}>
        <Trophy size={32} color={colors.gold} />
        <Text variant="display" center accessibilityRole="header">
          {headline}
        </Text>
        <Text tone="muted" center>
          Thanks for playing{others.length ? ` with ${others.length === 1 ? others[0].display_name : `${others.length} others`}` : ''}.
        </Text>
      </Animated.View>

      {ranked.length ? <Podium players={ranked} meId={meId} /> : null}

      {wasPlayer ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.warningSoft, borderColor: 'transparent' }}>
          <Gem size={22} color={colors.gold} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">+{GAME_REWARDS.play} gems for playing</Text>
            <Text variant="caption" tone="muted">
              {iWon ? `Winner bonus: +${GAME_REWARDS.win} gems. Nice one!` : `The winner gets +${GAME_REWARDS.win} more. XP too.`}
            </Text>
          </View>
        </Card>
      ) : null}

      <View style={{ gap: space.md }}>
        <Text variant="heading">Final scores</Text>
        <Scoreboard players={ranked} meId={meId} hostId={game.host_id} />
      </View>

      <View style={{ gap: space.sm }}>
        <Button title="Play again" icon={RotateCcw} size="lg" onPress={playAgain} loading={create.isPending} fullWidth accessibilityHint="Starts a new game you host" />
        {others.length && (isPlayer || wasPlayer) ? <Button title="Give kudos" icon={Heart} variant="secondary" size="lg" onPress={() => setKudosOpen(true)} fullWidth /> : null}
        <Button title={game.room_id ? 'Back to the hangout' : 'Back to Games'} icon={ArrowLeft} variant="ghost" onPress={onBack} fullWidth />
      </View>

      <KudosSheet visible={kudosOpen} onClose={() => setKudosOpen(false)} people={others} />
      <Confetti burstKey={burst} count={30} originY={0.15} />
    </View>
  );
}
