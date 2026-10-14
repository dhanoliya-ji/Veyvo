import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Hand, MicOff } from 'lucide-react-native';

import type { AvatarConfig, Scene } from '@/api/types';
import { Avatar } from '@/components/avatar/Avatar';
import { PressableScale, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/tokens';
import { SCENE_SEATS, SceneBackground } from './SceneBackground';

export type StageSeat = {
  id: string;
  name: string;
  avatar: Partial<AvatarConfig>;
  /** 0..1 audio level from the media SDK; only non-zero when real audio is detected. */
  level?: number;
  speaking?: boolean;
  muted?: boolean;
  handRaised?: boolean;
  badge?: string;
};

type Props = {
  scene: Scene;
  seats: StageSeat[];
  height?: number;
  onPressSeat?: (seat: StageSeat) => void;
  /** Floating emoji-free reactions keyed by user id. */
  reactions?: { key: string; userId: string; label: string }[];
};

function SeatView({ seat, size, onPress }: { seat: StageSeat; size: number; onPress?: () => void }) {
  const { colors, reduceMotion } = useTheme();
  const ring = useSharedValue(0);
  useEffect(() => {
    if (seat.speaking && !reduceMotion) {
      ring.value = withRepeat(withSequence(withTiming(1, { duration: 380 }), withTiming(0.55, { duration: 380 })), -1, true);
    } else {
      ring.value = withTiming(seat.speaking ? 1 : 0, { duration: 160 });
    }
  }, [seat.speaking, reduceMotion, ring]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.value, transform: [{ scale: 1 + ring.value * 0.08 }] }));

  const label = `${seat.name}${seat.badge ? `, ${seat.badge}` : ''}${seat.speaking ? ', speaking' : ''}${seat.muted ? ', muted' : ''}${seat.handRaised ? ', hand raised' : ''}`;
  return (
    <PressableScale onPress={onPress} disabled={!onPress} accessibilityLabel={label} style={{ alignItems: 'center', width: size + 28 }}>
      <View style={{ width: size + 8, height: size + 8, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: size, borderWidth: 3, borderColor: colors.success }, ringStyle]} />
        <Avatar config={seat.avatar} size={size} talking={seat.speaking ? Math.max(0.25, seat.level ?? 0.5) : 0} />
        {seat.muted ? (
          <View style={[styles.corner, { right: -2, bottom: -2, backgroundColor: colors.danger }]}>
            <MicOff size={11} color="#fff" />
          </View>
        ) : null}
        {seat.handRaised ? (
          <View style={[styles.corner, { right: -2, top: -2, backgroundColor: colors.warning }]}>
            <Hand size={11} color="#2A1F05" />
          </View>
        ) : null}
      </View>
      <View style={[styles.name, { backgroundColor: 'rgba(16,17,26,0.72)' }]}>
        <Text variant="tiny" style={{ color: '#F5F5FB' }} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          {seat.name}
        </Text>
      </View>
    </PressableScale>
  );
}

/** Avatars "sitting" together in the hangout's scene. Overflow beyond the seats is summarised. */
export function SceneStage({ scene, seats, height = 240, onPressSeat, reactions = [] }: Props) {
  const [width, setWidth] = useState(0);
  const visible = seats.slice(0, SCENE_SEATS.length);
  const overflow = seats.length - visible.length;
  const size = width < 360 ? 46 : 54;

  return (
    <View style={[styles.stage, { height }]} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <SceneBackground scene={scene} />
      {width > 0
        ? visible.map((seat, i) => {
            const [fx, fy] = SCENE_SEATS[i];
            const left = fx * width - (size + 28) / 2;
            const top = fy * height - size - 6;
            const reaction = reactions.find((r) => r.userId === seat.id);
            return (
              <View key={seat.id} style={{ position: 'absolute', left, top }}>
                <SeatView seat={seat} size={size} onPress={onPressSeat ? () => onPressSeat(seat) : undefined} />
                {reaction ? <ReactionBubble key={reaction.key} label={reaction.label} /> : null}
              </View>
            );
          })
        : null}
      {overflow > 0 ? (
        <View style={[styles.overflow, { backgroundColor: 'rgba(16,17,26,0.72)' }]}>
          <Text variant="tiny" style={{ color: '#F5F5FB' }}>
            +{overflow} more
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function ReactionBubble({ label }: { label: string }) {
  const { colors, reduceMotion } = useTheme();
  const y = useSharedValue(0);
  const o = useSharedValue(1);
  useEffect(() => {
    y.value = withTiming(reduceMotion ? 0 : -26, { duration: 1600 });
    o.value = withTiming(0, { duration: 1800 });
  }, [o, y, reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.reaction, { backgroundColor: colors.surfaceRaised }, style]}>
      <Text variant="tiny">{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: { width: '100%', overflow: 'hidden', borderRadius: radius.xl },
  name: { marginTop: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, maxWidth: 84 },
  corner: { position: 'absolute', width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  overflow: { position: 'absolute', right: 10, top: 10, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  reaction: { position: 'absolute', top: -14, alignSelf: 'center', left: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
});
