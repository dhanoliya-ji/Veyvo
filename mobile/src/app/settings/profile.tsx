import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { AtSign } from 'lucide-react-native';

import { useMe, useUpdateProfile } from '@/api/hooks';
import type { Vibe } from '@/api/types';
import { Button, Chip, Header, Input, Screen, Text } from '@/components/ui';
import { VIBE_LABELS } from '@/lib/format';
import { errorMessage, fieldErrors, get } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { space } from '@/theme/tokens';

const VIBES: Vibe[] = ['down_to_chat', 'studying', 'listening', 'gaming', 'busy'];

export default function EditProfile() {
  const me = useMe();
  const update = useUpdateProfile();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [usernameError, setUsernameError] = useState<string | undefined>();
  const [nameError, setNameError] = useState<string | undefined>();

  useEffect(() => {
    if (me.data) {
      setDisplayName(me.data.display_name);
      setUsername(me.data.username ?? '');
      setBio(me.data.bio);
    }
  }, [me.data]);

  useEffect(() => {
    if (!me.data || username === me.data.username) {
      setUsernameError(undefined);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await get<{ available: boolean; reason: string | null }>('/me/username-check', { username });
        setUsernameError(res.available ? undefined : res.reason ?? 'That username is taken.');
      } catch {
        /* ignore */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [username, me.data]);

  const setVibe = (vibe: Vibe | null) => {
    if ((me.data?.vibe ?? null) === vibe) return;
    update.mutate(vibe ? { vibe } : { clear_vibe: true }, { onError: (e) => toast.error("Couldn't update your vibe", errorMessage(e)) });
  };

  const dirty = !!me.data && (displayName !== me.data.display_name || username !== (me.data.username ?? '') || bio !== me.data.bio);

  const save = async () => {
    if (!displayName.trim()) {
      setNameError('Your display name can’t be empty.');
      return;
    }
    try {
      await update.mutateAsync({
        display_name: displayName.trim(),
        bio: bio.trim(),
        ...(username !== me.data?.username ? { username } : {}),
      });
      haptic.success();
      toast.success('Profile updated');
      router.back();
    } catch (e) {
      const f = fieldErrors(e);
      if (f.username) setUsernameError(f.username);
      if (f.display_name) setNameError(f.display_name);
      if (!f.username && !f.display_name) toast.error("Couldn't save", errorMessage(e));
    }
  };

  return (
    <Screen scroll keyboard header={<Header title="Edit profile" />} footer={<Button title="Save changes" size="lg" onPress={save} disabled={!dirty || !!usernameError} loading={update.isPending} fullWidth />}>
      <View style={{ gap: space.lg, marginTop: space.sm }}>
        <Input label="Display name" value={displayName} onChangeText={(t) => { setDisplayName(t); setNameError(undefined); }} maxLength={40} error={nameError} />
        <Input
          label="Username"
          icon={AtSign}
          value={username}
          onChangeText={(t) => setUsername(t.replace(/\s/g, '').toLowerCase())}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={24}
          error={usernameError}
          hint="Changing it frees up your old username for others."
        />
        <Input label="Bio" value={bio} onChangeText={setBio} maxLength={300} counter multiline placeholder="What are you into?" />
        <View style={{ gap: space.sm }}>
          <Text variant="label" tone="muted">
            Vibe — let people know what you're up for
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityRole="radiogroup">
            <Chip label="No vibe" selected={!me.data?.vibe} onPress={() => setVibe(null)} />
            {VIBES.map((v) => (
              <Chip key={v} label={VIBE_LABELS[v]} selected={me.data?.vibe === v} onPress={() => setVibe(v)} />
            ))}
          </View>
        </View>
        <Text variant="caption" tone="faint">
          Your email ({me.data?.email}) is private and never shown on your profile.
        </Text>
      </View>
    </Screen>
  );
}
