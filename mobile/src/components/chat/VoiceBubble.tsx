import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Pause, Play } from 'lucide-react-native';

import { PressableScale, Text } from '@/components/ui';
import { formatDuration, loadAudio } from '@/lib/audio';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

type Props = {
  url?: string | null;
  durationMs?: number | null;
  mine: boolean;
  failed?: boolean;
};

// Only one voice note plays at a time.
let pauseCurrent: (() => void) | null = null;

/**
 * A voice note: play/pause, progress and length. The audio player is only created after the first tap,
 * so long chats don't load every recording.
 */
export function VoiceBubble({ url, durationMs, mine, failed }: Props) {
  const [started, setStarted] = useState(false);
  const supported = !!loadAudio();
  const length = durationMs ?? 0;
  if (started && url && supported) return <ActivePlayer url={url} durationMs={length} mine={mine} />;
  return (
    <Shell
      mine={mine && !failed}
      playing={false}
      progress={0}
      label={formatDuration(length)}
      disabled={!url || !supported}
      hint={!supported ? 'Update the app to play voice notes' : undefined}
      onToggle={() => setStarted(true)}
    />
  );
}

function ActivePlayer({ url, durationMs, mine }: { url: string; durationMs: number; mine: boolean }) {
  const audio = loadAudio()!;
  const player = audio.useAudioPlayer(url, { updateInterval: 200 });
  const status = audio.useAudioPlayerStatus(player);
  const autoplayed = useRef(false);

  useEffect(() => {
    const pause = () => player.pause();
    if (!autoplayed.current && status.isLoaded) {
      autoplayed.current = true;
      pauseCurrent?.();
      pauseCurrent = pause;
      audio.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => undefined);
      player.play();
    }
  }, [status.isLoaded, player, audio]);

  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      player.seekTo(0).catch(() => undefined);
    }
  }, [status.didJustFinish, player]);

  const total = status.duration > 0 ? status.duration * 1000 : durationMs;
  const position = status.currentTime * 1000;
  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    pauseCurrent?.();
    pauseCurrent = () => player.pause();
    if (total && position >= total - 150) player.seekTo(0).catch(() => undefined);
    player.play();
  };

  return (
    <Shell
      mine={mine}
      playing={status.playing}
      loading={!status.isLoaded}
      progress={total ? Math.min(1, position / total) : 0}
      label={status.playing || position > 0 ? formatDuration(position) : formatDuration(total)}
      onToggle={toggle}
    />
  );
}

function Shell({
  mine,
  playing,
  loading,
  progress,
  label,
  disabled,
  hint,
  onToggle,
}: {
  mine: boolean;
  playing: boolean;
  loading?: boolean;
  progress: number;
  label: string;
  disabled?: boolean;
  hint?: string;
  onToggle: () => void;
}) {
  const { colors } = useTheme();
  const fg = mine ? colors.onPrimary : colors.text;
  const track = mine ? 'rgba(255,255,255,0.35)' : colors.border;
  const Icon = playing ? Pause : Play;
  return (
    <View style={styles.row}>
      <PressableScale
        onPress={onToggle}
        disabled={disabled || loading}
        hitSlop={8}
        accessibilityLabel={playing ? 'Pause voice note' : `Play voice note, ${label}`}
        accessibilityHint={hint}
        style={[styles.btn, { backgroundColor: mine ? 'rgba(255,255,255,0.2)' : colors.surface }]}
      >
        {loading ? <ActivityIndicator size="small" color={fg} /> : <Icon size={18} color={fg} fill={fg} />}
      </PressableScale>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={[styles.track, { backgroundColor: track }]}>
          <View style={[styles.fill, { width: `${Math.round(progress * 100)}%`, backgroundColor: fg }]} />
        </View>
        <Text variant="caption" style={{ color: fg, opacity: 0.85 }}>
          {hint ? `${label} · ${hint}` : label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minWidth: 190,
    paddingVertical: 2,
  },
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
});
