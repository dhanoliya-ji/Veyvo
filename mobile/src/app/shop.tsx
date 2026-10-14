import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Check, Gem, Lock } from 'lucide-react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { qk, useBuyItem, useMe, useShop } from '@/api/hooks';
import type { Me, ShopItem } from '@/api/types';
import { GetGemsSection } from '@/components/monetization/GetGemsSection';
import { ThemePreview } from '@/components/shop/ThemePreview';
import { Badge, Button, ErrorState, Header, PressableScale, Screen, SectionHeader, Sheet, Skeleton, Text } from '@/components/ui';
import { ApiError, errorMessage, put } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { DEFAULT_THEME } from '@/lib/themes';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const SECTIONS: { slot: ShopItem['slot']; title: string; subtitle: string }[] = [
  { slot: 'chess_board', title: 'Chess boards', subtitle: 'Shown on your side of every chess game' },
  { slot: 'card_back', title: 'Card backs', subtitle: 'For Crazy Eights' },
  { slot: 'ludo_board', title: 'Ludo boards', subtitle: 'Your Ludo table style' },
];

export default function Shop() {
  const { colors } = useTheme();
  const qc = useQueryClient();
  const me = useMe();
  const shop = useShop();
  const buy = useBuyItem();
  const [sel, setSel] = useState<ShopItem | null>(null);
  const equipped = { ...DEFAULT_THEME, ...(me.data?.game_theme ?? {}) } as Record<string, string>;

  const apply = useMutation({
    mutationFn: (item: ShopItem) => put<Me>('/me/game-theme', { [item.slot]: item.value }),
    onSuccess: (m) => qc.setQueryData(qk.me, m),
  });

  const onBuy = (item: ShopItem) =>
    buy.mutate(item.key, {
      onSuccess: () => {
        haptic.success();
        toast.success(`${item.name} unlocked`);
      },
      onError: (e) => {
        if (e instanceof ApiError && e.code === 'insufficient_gems') toast.show({ title: 'Not enough gems yet', message: 'Earn gems from quests, games and the Daily Question — or get more below.', tone: 'warning' });
        else toast.error("Couldn't buy that", errorMessage(e));
      },
    });

  const onUse = async (item: ShopItem) => {
    try {
      await apply.mutateAsync(item);
      haptic.success();
      toast.success(`Now using ${item.name}`);
      setSel(null);
    } catch (e) {
      toast.error("Couldn't apply", errorMessage(e));
    }
  };

  return (
    <Screen
      scroll
      header={
        <Header
          title="Shop"
          right={
            <View style={[styles.balance, { backgroundColor: colors.primarySoft }]}>
              <Gem size={14} color={colors.primary} />
              <Text variant="label" tone="primary">
                {me.data?.gems ?? '–'}
              </Text>
            </View>
          }
        />
      }
    >
      {shop.isLoading ? <Skeleton height={260} rounded={radius.xl} /> : null}
      {shop.isError ? <ErrorState error={shop.error} onRetry={() => shop.refetch()} /> : null}
      {shop.data
        ? SECTIONS.map((section) => {
            const items = shop.data.filter((i) => i.slot === section.slot);
            if (!items.length) return null;
            return (
              <View key={section.slot} style={{ marginTop: space.lg }}>
                <SectionHeader title={section.title} subtitle={section.subtitle} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md }}>
                  {items.map((item) => {
                    const isOn = equipped[item.slot] === item.value;
                    return (
                      <PressableScale
                        key={item.key}
                        onPress={() => setSel(item)}
                        style={[styles.item, { backgroundColor: colors.surface, borderColor: isOn ? colors.primary : colors.border }]}
                        accessibilityLabel={`${item.name}${isOn ? ', in use' : item.owned ? ', owned' : `, ${item.price} gems`}`}
                      >
                        <ThemePreview slot={item.slot} value={item.value} size={92} />
                        <Text variant="label" numberOfLines={1}>
                          {item.name}
                        </Text>
                        {isOn ? (
                          <Badge label="In use" tone="success" />
                        ) : item.owned ? (
                          <Badge label={item.price === 0 && !item.event_only ? 'Free' : 'Owned'} tone="neutral" />
                        ) : (
                          <View style={styles.price}>
                            <Lock size={11} color={colors.gold} />
                            <Gem size={11} color={colors.gold} />
                            <Text variant="tiny" style={{ color: colors.gold }}>
                              {item.price}
                            </Text>
                          </View>
                        )}
                      </PressableScale>
                    );
                  })}
                </ScrollView>
              </View>
            );
          })
        : null}

      <View style={{ marginTop: space.xxl }}>
        <SectionHeader title="Get more gems" />
        <GetGemsSection />
      </View>

      <Sheet visible={!!sel} onClose={() => setSel(null)} title={sel?.name}>
        {sel ? (
          <View style={{ gap: space.lg, alignItems: 'center' }}>
            <View style={[styles.big, { backgroundColor: colors.surfaceAlt }]}>
              <ThemePreview slot={sel.slot} value={sel.value} size={170} />
            </View>
            {sel.event_only ? (
              <Text variant="caption" tone="muted" center>
                Event exclusive — earned during a seasonal event. Never sold.
              </Text>
            ) : null}
            {equipped[sel.slot] === sel.value ? (
              <Button title="In use" icon={Check} variant="secondary" disabled fullWidth />
            ) : sel.owned ? (
              <Button title="Use this theme" onPress={() => onUse(sel)} loading={apply.isPending} fullWidth />
            ) : (
              <Button title={`Unlock for ${sel.price} gems`} icon={Gem} onPress={() => onBuy(sel)} loading={buy.isPending} fullWidth />
            )}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  balance: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 30, borderRadius: radius.pill },
  item: { width: 128, alignItems: 'center', gap: 6, padding: space.md, borderRadius: radius.lg, borderWidth: 1.5 },
  price: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  big: { padding: space.xl, borderRadius: radius.xl },
});
