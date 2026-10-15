import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Quote, X } from 'lucide-react-native';

import type { ReplyContext } from '@/api/connect-extra';
import type { MessageContext } from '@/api/types';
import { IconButton, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

type Ctx = MessageContext | ReplyContext;

function describe(c: Ctx, mine: boolean, name: string) {
  const whose = mine ? `${name}'s` : 'your';
  const title = c.type === 'photo' ? `Replying to ${whose} photo` : `Replying to ${whose} prompt`;
  const prompt = 'prompt' in c ? c.prompt : undefined;
  const body = c.type === 'prompt' ? [prompt, c.text].filter(Boolean).join(' — ') : c.text;
  return { title, body };
}

/** Small quote shown above a message that replies to a photo or prompt. */
export function ReplyContextPreview({ context, mine, otherName }: { context: MessageContext; mine: boolean; otherName: string }) {
  const { colors } = useTheme();
  const { title, body } = describe(context, mine, otherName);
  return (
    <View
      style={[
        styles.preview,
        {
          borderLeftColor: colors.primary,
          backgroundColor: colors.surfaceAlt,
          alignSelf: mine ? 'flex-end' : 'flex-start',
        },
      ]}
      accessibilityLabel={`${title}${body ? `: ${body}` : ''}`}
    >
      {context.type === 'photo' && context.photo_url ? (
        <Image source={{ uri: context.photo_url }} style={styles.thumb} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : (
        <Quote size={14} color={colors.textMuted} />
      )}
      <View style={{ flexShrink: 1 }}>
        <Text variant="tiny" tone="muted">
          {title}
        </Text>
        {body ? (
          <Text variant="caption" numberOfLines={2}>
            {body}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Dismissible "Replying to…" chip above the composer; sent as context with the next text message. */
export function ReplyChip({ context, otherName, onDismiss }: { context: ReplyContext; otherName: string; onDismiss: () => void }) {
  const { colors } = useTheme();
  const { title, body } = describe(context, true, otherName);
  return (
    <View style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityLiveRegion="polite">
      {context.type === 'photo' && context.photo_url ? (
        <Image source={{ uri: context.photo_url }} style={styles.thumb} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : (
        <Quote size={16} color={colors.primary} />
      )}
      <View style={{ flex: 1 }}>
        <Text variant="label" tone="primary">
          {title}
        </Text>
        {body ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {body}
          </Text>
        ) : null}
      </View>
      <IconButton icon={X} label="Don't reply to this" onPress={onDismiss} size={36} />
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    maxWidth: '80%',
    borderLeftWidth: 3,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    marginBottom: 3,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingLeft: space.md,
    paddingVertical: 4,
  },
  thumb: { width: 36, height: 36, borderRadius: 8 },
});
