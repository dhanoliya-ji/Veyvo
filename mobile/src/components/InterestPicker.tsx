import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Search } from 'lucide-react-native';

import type { Interest } from '@/api/types';
import { Chip, Input, Text } from '@/components/ui';
import { space } from '@/theme/tokens';

type Props = { interests: Interest[]; selected: number[]; onChange: (ids: number[]) => void; max?: number };

export function InterestPicker({ interests, selected, onChange, max = 12 }: Props) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? interests.filter((i) => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)) : interests;
    const map = new Map<string, Interest[]>();
    filtered.forEach((i) => map.set(i.category, [...(map.get(i.category) ?? []), i]));
    return [...map.entries()];
  }, [interests, query]);

  const toggle = (id: number) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else if (selected.length < max) onChange([...selected, id]);
  };

  return (
    <View style={{ gap: space.lg }}>
      <Input icon={Search} placeholder="Search interests" value={query} onChangeText={setQuery} accessibilityLabel="Search interests" autoCorrect={false} />
      {groups.length === 0 ? (
        <Text tone="muted" center>
          No interests match “{query}”.
        </Text>
      ) : null}
      {groups.map(([category, items]) => (
        <View key={category} style={{ gap: space.sm }}>
          <Text variant="tiny" tone="faint" style={{ textTransform: 'uppercase' }}>
            {category}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {items.map((i) => (
              <Chip key={i.id} label={i.name} selected={selected.includes(i.id)} onPress={() => toggle(i.id)} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
