import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Hourglass, Mail, MailOpen, Send, Settings } from 'lucide-react-native';

import { arrivesIn, useFindPenPal, useLetters, useStopLooking, type PenPal } from '@/api/letters-extra';
import { UserPhoto } from '@/components/UserPhoto';
import { Badge, Button, Card, EmptyState, ErrorState, Header, RowSkeleton, Screen, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space } from '@/theme/tokens';

export default function Letters() {
  const { colors } = useTheme();
  const home = useLetters();
  const find = useFindPenPal();
  const stop = useStopLooking();
  const [refreshing, setRefreshing] = useState(false);
  const data = home.data;
  const full = !!data && data.pen_pals.filter((p) => p.status === 'active').length >= data.max_pen_pals;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await home.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const onFind = async () => {
    try {
      const r = await find.mutateAsync();
      haptic.success();
      if (r.status === 'matched' && r.pen_pal) {
        toast.success(`Meet your pen pal, ${r.pen_pal.pal.display_name} ✉️`);
        router.push(`/letters/${r.pen_pal.id}` as Href);
      } else {
        toast.show({ title: "You're on the list. We'll let you know when we find someone.", tone: 'info' });
      }
    } catch (e) {
      toast.error("Couldn't look for a pen pal", errorMessage(e));
    }
  };

  const intro = (
    <View style={{ gap: space.md, marginBottom: space.lg }}>
      <Card>
        <View style={{ gap: space.sm }}>
          <Text variant="heading">Slow Letters ✉️</Text>
          <Text tone="muted">
            Write real letters to someone far away. Letters take hours to arrive, longer the farther apart you are. After 3 letters each, you can both choose to become friends.
          </Text>
          <Text variant="caption" tone="faint">
            Your pen pal only sees your display name and profile photo. Never your location or profile.
          </Text>
          {!data ? null : !data.allow_pen_pals ? (
            <Button title="Turn on in privacy settings" variant="outline" icon={Settings} onPress={() => router.push('/settings')} />
          ) : data.waiting ? (
            <View style={[styles.waiting, { backgroundColor: colors.primarySoft }]}>
              <Hourglass size={18} color={colors.primary} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                Looking for a pen pal…
              </Text>
              <Button title="Stop" size="sm" variant="ghost" onPress={() => stop.mutate()} loading={stop.isPending} />
            </View>
          ) : full ? (
            <Text variant="caption" tone="muted">
              You have {data.max_pen_pals} pen pals, the most at once. End one to find someone new.
            </Text>
          ) : (
            <Button title="Find a pen pal" icon={Send} onPress={onFind} loading={find.isPending} />
          )}
        </View>
      </Card>
    </View>
  );

  return (
    <Screen padded={false} header={<Header title="Slow Letters" />}>
      {home.isLoading ? (
        <View style={styles.pad}>
          <RowSkeleton count={4} />
        </View>
      ) : home.isError ? (
        <ErrorState error={home.error} onRetry={() => home.refetch()} />
      ) : (
        <FlatList
          data={data?.pen_pals ?? []}
          keyExtractor={(p) => p.id}
          contentContainerStyle={[styles.pad, { gap: space.md, paddingBottom: space.huge }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
          ListHeaderComponent={intro}
          ListEmptyComponent={<EmptyState compact icon={Mail} title="No pen pals yet" message="Find a pen pal to start writing." />}
          renderItem={({ item }) => <PenPalCard pal={item} />}
        />
      )}
    </Screen>
  );
}

function PenPalCard({ pal }: { pal: PenPal }) {
  const { colors } = useTheme();
  const status = pal.incoming_arrives_at
    ? `A letter is on its way, ${arrivesIn(pal.incoming_arrives_at)}`
    : pal.outgoing_arrives_at
      ? `Your letter ${arrivesIn(pal.outgoing_arrives_at)}`
      : pal.letters_sent + pal.letters_received === 0
        ? 'Write the first letter'
        : `${pal.letters_sent} sent · ${pal.letters_received} received`;
  return (
    <Card onPress={() => router.push(`/letters/${pal.id}` as Href)} accessibilityLabel={`${pal.pal.display_name}. ${status}`}>
      <View style={styles.row}>
        <UserPhoto user={pal.pal} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="subheading" numberOfLines={1}>
            {pal.pal.display_name}
          </Text>
          <Text variant="caption" tone={pal.incoming_arrives_at ? 'primary' : 'muted'} numberOfLines={1}>
            {status}
          </Text>
        </View>
        {pal.status === 'friends' ? <Badge label="Friends" tone="success" /> : null}
        {pal.unread_count ? (
          <View style={[styles.unread, { backgroundColor: colors.accentSoft }]}>
            <MailOpen size={14} color={colors.accent} />
            <Text variant="caption" tone="accent">
              {pal.unread_count}
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: screenPadding, paddingTop: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.md, borderRadius: radius.md, minHeight: 48 },
  unread: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill },
});
