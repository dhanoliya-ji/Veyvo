import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { Gem, Lock } from 'lucide-react-native';

import { useMe, useShop, useUpdateAvatar, useUpdateProfile } from '@/api/hooks';
import type { AvatarConfig, Vibe } from '@/api/types';
import { AvatarEditor } from '@/components/avatar/AvatarEditor';
import { Avatar } from '@/components/avatar/Avatar';
import type { Cosmetic } from '@/components/avatar/options';
import { Button, Chip, ErrorState, Header, RowSkeleton, Screen, Sheet, Text, confirm } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { VIBE_LABELS } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const VIBES: Vibe[] = ['down_to_chat', 'studying', 'listening', 'gaming', 'busy'];

const same = (a: AvatarConfig | null, b: AvatarConfig | undefined) =>
  !!a && !!b && (Object.keys(a) as (keyof AvatarConfig)[]).every((k) => a[k] === b[k]);

export default function AvatarScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const me = useMe();
  const shop = useShop();
  const save = useUpdateAvatar();
  const profile = useUpdateProfile();
  const [draft, setDraft] = useState<AvatarConfig | null>(null);
  const [locked, setLocked] = useState<Cosmetic | null>(null);
  const leaving = useRef(false);

  useEffect(() => {
    if (me.data && !draft) setDraft(me.data.avatar);
  }, [me.data, draft]);

  const owned = useMemo(() => new Set((shop.data ?? []).filter((i) => i.owned).map((i) => i.key)), [shop.data]);
  const dirty = !!draft && !same(draft, me.data?.avatar);

  // Unsaved-changes guard (back button, gesture, hardware back).
  useEffect(() => {
    return navigation.addListener('beforeRemove', (e) => {
      if (!dirty || leaving.current) return;
      e.preventDefault();
      confirm({ title: 'Discard changes?', message: "Your avatar changes haven't been saved.", confirmLabel: 'Discard', destructive: true }).then((ok) => {
        if (ok) {
          leaving.current = true;
          navigation.dispatch(e.data.action);
        }
      });
    });
  }, [navigation, dirty]);

  const onSave = () => {
    if (!draft) return;
    save.mutate(draft, {
      onSuccess: () => {
        haptic.success();
        toast.success('Avatar saved', 'Looking good.');
        leaving.current = true;
        if (router.canGoBack()) router.back();
      },
      onError: (e) => {
        haptic.error();
        toast.error("Couldn't save your avatar", errorMessage(e));
      },
    });
  };

  const setVibe = (vibe: Vibe | null) => {
    if ((me.data?.vibe ?? null) === vibe) return;
    profile.mutate(vibe ? { vibe } : { clear_vibe: true }, {
      onSuccess: () => haptic.tap(),
      onError: (e) => toast.error("Couldn't update your vibe", errorMessage(e)),
    });
  };

  let body;
  if (me.isLoading || (!draft && !me.isError)) body = <RowSkeleton count={4} />;
  else if (me.isError || !draft) body = <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  else
    body = (
      <View style={{ gap: space.xl }}>
        <AvatarEditor value={draft} onChange={setDraft} owned={owned} onLockedPress={setLocked} />

        <View style={{ gap: space.sm }}>
          <Text variant="heading">Your vibe</Text>
          <Text variant="caption" tone="muted">
            Shows next to your name so people know what you're up for. Saves instantly.
          </Text>
          <View style={styles.vibes} accessibilityRole="radiogroup">
            <Chip label="No vibe" selected={!me.data?.vibe} onPress={() => setVibe(null)} />
            {VIBES.map((v) => (
              <Chip key={v} label={VIBE_LABELS[v]} selected={me.data?.vibe === v} onPress={() => setVibe(v)} />
            ))}
          </View>
        </View>
      </View>
    );

  return (
    <Screen
      scroll
      header={<Header title="Edit avatar" subtitle={dirty ? 'Unsaved changes' : undefined} />}
      footer={draft ? <Button title={dirty ? 'Save avatar' : 'Saved'} size="lg" onPress={onSave} loading={save.isPending} disabled={!dirty} fullWidth /> : undefined}
    >
      {body}
      <Sheet visible={!!locked} onClose={() => setLocked(null)} title={locked ? `Unlock ${locked.name}` : undefined}>
        {locked && draft ? (
          <View style={{ gap: space.lg, alignItems: 'center' }}>
            <View style={[styles.preview, { backgroundColor: colors.surfaceAlt }]}>
              <Avatar config={{ ...draft, [locked.slot]: locked.value }} size={120} />
              <View style={[styles.lock, { backgroundColor: colors.bg }]}>
                <Lock size={14} color={colors.gold} />
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Gem size={16} color={colors.gold} />
              <Text variant="heading" style={{ color: colors.gold }}>
                {locked.price} gems
              </Text>
            </View>
            <Text tone="muted" center>
              {locked.name} is in the gem shop. You have {me.data?.gems ?? 0} gems.
            </Text>
            <Button
              title="Unlock in the shop"
              size="lg"
              fullWidth
              onPress={async () => {
                setLocked(null);
                if (dirty) {
                  const ok = await confirm({ title: 'Save your changes first?', message: 'Your avatar changes will be saved before you go to the shop.', confirmLabel: 'Save and go' });
                  if (!ok) return;
                  try {
                    await save.mutateAsync(draft);
                  } catch (e) {
                    toast.error("Couldn't save your avatar", errorMessage(e));
                    return;
                  }
                }
                router.push('/shop');
              }}
            />
            <Button title="Not now" variant="ghost" onPress={() => setLocked(null)} />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  vibes: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  preview: { padding: space.lg, borderRadius: radius.xl },
  lock: { position: 'absolute', top: space.sm, right: space.sm, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
