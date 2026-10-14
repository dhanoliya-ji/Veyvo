import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { useInterests, useMe, useUpdateInterests } from '@/api/hooks';
import { InterestPicker } from '@/components/InterestPicker';
import { Button, ErrorState, Header, RowSkeleton, Screen, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { space } from '@/theme/tokens';

export default function EditInterests() {
  const me = useMe();
  const interests = useInterests();
  const update = useUpdateInterests();
  const [selected, setSelected] = useState<number[]>([]);

  useEffect(() => {
    if (me.data) setSelected(me.data.interests.map((i) => i.id));
  }, [me.data]);

  const save = async () => {
    try {
      await update.mutateAsync(selected);
      haptic.success();
      toast.success('Interests updated', 'Your recommendations will refresh.');
      router.back();
    } catch (e) {
      toast.error("Couldn't save", errorMessage(e));
    }
  };

  return (
    <Screen
      scroll
      keyboard
      header={<Header title="Interests" subtitle={`${selected.length} of 12 selected`} />}
      footer={<Button title="Save" size="lg" onPress={save} disabled={selected.length < 1} loading={update.isPending} fullWidth />}
    >
      <View style={{ gap: space.lg, marginTop: space.sm }}>
        <Text tone="muted">We use these to suggest hangouts, communities and people. Pick up to 12.</Text>
        {interests.isLoading ? <RowSkeleton count={4} /> : null}
        {interests.isError ? <ErrorState error={interests.error} onRetry={() => interests.refetch()} /> : null}
        {interests.data ? <InterestPicker interests={interests.data} selected={selected} onChange={setSelected} /> : null}
      </View>
    </Screen>
  );
}
