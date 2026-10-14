import { StyleSheet, View } from 'react-native';
import { Eye, Timer } from 'lucide-react-native';

import { msLeft, useNow } from '@/api/games-extra';
import type { GameView } from '@/api/types';
import { Button, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { Pop, TimerBar } from './Motion';

export type GameCtx = {
  game: GameView;
  meId: string;
  /** Server clock minus device clock, in ms. */
  offset: number;
  isPlayer: boolean;
  /** Points I gained this round (server score diff), or null if unknown. */
  roundGain: number | null;
  refetch: () => void;
};

/** Device-clock timestamp (ms) at which the current phase ends. */
export function phaseEndsAt(game: GameView, offset: number): number {
  const ends = game.round?.phase_ends_at;
  return ends ? Date.parse(ends) - offset : 0;
}

/** Big 3-2-1 that pops on each tick. */
export function PhaseCountdown({ game, offset, title, subtitle }: { game: GameView; offset: number; title: string; subtitle?: string }) {
  const { colors } = useTheme();
  const now = useNow(200);
  const left = msLeft(game.round?.phase_ends_at, offset, now);
  const n = Math.max(1, Math.ceil(left / 1000));
  return (
    <View style={styles.countdown} accessibilityLiveRegion="polite">
      <Text variant="label" tone="muted">
        {title}
      </Text>
      <Pop popKey={n}>
        <View style={[styles.bubble, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]} accessibilityLabel={`Starting in ${n}`}>
          <Text style={{ fontSize: 64, lineHeight: 72, fontFamily: 'Inter_800ExtraBold', color: colors.primary }}>{left <= 0 ? '…' : n}</Text>
        </View>
      </Pop>
      {subtitle ? (
        <Text variant="heading" center>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

/** "Round 2 of 7" plus a seconds counter and a draining bar. */
export function RoundTimer({ game, offset, phaseSeconds, label }: { game: GameView; offset: number; phaseSeconds: number; label?: string }) {
  const { colors } = useTheme();
  const now = useNow(250);
  const left = msLeft(game.round?.phase_ends_at, offset, now);
  const secs = Math.ceil(left / 1000);
  const r = game.round;
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.timerRow}>
        <Text variant="label" tone="muted">
          {label ?? (r ? `Round ${r.index + 1} of ${r.total}` : '')}
        </Text>
        <View style={styles.secs} accessibilityLabel={`${secs} seconds left`}>
          <Timer size={14} color={secs <= 5 ? colors.accent : colors.textMuted} />
          <Text variant="label" style={{ color: secs <= 5 ? colors.accent : colors.textMuted, fontVariant: ['tabular-nums'] }}>
            {left > 0 ? `${secs}s` : 'Time!'}
          </Text>
        </View>
      </View>
      <TimerBar endsAt={phaseEndsAt(game, offset)} now={now} totalMs={phaseSeconds * 1000} />
    </View>
  );
}

/** Shown to someone viewing a game they haven't joined (from a link or room banner). */
export function SpectatorBanner({ onJoin, loading, full }: { onJoin: () => void; loading: boolean; full: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.spectator, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Eye size={18} color={colors.textMuted} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">You're watching</Text>
        <Text variant="caption" tone="muted">
          {full ? 'This game is full right now.' : 'Join to play from the next question or guess.'}
        </Text>
      </View>
      {!full ? <Button title="Join game" size="sm" onPress={onJoin} loading={loading} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  countdown: { alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingVertical: space.huge },
  bubble: { width: 140, height: 140, borderRadius: 70, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  timerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  secs: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  spectator: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
