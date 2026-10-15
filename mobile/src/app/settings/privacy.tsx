import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Activity, BadgeCheck, Check, Eye, EyeOff, Hand, Hash, Images, Mail, MessageCircle, Search, Send, Sparkles, UserPlus } from 'lucide-react-native';

import { useMe, useUpdatePrivacy } from '@/api/hooks';
import type { Privacy } from '@/api/types';
import { Header, ListGroup, ListRow, PressableScale, Screen, Sheet, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

type ChoiceKey = 'who_can_friend_request' | 'who_can_invite' | 'who_can_message' | 'profile_visibility';

const CHOICES: Record<ChoiceKey, { title: string; options: { value: string; label: string; detail: string }[] }> = {
  profile_visibility: {
    title: 'Who can see my full profile',
    options: [
      { value: 'everyone', label: 'Everyone on Veyvo', detail: 'Bio, interests and vibes are visible to others.' },
      { value: 'friends', label: 'Friends only', detail: 'Others only see your profile picture, name and username.' },
    ],
  },
  who_can_friend_request: {
    title: 'Who can send me friend requests',
    options: [
      { value: 'everyone', label: 'Everyone', detail: 'Anyone can send a request. You choose who to accept.' },
      { value: 'friends_of_friends', label: 'Friends of friends', detail: 'Only people who share a friend with you.' },
      { value: 'nobody', label: 'Nobody', detail: 'You can still add people yourself.' },
    ],
  },
  who_can_invite: {
    title: 'Who can invite me to hangouts',
    options: [
      { value: 'everyone', label: 'Everyone', detail: 'Anyone can send you a hangout invite.' },
      { value: 'friends', label: 'Friends', detail: 'Only your friends can invite you.' },
      { value: 'nobody', label: 'Nobody', detail: 'No hangout invites.' },
    ],
  },
  who_can_message: {
    title: 'Who can message me',
    options: [
      { value: 'friends', label: 'Friends', detail: 'Only mutual friends can message. Strangers never can.' },
      { value: 'nobody', label: 'Nobody', detail: 'Turn off direct messages entirely.' },
    ],
  },
};

export default function PrivacySettings() {
  const { colors } = useTheme();
  const me = useMe();
  const update = useUpdatePrivacy();
  const [open, setOpen] = useState<ChoiceKey | null>(null);
  const p = me.data?.privacy;

  const set = (patch: Partial<Privacy>) =>
    update.mutate(patch, { onError: (e) => toast.error("Couldn't save that setting", errorMessage(e)) });

  const label = (key: ChoiceKey) => CHOICES[key].options.find((o) => o.value === p?.[key])?.label ?? '';

  const section = (children: ReactNode, title: string) => <ListGroup title={title}>{children}</ListGroup>;

  return (
    <Screen scroll header={<Header title="Privacy" />}>
      {p ? (
        <View style={{ gap: space.xl, marginTop: space.sm }}>
          <Text tone="muted">You're in control. Changes save instantly and apply everywhere, enforced by our servers.</Text>
          {section(
            <>
              <ListRow icon={Eye} iconTone="primary" title="Profile visibility" value={label('profile_visibility')} onPress={() => setOpen('profile_visibility')} />
              <ListRow icon={Search} iconTone="primary" title="Show me in search" subtitle="Let people find you by name or username." toggle={{ value: p.discoverable, onChange: (v) => set({ discoverable: v }) }} />
              <ListRow icon={Hash} iconTone="primary" title="Show my interests" subtitle="Friends can always see them." toggle={{ value: p.show_interests, onChange: (v) => set({ show_interests: v }) }} />
              <ListRow
                icon={Images}
                iconTone="primary"
                title="All my photos visible to everyone"
                subtitle="Off: people who aren't your friends only see your profile picture."
                toggle={{ value: p.photo_visibility !== 'friends', onChange: (v) => set({ photo_visibility: v ? 'everyone' : 'friends' }) }}
              />
            </>,
            'Profile',
          )}
          {section(
            <>
              <ListRow icon={UserPlus} iconTone="primary" title="Friend requests" value={label('who_can_friend_request')} onPress={() => setOpen('who_can_friend_request')} />
              <ListRow icon={MessageCircle} iconTone="primary" title="Messages" value={label('who_can_message')} onPress={() => setOpen('who_can_message')} />
              <ListRow icon={Send} iconTone="primary" title="Hangout invites" value={label('who_can_invite')} onPress={() => setOpen('who_can_invite')} />
              <ListRow icon={Sparkles} iconTone="primary" title="Icebreaker matches" subtitle="Be matched with people who share an interest." toggle={{ value: p.allow_icebreakers, onChange: (v) => set({ allow_icebreakers: v }) }} />
            </>,
            'Contact',
          )}
          {section(
            <>
              <ListRow
                icon={Hand}
                iconTone="primary"
                title="Show me in Friend Swipe"
                subtitle="Off: you won't appear in anyone's deck. You can still swipe yourself."
                toggle={{ value: p.show_in_discover !== false, onChange: (v) => set({ show_in_discover: v }) }}
              />
              <ListRow
                icon={BadgeCheck}
                iconTone="primary"
                title="Only show me to verified people"
                subtitle="Only people who passed a selfie check will see you in Friend Swipe."
                toggle={{ value: !!p.discover_verified_only, onChange: (v) => set({ discover_verified_only: v }), disabled: p.show_in_discover === false }}
              />
              <ListRow
                icon={Mail}
                iconTone="primary"
                title="Allow pen pal matches"
                subtitle="Be matched with someone new to write Slow Letters with."
                toggle={{ value: p.allow_pen_pals !== false, onChange: (v) => set({ allow_pen_pals: v }) }}
              />
            </>,
            'Meeting new friends',
          )}
          {section(
            <>
              <ListRow
                icon={p.show_online_status === 'friends' ? Activity : EyeOff}
                iconTone="primary"
                title="Show when I'm online"
                subtitle="Only friends can see it. Turning this off also hides your read receipts — and you won't see theirs."
                toggle={{ value: p.show_online_status === 'friends', onChange: (v) => set({ show_online_status: v ? 'friends' : 'nobody' }) }}
              />
            </>,
            'Activity',
          )}
          <Text variant="caption" tone="faint">
            Veyvo never shows your email, never asks for your location, and doesn't record voice. Download or delete your data any time in Account & security.
          </Text>
        </View>
      ) : null}

      <Sheet visible={!!open} onClose={() => setOpen(null)} title={open ? CHOICES[open].title : undefined}>
        <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
          {open
            ? CHOICES[open].options.map((o) => {
                const active = p?.[open] === o.value;
                return (
                  <PressableScale
                    key={o.value}
                    hapticFeedback="tap"
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      set({ [open]: o.value } as Partial<Privacy>);
                      setOpen(null);
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1.5, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primarySoft : 'transparent' }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong">{o.label}</Text>
                      <Text variant="caption" tone="muted">
                        {o.detail}
                      </Text>
                    </View>
                    {active ? <Check size={18} color={colors.primary} /> : null}
                  </PressableScale>
                );
              })
            : null}
        </View>
      </Sheet>
    </Screen>
  );
}
