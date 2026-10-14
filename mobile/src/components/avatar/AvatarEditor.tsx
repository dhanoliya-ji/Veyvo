import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Check, Gem, Lock, Shuffle } from 'lucide-react-native';

import type { AvatarConfig } from '@/api/types';
import { PressableScale, SegmentedControl, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { Avatar } from './Avatar';
import { AVATAR_OPTIONS, COSMETICS, LABELS, randomAvatar, type Cosmetic } from './options';

type Tab = 'face' | 'hair' | 'outfit' | 'extras';

type Props = {
  value: AvatarConfig;
  onChange: (next: AvatarConfig) => void;
  /** Item keys the user owns. Paid items not in this set show a lock. */
  owned?: Set<string>;
  /** Called when a locked item is tapped (e.g. open the shop). If omitted, locked items are hidden. */
  onLockedPress?: (item: Cosmetic) => void;
  previewSize?: number;
};

function Swatches({ colors: list, value, onPick, label }: { colors: readonly string[]; value: string; onPick: (c: string) => void; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <View style={styles.swatches}>
        {list.map((c, i) => {
          const active = c === value;
          return (
            <PressableScale
              key={c}
              onPress={() => onPick(c)}
              hapticFeedback="tap"
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label} option ${i + 1}`}
              style={[styles.swatch, { backgroundColor: c, borderColor: active ? colors.primary : colors.border, borderWidth: active ? 3 : 1 }]}
            >
              {active ? <Check size={16} color={c === '#F5F5FB' || c === '#FFDFC4' || c === '#E8D5A3' ? '#1E1B2E' : '#FFFFFF'} strokeWidth={3} /> : null}
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

export function AvatarEditor({ value, onChange, owned, onLockedPress, previewSize = 132 }: Props) {
  const { colors } = useTheme();
  const [tab, setTab] = useState<Tab>('face');
  const set = (patch: Partial<AvatarConfig>) => onChange({ ...value, ...patch });

  const itemGrid = (slot: 'hair' | 'outfit' | 'accessory') => {
    const items = COSMETICS.filter((c) => c.slot === slot && (c.price === 0 || owned?.has(c.key) || onLockedPress));
    return (
      <View style={styles.grid}>
        {items.map((item) => {
          const locked = item.price > 0 && !owned?.has(item.key);
          const active = value[slot] === item.value;
          return (
            <PressableScale
              key={item.key}
              onPress={() => (locked ? onLockedPress?.(item) : set({ [slot]: item.value } as Partial<AvatarConfig>))}
              hapticFeedback="tap"
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${item.name}${locked ? `, locked, ${item.price} gems` : ''}`}
              style={[styles.tile, { backgroundColor: colors.surfaceAlt, borderColor: active ? colors.primary : 'transparent' }]}
            >
              <View style={{ opacity: locked ? 0.45 : 1 }}>
                <Avatar config={{ ...value, [slot]: item.value }} size={58} showBg={false} />
              </View>
              <Text variant="tiny" tone={active ? 'primary' : 'muted'} numberOfLines={1}>
                {item.name}
              </Text>
              {locked ? (
                <View style={[styles.price, { backgroundColor: colors.bg }]}>
                  <Lock size={10} color={colors.gold} />
                  <Gem size={10} color={colors.gold} />
                  <Text variant="tiny" style={{ color: colors.gold }}>
                    {item.price}
                  </Text>
                </View>
              ) : null}
            </PressableScale>
          );
        })}
      </View>
    );
  };

  const optionRow = (key: 'eyes' | 'brows' | 'mouth', title: string) => (
    <View style={{ gap: space.sm }}>
      <Text variant="label" tone="muted">
        {title}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {AVATAR_OPTIONS[key].map((opt) => {
          const active = value[key] === opt;
          return (
            <PressableScale
              key={opt}
              onPress={() => set({ [key]: opt } as Partial<AvatarConfig>)}
              hapticFeedback="tap"
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${title}: ${LABELS[opt] ?? opt}`}
              style={[styles.faceTile, { backgroundColor: colors.surfaceAlt, borderColor: active ? colors.primary : 'transparent' }]}
            >
              <Avatar config={{ ...value, [key]: opt }} size={52} showBg={false} />
              <Text variant="tiny" tone={active ? 'primary' : 'muted'}>
                {LABELS[opt] ?? opt}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <View style={{ gap: space.lg }}>
      <View style={styles.previewRow}>
        <Avatar config={value} size={previewSize} label="Your avatar preview" />
        <PressableScale
          onPress={() => onChange(randomAvatar())}
          hapticFeedback="light"
          accessibilityLabel="Randomise avatar"
          style={[styles.shuffle, { backgroundColor: colors.surfaceAlt }]}
        >
          <Shuffle size={18} color={colors.text} />
          <Text variant="label">Surprise me</Text>
        </PressableScale>
      </View>
      <SegmentedControl
        value={tab}
        onChange={setTab}
        options={[
          { value: 'face', label: 'Face' },
          { value: 'hair', label: 'Hair' },
          { value: 'outfit', label: 'Outfit' },
          { value: 'extras', label: 'Extras' },
        ]}
      />
      {tab === 'face' ? (
        <View style={{ gap: space.lg }}>
          <Swatches label="Skin tone" colors={AVATAR_OPTIONS.skin} value={value.skin} onPick={(skin) => set({ skin })} />
          {optionRow('eyes', 'Eyes')}
          {optionRow('brows', 'Brows')}
          {optionRow('mouth', 'Mouth')}
        </View>
      ) : null}
      {tab === 'hair' ? (
        <View style={{ gap: space.lg }}>
          <Swatches label="Hair colour" colors={AVATAR_OPTIONS.hairColor} value={value.hairColor} onPick={(hairColor) => set({ hairColor })} />
          {itemGrid('hair')}
        </View>
      ) : null}
      {tab === 'outfit' ? (
        <View style={{ gap: space.lg }}>
          <Swatches label="Outfit colour" colors={AVATAR_OPTIONS.outfitColor} value={value.outfitColor} onPick={(outfitColor) => set({ outfitColor })} />
          {itemGrid('outfit')}
        </View>
      ) : null}
      {tab === 'extras' ? (
        <View style={{ gap: space.lg }}>
          <Swatches label="Background" colors={AVATAR_OPTIONS.bg} value={value.bg} onPick={(bg) => set({ bg })} />
          {itemGrid('accessory')}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  previewRow: { alignItems: 'center', gap: space.md },
  shuffle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, height: 38, borderRadius: radius.pill },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { width: '31%', alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.lg, borderWidth: 2, gap: 4 },
  faceTile: { alignItems: 'center', padding: space.sm, borderRadius: radius.lg, borderWidth: 2, gap: 4, width: 80 },
  price: { position: 'absolute', top: 6, right: 6, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 5, paddingVertical: 2, borderRadius: radius.pill },
});
