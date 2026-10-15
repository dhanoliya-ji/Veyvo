import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Check, Users } from 'lucide-react-native';

import { useFriends } from '@/api/hooks';
import { MAX_SQUAD_SIZE, SQUAD_EMOJIS, useCreateSquad } from '@/api/squads-extra';
import { UserPhoto } from '@/components/UserPhoto';
import { Button, EmptyState, Header, Input, PressableScale, RowSkeleton, Screen, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space } from '@/theme/tokens';

export default function CreateSquad() {
  const { colors } = useTheme();
  const friends = useFriends();
  const create = useCreateSquad();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(SQUAD_EMOJIS[0]);
  const [picked, setPicked] = useState<string[]>([]);
  const full = picked.length >= MAX_SQUAD_SIZE - 1;

  const toggle = (id: string) => {
    haptic.light();
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : full ? p : [...p, id]));
  };

  const submit = async () => {
    try {
      const squad = await create.mutateAsync({ name: name.trim(), emoji, member_ids: picked });
      haptic.success();
      router.replace(`/squads/${squad.id}` as Href);
    } catch (e) {
      toast.error("Couldn't create squad", errorMessage(e));
    }
  };

  return (
    <Screen
      padded={false}
      keyboard
      header={<Header title="New squad" close />}
      footer={
        <Button
          title={picked.length ? `Create squad with ${picked.length} ${picked.length === 1 ? 'friend' : 'friends'}` : 'Create squad'}
          onPress={submit}
          loading={create.isPending}
          disabled={!name.trim()}
          fullWidth
        />
      }
    >
      <FlatList
        data={friends.data ?? []}
        keyExtractor={(f) => f.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: space.huge }}
        ListHeaderComponent={
          <View style={{ gap: space.lg, marginBottom: space.lg }}>
            <Input label="Squad name" value={name} onChangeText={setName} placeholder="Night Owls" maxLength={40} counter autoFocus />
            <View style={{ gap: space.sm }}>
              <Text variant="label" tone="muted">
                Emoji
              </Text>
              <View style={styles.emojis}>
                {SQUAD_EMOJIS.map((e) => (
                  <PressableScale
                    key={e}
                    onPress={() => setEmoji(e)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: e === emoji }}
                    accessibilityLabel={`Emoji ${e}`}
                    style={[styles.emoji, { backgroundColor: e === emoji ? colors.primarySoft : colors.surface, borderColor: e === emoji ? colors.primary : colors.border }]}
                  >
                    <Text style={{ fontSize: 22, lineHeight: 28 }}>{e}</Text>
                  </PressableScale>
                ))}
              </View>
            </View>
            <Text variant="label" tone="muted">
              Add friends ({picked.length}/{MAX_SQUAD_SIZE - 1})
            </Text>
            {friends.isLoading ? <RowSkeleton count={4} /> : null}
          </View>
        }
        ListEmptyComponent={
          friends.isLoading ? null : (
            <EmptyState compact icon={Users} title="No friends to add yet" message="You can create the squad now and add friends later." />
          )
        }
        renderItem={({ item }) => {
          const selected = picked.includes(item.id);
          return (
            <PressableScale
              onPress={() => toggle(item.id)}
              disabled={!selected && full}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected, disabled: !selected && full }}
              accessibilityLabel={item.display_name}
              style={[styles.friend, { opacity: !selected && full ? 0.5 : 1 }]}
            >
              <UserPhoto user={item} size={44} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {item.display_name}
                </Text>
                {item.username ? (
                  <Text variant="caption" tone="muted">
                    @{item.username}
                  </Text>
                ) : null}
              </View>
              <View style={[styles.check, { borderColor: selected ? colors.primary : colors.borderStrong, backgroundColor: selected ? colors.primary : 'transparent' }]}>
                {selected ? <Check size={16} color={colors.onPrimary} /> : null}
              </View>
            </PressableScale>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  emojis: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  emoji: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  friend: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, minHeight: 56 },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
