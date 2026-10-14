import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Eye, EyeOff, FastForward, House, Lock, MessagesSquare, Moon, PawPrint, Shield, ShieldPlus, Skull, Sun, Vote, type LucideProps } from 'lucide-react-native';

import type { WerewolfBoardView, WerewolfRole } from '@/api/games-extra';
import { UserPhoto } from '@/components/UserPhoto';
import { Button, PressableScale, Text, confirm } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { radius, space } from '@/theme/tokens';
import { nameOf, playerOf, useBoardSize, type GameCtx } from './GameParts';

export const ROLE_META: Record<WerewolfRole, { name: string; icon: ComponentType<LucideProps>; color: string; blurb: string }> = {
  werewolf: { name: 'Werewolf', icon: PawPrint, color: '#E5484D', blurb: 'Each night, pick a victim with your pack. By day, blend in.' },
  seer: { name: 'Seer', icon: Eye, color: '#8E7CFF', blurb: 'Each night, inspect one player to learn if they are a werewolf.' },
  doctor: { name: 'Doctor', icon: ShieldPlus, color: '#3DD68C', blurb: 'Each night, protect one player (yourself too) from the wolves.' },
  villager: { name: 'Villager', icon: House, color: '#E6C77A', blurb: 'Find the wolves by talking and voting. Trust carefully.' },
};

const THEME = {
  night: { from: '#060B1E', to: '#1A2752', text: '#E8ECFF', muted: '#9AA6D6', card: 'rgba(255,255,255,0.07)', border: 'rgba(255,255,255,0.14)', accent: '#9DB4FF' },
  day: { from: '#FBE3B8', to: '#E9A266', text: '#3A2410', muted: '#7A5634', card: 'rgba(255,255,255,0.45)', border: 'rgba(90,50,10,0.18)', accent: '#B4541A' },
};

const PHASE_META = {
  night: { icon: Moon, title: 'Night' },
  day: { icon: Sun, title: 'Morning' },
  discussion: { icon: MessagesSquare, title: 'Discussion' },
  vote: { icon: Vote, title: 'Vote' },
} as const;

const ACTION_VERB: Record<string, string> = { kill: 'Choose victim', inspect: 'Inspect', protect: 'Protect', vote: 'Vote out' };
const ADVANCE_LABEL: Record<WerewolfBoardView['phase'], string> = { night: 'End the night', day: 'Start discussion', discussion: 'Open voting', vote: 'Close the vote' };

function Backdrop({ night, width, height }: { night: boolean; width: number; height: number }) {
  const t = night ? THEME.night : THEME.day;
  // Fixed star field so it doesn't shimmer between renders.
  const stars = [
    [0.08, 0.06], [0.22, 0.12], [0.37, 0.04], [0.55, 0.09], [0.71, 0.05], [0.88, 0.11], [0.15, 0.22], [0.93, 0.25],
    [0.05, 0.4], [0.96, 0.46], [0.1, 0.62], [0.9, 0.7], [0.3, 0.18], [0.64, 0.2], [0.8, 0.33], [0.45, 0.15],
  ];
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="wwSky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={t.from} />
          <Stop offset="1" stopColor={t.to} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} rx={24} fill="url(#wwSky)" />
      {night ? (
        stars.map(([x, y], i) => <Circle key={i} cx={x * width} cy={y * height} r={i % 3 === 0 ? 1.6 : 1} fill="#FFFFFF" opacity={0.4 + (i % 4) * 0.15} />)
      ) : (
        <Circle cx={width * 0.85} cy={height * 0.06} r={width * 0.22} fill="#FFF3C4" opacity={0.35} />
      )}
    </Svg>
  );
}

/** Secret role card: hidden by default so people nearby can't see it; hides itself again after a few seconds. */
function RoleCard({ view, ctx }: { view: WerewolfBoardView; ctx: GameCtx }) {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const role = view.your_role;
  if (!role) return null;
  const meta = ROLE_META[role];
  const Icon = meta.icon;
  const pack = (view.wolves ?? []).filter((p) => p !== ctx.meId);
  const toggle = () => {
    haptic.tap();
    if (timer.current) clearTimeout(timer.current);
    const next = !shown;
    setShown(next);
    timer.current = next ? setTimeout(() => setShown(false), 8000) : null;
  };
  return (
    <PressableScale
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={shown ? `Your role: ${meta.name}. ${meta.blurb}${pack.length ? ` Your pack: ${pack.map((p) => nameOf(ctx, p)).join(', ')}` : ''}. Tap to hide` : 'Your secret role is hidden. Tap to reveal'}
      style={[styles.roleCard, { borderColor: shown ? meta.color : 'rgba(230,199,122,0.5)', backgroundColor: shown ? '#120D1F' : '#1B1430' }]}
    >
      {shown ? (
        <Animated.View entering={FadeIn.duration(180)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={[styles.roleIcon, { backgroundColor: `${meta.color}33` }]}>
            <Icon size={26} color={meta.color} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="tiny" style={{ color: '#B9AED6', letterSpacing: 1.5 }}>
              YOUR ROLE
            </Text>
            <Text variant="heading" style={{ color: meta.color }}>
              {meta.name}
            </Text>
            <Text variant="caption" style={{ color: '#D6CFEA' }}>
              {meta.blurb}
            </Text>
            {pack.length ? (
              <Text variant="caption" style={{ color: '#FF9DA0' }}>
                Your pack: {pack.map((p) => nameOf(ctx, p)).join(', ')}
              </Text>
            ) : null}
          </View>
          <EyeOff size={18} color="#B9AED6" />
        </Animated.View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={[styles.roleIcon, { backgroundColor: 'rgba(230,199,122,0.15)' }]}>
            <Lock size={22} color="#E6C77A" />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" style={{ color: '#F6EFD9' }}>
              Your secret role
            </Text>
            <Text variant="caption" style={{ color: '#B9AED6' }}>
              Tap to peek. Make sure no one is looking.
            </Text>
          </View>
          <Eye size={18} color="#E6C77A" />
        </View>
      )}
    </PressableScale>
  );
}

export function WerewolfTable({ ctx }: { ctx: GameCtx }) {
  const { game, meId, readOnly, pending } = ctx;
  const view = game.board as WerewolfBoardView;
  const finished = view.status !== 'active';
  const night = view.phase === 'night' && !finished;
  const t = night ? THEME.night : THEME.day;
  const width = useBoardSize(480);
  const phaseKey = `${view.phase}-${view.round}`;
  const [pick, setPick] = useState<{ key: string; pid: string } | null>(null);
  const selected = pick?.key === phaseKey ? pick.pid : null;

  const targetActions = readOnly ? [] : game.legal_actions.filter((a) => ['kill', 'inspect', 'protect', 'vote'].includes(a.type));
  const actionType = targetActions[0]?.type ?? null;
  const targets = new Set(targetActions.filter((a) => typeof a.target === 'string').map((a) => a.target as string));
  const canAbstain = targetActions.some((a) => a.type === 'vote' && a.target === null);
  const canAdvance = !readOnly && game.legal_actions.some((a) => a.type === 'advance');
  const alive = new Set(view.alive);
  const amAlive = alive.has(meId);
  const role = view.your_role;

  // Tallies for the open ballot.
  const tally: Record<string, number> = {};
  for (const target of Object.values(view.votes ?? {})) if (target) tally[target] = (tally[target] ?? 0) + 1;
  const wolfPicks: Record<string, number> = {};
  for (const target of Object.values(view.wolf_votes ?? {})) wolfPicks[target] = (wolfPicks[target] ?? 0) + 1;
  const seerById = new Map((view.seer_results ?? []).map((r) => [r.target, r.is_werewolf]));

  const n = view.players.length;
  const seat = n <= 6 ? 58 : n <= 9 ? 50 : 42;
  const circle = width - 24;
  const R = circle / 2 - seat / 2 - 18;

  const send = async (action: { type: string; target?: string | null }) => {
    const ok = await ctx.act(action);
    if (ok) setPick(null);
  };

  const advance = async () => {
    if (view.phase === 'night' || view.phase === 'vote') {
      const ok = await confirm({
        title: view.phase === 'night' ? 'End the night now?' : 'Close the vote now?',
        message: view.phase === 'night' ? "Anyone who hasn't acted yet loses their night action." : "Anyone who hasn't voted counts as abstaining.",
        confirmLabel: ADVANCE_LABEL[view.phase],
      });
      if (!ok) return;
    }
    ctx.act({ type: 'advance' });
  };

  // Instructions for this viewer.
  const instruction = (() => {
    if (finished) return view.winner === 'village' ? 'The village wins! Every wolf was found.' : 'The wolves win. The village has fallen.';
    if (!game.players.some((p) => p.id === meId)) return 'You are watching this game.';
    if (!amAlive && view.phase !== 'day') return "You're out. Watch quietly and don't give anything away.";
    switch (view.phase) {
      case 'night':
        if (role === 'werewolf') return actionType ? 'Pick tonight’s victim with your pack.' : 'Your pick is in. Waiting for the night to end.';
        if (role === 'seer') {
          const tonight = (view.seer_results ?? []).find((r) => r.round === view.round);
          return actionType ? 'Choose someone to inspect.' : tonight ? `${nameOf(ctx, tonight.target)} is ${tonight.is_werewolf ? 'a WEREWOLF' : 'not a werewolf'}.` : 'Waiting for the night to end.';
        }
        if (role === 'doctor') return actionType ? 'Choose someone to protect tonight (yourself allowed).' : `You're protecting ${nameOf(ctx, view.protected_tonight, 'yourself')} tonight.`;
        return 'Night has fallen. Close your eyes while others act.';
      case 'day': {
        const killed = view.last_night?.killed;
        return killed ? `${nameOf(ctx, killed)} ${killed === meId ? 'were' : 'was'} found dead this morning.` : 'Everyone survived the night.';
      }
      case 'discussion':
        return 'Talk it through on the call. Who seems suspicious?';
      case 'vote':
        return actionType ? 'Tap a player to vote them out, or abstain.' : 'Vote cast. Waiting for everyone else.';
    }
  })();

  const PhaseIcon = finished ? (view.winner === 'village' ? Sun : PawPrint) : PHASE_META[view.phase].icon;

  return (
    <View style={{ gap: space.md }}>
      {!readOnly ? <RoleCard view={view} ctx={ctx} /> : null}

      <View style={[styles.table, { width, alignSelf: 'center' }]}>
        <Backdrop night={night} width={width} height={width + 120} />
        {/* Phase banner */}
        <View style={styles.banner} accessible accessibilityLiveRegion="polite" accessibilityLabel={`${finished ? 'Game over' : `${PHASE_META[view.phase].title}, round ${view.round}`}. ${instruction}`}>
          <View style={[styles.bannerIcon, { backgroundColor: t.card, borderColor: t.border }]}>
            <PhaseIcon size={18} color={t.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="tiny" style={{ color: t.muted, letterSpacing: 1.5 }}>
              {finished ? 'GAME OVER' : `${PHASE_META[view.phase].title.toUpperCase()} · ROUND ${view.round}`}
            </Text>
            <Text variant="bodyStrong" style={{ color: t.text }}>
              {instruction}
            </Text>
          </View>
        </View>

        {/* Players in a circle */}
        <View style={{ width: circle, height: circle, alignSelf: 'center' }}>
          <View style={[styles.centre, { left: circle / 2 - 46, top: circle / 2 - 46, borderColor: t.border, backgroundColor: t.card }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <PhaseIcon size={34} color={t.accent} />
            <Text variant="tiny" style={{ color: t.muted }}>
              {view.alive.length} alive
            </Text>
          </View>
          {view.players.map((pid, i) => {
            const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
            const cx = circle / 2 + Math.cos(a) * R;
            const cy = circle / 2 + Math.sin(a) * R;
            const p = playerOf(game, pid);
            const dead = !alive.has(pid);
            const isTarget = targets.has(pid);
            const isSel = selected === pid;
            const shownRole = view.roles?.[pid] ?? (pid === meId ? role : view.wolves?.includes(pid) ? 'werewolf' : null);
            const seer = seerById.get(pid);
            const votes = tally[pid] ?? 0;
            const picks = wolfPicks[pid] ?? 0;
            const voted = view.phase === 'vote' && pid in (view.votes ?? {});
            const label = `${nameOf(ctx, pid)}${dead ? ', dead' : ''}${shownRole && (finished || pid === meId || role === 'werewolf') ? `, ${ROLE_META[shownRole].name}` : ''}${seer !== undefined ? `, inspected: ${seer ? 'werewolf' : 'not a werewolf'}` : ''}${votes ? `, ${votes} votes` : ''}${picks ? `, ${picks} wolf picks` : ''}${voted ? ', has voted' : ''}${isTarget ? `. Tap to ${ACTION_VERB[actionType ?? '']?.toLowerCase()}` : ''}`;
            return (
              <Pressable
                key={pid}
                onPress={() => {
                  if (!isTarget || pending) return;
                  haptic.tap();
                  setPick(isSel ? null : { key: phaseKey, pid });
                }}
                disabled={!isTarget}
                accessibilityRole={isTarget ? 'button' : undefined}
                accessibilityState={{ selected: isSel, disabled: !isTarget }}
                accessibilityLabel={label}
                style={[styles.seat, { left: cx - seat / 2 - 10, top: cy - seat / 2 - 6, width: seat + 20 }]}
              >
                <View style={{ borderRadius: 999, padding: 2, borderWidth: 3, borderColor: isSel ? '#FFD34D' : isTarget ? t.accent : 'transparent', opacity: dead ? 0.38 : 1 }}>
                  <UserPhoto user={p} size={seat} showVerified={false} />
                  {dead ? (
                    <View style={[styles.deadOverlay, { borderRadius: seat }]}>
                      <Skull size={seat * 0.42} color="#FFFFFF" />
                    </View>
                  ) : null}
                </View>
                {votes || picks ? (
                  <View style={[styles.countBadge, { backgroundColor: picks ? '#E5484D' : '#FFD34D' }]}>
                    {picks ? <PawPrint size={10} color="#fff" /> : null}
                    <Text variant="tiny" style={{ color: picks ? '#fff' : '#2A1B00' }}>
                      {votes || picks}
                    </Text>
                  </View>
                ) : null}
                {seer !== undefined ? (
                  <View style={[styles.cornerBadge, { backgroundColor: seer ? '#E5484D' : '#3DD68C' }]}>
                    <Eye size={10} color="#fff" />
                  </View>
                ) : view.protected_tonight === pid ? (
                  <View style={[styles.cornerBadge, { backgroundColor: '#3DD68C' }]}>
                    <Shield size={10} color="#fff" />
                  </View>
                ) : null}
                <Text variant="tiny" numberOfLines={1} style={{ color: dead ? t.muted : t.text, maxWidth: seat + 20, textDecorationLine: dead ? 'line-through' : 'none' }}>
                  {pid === meId ? 'You' : (p?.display_name ?? 'Player')}
                </Text>
                {shownRole && (finished || pid === meId || shownRole === 'werewolf') ? (
                  <Text variant="tiny" numberOfLines={1} style={{ color: ROLE_META[shownRole].color }}>
                    {ROLE_META[shownRole].name}
                  </Text>
                ) : voted ? (
                  <Text variant="tiny" style={{ color: t.muted }}>
                    voted
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {/* Action area */}
        {actionType ? (
          <View style={[styles.actionBox, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text variant="label" style={{ color: t.text }}>
              {selected ? `${ACTION_VERB[actionType]}: ${nameOf(ctx, selected, 'yourself')}?` : `Tap a highlighted player to ${ACTION_VERB[actionType].toLowerCase()}.`}
            </Text>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button
                title={selected ? `Confirm` : 'Pick someone'}
                onPress={() => selected && send({ type: actionType, target: selected })}
                disabled={!selected || pending}
                loading={pending && !!selected}
                variant={actionType === 'kill' ? 'danger' : 'primary'}
                style={{ flex: 1 }}
              />
              {canAbstain ? <Button title="Abstain" variant="secondary" onPress={() => send({ type: 'vote', target: null })} disabled={pending} style={{ flex: 1 }} /> : null}
            </View>
          </View>
        ) : null}

        {canAdvance ? (
          <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}>
            <Button title={ADVANCE_LABEL[view.phase]} icon={FastForward} variant="secondary" onPress={advance} disabled={pending} accessibilityHint="Host only: moves everyone to the next phase" fullWidth />
          </View>
        ) : null}
      </View>

      {/* Recaps */}
      {view.last_vote && !finished && view.phase === 'night' ? (
        <View style={styles.recap}>
          <Vote size={16} color="#B4541A" />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            {view.last_vote.eliminated ? `The village voted out ${nameOf(ctx, view.last_vote.eliminated, 'you')}.` : 'Nobody was voted out last round.'}
          </Text>
        </View>
      ) : null}

      {view.seer_results?.length && (role === 'seer' || finished) ? (
        <View style={{ gap: space.xs }}>
          <Text variant="label" tone="muted">
            {finished ? "The seer's visions" : 'Your visions'}
          </Text>
          {view.seer_results.map((r) => (
            <View key={`${r.round}-${r.target}`} style={styles.recap}>
              <Eye size={16} color={r.is_werewolf ? '#E5484D' : '#3DD68C'} />
              <Text variant="caption" style={{ flex: 1 }}>
                Night {r.round}: {nameOf(ctx, r.target)} {r.is_werewolf ? 'is a werewolf' : 'is not a werewolf'}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {view.deaths.length ? (
        <View style={{ gap: space.xs }}>
          <Text variant="label" tone="muted">
            Fallen
          </Text>
          {view.deaths.map((d) => (
            <View key={`${d.round}-${d.player_id}`} style={styles.recap}>
              <Skull size={16} color="#8A8FA3" />
              <Text variant="caption" style={{ flex: 1 }}>
                {nameOf(ctx, d.player_id)}: {d.cause === 'wolves' ? `taken by wolves, night ${d.round}` : d.cause === 'vote' ? `voted out, round ${d.round}` : 'left the game'}
                {view.roles?.[d.player_id] ? ` (${ROLE_META[view.roles[d.player_id]].name})` : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text variant="caption" tone="faint" center>
        {(Object.keys(ROLE_META) as WerewolfRole[])
          .filter((r) => view.role_counts[r])
          .map((r) => `${view.role_counts[r]} ${ROLE_META[r].name.toLowerCase()}${view.role_counts[r] > 1 ? 's' : ''}`)
          .join(' · ')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  table: { borderRadius: 24, overflow: 'hidden', paddingTop: space.lg },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg },
  bannerIcon: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  centre: { position: 'absolute', width: 92, height: 92, borderRadius: 46, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  seat: { position: 'absolute', alignItems: 'center', gap: 1 },
  deadOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  countBadge: { position: 'absolute', top: -2, right: 4, minWidth: 20, height: 20, paddingHorizontal: 4, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  cornerBadge: { position: 'absolute', top: -2, left: 4, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionBox: { marginHorizontal: space.lg, marginBottom: space.md, padding: space.md, gap: space.sm, borderRadius: radius.lg, borderWidth: 1 },
  recap: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32 },
  roleCard: { padding: space.lg, borderRadius: radius.xl, borderWidth: 1.5 },
  roleIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
