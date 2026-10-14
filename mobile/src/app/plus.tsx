import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Check, Crown } from 'lucide-react-native';

import { useBillingStatus, useRefreshWallet, useStoreProducts } from '@/api/billing-extra';
import { Button, Card, ErrorState, Header, Screen, Skeleton, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { billingSupported, purchase, restorePurchases } from '@/lib/billing';
import { LEGAL_URLS } from '@/lib/config';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

export default function Plus() {
  const { colors } = useTheme();
  const status = useBillingStatus();
  const s = status.data;
  const canBill = !!s?.billing_available && billingSupported();
  const products = useStoreProducts(canBill);
  const refresh = useRefreshWallet();
  const [busy, setBusy] = useState<'buy' | 'restore' | null>(null);
  const plus = products.data?.plus;

  const subscribe = async () => {
    if (!s || !plus) return;
    setBusy('buy');
    try {
      const r = await purchase(plus, s.account_ref);
      if (r === 'done') {
        haptic.success();
        toast.success('Welcome to Veyvo Plus!', 'Your perks are active now.');
      } else if (r === 'pending') {
        toast.show({ title: 'Payment pending', message: 'Plus turns on as soon as Google Play confirms it.' });
      }
    } catch (e) {
      toast.error('Subscription didn’t go through', e instanceof Error ? e.message : errorMessage(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const restore = async () => {
    setBusy('restore');
    try {
      const n = await restorePurchases();
      toast.show({ title: n ? 'Purchases restored' : 'Nothing to restore', tone: n ? 'success' : 'info' });
    } catch (e) {
      toast.error("Couldn't restore", errorMessage(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const until = s?.plus.until ? new Date(s.plus.until).toLocaleDateString(undefined, { dateStyle: 'medium' }) : null;

  return (
    <Screen scroll header={<Header title="Veyvo Plus" />}>
      {status.isLoading ? <Skeleton height={320} rounded={radius.xl} /> : null}
      {status.isError ? <ErrorState error={status.error} onRetry={() => status.refetch()} /> : null}
      {s ? (
        <View style={{ gap: space.xl, marginTop: space.sm }}>
          <Card style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xxl, borderColor: colors.primary }}>
            <View style={[styles.crown, { backgroundColor: colors.primarySoft }]}>
              <Crown size={32} color={colors.primary} />
            </View>
            <Text variant="title" center>
              {s.plus.active ? 'You’re on Plus' : 'Hang out, upgraded'}
            </Text>
            {s.plus.active && until ? (
              <Text tone="muted" center>
                Active until {until}. Manage or cancel any time in Google Play.
              </Text>
            ) : (
              <Text tone="muted" center>
                Support Veyvo and get a few extras. Everything important stays free for everyone.
              </Text>
            )}
          </Card>

          <Card style={{ gap: space.md }}>
            {s.plus.perks.map((perk) => (
              <View key={perk} style={styles.perk}>
                <Check size={18} color={colors.primary} strokeWidth={3} />
                <Text variant="bodyStrong">{perk}</Text>
              </View>
            ))}
          </Card>

          {s.plus.active ? (
            <Button title="Manage subscription" variant="secondary" onPress={() => Linking.openURL('https://play.google.com/store/account/subscriptions')} fullWidth />
          ) : !s.billing_available ? (
            <Text tone="muted" center>
              Veyvo Plus isn't available yet. Check back soon.
            </Text>
          ) : !billingSupported() ? (
            <Text tone="muted" center>
              Subscriptions need the installed Veyvo app (not Expo Go).
            </Text>
          ) : (
            <Button
              title={plus ? `Subscribe · ${plus.price} / month` : products.isLoading ? 'Loading price…' : 'Not set up in Google Play yet'}
              size="lg"
              onPress={subscribe}
              loading={busy === 'buy'}
              disabled={!plus}
              fullWidth
            />
          )}
          {canBill ? <Button title="Restore purchases" variant="ghost" onPress={restore} loading={busy === 'restore'} /> : null}
          <Text variant="caption" tone="faint" center>
            Billed monthly by Google Play until you cancel. Cancel any time in Google Play → Subscriptions. Blocking, reporting and privacy tools are always free.{' '}
            <Text variant="caption" tone="primary" onPress={() => Linking.openURL(LEGAL_URLS.terms)}>
              Terms
            </Text>
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  crown: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  perk: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
