import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Eye, EyeOff, Flag, MicOff, VideoOff } from 'lucide-react-native';

import type { Participant } from '@/api/types';
import { UserPhoto } from '@/components/UserPhoto';
import { IconButton, PressableScale, Text } from '@/components/ui';
import type { CameraRef } from '@/lib/voice';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

declare const require: (id: string) => any;

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
  videos: Record<string, CameraRef>;
  camerasOn: Set<string>;
  speaking: Record<string, number>;
  /** Friends' videos show automatically; everyone else's stays hidden until tapped. */
  onReveal: (userId: string, visible: boolean) => void;
  onPressTile: (p: Participant) => void;
  onReport: (p: Participant) => void;
  /** Voice rooms: a compact grid of photos with no camera states. */
  compact?: boolean;
  reactions?: { key: string; userId: string; label: string }[];
};

/** Responsive video grid. Shows real video only when the camera is on and the viewer chose to see it. */
export function VideoGrid({ participants, meId, videos, camerasOn, speaking, onReveal, onPressTile, onReport, compact, reactions = [] }: Props) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const n = Math.max(1, participants.length);
  const cols = compact ? 4 : n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const gap = space.sm;
  const tileW = (width - space.lg * 2 - gap * (cols - 1)) / cols;
  const tileH = compact ? tileW * 1.2 : n <= 2 ? tileW * 1.25 : tileW * 1.2;

  return (
    <View style={[styles.grid, { gap }]}>
      {participants.map((p) => {
        const isMe = p.id === meId;
        const camOn = camerasOn.has(p.id);
        const track = videos[p.id];
        const talking = !!speaking[p.id];
        const showPlaceholderReveal = camOn && !track && !isMe;
        return (
          <PressableScale
            key={p.id}
            scaleTo={0.99}
            onPress={() => onPressTile(p)}
            accessibilityLabel={`${isMe ? 'You' : p.display_name}${camOn ? ', camera on' : ', camera off'}${talking ? ', speaking' : ''}${p.muted_by_host ? ', muted' : ''}`}
            style={[styles.tile, { width: tileW, height: tileH, backgroundColor: colors.surfaceAlt, borderColor: talking ? colors.success : 'transparent' }]}
          >
            {track ? (
              <NativeVideo trackRef={track} mirror={isMe} />
            ) : (
              <View style={styles.center}>
                <UserPhoto user={p} size={Math.min(96, tileW * 0.45)} speaking={talking} />
                {showPlaceholderReveal ? (
                  <PressableScale
                    onPress={() => onReveal(p.id, true)}
                    style={[styles.reveal, { backgroundColor: colors.primary }]}
                    accessibilityLabel={`Show ${p.display_name}'s video`}
                  >
                    <Eye size={14} color={colors.onPrimary} />
                    <Text variant="tiny" style={{ color: colors.onPrimary }}>
                      Tap to show video
                    </Text>
                  </PressableScale>
                ) : !camOn && !compact ? (
                  <View style={styles.camOff}>
                    <VideoOff size={12} color={colors.textMuted} />
                    <Text variant="tiny" tone="muted">
                      Camera off
                    </Text>
                  </View>
                ) : null}
              </View>
            )}
            <View style={styles.nameRow}>
              <View style={[styles.namePill, { backgroundColor: 'rgba(16,17,26,0.65)' }]}>
                {p.muted_by_host ? <MicOff size={11} color="#fff" /> : null}
                <Text variant="tiny" style={{ color: '#fff' }} numberOfLines={1}>
                  {isMe ? 'You' : p.display_name}
                </Text>
              </View>
            </View>
            {reactions.find((r) => r.userId === p.id) ? (
              <View style={[styles.reactionChip, { backgroundColor: colors.surfaceRaised }]}>
                <Text variant="tiny">{reactions.find((r) => r.userId === p.id)?.label}</Text>
              </View>
            ) : null}
            {!isMe && !compact ? (
              <View style={styles.tools}>
                {track ? (
                  <IconButton
                    icon={EyeOff}
                    size={30}
                    variant="filled"
                    label={`Hide ${p.display_name}'s video`}
                    onPress={() => onReveal(p.id, false)}
                  />
                ) : null}
                <IconButton icon={Flag} size={30} variant="filled" label={`Report ${p.display_name}`} onPress={() => onReport(p)} />
              </View>
            ) : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  tile: { borderRadius: radius.lg, overflow: 'hidden', borderWidth: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.sm },
  reveal: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  camOff: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  nameRow: { position: 'absolute', left: 6, bottom: 6, right: 6, flexDirection: 'row' },
  namePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, maxWidth: '100%' },
  tools: { position: 'absolute', right: 6, top: 6, gap: 6 },
  reactionChip: { position: 'absolute', left: 6, top: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
});
