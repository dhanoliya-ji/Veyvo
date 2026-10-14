import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Coffee, Play, SkipForward, Square, Timer } from 'lucide-react-native';

import type { TimerState } from '@/api/types';
import { Button, ProgressBar, Text } from '@/components/ui';
import { countdown } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

type Props = {
  timer: TimerState | null;
  isHost: boolean;
  busy: boolean;
  onControl: (action: 'start' | 'skip' | 'stop') => void;
};

/** Shared pomodoro timer for study rooms. The server owns the clock; we only count down to `phase_ends_at`. */
export function FocusTimerCard({ timer, isHost, busy, onControl }: Props) {
  const { colors } = useTheme();
  const [now, setNow] = useState(Date.now());
  const phase = timer?.phase ?? 'idle';
  const endsAt = timer?.phase_ends_at ? new Date(timer.phase_ends_at).getTime() : null;

  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);

  const total = ((phase === 'focus' ? timer?.focus_minutes : timer?.break_minutes) ?? 25) * 60_000;
  const left = endsAt ? Math.max(0, endsAt - now) : 0;
  const tint = phase === 'focus' ? colors.primary : phase === 'break' ? colors.success : colors.textMuted;
  const Icon = phase === 'break' ? Coffee : Timer;
  const title = phase === 'focus' ? 'Focus time' : phase === 'break' ? 'Break time' : 'Timer not started';
  const subtitle =
    phase === 'idle'
      ? isHost
        ? `Start a ${timer?.focus_minutes ?? 25} min focus block when everyone's ready.`
        : 'The host will start the focus timer.'
      : phase === 'focus'
        ? `Round ${timer?.cycle ?? 1} · chat opens on the break`
        : `Round ${timer?.cycle ?? 1} · stretch, sip, chat`;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessible={!isHost}
      accessibilityLabel={`${title}. ${endsAt ? `${countdown(left)} left.` : ''} ${subtitle}`}
    >
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: `${tint}22` }]}>
          <Icon size={18} color={tint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        </View>
        {endsAt ? (
          <Text variant="title" style={{ color: tint, fontVariant: ['tabular-nums'] }} accessibilityLiveRegion="none">
            {countdown(left)}
          </Text>
        ) : null}
      </View>
      {endsAt ? <ProgressBar value={1 - left / total} color={tint} /> : null}
      {isHost ? (
        <View style={styles.row}>
          {phase === 'idle' ? (
            <Button title="Start focus" icon={Play} size="sm" onPress={() => onControl('start')} loading={busy} style={{ flex: 1 }} />
          ) : (
            <>
              <Button
                title={phase === 'focus' ? 'Skip to break' : 'Skip to focus'}
                icon={SkipForward}
                size="sm"
                variant="secondary"
                onPress={() => onControl('skip')}
                disabled={busy}
                style={{ flex: 1 }}
              />
              <Button title="Stop" icon={Square} size="sm" variant="outline" onPress={() => onControl('stop')} disabled={busy} />
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.md, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
