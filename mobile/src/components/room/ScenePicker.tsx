import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Check, Lock } from 'lucide-react-native';

import { ALL_SCENES } from '@/api/rooms-extra';
import type { Scene } from '@/api/types';
import { SCENE_META, SceneBackground } from '@/components/scene/SceneBackground';
import { PressableScale, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

type Props = { value: Scene; onChange: (scene: Scene) => void; owned: Set<Scene>; onLockedPress?: () => void };

/** Scene thumbnails. Locked scenes open the shop instead of being selectable. */
export function ScenePicker({ value, onChange, owned, onLockedPress }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Scene">
      {ALL_SCENES.map((scene) => {
        const locked = !owned.has(scene);
        const selected = value === scene;
        const name = SCENE_META[scene].name;
        return (
          <PressableScale
            key={scene}
            onPress={() => (locked ? (onLockedPress ? onLockedPress() : router.push('/shop')) : onChange(scene))}
            hapticFeedback="tap"
            accessibilityRole={locked ? 'button' : 'radio'}
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={locked ? `${name}, locked` : name}
            accessibilityHint={locked ? 'Opens the shop to unlock this scene' : undefined}
            style={[styles.item, { borderColor: selected ? colors.primary : colors.border, backgroundColor: colors.surface }]}
          >
            <View style={styles.thumb}>
              <SceneBackground scene={scene} />
              {locked ? (
                <View style={[StyleSheet.absoluteFill, styles.lockOverlay]}>
                  <Lock size={16} color="#F5F5FB" />
                </View>
              ) : null}
              {selected ? (
                <View style={[styles.check, { backgroundColor: colors.primary }]}>
                  <Check size={12} color={colors.onPrimary} strokeWidth={3} />
                </View>
              ) : null}
            </View>
            <View style={styles.caption}>
              <Text variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                {name}
              </Text>
              {locked ? (
                <Text variant="tiny" tone="primary">
                  Unlock
                </Text>
              ) : null}
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  item: { width: '31.5%', flexGrow: 1, borderWidth: 2, borderRadius: radius.lg, overflow: 'hidden' },
  thumb: { height: 64, overflow: 'hidden' },
  lockOverlay: { backgroundColor: 'rgba(16,17,26,0.55)', alignItems: 'center', justifyContent: 'center' },
  check: { position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  caption: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, paddingVertical: 6, minHeight: 30 },
});
