import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { Crown, Play, Share2, UserPlus } from 'lucide-react-native';

import { GAME_META, isApiError } from '@/api/games-extra';
import { useGameActions } from '@/api/hooks';
import { Avatar } from '@/components/avatar/Avatar';
import { Button, Card, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import type { GameCtx } from './GameParts';

const MAX_PLAYERS = 12;

const RULES = {
  trivia: ['Everyone gets the same question.', 'Faster correct answers earn more points.', 'Answers are revealed after the timer ends.'],
  doodle: ['Take turns drawing a secret word.', 'Guess what the artist is drawing — quicker guesses score more.', 'The artist scores when people guess right.'],
};

export function GameLobby({ ctx, onJoin, joining }: { ctx: GameCtx; onJoin: () => void; joining: boolean }) {
  const { colors, reduceMotion } = useTheme();
  const { game, meId, isPlayer } = ctx;
  const actions = useGameActions(game.id);
  const [startError, setStartError] = useState<string | null>(null);
  const active = game.players.filter((p) => p.active);
  const isHost = game.host_id === meId;
  const host = game.players.find((p) => p.id === game.host_id);
  const meta = GAME_META[game.game_type];
  const needsMore = game.game_type === 'doodle' && active.length < 2;

  const share = async () => {
    try {
      await Share.share({ message: `Join my ${meta.name} game on Veyvo! Open Games → "Join with a code" and enter ${game.code}` });
    } catch {
      /* dismissed */
    }
  };

  const start = () => {
    setStartError(null);
    actions.start.mutate(undefined, {
      onSuccess: () => haptic.success(),
      onError: (e) => {
        haptic.error();
        if (isApiError(e, 409)) setStartError(errorMessage(e));
        else toast.error("Couldn't start the game", errorMessage(e));
        ctx.refetch();
      },
    });
  };

  return (
    <View style={{ gap: space.xl }}>
      <Card style={{ alignItems: 'center', gap: space.sm }}>
        <Text variant="label" tone="muted">
          Game code
        </Text>
        <Text
          selectable
          style={{ fontFamily: 'Inter_800ExtraBold', fontSize: 40, lineHeight: 48, letterSpacing: 8, color: colors.text }}
          accessibilityLabel={`Game code ${game.code.split('').join(' ')}`}
        >
          {game.code}
        </Text>
        <Text variant="caption" tone="muted" center>
          Friends can join from Games → "Join with a code".
        </Text>
        <Button title="Share code" icon={Share2} variant="secondary" size="sm" onPress={share} />
      </Card>

      <View style={{ gap: space.md }}>
        <View style={styles.rowBetween}>
          <Text variant="heading">Players</Text>
          <Text variant="label" tone="muted">
            {active.length} / {MAX_PLAYERS}
          </Text>
        </View>
        <View style={styles.grid}>
          {active.map((p) => (
            <Animated.View key={p.id} entering={reduceMotion ? undefined : ZoomIn.springify().damping(14)} style={styles.player} accessible accessibilityLabel={`${p.display_name}${p.id === game.host_id ? ', host' : ''}${p.id === meId ? ', you' : ''}`}>
              <View>
                <Avatar config={p.avatar} size={60} />
                {p.id === game.host_id ? (
                  <View style={[styles.crown, { backgroundColor: colors.bg }]}>
                    <Crown size={14} color={colors.gold} fill={colors.gold} />
                  </View>
                ) : null}
              </View>
              <Text variant="caption" numberOfLines={1} style={{ maxWidth: 76 }}>
                {p.id === meId ? 'You' : p.display_name}
              </Text>
            </Animated.View>
          ))}
          {active.length < 4 ? (
            <View style={styles.player}>
              <View style={[styles.empty, { borderColor: colors.borderStrong }]}>
                <UserPlus size={22} color={colors.textFaint} />
              </View>
              <Text variant="caption" tone="faint">
                Waiting…
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <Card style={{ gap: space.sm, backgroundColor: colors.surfaceAlt }}>
        <Text variant="bodyStrong">How to play {meta.name}</Text>
        {RULES[game.game_type].map((r) => (
          <Text key={r} variant="body" tone="muted">
            • {r}
          </Text>
        ))}
      </Card>

      {!isPlayer ? (
        <Button title="Join game" icon={UserPlus} size="lg" onPress={onJoin} loading={joining} disabled={active.length >= MAX_PLAYERS} fullWidth />
      ) : isHost ? (
        <View style={{ gap: space.sm }}>
          {startError ? (
            <Animated.View entering={reduceMotion ? undefined : FadeIn}>
              <Text tone="danger" center accessibilityLiveRegion="polite">
                {startError}
              </Text>
            </Animated.View>
          ) : needsMore ? (
            <Text tone="muted" center>
              Doodle & Guess needs at least 2 players. Share the code to invite someone.
            </Text>
          ) : null}
          <Button title="Start game" icon={Play} size="lg" onPress={start} loading={actions.start.isPending} fullWidth />
        </View>
      ) : (
        <Text tone="muted" center accessibilityLiveRegion="polite">
          Waiting for {host?.display_name ?? 'the host'} to start…
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  player: { alignItems: 'center', gap: 4, width: 76 },
  crown: { position: 'absolute', top: -4, right: -4, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  empty: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg },
});
