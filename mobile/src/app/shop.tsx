import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { router } from 'expo-router';
import { Check, Crown, Gamepad2, Gem, Shirt, Sparkles, Target, Wand2 } from 'lucide-react-native';

import { isApiError } from '@/api/games-extra';
import { useBuyItem, useConfig, useMe, useShop } from '@/api/hooks';
import type { AvatarConfig, Scene, ShopItem } from '@/api/types';
import { Avatar } from '@/components/avatar/Avatar';
import { Confetti } from '@/components/games/Confetti';
import { GemPill } from '@/components/games/Scoreboard';
import { SceneBackground } from '@/components/scene/SceneBackground';
import { Badge, Button, Card, ErrorState, Header, PressableScale, Screen, SectionHeader, Sheet, Skeleton, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const SECTIONS: { slot: ShopItem['slot']; title: string }[] = [
  { slot: 'hair', title: 'Hair' },
  { slot: 'outfit', title: 'Outfits' },
  { slot: 'accessory', title: 'Accessories' },
  { slot: 'scene', title: 'Room scenes' },
];

const EARN_HINT = 'Earn gems from quests, daily questions and games.';

function ItemPreview({ item, avatar, size }: { item: ShopItem; avatar: AvatarConfig | undefined; size: number }) {
  if (item.slot === 'scene') {
    return (
      <View style={{ width: '100%', aspectRatio: 1.5, borderRadius: radius.md, overflow: 'hidden' }} accessibilityElementsHidden>
        <SceneBackground scene={item.value as Scene} />
      </View>
    );
  }
  return <Avatar config={{ ...(avatar ?? {}), [item.slot]: item.value }} size={size} />;
}

export default function Shop() {
  const { colors } = useTheme();
  const me = useMe();
  const shop = useShop();
  const config = useConfig();
  const buy = useBuyItem();
  const [selected, setSelected] = useState<ShopItem | null>(null);
  const [bought, setBought] = useState<string | null>(null);
  const [burst, setBurst] = useState<number | null>(null);

  const gems = me.data?.gems ?? 0;
  const grouped = useMemo(() => {
    const items = shop.data ?? [];
    return SECTIONS.map((s) => ({ ...s, items: items.filter((i) => i.slot === s.slot).sort((a, b) => Number(a.price > 0) - Number(b.price > 0) || a.price - b.price) }));
  }, [shop.data]);

  const wearing = (item: ShopItem) => item.slot !== 'scene' && me.data?.avatar[item.slot] === item.value;

  const close = () => {
    setSelected(null);
    setBought(null);
  };

  const purchase = (item: ShopItem) => {
    buy.mutate(item.key, {
      onSuccess: () => {
        haptic.success();
        setBought(item.key);
        setBurst(Date.now());
      },
      onError: (e) => {
        haptic.error();
        if (isApiError(e, 402)) toast.show({ title: 'Not enough gems yet', message: EARN_HINT, tone: 'warning' });
        else if (isApiError(e, 409)) {
          setBought(item.key);
          shop.refetch();
        } else toast.error("Couldn't buy that", errorMessage(e));
      },
    });
  };

  const renderItem = (item: ShopItem) => {
    const isWearing = wearing(item);
    const label = item.owned ? (isWearing ? 'Wearing' : 'Owned') : item.price === 0 ? 'Free' : `${item.price} gems`;
    return (
      <PressableScale
        key={item.key}
        onPress={() => setSelected(item)}
        hapticFeedback="tap"
        scaleTo={0.97}
        accessibilityLabel={`${item.name}, ${label}`}
        accessibilityHint={item.owned ? undefined : 'Opens purchase details'}
        style={[styles.item, { backgroundColor: colors.surface, borderColor: isWearing ? colors.primary : colors.border }, item.slot === 'scene' && styles.sceneItem]}
      >
        <View style={styles.preview}>
          <ItemPreview item={item} avatar={me.data?.avatar} size={76} />
        </View>
        <Text variant="label" numberOfLines={1}>
          {item.name}
        </Text>
        {item.owned ? (
          <View style={styles.state}>
            <Check size={12} color={colors.success} strokeWidth={3} />
            <Text variant="caption" tone="success">
              {isWearing ? 'Wearing' : 'Owned'}
            </Text>
          </View>
        ) : item.price === 0 ? (
          <Text variant="caption" tone="muted">
            Free
          </Text>
        ) : (
          <View style={styles.state}>
            <Gem size={12} color={colors.gold} />
            <Text variant="caption" style={{ color: colors.gold }}>
              {item.price}
            </Text>
          </View>
        )}
      </PressableScale>
    );
  };

  const sel = selected ? (shop.data?.find((i) => i.key === selected.key) ?? selected) : null;
  const justBought = !!sel && bought === sel.key;
  const short = sel ? Math.max(0, sel.price - gems) : 0;

  return (
    <Screen
      scroll
      refreshing={shop.isRefetching && !shop.isLoading}
      onRefresh={() => {
        shop.refetch();
        me.refetch();
      }}
      header={<Header title="Gem shop" right={<GemPill gems={me.data?.gems} onPress={null} />} />}
    >
      <Text tone="muted" style={{ marginBottom: space.lg }}>
        Spend gems on new looks for your avatar and scenes for your hangouts. {EARN_HINT}
      </Text>

      {shop.isLoading ? (
        <View style={styles.grid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} width="31%" height={130} rounded={radius.lg} />
          ))}
        </View>
      ) : shop.isError ? (
        <ErrorState error={shop.error} onRetry={() => shop.refetch()} />
      ) : (
        grouped.map((g) =>
          g.items.length ? (
            <View key={g.slot} style={{ marginBottom: space.xl }}>
              <SectionHeader title={g.title} subtitle={g.slot === 'scene' ? 'Use these when you host a hangout.' : undefined} />
              <View style={styles.grid}>{g.items.map(renderItem)}</View>
            </View>
          ) : null,
        )
      )}

      {/* Earn */}
      <SectionHeader title="Earn gems" />
      <View style={styles.earnRow}>
        <Button title="Quests" icon={Target} variant="secondary" size="sm" onPress={() => router.push('/quests')} style={{ flex: 1 }} />
        <Button title="Daily" icon={Sparkles} variant="secondary" size="sm" onPress={() => router.push('/games/daily')} style={{ flex: 1 }} />
        <Button title="Games" icon={Gamepad2} variant="secondary" size="sm" onPress={() => router.push('/games')} style={{ flex: 1 }} />
      </View>

      {/* Coming soon: never sells anything */}
      <View style={{ marginTop: space.xl, gap: space.md }}>
        <Card style={{ gap: space.sm }}>
          <View style={styles.soonHead}>
            <Gem size={20} color={colors.gold} />
            <Text variant="heading" style={{ flex: 1 }}>
              Get more gems
            </Text>
            <Badge label="Coming soon" tone="neutral" />
          </View>
          <Text tone="muted">
            {config.data?.purchases_available ? 'Gem packs are on their way.' : 'Buying gem packs isn’t available yet.'} Nothing here can be bought right now — for now, gems are earned by playing, answering and hanging out.
          </Text>
          <Button title="Coming soon" variant="outline" disabled fullWidth accessibilityHint="Gem purchases are not available yet" />
        </Card>
        <Card style={{ gap: space.sm, borderColor: colors.primary }}>
          <View style={styles.soonHead}>
            <Crown size={20} color={colors.primary} />
            <Text variant="heading" style={{ flex: 1 }}>
              Veyvo Plus
            </Text>
            <Badge label="Coming soon" tone="primary" />
          </View>
          {['Ad-free, always', 'Monthly gem bonus', 'Exclusive avatar items', 'A little Plus badge on your profile'].map((perk) => (
            <View key={perk} style={styles.perk}>
              <Check size={14} color={colors.primary} strokeWidth={3} />
              <Text variant="body">{perk}</Text>
            </View>
          ))}
          <Text variant="caption" tone="muted">
            A preview of what's planned. Safety tools and core features will always be free.
          </Text>
          <Button title="Coming soon" variant="outline" disabled fullWidth accessibilityHint="Veyvo Plus is not available yet" />
        </Card>
      </View>

      <Sheet visible={!!sel} onClose={close} title={sel?.name}>
        {sel ? (
          <View style={{ gap: space.lg }}>
            <View style={[styles.bigPreview, { backgroundColor: colors.surfaceAlt }]}>
              <ItemPreview item={sel} avatar={me.data?.avatar} size={140} />
            </View>
            {justBought ? (
              <Animated.View entering={FadeIn} style={{ gap: space.sm }}>
                <Text variant="heading" center tone="success">
                  It's yours!
                </Text>
                {sel.slot === 'scene' ? (
                  <Text tone="muted" center>
                    Pick this scene next time you create a hangout.
                  </Text>
                ) : (
                  <Button
                    title="Wear it now"
                    icon={Shirt}
                    size="lg"
                    onPress={() => {
                      close();
                      router.push('/avatar');
                    }}
                    fullWidth
                  />
                )}
                <Button title="Keep browsing" variant="ghost" onPress={close} />
              </Animated.View>
            ) : sel.owned ? (
              <View style={{ gap: space.sm }}>
                <Text tone="muted" center>
                  {wearing(sel) ? "You're wearing this." : sel.price === 0 ? 'Free for everyone.' : 'You already own this.'}
                </Text>
                {sel.slot !== 'scene' && !wearing(sel) ? (
                  <Button
                    title="Wear it in the avatar editor"
                    icon={Wand2}
                    onPress={() => {
                      close();
                      router.push('/avatar');
                    }}
                    fullWidth
                  />
                ) : null}
              </View>
            ) : (
              <View style={{ gap: space.sm }}>
                <View style={styles.priceRow}>
                  <Text variant="bodyStrong">Price</Text>
                  <View style={styles.state}>
                    <Gem size={16} color={colors.gold} />
                    <Text variant="heading" style={{ color: colors.gold }}>
                      {sel.price}
                    </Text>
                  </View>
                </View>
                <View style={styles.priceRow}>
                  <Text tone="muted">Your balance</Text>
                  <Text tone="muted">{gems} gems</Text>
                </View>
                {short > 0 ? (
                  <Text tone="warning" center>
                    You need {short} more gems. {EARN_HINT}
                  </Text>
                ) : null}
                <Button
                  title={short > 0 ? 'Not enough gems yet' : `Buy for ${sel.price} gems`}
                  icon={Gem}
                  size="lg"
                  onPress={() => purchase(sel)}
                  loading={buy.isPending}
                  disabled={short > 0}
                  fullWidth
                />
                {short > 0 ? <Button title="See quests" variant="ghost" onPress={() => { close(); router.push('/quests'); }} /> : null}
              </View>
            )}
          </View>
        ) : null}
        <Confetti burstKey={burst} originY={0.25} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  item: { width: '31.5%', alignItems: 'center', gap: 4, padding: space.sm, borderRadius: radius.lg, borderWidth: 1.5 },
  sceneItem: { width: '48.5%' },
  preview: { width: '100%', alignItems: 'center', justifyContent: 'center', minHeight: 80 },
  state: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  earnRow: { flexDirection: 'row', gap: space.sm },
  soonHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  perk: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  bigPreview: { alignItems: 'center', justifyContent: 'center', padding: space.lg, borderRadius: radius.xl },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
