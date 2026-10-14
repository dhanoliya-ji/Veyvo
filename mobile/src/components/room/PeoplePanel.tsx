import { ScrollView, StyleSheet, View } from 'react-native';
import { Hand, MicOff, Volume2 } from 'lucide-react-native';

import type { Participant } from '@/api/types';
import { Avatar } from '@/components/avatar/Avatar';
import { Badge, Button, PressableScale, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { ROLE_LABEL } from './constants';

type Props = {
  participants: Participant[];
  meId: string | undefined;
  speaking: Record<string, number>;
  canModerate: boolean;
  isVoice: boolean;
  onPress: (p: Participant) => void;
  onInviteToSpeak: (p: Participant) => void;
  bottomPadding?: number;
};

export function PeoplePanel({ participants, meId, speaking, canModerate, isVoice, onPress, onInviteToSpeak, bottomPadding = 0 }: Props) {
  const host = participants.filter((p) => p.role === 'host');
  const speakers = participants.filter((p) => p.role === 'moderator' || p.role === 'speaker');
  const hands = participants.filter((p) => p.role === 'listener' && p.hand_raised);
  const listeners = participants.filter((p) => p.role === 'listener' && !p.hand_raised);

  const groups: { title: string; people: Participant[] }[] = [
    { title: 'Host', people: host },
    { title: isVoice ? 'Speakers' : 'Members', people: speakers },
    { title: 'Raised hands', people: hands },
    { title: 'Listeners', people: listeners },
  ];

  return (
    <ScrollView contentContainerStyle={{ padding: space.md, gap: space.lg, paddingBottom: space.md + bottomPadding }} showsVerticalScrollIndicator={false}>
      {groups
        .filter((g) => g.people.length)
        .map((g) => (
          <View key={g.title} style={{ gap: space.xs }}>
            <Text variant="tiny" tone="faint" style={{ textTransform: 'uppercase' }} accessibilityRole="header">
              {g.title} · {g.people.length}
            </Text>
            {g.people.map((p) => (
              <PersonRow
                key={p.id}
                p={p}
                isMe={p.id === meId}
                speaking={speaking[p.id] !== undefined}
                onPress={() => onPress(p)}
                action={canModerate && g.title === 'Raised hands' ? () => onInviteToSpeak(p) : undefined}
              />
            ))}
          </View>
        ))}
    </ScrollView>
  );
}

function PersonRow({ p, isMe, speaking, onPress, action }: { p: Participant; isMe: boolean; speaking: boolean; onPress: () => void; action?: () => void }) {
  const { colors } = useTheme();
  const status = [speaking ? 'speaking' : null, p.muted_by_host ? 'muted by host' : null, p.hand_raised ? 'hand raised' : null].filter(Boolean).join(', ');
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.99}
      style={styles.row}
      accessibilityLabel={`${p.display_name}${isMe ? ' (you)' : ''}, ${ROLE_LABEL[p.role] ?? p.role}${status ? `, ${status}` : ''}`}
      accessibilityHint="Opens options for this person"
    >
      <View style={[styles.avatarRing, { borderColor: speaking ? colors.success : 'transparent' }]}>
        <Avatar config={p.avatar} size={40} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {p.display_name}
          {isMe ? <Text tone="muted"> (you)</Text> : null}
        </Text>
        <View style={styles.meta}>
          {p.role === 'host' || p.role === 'moderator' ? <Badge label={ROLE_LABEL[p.role]} tone={p.role === 'host' ? 'warning' : 'primary'} /> : null}
          {p.is_friend && !isMe ? <Badge label="Friend" tone="success" /> : null}
          {speaking ? (
            <View style={styles.inline}>
              <Volume2 size={12} color={colors.success} />
              <Text variant="tiny" tone="success">
                Speaking
              </Text>
            </View>
          ) : null}
          {p.muted_by_host ? (
            <View style={styles.inline}>
              <MicOff size={12} color={colors.danger} />
              <Text variant="tiny" tone="danger">
                Muted
              </Text>
            </View>
          ) : null}
          {p.hand_raised ? (
            <View style={styles.inline}>
              <Hand size={12} color={colors.warning} />
              <Text variant="tiny" tone="warning">
                Hand up
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {action ? <Button title="Let speak" size="sm" onPress={action} accessibilityLabel={`Let ${p.display_name} speak`} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 6, minHeight: 52 },
  avatarRing: { borderWidth: 2, borderRadius: 24, padding: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
