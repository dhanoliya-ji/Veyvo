import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { CalendarHeart, Gem, Sparkles } from 'lucide-react-native';

import { timeLeft, useClaimEvent, useCurrentEvent } from '@/api/moments-extra';
import { ThemePreview } from '@/components/shop/ThemePreview';
import { Button, Card, EmptyState, ErrorState, Header, ProgressBar, Screen, Skeleton, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { radius, space } from '@/theme/tokens';

export default function EventScreen() {
  const event = useCurrentEvent();
  const claim = useClaimEvent();
  const e = event.data;

  const doClaim = async () => {
    if (!e) return;
    try {
      const r = await claim.mutateAsync(e.key);
      haptic.success();
      toast.success(r.already_claimed ? 'Already claimed' : `+${r.gems} gems${r.item_key && e.item ? ` and the ${e.item.name}` : ''}`, r.item_key ? 'Use it from the Shop.' : undefined);
    } catch (err) {
      toast.error("Couldn't claim", errorMessage(err));
    }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <Screen scroll header={<Header title="Event" />}>
      {event.isLoading ? <Skeleton height={320} rounded={radius.xl} /> : null}
      {event.isError ? <ErrorState error={event.error} onRetry={() => event.refetch()} /> : null}
      {event.isSuccess && !e ? (
        <EmptyState icon={CalendarHeart} title="No event right now" message="Seasonal events come with exclusive rewards. Check back soon." action="Back to Home" onAction={() => router.replace('/home')} />
      ) : null}
      {e ? (
        <View style={{ gap: space.xl, marginTop: space.sm }}>
          <Card style={{ gap: space.md, borderColor: `${e.accent}66`, backgroundColor: `${e.accent}14` }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <CalendarHeart size={20} color={e.accent} />
              <Text variant="tiny" style={{ color: e.accent, textTransform: 'uppercase' }}>
                {fmt(e.starts_at)} – {fmt(new Date(new Date(e.ends_at).getTime() - 1).toISOString())} · {timeLeft(e.ends_at)}
              </Text>
            </View>
            <Text variant="display">{e.name}</Text>
            <Text tone="muted">{e.description}</Text>
          </Card>

          <Card style={{ gap: space.md }}>
            <Text variant="subheading">{e.quest.title}</Text>
            <ProgressBar value={e.quest.progress / e.quest.target} color={e.accent} height={8} />
            <Text variant="caption" tone="muted">
              {e.quest.progress} of {e.quest.target} done
            </Text>
            <View style={styles.rewards}>
              <View style={styles.reward}>
                <Gem size={18} color={e.accent} />
                <Text variant="bodyStrong">{e.gems} gems</Text>
              </View>
              <View style={styles.reward}>
                <Sparkles size={18} color={e.accent} />
                <Text variant="bodyStrong">{e.xp} XP</Text>
              </View>
            </View>
            {e.item ? (
              <View style={styles.itemRow}>
                <ThemePreview slot={e.item.slot as 'chess_board' | 'card_back' | 'ludo_board'} value={e.item.value} size={72} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">{e.item.name}</Text>
                  <Text variant="caption" tone="muted">
                    Event exclusive. Only earnable during {e.name} — it never goes on sale.
                  </Text>
                </View>
              </View>
            ) : null}
            <Button
              title={e.quest.claimed ? 'Claimed' : e.quest.completed ? 'Claim reward' : 'Keep going'}
              onPress={e.quest.completed && !e.quest.claimed ? doClaim : () => router.push('/games')}
              disabled={e.quest.claimed}
              loading={claim.isPending}
              fullWidth
            />
          </Card>
          <Text variant="caption" tone="faint" center>
            Event dates are fixed and never extended or reset.
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rewards: { flexDirection: 'row', gap: space.xl },
  reward: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
});
