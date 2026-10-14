import { useEffect, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Crown, Eye } from 'lucide-react-native';

import type { GameAction } from '@/api/games-extra';
import { useMe } from '@/api/hooks';
import type { GamePlayer, GameView } from '@/api/types';
import { UserPhoto } from '@/components/UserPhoto';
import { Button, Text } from '@/components/ui';
import { themeFor } from '@/lib/themes';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space } from '@/theme/tokens';

export type GameCtx = {
  game: GameView;
  meId: string;
  /** Viewer is an active player in this game. */
  isPlayer: boolean;
  /** Sends one action with the version currently on screen. Resolves true when the server accepted it. */
  act: (action: GameAction) => Promise<boolean>;
  /** An action is in flight: interactive pieces should ignore taps. */
  pending: boolean;
  refetch: () => void;
  /** Board shown without controls (e.g. the final position on the results screen). */
  readOnly: boolean;
};

/** The viewer's purchased board/card themes (falls back to the defaults). */
export function useGameTheme() {
  const me = useMe();
  return themeFor(me.data?.game_theme);
}

/** Lighten (amt > 0) or darken (amt < 0) a #RRGGBB colour. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = (v: number) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function playerOf(game: GameView, id: string | null | undefined): GamePlayer | undefined {
  return id ? game.players.find((p) => p.id === id) : undefined;
}

/** "You" for the viewer, otherwise the player's display name. */
export function nameOf(ctx: Pick<GameCtx, 'game' | 'meId'>, id: string | null | undefined, you = 'You'): string {
  if (!id) return 'Someone';
  if (id === ctx.meId) return you;
  return playerOf(ctx.game, id)?.display_name ?? 'A player';
}

/** Square board size that fits the screen with the standard side padding. */
export function useBoardSize(max = 560, inset = 0): number {
  const { width } = useWindowDimensions();
  return Math.floor(Math.min(max, width - screenPadding * 2 - inset));
}

/** Soft looping pulse (scale) for things that want attention. Static with reduce-motion. */
export function usePulse(active: boolean, amount = 0.12, duration = 650) {
  const { reduceMotion } = useTheme();
  const v = useSharedValue(1);
  useEffect(() => {
    if (!active || reduceMotion) {
      v.value = 1;
      return;
    }
    v.value = withRepeat(withSequence(withTiming(1 + amount, { duration }), withTiming(1, { duration })), -1, false);
  }, [active, reduceMotion, amount, duration, v]);
  return useAnimatedStyle(() => ({ transform: [{ scale: v.value }] }));
}

/** Player photo with a glowing ring while it is their turn. */
export function PlayerAvatar({ player, size = 40, highlight, dimmed, label, ringColor }: { player: GamePlayer | undefined; size?: number; highlight?: boolean; dimmed?: boolean; label?: string; ringColor?: string }) {
  const { colors } = useTheme();
  const pulse = usePulse(!!highlight, 0.06, 700);
  const ring = ringColor ?? colors.success;
  return (
    <Animated.View
      style={[{ padding: 2, borderRadius: 999, borderWidth: 2, borderColor: highlight ? ring : 'transparent', opacity: dimmed ? 0.4 : 1 }, highlight ? pulse : null]}
      accessible={!!label}
      accessibilityLabel={label}
    >
      <UserPhoto user={player} size={size} showVerified={false} />
    </Animated.View>
  );
}

/** Horizontal strip of every player's real photo; `activeIds` are highlighted (whose turn it is). */
export function PlayerStrip({ game, meId, activeIds }: { game: GameView; meId: string; activeIds: string[] }) {
  const { colors } = useTheme();
  const people = game.players.filter((p) => p.active || game.status !== 'lobby');
  if (!people.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} accessibilityRole="list" accessibilityLabel="Players">
      {people.map((p) => {
        const on = activeIds.includes(p.id);
        return (
          <View key={p.id} style={styles.stripItem} accessible accessibilityLabel={`${p.display_name}${p.id === meId ? ' (you)' : ''}${p.id === game.host_id ? ', host' : ''}${on ? ', their turn' : ''}${p.active ? '' : ', left'}`}>
            <View>
              <PlayerAvatar player={p} size={34} highlight={on} dimmed={!p.active} />
              {p.id === game.host_id ? (
                <View style={[styles.crown, { backgroundColor: colors.bg }]}>
                  <Crown size={10} color={colors.gold} fill={colors.gold} />
                </View>
              ) : null}
            </View>
            <Text variant="tiny" numberOfLines={1} style={{ maxWidth: 56, color: on ? colors.success : colors.textMuted }}>
              {p.id === meId ? 'You' : p.display_name}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

/** One-line status ("Your turn", "Waiting for Sam…") shown above a board. */
export function TurnBanner({ mine, text, right, tint }: { mine: boolean; text: string; right?: ReactNode; tint?: string }) {
  const { colors } = useTheme();
  const c = tint ?? (mine ? colors.success : colors.textMuted);
  return (
    <View
      style={[styles.banner, { backgroundColor: mine ? colors.successSoft : colors.surface, borderColor: mine ? colors.success : colors.border }]}
      accessibilityLiveRegion="polite"
      accessible
      accessibilityLabel={text}
    >
      <View style={[styles.dot, { backgroundColor: c }]} />
      <Text variant="bodyStrong" style={{ flex: 1, color: mine ? colors.success : colors.text }} numberOfLines={2}>
        {text}
      </Text>
      {right}
    </View>
  );
}

/** Shown to someone viewing a game they haven't joined. */
export function SpectatorBanner({ onJoin, loading, canJoin }: { onJoin: () => void; loading: boolean; canJoin: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.spectator, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Eye size={18} color={colors.textMuted} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">You're watching</Text>
        <Text variant="caption" tone="muted">
          {canJoin ? 'Join from the lobby next time to play.' : 'This game started without you. You can follow along.'}
        </Text>
      </View>
      {canJoin ? <Button title="Join" size="sm" onPress={onJoin} loading={loading} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.xs },
  stripItem: { alignItems: 'center', gap: 2, minWidth: 44 },
  crown: { position: 'absolute', top: -3, right: -3, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, minHeight: 48, borderRadius: radius.lg, borderWidth: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  spectator: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
