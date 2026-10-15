import { useEffect, useState, type ComponentType } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowRight,
  AudioLines,
  Ban,
  CameraOff,
  Crown,
  Dice5,
  EyeOff,
  Flag,
  Flame,
  Gamepad2,
  Gift,
  Hand,
  HeartHandshake,
  Mail,
  Mic,
  Moon,
  PhoneCall,
  ShieldCheck,
  Spade,
  Sparkles,
  Users,
  UsersRound,
  Video,
  type LucideProps,
} from 'lucide-react-native';

import { useMe } from '@/api/hooks';
import { Button, PressableScale, Text } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { usePreferences } from '@/stores/preferences';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space, type Palette } from '@/theme/tokens';

type Tone = 'primary' | 'accent' | 'success' | 'warning';
type Icon = ComponentType<LucideProps>;

type Page = {
  key: string;
  tone: Tone;
  title: string;
  body: string;
  hero: Icon;
  /** Four small icons that float around the hero. */
  orbit: [Icon, Icon, Icon, Icon];
  points: { icon: Icon; text: string }[];
};

const PAGES: Page[] = [
  {
    key: 'meet',
    tone: 'primary',
    title: 'Meet your people',
    body: 'Friend Swipe shows real people who share your interests. Your Daily Drop brings a few fresh picks every day.',
    hero: Users,
    orbit: [Sparkles, Hand, HeartHandshake, Gift],
    points: [
      { icon: HeartHandshake, text: "You're only friends when you both say yes" },
      { icon: Hand, text: 'Wave hi or leave a note on a photo or prompt' },
    ],
  },
  {
    key: 'live',
    tone: 'accent',
    title: 'Hang out live',
    body: 'Drop into voice and video rooms around things you love, or call a friend when you feel like talking.',
    hero: Mic,
    orbit: [Video, PhoneCall, Sparkles, UsersRound],
    points: [
      { icon: Video, text: 'Rooms for chatting, study sessions and more' },
      { icon: PhoneCall, text: 'Private calls with friends, any time' },
    ],
  },
  {
    key: 'play',
    tone: 'warning',
    title: 'Play together',
    body: 'Chess, Ludo, cards, Four in a Row and Werewolf — with voice and faces, so it feels like the same table.',
    hero: Gamepad2,
    orbit: [Crown, Dice5, Spade, Moon],
    points: [
      { icon: Dice5, text: 'Invite friends straight into a game' },
      { icon: Mic, text: 'Talk and see each other while you play' },
    ],
  },
  {
    key: 'close',
    tone: 'success',
    title: 'Stay close',
    body: 'Start a squad with your favourite people, send a voice note, or write Slow Letters to a pen pal far away.',
    hero: UsersRound,
    orbit: [AudioLines, Mail, Flame, HeartHandshake],
    points: [
      { icon: Flame, text: 'Squads keep a weekly streak going' },
      { icon: Mail, text: 'Slow Letters arrive like real post' },
    ],
  },
  {
    key: 'control',
    tone: 'primary',
    title: "You're in control",
    body: 'Veyvo is built so you always feel safe and never put on the spot.',
    hero: ShieldCheck,
    orbit: [EyeOff, Flag, Ban, CameraOff],
    points: [
      { icon: EyeOff, text: 'Skips are silent — nobody is ever told' },
      { icon: Flag, text: 'Block or report from anywhere, any time' },
      { icon: CameraOff, text: 'Your camera always starts off' },
    ],
  },
];

function toneColors(colors: Palette, tone: Tone) {
  return {
    primary: { fg: colors.primary, soft: colors.primarySoft },
    accent: { fg: colors.accent, soft: colors.accentSoft },
    success: { fg: colors.success, soft: colors.successSoft },
    warning: { fg: colors.warning, soft: colors.warningSoft },
  }[tone];
}

const ORBIT_TONES: Tone[][] = [
  ['accent', 'success', 'warning', 'primary'],
  ['primary', 'success', 'warning', 'accent'],
  ['accent', 'primary', 'success', 'accent'],
  ['primary', 'accent', 'warning', 'success'],
  ['success', 'warning', 'accent', 'success'],
];

export default function Tour() {
  const { colors, reduceMotion } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { replay } = useLocalSearchParams<{ replay?: string }>();
  const me = useMe();
  const setTourSeen = usePreferences((s) => s.setTourSeen);
  const [page, setPage] = useState(0);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollX = useSharedValue(0);
  const float = useSharedValue(0);

  // Mark it seen as soon as it opens, so it really only shows once per device even if the app is closed mid-tour.
  useEffect(() => {
    setTourSeen(true);
  }, [setTourSeen]);

  useEffect(() => {
    if (!reduceMotion) float.value = withRepeat(withTiming(1, { duration: 2600 }), -1, true);
  }, [float, reduceMotion]);

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });

  useAnimatedReaction(
    () => Math.round(scrollX.value / Math.max(width, 1)),
    (current, previous) => {
      if (current !== previous) runOnJS(setPage)(Math.min(Math.max(current, 0), PAGES.length - 1));
    },
    [width],
  );

  const last = page === PAGES.length - 1;
  const artSize = Math.min(width - screenPadding * 2, height * 0.36, 300);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  };

  const goTo = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * width, animated: !reduceMotion });
    if (reduceMotion) setPage(index);
  };

  const finish = () => {
    haptic.success();
    if (replay) {
      close();
      return;
    }
    if (me.data && !me.data.photo_url) {
      toast.show({ title: 'Add a photo first', message: 'Real photos help people recognise you and say yes.' });
      router.replace('/photos');
    } else {
      router.replace('/discover');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, space.lg) }]}>
      <View style={styles.topBar}>
        <Text variant="label" tone="faint">
          {page + 1} of {PAGES.length}
        </Text>
        {!last ? (
          <PressableScale onPress={close} accessibilityRole="button" accessibilityLabel="Skip the tour" hitSlop={12} style={styles.skip}>
            <Text variant="label" tone="muted">
              Skip
            </Text>
          </PressableScale>
        ) : (
          <View style={styles.skip} />
        )}
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      >
        {PAGES.map((p, index) => (
          <View key={p.key} style={{ width, paddingHorizontal: screenPadding, justifyContent: 'center' }} accessible={page === index} accessibilityLabel={`${p.title}. ${p.body}`}>
            <TourArt page={p} index={index} scrollX={scrollX} float={float} width={width} size={artSize} />
            <TourText page={p} index={index} scrollX={scrollX} width={width} />
          </View>
        ))}
      </Animated.ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {PAGES.map((p, index) => (
            <Dot key={p.key} index={index} scrollX={scrollX} width={width} color={colors.primary} onPress={() => goTo(index)} />
          ))}
        </View>
        {last ? (
          <Button title="Let's go" iconRight={ArrowRight} size="lg" onPress={finish} fullWidth accessibilityHint={replay ? 'Closes the tour' : 'Starts using Veyvo'} />
        ) : (
          <Button title="Next" iconRight={ArrowRight} size="lg" onPress={() => goTo(page + 1)} fullWidth />
        )}
      </View>
    </View>
  );
}

function pageRange(index: number, width: number) {
  return [(index - 1) * width, index * width, (index + 1) * width];
}

function TourArt({ page, index, scrollX, float, width, size }: { page: Page; index: number; scrollX: SharedValue<number>; float: SharedValue<number>; width: number; size: number }) {
  const { colors } = useTheme();
  const main = toneColors(colors, page.tone);
  const Hero = page.hero;
  const range = pageRange(index, width);

  const halo = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.value, range, [0, 1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(scrollX.value, range, [0.6, 1, 0.6], Extrapolation.CLAMP) }],
  }));
  const hero = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(scrollX.value, range, [width * 0.15, 0, -width * 0.15], Extrapolation.CLAMP) },
      { translateY: (float.value - 0.5) * 6 },
      { rotate: `${interpolate(scrollX.value, range, [-12, 0, 12], Extrapolation.CLAMP)}deg` },
    ],
  }));

  // Satellites sit on a circle around the hero: top-left, top-right, bottom-right, bottom-left.
  const radiusOrbit = size * 0.38;
  const angles = [-140, -35, 30, 150];

  return (
    <View style={{ height: size, alignItems: 'center', justifyContent: 'center', marginBottom: space.xxl }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[{ position: 'absolute', width: size, height: size, alignItems: 'center', justifyContent: 'center' }, halo]}>
        <View style={{ position: 'absolute', width: size * 0.92, height: size * 0.92, borderRadius: size, backgroundColor: main.soft }} />
        <View style={{ position: 'absolute', width: size * 0.66, height: size * 0.66, borderRadius: size, borderWidth: 1.5, borderColor: main.fg, opacity: 0.25 }} />
        <View style={{ position: 'absolute', width: size * 0.42, height: size * 0.42, borderRadius: size, backgroundColor: main.soft }} />
        {/* Tiny sparkle dots */}
        {[
          [0.12, 0.2, 6],
          [0.85, 0.15, 8],
          [0.9, 0.7, 5],
          [0.08, 0.78, 7],
          [0.5, 0.04, 5],
        ].map(([x, y, d], i) => (
          <View key={i} style={{ position: 'absolute', left: size * x, top: size * y, width: d, height: d, borderRadius: d, backgroundColor: i % 2 ? colors.accent : main.fg, opacity: 0.6 }} />
        ))}
      </Animated.View>

      <Animated.View style={[styles.heroTile, { width: size * 0.34, height: size * 0.34, backgroundColor: colors.surfaceRaised, borderColor: colors.border, shadowColor: colors.shadow }, hero]}>
        <Hero size={size * 0.15} color={main.fg} strokeWidth={2} />
      </Animated.View>

      {page.orbit.map((OrbitIcon, i) => (
        <Satellite
          key={i}
          icon={OrbitIcon}
          tone={ORBIT_TONES[index % ORBIT_TONES.length][i]}
          x={Math.cos((angles[i] * Math.PI) / 180) * radiusOrbit}
          y={Math.sin((angles[i] * Math.PI) / 180) * radiusOrbit}
          depth={0.35 + i * 0.12}
          bob={i % 2 ? 1 : -1}
          range={range}
          scrollX={scrollX}
          float={float}
          width={width}
          size={Math.max(44, size * 0.18)}
        />
      ))}
    </View>
  );
}

function Satellite({
  icon: OrbitIcon,
  tone,
  x,
  y,
  depth,
  bob,
  range,
  scrollX,
  float,
  width,
  size,
}: {
  icon: Icon;
  tone: Tone;
  x: number;
  y: number;
  depth: number;
  bob: number;
  range: number[];
  scrollX: SharedValue<number>;
  float: SharedValue<number>;
  width: number;
  size: number;
}) {
  const { colors } = useTheme();
  const c = toneColors(colors, tone);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.value, range, [0, 1, 0], Extrapolation.CLAMP),
    transform: [
      { translateX: x + interpolate(scrollX.value, range, [width * depth, 0, -width * depth], Extrapolation.CLAMP) },
      { translateY: y + (float.value - 0.5) * 10 * bob },
      { scale: interpolate(scrollX.value, range, [0.5, 1, 0.5], Extrapolation.CLAMP) },
    ],
  }));
  return (
    <Animated.View style={[styles.satellite, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface, borderColor: c.soft }, style]}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: c.soft }]} />
      <OrbitIcon size={size * 0.44} color={c.fg} strokeWidth={2.2} />
    </Animated.View>
  );
}

function TourText({ page, index, scrollX, width }: { page: Page; index: number; scrollX: SharedValue<number>; width: number }) {
  const { colors } = useTheme();
  const main = toneColors(colors, page.tone);
  const range = pageRange(index, width);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.value, range, [0, 1, 0], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(scrollX.value, range, [16, 0, 16], Extrapolation.CLAMP) }],
  }));
  return (
    <Animated.View style={[{ gap: space.md }, style]}>
      <Text variant="display" center>
        {page.title}
      </Text>
      <Text tone="muted" center style={{ alignSelf: 'center', maxWidth: 340 }}>
        {page.body}
      </Text>
      <View style={{ gap: space.sm, marginTop: space.sm, alignSelf: 'center', maxWidth: 360, width: '100%' }}>
        {page.points.map(({ icon: PointIcon, text }) => (
          <View key={text} style={[styles.point, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.pointIcon, { backgroundColor: main.soft }]}>
              <PointIcon size={16} color={main.fg} strokeWidth={2.2} />
            </View>
            <Text variant="label" style={{ flex: 1 }}>
              {text}
            </Text>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

function Dot({ index, scrollX, width, color, onPress }: { index: number; scrollX: SharedValue<number>; width: number; color: string; onPress: () => void }) {
  const range = pageRange(index, width);
  const style = useAnimatedStyle(() => ({
    width: interpolate(scrollX.value, range, [8, 26, 8], Extrapolation.CLAMP),
    opacity: interpolate(scrollX.value, range, [0.3, 1, 0.3], Extrapolation.CLAMP),
  }));
  return (
    <PressableScale onPress={onPress} hitSlop={8} accessibilityLabel={`Page ${index + 1}`}>
      <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: screenPadding, height: 52 },
  skip: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  footer: { paddingHorizontal: screenPadding, gap: space.xl, paddingTop: space.lg },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.sm, height: 12 },
  dot: { height: 8, borderRadius: radius.pill },
  heroTile: {
    borderRadius: radius.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 8,
  },
  satellite: { position: 'absolute', alignItems: 'center', justifyContent: 'center', borderWidth: 1, overflow: 'hidden' },
  point: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  pointIcon: { width: 30, height: 30, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
