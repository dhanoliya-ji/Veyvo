import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { ChevronDown, ChevronUp, Search } from 'lucide-react-native';

import type { Interest } from '@/api/types';
import { Chip, Input, PressableScale, Skeleton, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { resolveCategories } from './constants';

type Props = { interests: Interest[] | undefined; value: number | null; onChange: (id: number | null) => void; loading?: boolean };

/** Single-choice topic picker: popular hangout categories first, with every interest one tap away. */
export function TopicPicker({ interests, value, onChange, loading }: Props) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const categories = useMemo(() => resolveCategories(interests), [interests]);
  const categoryIds = useMemo(() => new Set(categories.map((c) => c.interestId)), [categories]);
  const selectedOther = value !== null && !categoryIds.has(value) ? interests?.find((i) => i.id === value) : undefined;

  const others = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (interests ?? []).filter((i) => !categoryIds.has(i.id) && (!q || i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)));
  }, [interests, categoryIds, query]);

  if (loading) {
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {[90, 70, 110, 80].map((w) => (
          <Skeleton key={w} width={w} height={36} rounded={18} />
        ))}
      </View>
    );
  }

  const pick = (id: number) => onChange(value === id ? null : id);

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {categories.map((c) => (
          <Chip key={c.slug} label={c.label} icon={c.icon} selected={value === c.interestId} onPress={() => pick(c.interestId)} />
        ))}
        {selectedOther ? <Chip label={selectedOther.name} selected onPress={() => pick(selectedOther.id)} /> : null}
      </View>
      {others.length || query ? (
        <PressableScale
          onPress={() => setExpanded((e) => !e)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={expanded ? 'Hide more topics' : 'Show more topics'}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, alignSelf: 'flex-start' }}
        >
          <Text variant="label" tone="primary">
            {expanded ? 'Fewer topics' : 'More topics'}
          </Text>
          {expanded ? <ChevronUp size={16} color={colors.primary} /> : <ChevronDown size={16} color={colors.primary} />}
        </PressableScale>
      ) : null}
      {expanded ? (
        <View style={{ gap: space.md }}>
          <Input icon={Search} placeholder="Search topics" value={query} onChangeText={setQuery} accessibilityLabel="Search topics" autoCorrect={false} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {others.map((i) => (
              <Chip key={i.id} label={i.name} selected={value === i.id} onPress={() => pick(i.id)} />
            ))}
            {others.length === 0 ? (
              <Text tone="muted" variant="caption">
                No topics match “{query}”.
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}
