import { ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { BadgeCheck, ImageOff } from 'lucide-react-native';

import { useModPhotos, useModVerifications, useReview } from '@/api/photos-extra';
import { UserPhoto } from '@/components/UserPhoto';
import { Button, Card, EmptyState, ErrorState, RowSkeleton, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { toast } from '@/stores/toast';
import { radius, space } from '@/theme/tokens';

/** Moderators compare a live selfie (doing the requested pose) with the person's profile photos. */
export function VerificationQueue() {
  const queue = useModVerifications();
  const review = useReview('verifications');

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    try {
      await review.mutateAsync({ id, decision, note: decision === 'reject' ? 'Your selfie didn’t clearly match your photos or the pose. Please try again.' : '' });
      toast.success(decision === 'approve' ? 'Verified' : 'Rejected', 'The selfie has been deleted.');
    } catch (e) {
      toast.error("Couldn't save", errorMessage(e));
    }
  };

  if (queue.isLoading) return <RowSkeleton />;
  if (queue.isError) return <ErrorState error={queue.error} onRetry={() => queue.refetch()} />;
  if (!queue.data?.length) return <EmptyState icon={BadgeCheck} title="No verifications waiting" />;

  return (
    <ScrollView contentContainerStyle={{ gap: space.lg, paddingBottom: space.huge }}>
      {queue.data.map((v) => (
        <Card key={v.id} style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <UserPhoto user={v.user} size={36} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{v.user.display_name}</Text>
              <Text variant="caption" tone="muted">
                Pose: {v.gesture} · {timeAgo(v.created_at)}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="tiny" tone="faint">
                SELFIE
              </Text>
              {v.selfie_url ? <Image source={{ uri: v.selfie_url }} style={styles.big} contentFit="cover" /> : null}
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="tiny" tone="faint">
                PROFILE PHOTOS
              </Text>
              <View style={styles.thumbs}>
                {v.photos.slice(0, 4).map((p) => (p.url ? <Image key={p.id} source={{ uri: p.url }} style={styles.thumb} contentFit="cover" /> : null))}
              </View>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title="Approve" onPress={() => decide(v.id, 'approve')} style={{ flex: 1 }} loading={review.isPending} />
            <Button title="Reject" variant="danger" onPress={() => decide(v.id, 'reject')} style={{ flex: 1 }} />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

/** Photos that automatic moderation couldn't clear (or all photos, when no provider is configured). */
export function PhotoQueue() {
  const queue = useModPhotos();
  const review = useReview('photos');

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    try {
      await review.mutateAsync({ id, decision });
    } catch (e) {
      toast.error("Couldn't save", errorMessage(e));
    }
  };

  if (queue.isLoading) return <RowSkeleton />;
  if (queue.isError) return <ErrorState error={queue.error} onRetry={() => queue.refetch()} />;
  if (!queue.data?.length) return <EmptyState icon={ImageOff} title="No photos waiting" />;

  return (
    <ScrollView contentContainerStyle={{ gap: space.lg, paddingBottom: space.huge }}>
      {queue.data.map((p) => (
        <Card key={p.id} style={{ gap: space.sm }}>
          <Text variant="bodyStrong">
            {p.user.display_name} · {timeAgo(p.created_at)}
          </Text>
          {p.url ? <Image source={{ uri: p.url }} style={styles.big} contentFit="cover" /> : null}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title="Approve" onPress={() => decide(p.id, 'approve')} style={{ flex: 1 }} />
            <Button title="Reject" variant="danger" onPress={() => decide(p.id, 'reject')} style={{ flex: 1 }} />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  big: { width: '100%', aspectRatio: 4 / 5, borderRadius: radius.lg },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  thumb: { width: '48%', aspectRatio: 4 / 5, borderRadius: radius.sm },
});
