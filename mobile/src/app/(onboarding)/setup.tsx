import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { AtSign, BellRing, Eye, MessageCircle, UserPlus } from 'lucide-react-native';

import { qk, useInterests } from '@/api/hooks';
import type { AvatarConfig, Me, Privacy } from '@/api/types';
import { AvatarEditor } from '@/components/avatar/AvatarEditor';
import { randomAvatar } from '@/components/avatar/options';
import { InterestPicker } from '@/components/InterestPicker';
import { Button, ErrorState, Header, Input, ListGroup, ListRow, ProgressBar, RowSkeleton, Screen, Text } from '@/components/ui';
import { enablePushNotifications } from '@/hooks/usePushNotifications';
import { ApiError, errorMessage, fieldErrors, get, post } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/queryClient';
import { useSession } from '@/stores/session';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

const STEPS = ['You', 'Avatar', 'Interests', 'Privacy'] as const;
const USERNAME_RE = /^[a-z0-9][a-z0-9_.]{1,22}[a-z0-9]$/;

export default function Setup() {
  const { colors } = useTheme();
  const interests = useInterests();
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [usernameState, setUsernameState] = useState<{ checking: boolean; ok: boolean | null; reason?: string }>({ checking: false, ok: null });
  const [avatar, setAvatar] = useState<AvatarConfig>(() => randomAvatar());
  const [selected, setSelected] = useState<number[]>([]);
  const [privacy, setPrivacy] = useState<Partial<Privacy>>({ profile_visibility: 'everyone', discoverable: true, show_online_status: 'friends', who_can_friend_request: 'everyone', allow_icebreakers: true });
  const [notifications, setNotifications] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Debounced username availability check.
  useEffect(() => {
    const name = username.trim().toLowerCase();
    if (!name) {
      setUsernameState({ checking: false, ok: null });
      return;
    }
    if (!USERNAME_RE.test(name) || name.includes('..')) {
      setUsernameState({ checking: false, ok: false, reason: '3–24 characters: letters, numbers, dots and underscores.' });
      return;
    }
    setUsernameState({ checking: true, ok: null });
    const t = setTimeout(async () => {
      try {
        const res = await get<{ available: boolean; reason: string | null }>('/me/username-check', { username: name });
        setUsernameState({ checking: false, ok: res.available, reason: res.reason ?? undefined });
      } catch {
        setUsernameState({ checking: false, ok: null });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [username]);

  const canNext = [
    displayName.trim().length > 0 && usernameState.ok === true,
    true,
    selected.length >= 3,
    true,
  ][step];

  const finish = async () => {
    setSubmitting(true);
    try {
      const me = await post<Me>('/me/onboarding', {
        username: username.trim().toLowerCase(),
        display_name: displayName.trim(),
        bio: bio.trim(),
        avatar,
        interest_ids: selected,
        privacy,
      });
      if (notifications) await enablePushNotifications();
      haptic.success();
      toast.success(`Welcome to Veyvo, ${me.display_name}!`, 'You earned 50 gems for joining.');
      queryClient.setQueryData(qk.me, me);
    } catch (e) {
      haptic.error();
      const fields = fieldErrors(e);
      if ((e instanceof ApiError && e.code === 'username_taken') || fields.username) {
        setStep(0);
        setUsernameState({ checking: false, ok: false, reason: 'That username is taken.' });
      }
      toast.error("Couldn't finish setup", errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = (key: keyof Privacy, on: Privacy[keyof Privacy], off: Privacy[keyof Privacy]) => (value: boolean) => setPrivacy((p) => ({ ...p, [key]: value ? on : off }));

  return (
    <Screen
      scroll
      keyboard
      header={
        <View>
          <Header
            title={`Step ${step + 1} of ${STEPS.length}`}
            back={step > 0}
            onBack={() => setStep((s) => Math.max(0, s - 1))}
            right={step === 0 ? <Button title="Sign out" variant="ghost" size="sm" onPress={() => useSession.getState().signOutLocal('user')} /> : undefined}
          />
          <View style={{ paddingHorizontal: space.xl, marginBottom: space.md }}>
            <ProgressBar value={(step + 1) / STEPS.length} />
          </View>
        </View>
      }
      footer={
        <Button
          title={step === STEPS.length - 1 ? 'Start hanging out' : 'Continue'}
          size="lg"
          disabled={!canNext}
          loading={submitting}
          onPress={() => (step === STEPS.length - 1 ? finish() : setStep((s) => s + 1))}
          fullWidth
        />
      }
    >
      <Animated.View key={step} entering={FadeIn.duration(220)} exiting={FadeOut.duration(120)} style={{ gap: space.lg }}>
        {step === 0 ? (
          <>
            <View style={{ gap: space.xs }}>
              <Text variant="title">What should we call you?</Text>
              <Text tone="muted">Use a nickname if you like. Your email is never shown to anyone.</Text>
            </View>
            <Input label="Display name" value={displayName} onChangeText={setDisplayName} maxLength={40} placeholder="e.g. Sam" autoComplete="nickname" />
            <Input
              label="Username"
              icon={AtSign}
              value={username}
              onChangeText={(t) => setUsername(t.replace(/\s/g, '').toLowerCase())}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={24}
              placeholder="sam_hangs"
              error={usernameState.ok === false ? usernameState.reason : undefined}
              hint={usernameState.checking ? 'Checking…' : usernameState.ok ? 'Nice — that one is available.' : 'Friends can find you by this.'}
            />
            <Input label="Short bio (optional)" value={bio} onChangeText={setBio} maxLength={300} counter multiline placeholder="What are you into? What kind of hangouts do you enjoy?" />
          </>
        ) : null}

        {step === 1 ? (
          <>
            <View style={{ gap: space.xs }}>
              <Text variant="title">Make your avatar</Text>
              <Text tone="muted">Veyvo uses cartoon avatars instead of photos, so you can be yourself without showing your face.</Text>
            </View>
            <AvatarEditor value={avatar} onChange={setAvatar} />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <View style={{ gap: space.xs }}>
              <Text variant="title">What are you into?</Text>
              <Text tone="muted">Pick at least 3. We use these to suggest hangouts and people — nothing else.</Text>
              <Text variant="label" tone={selected.length >= 3 ? 'success' : 'primary'}>
                {selected.length} selected
              </Text>
            </View>
            {interests.isLoading ? <RowSkeleton count={4} /> : null}
            {interests.isError ? <ErrorState error={interests.error} onRetry={() => interests.refetch()} compact /> : null}
            {interests.data ? <InterestPicker interests={interests.data} selected={selected} onChange={setSelected} /> : null}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <View style={{ gap: space.xs }}>
              <Text variant="title">Your privacy, your call</Text>
              <Text tone="muted">We've started with private defaults. You can change any of this later in Settings.</Text>
            </View>
            <ListGroup>
              <ListRow icon={Eye} iconTone="primary" title="Show up in search" subtitle="People can find you by name or username." toggle={{ value: !!privacy.discoverable, onChange: toggle('discoverable', true, false) }} />
              <ListRow icon={UserPlus} iconTone="primary" title="Anyone can send friend requests" subtitle="Off: only friends of friends." toggle={{ value: privacy.who_can_friend_request === 'everyone', onChange: toggle('who_can_friend_request', 'everyone', 'friends_of_friends') }} />
              <ListRow icon={MessageCircle} iconTone="primary" title="Icebreaker matches" subtitle="Get matched with people who share an interest." toggle={{ value: !!privacy.allow_icebreakers, onChange: toggle('allow_icebreakers', true, false) }} />
              <ListRow icon={Eye} iconTone="primary" title="Show friends when I'm online" subtitle="Only friends ever see this." toggle={{ value: privacy.show_online_status === 'friends', onChange: toggle('show_online_status', 'friends', 'nobody') }} />
            </ListGroup>
            <ListGroup>
              <ListRow icon={BellRing} iconTone="accent" title="Notifications" subtitle="Friend requests, invites and messages. Message text stays hidden on your lock screen." toggle={{ value: notifications, onChange: setNotifications }} />
            </ListGroup>
            <View style={[styles.note, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text variant="caption" tone="muted">
                Only friends can message you. You can block, report or leave anything instantly — safety tools are always free.
              </Text>
            </View>
          </>
        ) : null}
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { padding: space.lg, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
});
