import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Headphones, Mic, MicOff, PhoneOff, RefreshCw, ShieldCheck, SwitchCamera, Users, Video, VideoOff } from 'lucide-react-native';

import { ControlButton } from '@/components/room/ControlButton';
import { Button, PressableScale, Text } from '@/components/ui';
import { VOICE_COPY } from '@/lib/voice';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import type { GameCall } from './useGameCall';

type Props = {
  call: GameCall;
  facesHidden: boolean;
  onToggleFaces: () => void;
};

/** The in-game call bar: join or start a call, then mic, camera, flip, faces and leave. Hidden when voice isn't available. */
export function GameCallBar({ call, facesHidden, onToggleFaces }: Props) {
  const { colors } = useTheme();
  const { voice, room } = call;
  if (!call.available) return null;

  if (!call.inCall) {
    return (
      <View style={[styles.invite, { backgroundColor: call.live ? colors.successSoft : colors.surfaceAlt }]}>
        <Headphones size={18} color={call.live ? colors.success : colors.textMuted} />
        <Text variant="label" style={{ flex: 1 }} numberOfLines={2}>
          {call.live ? `Call going · ${call.count} in the call` : 'Talk while you play. Only players can join.'}
        </Text>
        <Button
          title={call.live ? 'Join call' : 'Start call'}
          size="sm"
          variant={call.live ? 'primary' : 'secondary'}
          loading={call.joining}
          onPress={call.join}
          accessibilityHint="Your mic and camera start off. Tap to turn them on."
        />
      </View>
    );
  }

  const ready = voice.state === 'connected';
  const canVideo = !!room?.can_video;
  const needsVerify = !!room?.video_requires_verification && !canVideo;
  const connecting = voice.state === 'connecting' || voice.state === 'reconnecting' || (!room && call.inCall);
  const problem = voice.state === 'failed' || voice.state === 'disconnected' ? voice.error ?? VOICE_COPY.failed : voice.micBlocked ? VOICE_COPY.micBlocked : null;

  const pressCamera = () => {
    if (!canVideo && !voice.camOn) {
      if (needsVerify) router.push('/verification');
      else toast.show({ title: 'The host turned your camera off', tone: 'warning' });
      return;
    }
    voice.toggleCamera();
  };

  return (
    <View style={[styles.wrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {connecting || problem ? (
        <View style={styles.status} accessibilityLiveRegion="polite">
          {connecting && !problem ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
          <Text variant="caption" tone={problem ? 'warning' : 'muted'} style={{ flex: 1 }} numberOfLines={2}>
            {problem ?? 'Connecting to the call...'}
          </Text>
          {problem ? (
            voice.micBlocked ? (
              <Button title="Open settings" size="sm" variant="ghost" onPress={voice.openSettings} />
            ) : (
              <Button title="Retry" size="sm" variant="ghost" icon={RefreshCw} onPress={voice.retry} />
            )
          ) : null}
        </View>
      ) : null}
      <View style={styles.controls}>
        <ControlButton
          icon={voice.micOn ? Mic : MicOff}
          label={voice.micOn ? 'Mic on' : 'Mic off'}
          tone={voice.micOn ? 'on' : 'off'}
          busy={voice.micBusy}
          disabled={!ready || !room?.can_speak}
          onPress={voice.toggleMic}
          accessibilityLabel={voice.micOn ? 'Turn microphone off' : 'Turn microphone on'}
        />
        <ControlButton
          icon={voice.camOn ? Video : VideoOff}
          label={voice.camOn ? 'Camera on' : 'Camera'}
          tone={voice.camOn ? 'on' : 'off'}
          busy={voice.camBusy}
          disabled={!ready}
          onPress={pressCamera}
          accessibilityLabel={voice.camOn ? 'Turn camera off' : needsVerify ? 'Camera needs verification' : 'Turn camera on'}
        />
        {voice.camOn ? <ControlButton icon={SwitchCamera} label="Flip" onPress={voice.flipCamera} accessibilityLabel="Switch between front and back camera" /> : null}
        <ControlButton icon={Users} label={facesHidden ? 'Show faces' : 'Faces'} active={!facesHidden} onPress={onToggleFaces} accessibilityLabel={facesHidden ? 'Show call faces' : 'Minimise call faces'} />
        <View style={{ flex: 1 }} />
        <PressableScale onPress={call.leave} hapticFeedback="medium" accessibilityRole="button" accessibilityLabel="Leave call" style={[styles.leave, { backgroundColor: colors.danger }]}>
          <PhoneOff size={18} color="#FFFFFF" />
          <Text variant="button" style={{ color: '#FFFFFF' }}>
            Leave call
          </Text>
        </PressableScale>
      </View>
      {needsVerify ? (
        <PressableScale onPress={() => router.push('/verification')} accessibilityRole="link" accessibilityLabel="Verify to use camera" style={[styles.verify, { backgroundColor: colors.primarySoft }]}>
          <ShieldCheck size={16} color={colors.primary} />
          <Text variant="caption" tone="primary" style={{ flex: 1 }}>
            Verify to use camera. Without it, your camera works only when everyone else here is your friend.
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  invite: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.md, paddingRight: space.xs, paddingVertical: space.xs, borderRadius: radius.md, minHeight: 48 },
  wrap: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.sm, gap: space.sm },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xs },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  leave: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, height: 48, borderRadius: radius.pill, justifyContent: 'center' },
  verify: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.md, minHeight: 44 },
});
