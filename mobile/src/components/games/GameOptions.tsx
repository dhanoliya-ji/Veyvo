import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { qk } from '@/api/hooks';
import type { GameView } from '@/api/types';
import { Card, Chip, ListRow, Text } from '@/components/ui';
import { errorMessage, patch } from '@/lib/api';
import { toast } from '@/stores/toast';
import { space } from '@/theme/tokens';

const PACKS = [
  { key: 'classic', label: 'Classic' },
  { key: 'deep_talk', label: 'Deep talk' },
  { key: 'funny', label: 'Funny' },
];

const HOUSE_RULES = [
  { key: 'draw_two', title: 'Twos: next player draws 2', subtitle: 'Can be stacked.' },
  { key: 'queen_skip', title: 'Queens skip the next player', subtitle: '' },
  { key: 'ace_reverse', title: 'Aces reverse direction', subtitle: '' },
];

/** Host-only lobby settings (server validates and applies them when the game starts). */
export function GameOptions({ game, isHost }: { game: GameView; isHost: boolean }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (options: Record<string, unknown>) => patch<GameView>(`/games/${game.id}/settings`, { options }),
    onSuccess: (g) => qc.setQueryData(qk.game(game.id), g),
    onError: (e) => toast.error("Couldn't change that", errorMessage(e)),
  });
  const s = game.settings as Record<string, any>;

  if (game.game_type === 'crazy_eights') {
    return (
      <Card style={{ gap: space.xs }} padded={false}>
        <Text variant="bodyStrong" style={{ padding: space.lg, paddingBottom: 0 }}>
          House rules
        </Text>
        {HOUSE_RULES.map((r) => (
          <ListRow
            key={r.key}
            title={r.title}
            subtitle={r.subtitle || undefined}
            toggle={{ value: !!s[r.key], onChange: (v) => save.mutate({ [r.key]: v }), disabled: !isHost || save.isPending }}
          />
        ))}
        {!isHost ? (
          <Text variant="caption" tone="faint" style={{ padding: space.lg, paddingTop: 0 }}>
            Only the host can change these.
          </Text>
        ) : null}
      </Card>
    );
  }

  if (game.game_type === 'truth_or_dare') {
    const rounds = (s.rounds as number) ?? 3;
    const packs: string[] = s.packs ?? PACKS.map((p) => p.key);
    const togglePack = (key: string) => {
      const next = packs.includes(key) ? packs.filter((p) => p !== key) : [...packs, key];
      if (next.length) save.mutate({ packs: next });
    };
    return (
      <Card style={{ gap: space.md }}>
        <Text variant="bodyStrong">Game settings</Text>
        <View style={{ gap: space.sm }}>
          <Text variant="label" tone="muted">
            Turns per player
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {[1, 2, 3, 5].map((n) => (
              <Chip key={n} label={String(n)} selected={rounds === n} onPress={isHost ? () => save.mutate({ rounds: n }) : undefined} />
            ))}
          </View>
        </View>
        <View style={{ gap: space.sm }}>
          <Text variant="label" tone="muted">
            Question packs
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            {PACKS.map((p) => (
              <Chip key={p.key} label={p.label} selected={packs.includes(p.key)} onPress={isHost ? () => togglePack(p.key) : undefined} />
            ))}
          </View>
        </View>
        {!isHost ? (
          <Text variant="caption" tone="faint">
            Only the host can change these.
          </Text>
        ) : null}
      </Card>
    );
  }
  return null;
}
