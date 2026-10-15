import { StyleSheet, View } from 'react-native';
import { ChevronDown, ChevronUp, Eye, Headphones, VolumeX } from 'lucide-react-native';

import type { Participant } from '@/api/types';
import { UserPhoto } from '@/components/UserPhoto';
import { PressableScale, Text } from '@/components/ui';
import type { CameraRef, VoiceControls } from '@/lib/voice';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

declare const require: (id: string) => any;

const SIZE = 64;

/** LiveKit's VideoTrack is native-only; load it lazily so Expo Go never touches it. */
function NativeVideo({ trackRef, mirror }: { trackRef: CameraRef; mirror?: boolean }) {
  let VideoTrack: any = null;
  try {
    VideoTrack = require('@livekit/react-native').VideoTrack;
  } catch {
    return null;
  }
  return <VideoTrack trackRef={trackRef} style={StyleSheet.absoluteFill} objectFit="cover" mirror={mirror} />;
}

type Props = {
  participants: Participant[];
  meId: string;
  voice: VoiceControls;
  minimised: boolean;
  onToggleMinimised: () => void;
  /** Show a hidden camera (strangers' videos stay hidden until tapped). */
  onReveal: (userId: string) => void;
  onPressPerson: (p: Participant) => void;
  top: number;
};

/** Floating face bubbles for the in-game call. Real video only when the camera is on and you chose to see it. */
export function FaceBubbles({ participants, meId, voice, minimised, onToggleMinimised, onReveal, onPressPerson, top }: Props) {
  const { colors } = useTheme();
  const anyoneSpeaking = participants.some((p) => !!voice.speaking[p.id]);

  if (minimised) {
    return (
      <View style={[styles.wrap, { top }]} pointerEvents="box-none">
        <PressableScale
          onPress={onToggleMinimised}
          hapticFeedback="tap"
          accessibilityLabel={`Show call faces, ${participants.length} in the call`}
          style={[styles.pill, { backgroundColor: colors.surfaceRaised, borderColor: anyoneSpeaking ? colors.success : colors.border }]}
        >
          <Headphones size={14} color={anyoneSpeaking ? colors.success : colors.text} />
          <Text variant="tiny">{participants.length}</Text>
          <ChevronDown size={14} color={colors.textMuted} />
        </PressableScale>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { top }]} pointerEvents="box-none">
      <PressableScale onPress={onToggleMinimised} hapticFeedback="tap" accessibilityLabel="Minimise call faces" style={[styles.collapse, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
        <ChevronUp size={14} color={colors.textMuted} />
      </PressableScale>
      {participants.map((p) => {
        const isMe = p.id === meId;
        const track = voice.videos[p.id];
        const camOn = voice.camerasOn.has(p.id);
        const talking = !!voice.speaking[p.id];
        const mutedForMe = voice.audioMuted.has(p.id);
        const hiddenCam = camOn && !track && !isMe;
        return (
          <View key={p.id} style={{ alignItems: 'center' }}>
            <PressableScale
              onPress={() => onPressPerson(p)}
              hapticFeedback="tap"
              accessibilityLabel={`${isMe ? 'You' : p.display_name}${camOn ? ', camera on' : ''}${talking ? ', speaking' : ''}${mutedForMe ? ', muted for you' : ''}`}
              accessibilityHint={isMe ? undefined : 'Opens options for this person'}
              style={[styles.bubble, { backgroundColor: colors.surfaceAlt, borderColor: talking ? colors.success : colors.surfaceRaised }]}
            >
              {track ? <NativeVideo trackRef={track} mirror={isMe} /> : <UserPhoto user={p} size={SIZE - 6} showVerified={false} />}
            </PressableScale>
            {hiddenCam ? (
              <PressableScale
                onPress={() => onReveal(p.id)}
                hapticFeedback="tap"
                accessibilityLabel={`Show ${p.display_name}'s video`}
                style={[styles.badge, { backgroundColor: colors.primary }]}
              >
                <Eye size={12} color={colors.onPrimary} />
              </PressableScale>
            ) : mutedForMe ? (
              <View style={[styles.badge, { backgroundColor: colors.surfaceRaised }]}>
                <VolumeX size={12} color={colors.textMuted} />
              </View>
            ) : null}
            <Text variant="tiny" numberOfLines={1} style={styles.name}>
              {isMe ? 'You' : p.display_name}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: space.sm, gap: space.xs, alignItems: 'center', zIndex: 20 },
  bubble: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, overflow: 'hidden', borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: -2, top: SIZE - 22, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  name: { maxWidth: SIZE + 8, marginTop: 2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 32, borderRadius: radius.pill, borderWidth: 2 },
  collapse: { width: 32, height: 24, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
});
