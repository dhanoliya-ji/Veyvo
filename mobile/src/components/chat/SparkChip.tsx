import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { X } from 'lucide-react-native';

import { useSpark } from '@/api/invites-extra';
import { IconButton, PressableScale, Text } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const QUIET_MS = 24 * 60 * 60 * 1000;
// Dismissed for this app session, per conversation and suggestion.
const dismissed = new Set<string>();

type Props = {
  conversationId: string;
  /** Newest message in the chat (null when empty). The chip only shows in quiet chats. */
  lastMessageAt: string | null | undefined;
  /** Hide while typing, replying, or when messaging isn't possible. */
  hidden?: boolean;
  /** Fills the composer with an editable opener. Never sends anything. */
  onUse: (opener: string) => void;
};

/** "💡 Ask Maya about her best trip": a gentle opener for a chat that's gone quiet. */
export function SparkChip({ conversationId, lastMessageAt, hidden, onUse }: Props) {
  const { colors, reduceMotion } = useTheme();
  const [openedAt] = useState(() => Date.now());
  const quiet = !lastMessageAt || openedAt - new Date(lastMessageAt).getTime() > QUIET_MS;
  const spark = useSpark(conversationId, quiet && !hidden);
  const [, setTick] = useState(0);
  const s = spark.data;
  const key = `${conversationId}:${s?.suggestion ?? ''}`;
  if (hidden || !quiet || !s?.suggestion || dismissed.has(key)) return null;

  const dismiss = () => {
    dismissed.add(key);
    setTick((t) => t + 1);
  };

  return (
    <Animated.View entering={reduceMotion ? undefined : FadeIn} exiting={reduceMotion ? undefined : FadeOut}>
      <View style={[styles.chip, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
        <PressableScale
          style={{ flex: 1 }}
          onPress={() => {
            haptic.light();
            onUse(s.opener ?? s.suggestion ?? '');
            dismiss();
          }}
          accessibilityRole="button"
          accessibilityLabel={`Suggestion: ${s.suggestion}. Tap to write it in the message box.`}
        >
          <Text variant="label" numberOfLines={2}>
            💡 {s.suggestion}
          </Text>
        </PressableScale>
        <IconButton icon={X} label="Hide suggestion" onPress={dismiss} size={32} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.md,
    paddingVertical: space.xxs,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
