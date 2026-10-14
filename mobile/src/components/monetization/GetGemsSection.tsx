import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Clapperboard, Crown, Gem } from 'lucide-react-native';

import { adRewardApi, useBillingStatus, useRefreshWallet, useStoreProducts } from '@/api/billing-extra';
import { Badge, Button, Card, PressableScale, Text } from '@/components/ui';
import { adsSupported, showRewardedAd } from '@/lib/ads';
import { ApiError, errorMessage } from '@/lib/api';
import { billingSupported, purchase, type StoreProduct } from '@/lib/billing';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Real ways to get more gems: a capped rewarded ad and Google Play gem packs. Nothing is faked. */
export function GetGemsSection() {
  const { colors } = useTheme();
  const status = useBillingStatus();
  const s = status.data;
  const canBill = !!s?.billing_available && billingSupported();
  const products = useStoreProducts(canBill);
  const refresh = useRefreshWallet();
  const [watching, setWatching] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);

  const watchAd = async () => {
    setWatching(true);
    try {
      const { nonce } = await adRewardApi.start();
      const result = await showRewardedAd(nonce);
      if (result === 'earned') {
        // Gems arrive when Google's signed callback reaches our server. On a dev laptop Google can't reach it,
        // so the development server offers a local stand-in for that callback.
        let granted = false;
        for (let i = 0; i < 6 && !granted; i++) {
          await wait(1500);
          const r = s?.ads.dev_claim ? await adRewardApi.devClaim(nonce) : await adRewardApi.status(nonce);
          granted = r.status === 'granted';
        }
        haptic.success();
        toast.success(granted ? `+${s?.ads.gems_per_ad ?? 0} gems` : 'Reward on its way', granted ? 'Thanks for watching!' : 'It can take a moment to arrive.');
      } else if (result === 'closed') {
        toast.show({ title: 'No reward this time', message: 'Watch the whole ad to earn gems.' });
      } else if (result === 'unavailable') {
        toast.show({ title: 'Ads need the installed Veyvo app', message: 'They don’t work in Expo Go.', tone: 'warning' });
      } else {
        toast.show({ title: 'No ad available right now', message: 'Please try again in a little while.', tone: 'warning' });
      }
    } catch (e) {
      toast.error(e instanceof ApiError && e.code === 'ad_cap_reached' ? 'That’s all for today' : "Couldn't start the ad", errorMessage(e));
    } finally {
      setWatching(false);
      refresh();
    }
  };

  const buy = async (product: StoreProduct) => {
    if (!s) return;
    setBuying(product.id);
    try {
      const result = await purchase(product, s.account_ref);
      if (result === 'done') {
        haptic.success();
        toast.success('Purchase complete', 'Your gems have been added.');
      } else if (result === 'pending') {
        toast.show({ title: 'Payment pending', message: 'We’ll add your gems as soon as Google Play confirms it.' });
      }
    } catch (e) {
      toast.error('Purchase didn’t go through', e instanceof Error ? e.message : errorMessage(e));
    } finally {
      setBuying(null);
      refresh();
    }
  };

  const gemsFor = (id: string) => s?.gem_packs.find((p) => p.product_id === id)?.gems;

  return (
    <View style={{ gap: space.md }}>
      {s?.ads.enabled ? (
        <Card style={{ gap: space.sm }}>
          <View style={styles.head}>
            <Clapperboard size={20} color={colors.accent} />
            <Text variant="heading" style={{ flex: 1 }}>
              Watch an ad
            </Text>
            <Badge label={`${s.ads.remaining_today} left today`} tone="accent" />
          </View>
          <Text tone="muted">Watch a short video to earn {s.ads.gems_per_ad} gems. Totally optional, and never shown in hangouts or chats.</Text>
          <Button
            title={s.ads.remaining_today ? `Watch for +${s.ads.gems_per_ad} gems` : 'Come back tomorrow'}
            icon={Gem}
            variant="accent"
            onPress={watchAd}
            loading={watching}
            disabled={!s.ads.remaining_today || !adsSupported()}
            fullWidth
          />
          {!adsSupported() ? (
            <Text variant="caption" tone="faint">
              Ads need the installed Veyvo app (not Expo Go).
            </Text>
          ) : null}
        </Card>
      ) : null}

      <Card style={{ gap: space.sm }}>
        <View style={styles.head}>
          <Gem size={20} color={colors.gold} />
          <Text variant="heading" style={{ flex: 1 }}>
            Gem packs
          </Text>
        </View>
        {!s?.billing_available ? (
          <Text tone="muted">Gem packs aren't available yet. For now, earn gems from quests, games and the Daily Question.</Text>
        ) : !billingSupported() ? (
          <Text tone="muted">Purchases need the installed Veyvo app (not Expo Go).</Text>
        ) : products.isLoading ? (
          <Text tone="muted">Loading prices from Google Play…</Text>
        ) : !products.data?.packs.length ? (
          <Text tone="muted">Gem packs aren't set up in Google Play yet.</Text>
        ) : (
          <View style={styles.packs}>
            {products.data.packs.map((p) => (
              <PressableScale
                key={p.id}
                onPress={() => buy(p)}
                disabled={!!buying}
                style={[styles.pack, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                accessibilityLabel={`${gemsFor(p.id) ?? ''} gems for ${p.price}`}
              >
                <Gem size={22} color={colors.gold} />
                <Text variant="heading">{gemsFor(p.id) ?? '—'}</Text>
                <Text variant="label" tone="primary">
                  {buying === p.id ? 'Opening…' : p.price}
                </Text>
              </PressableScale>
            ))}
          </View>
        )}
        <Text variant="caption" tone="faint">
          Payments are handled by Google Play. Gems have no cash value. Safety features are always free.
        </Text>
      </Card>

      <Card onPress={() => router.push('/plus')} style={{ gap: space.xs, borderColor: colors.primary }} accessibilityLabel="Veyvo Plus">
        <View style={styles.head}>
          <Crown size={20} color={colors.primary} />
          <Text variant="heading" style={{ flex: 1 }}>
            Veyvo Plus
          </Text>
          {s?.plus.active ? <Badge label="Active" tone="success" /> : <Badge label="See perks" tone="primary" />}
        </View>
        <Text tone="muted">No ads, monthly gems, a Plus badge and bigger hangouts.</Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  packs: { flexDirection: 'row', gap: space.sm },
  pack: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
