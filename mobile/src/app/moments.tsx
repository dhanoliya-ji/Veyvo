import { useRef, useState } from 'react';
import { FlatList, Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { Share2, Sparkles, Trash2 } from 'lucide-react-native';

import { useMe } from '@/api/hooks';
import { useDeleteMoment, useMoments, type Moment } from '@/api/moments-extra';
import { MomentCard, momentHeadline } from '@/components/moments/MomentCard';
import { Button, EmptyState, ErrorState, Header, IconButton, RowSkeleton, Screen, Skeleton, Text, confirm } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { radius, screenPadding, space } from '@/theme/tokens';

function MomentItem({ moment, width }: { moment: Moment; width: number }) {
  const me = useMe();
  const cardRef = useRef<View>(null);
  const del = useDeleteMoment();
  const [sharing, setSharing] = useState(false);

  const share = async () => {
    setSharing(true);
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your Veyvo moment' });
      } else {
        throw new Error('sharing unavailable');
      }
      haptic.success();
    } catch {
      // Fall back to plain text if image capture or sharing isn't available on this device.
      const head = momentHeadline(moment);
      await Share.share({ message: `${moment.title} — ${head.big} ${head.label} on Veyvo. Meet your people. Find your vibe.` }).catch(() => undefined);
    } finally {
      setSharing(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Delete this moment?', message: 'It will be removed for good.', confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await del.mutateAsync(moment.id);
    } catch (e) {
      toast.error("Couldn't delete", errorMessage(e));
    }
  };

  return (
    <View style={{ gap: space.md, alignItems: 'center' }}>
      <MomentCard ref={cardRef} moment={moment} avatar={me.data?.avatar} name={me.data?.display_name} width={width} />
      <View style={styles.actions}>
        <Button title="Share" icon={Share2} onPress={share} loading={sharing} style={{ flex: 1 }} />
        <IconButton icon={Trash2} label="Delete moment" variant="filled" onPress={remove} disabled={del.isPending} />
      </View>
    </View>
  );
}

export default function Moments() {
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - screenPadding * 2, 380);
  const moments = useMoments();
  const items = moments.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen padded={false} header={<Header title="Moments" subtitle="Private to you. Share the ones you love." />}>
      {moments.isLoading ? (
        <View style={{ padding: screenPadding, gap: space.lg, alignItems: 'center' }}>
          <Skeleton width={cardWidth} height={cardWidth * 1.25} rounded={radius.xxl} />
          <RowSkeleton count={1} />
        </View>
      ) : moments.isError ? (
        <ErrorState error={moments.error} onRetry={() => moments.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: screenPadding, gap: space.xxxl, paddingBottom: space.huge }}
          onRefresh={() => moments.refetch()}
          refreshing={moments.isRefetching}
          onEndReached={() => moments.hasNextPage && !moments.isFetchingNextPage && moments.fetchNextPage()}
          onEndReachedThreshold={0.5}
          ListHeaderComponent={
            items.length ? (
              <Text variant="caption" tone="faint" center>
                Shared cards only show your avatar and your own numbers — never anyone else.
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon={Sparkles}
              title="No moments yet"
              message="Play a game, hang out for a while or keep your streak going — your highlights will show up here."
              action="Play a game"
              onAction={() => router.push('/games')}
            />
          }
          renderItem={({ item }) => <MomentItem moment={item} width={cardWidth} />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'stretch' },
});
