import { useEffect, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { Mic } from 'lucide-react-native';

import { Text } from '@/components/ui';
import { formatDuration, loadAudio } from '@/lib/audio';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';

export const MAX_VOICE_MS = 60_000;
const MIN_VOICE_MS = 700;
const CANCEL_DX = -90;

export type RecordingState = { ms: number; cancelling: boolean };

type Props = {
  disabled?: boolean;
  size?: number;
  /** Called while recording (null when it stops) so the composer can show the timer bar. */
  onRecordingChange: (state: RecordingState | null) => void;
  onRecorded: (uri: string, durationMs: number) => void;
};

/** Hold to record a voice note, release to send, slide left to cancel. Hidden when expo-audio isn't in this build. */
export function VoiceRecordButton(props: Props) {
  if (!loadAudio()) return null;
  return <Recorder {...props} />;
}

function Recorder({ disabled, size = 48, onRecordingChange, onRecorded }: Props) {
  const audio = loadAudio()!;
  const { colors } = useTheme();
  const recorder = audio.useAudioRecorder(audio.RecordingPresets.HIGH_QUALITY);
  const [active, setActive] = useState(false);

  const startedAt = useRef(0);
  const starting = useRef<Promise<boolean> | null>(null);
  const cancelling = useRef(false);
  const recording = useRef(false);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const permission = useRef<boolean | null>(null);
  const cbs = useRef({ onRecordingChange, onRecorded });
  cbs.current = { onRecordingChange, onRecorded };

  const clearTick = () => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
  };

  const finish = async (send: boolean) => {
    const ok = starting.current ? await starting.current : false;
    starting.current = null;
    clearTick();
    setActive(false);
    cbs.current.onRecordingChange(null);
    if (!ok || !recording.current) return;
    recording.current = false;
    const elapsed = Date.now() - startedAt.current;
    try {
      await recorder.stop();
    } catch {
      /* already stopped */
    }
    audio.setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    const uri = recorder.uri;
    if (!send || cancelling.current) {
      haptic.light();
      return;
    }
    if (elapsed < MIN_VOICE_MS || !uri) {
      toast.show({
        title: 'Hold to record',
        message: 'Keep holding the mic while you talk, then let go to send.',
      });
      return;
    }
    haptic.success();
    cbs.current.onRecorded(uri, Math.min(elapsed, MAX_VOICE_MS));
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const start = async (): Promise<boolean> => {
    try {
      if (permission.current !== true) {
        const res = await audio.requestRecordingPermissionsAsync();
        const firstAsk = permission.current === null && res.canAskAgain !== false && !res.granted;
        permission.current = res.granted;
        if (!res.granted) {
          toast.show({
            title: 'Microphone needed',
            message: firstAsk ? 'Allow the microphone to send voice notes.' : 'Turn on microphone access for Veyvo in your phone settings.',
            tone: 'warning',
          });
          return false;
        }
        // The permission prompt interrupted the press; ask them to hold again.
        if (!pressing.current) return false;
      }
      await audio.setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recording.current = true;
      startedAt.current = Date.now();
      haptic.medium();
      tick.current = setInterval(() => {
        const ms = Date.now() - startedAt.current;
        cbs.current.onRecordingChange({ ms, cancelling: cancelling.current });
        if (ms >= MAX_VOICE_MS) finishRef.current(true);
      }, 200);
      return true;
    } catch {
      toast.error("Couldn't start recording", 'Please try again.');
      return false;
    }
  };

  const pressing = useRef(false);
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        pressing.current = true;
        cancelling.current = false;
        setActive(true);
        cbs.current.onRecordingChange({ ms: 0, cancelling: false });
        starting.current = start();
      },
      onPanResponderMove: (_e, g) => {
        const next = g.dx < CANCEL_DX;
        if (next !== cancelling.current) {
          cancelling.current = next;
          haptic.light();
          cbs.current.onRecordingChange({
            ms: Date.now() - startedAt.current,
            cancelling: next,
          });
        }
      },
      onPanResponderRelease: () => {
        pressing.current = false;
        finishRef.current(true);
      },
      onPanResponderTerminate: () => {
        pressing.current = false;
        cancelling.current = true;
        finishRef.current(false);
      },
    }),
  ).current;

  useEffect(
    () => () => {
      clearTick();
      if (recording.current) recorder.stop().catch(() => undefined);
    },
    [recorder],
  );

  return (
    <View
      {...(disabled ? {} : responder.panHandlers)}
      accessible
      accessibilityRole="button"
      accessibilityLabel="Record a voice note"
      accessibilityHint="Hold to record, let go to send, slide left to cancel. Up to 60 seconds."
      accessibilityState={{ disabled }}
      style={[
        styles.btn,
        {
          width: active ? size + 12 : size,
          height: active ? size + 12 : size,
          borderRadius: size,
          backgroundColor: active ? colors.danger : colors.surfaceAlt,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Mic size={22} color={active ? '#fff' : colors.text} />
    </View>
  );
}

/** Shown in place of the text box while recording. */
export function RecordingBar({ state }: { state: RecordingState }) {
  const { colors } = useTheme();
  const left = MAX_VOICE_MS - state.ms;
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.surface,
          borderColor: state.cancelling ? colors.danger : colors.border,
        },
      ]}
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.dot, { backgroundColor: colors.danger }]} />
      <TextLine color={colors.text}>{formatDuration(state.ms)}</TextLine>
      <View style={{ flex: 1 }} />
      <TextLine color={state.cancelling ? colors.danger : colors.textMuted}>
        {state.cancelling ? 'Let go to cancel' : left <= 10_000 ? `${Math.ceil(left / 1000)}s left` : '‹ Slide to cancel'}
      </TextLine>
    </View>
  );
}

function TextLine({ children, color }: { children: string; color: string }) {
  return (
    <Text variant="bodyStrong" style={{ color }}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center' },
  bar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    borderWidth: 1.5,
    borderRadius: 24,
    paddingHorizontal: 16,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
