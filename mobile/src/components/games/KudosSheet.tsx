import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';

import { isApiError, KUDOS_TAGS } from '@/api/games-extra';
import { useGiveKudos } from '@/api/hooks';
import type { UserSummary } from '@/api/types';
import { UserPhoto } from '@/components/UserPhoto';
import { PressableScale, Sheet, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

/** Pick a co-player and a kudos tag. One kudos per person per day (enforced by the server). */
export function KudosSheet({ visible, onClose, people }: { visible: boolean; onClose: () => void; people: UserSummary[] }) {
  const { colors } = useTheme();
  const give = useGiveKudos();
  const [target, setTarget] = useState<string | null>(null);
  const [given, setGiven] = useState<Record<string, string>>({});
  const selected = people.find((p) => p.id === (target ?? (people.length === 1 ? people[0].id : null)));

  const send = (tag: string, label: string) => {
    if (!selected) return;
    give.mutate(
      { userId: selected.id, tag },
      {
        onSuccess: () => {
          haptic.success();
          setGiven((g) => ({ ...g, [selected.id]: label }));
          toast.success(`Kudos sent to ${selected.display_name}`, `"${label}" — that'll make their day.`);
          setTarget(null);
        },
        onError: (e) => {
          if (isApiError(e, 409)) {
            setGiven((g) => ({ ...g, [selected.id]: 'already' }));
            toast.show({ title: 'Already given today', message: `You've already sent ${selected.display_name} a vibe today. Try again tomorrow.` });
          } else {
            haptic.error();
            toast.error("Couldn't send that vibe", errorMessage(e));
          }
        },
      },
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Send a vibe" scroll>
      <Text tone="muted" style={{ marginBottom: space.md }}>
        Kudos are anonymous little thank-yous. They show up as counts on profiles.
      </Text>
      <View style={styles.people}>
        {people.map((p) => {
          const active = selected?.id === p.id;
          const done = given[p.id];
          return (
            <PressableScale
              key={p.id}
              onPress={() => setTarget(p.id)}
              hapticFeedback="tap"
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${p.display_name}${done ? ', kudos sent' : ''}`}
              style={[styles.person, { borderColor: active ? colors.primary : 'transparent', backgroundColor: colors.surfaceAlt }]}
            >
              <UserPhoto user={p} size={48} />
              <Text variant="caption" numberOfLines={1} style={{ maxWidth: 72 }}>
                {p.display_name}
              </Text>
              {done ? (
                <View style={[styles.done, { backgroundColor: colors.success }]}>
                  <Check size={10} color="#FFFFFF" strokeWidth={3} />
                </View>
              ) : null}
            </PressableScale>
          );
        })}
      </View>
      {selected ? (
        given[selected.id] ? (
          <Text tone="success" center style={{ marginVertical: space.lg }}>
            {given[selected.id] === 'already' ? `You've already given ${selected.display_name} kudos today.` : `You gave ${selected.display_name} "${given[selected.id]}".`}
          </Text>
        ) : (
          <View style={styles.tags}>
            {KUDOS_TAGS.map((t) => (
              <PressableScale
                key={t.key}
                disabled={give.isPending}
                onPress={() => send(t.key, t.label)}
                hapticFeedback="light"
                accessibilityLabel={`Give ${selected.display_name} kudos: ${t.label}`}
                style={[styles.tag, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Text style={{ fontSize: 22 }}>{t.emoji}</Text>
                <Text variant="label">{t.label}</Text>
              </PressableScale>
            ))}
          </View>
        )
      ) : (
        <Text tone="muted" center style={{ marginVertical: space.lg }}>
          Choose someone first.
        </Text>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg },
  person: { alignItems: 'center', gap: 4, padding: space.sm, borderRadius: radius.lg, borderWidth: 2, minWidth: 84 },
  done: { position: 'absolute', top: 6, right: 14, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tag: { flexGrow: 1, flexBasis: '45%', flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingHorizontal: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
