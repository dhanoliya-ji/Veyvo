import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { Bell, CalendarClock, EyeOff, Gamepad2, Heart, MessageCircle, Send, UserPlus } from 'lucide-react-native';

import { useMe, useUpdatePrivacy } from '@/api/hooks';
import type { NotificationPref } from '@/api/types';
import { Button, Card, Header, ListGroup, ListRow, Screen, Text } from '@/components/ui';
import { disablePushNotifications, enablePushNotifications, getPushPermission, pushSupported } from '@/hooks/usePushNotifications';
import { errorMessage } from '@/lib/api';
import { toast } from '@/stores/toast';
import { space } from '@/theme/tokens';

const PREFS: { key: NotificationPref; title: string; icon: typeof Bell }[] = [
  { key: 'friend_requests', title: 'Friend requests', icon: UserPlus },
  { key: 'messages', title: 'Messages', icon: MessageCircle },
  { key: 'room_invites', title: 'Hangout invites', icon: Send },
  { key: 'events', title: 'Events starting', icon: CalendarClock },
  { key: 'games', title: 'Game invites', icon: Gamepad2 },
  { key: 'kudos', title: 'Vibes', icon: Heart },
];

export default function NotificationSettings() {
  const me = useMe();
  const update = useUpdatePrivacy();
  const [permission, setPermission] = useState<string>('undetermined');
  const supported = pushSupported();
  const p = me.data?.privacy;

  useEffect(() => {
    getPushPermission().then(setPermission);
  }, []);

  const set = (patch: Parameters<typeof update.mutate>[0]) => update.mutate(patch, { onError: (e) => toast.error("Couldn't save", errorMessage(e)) });

  const enable = async () => {
    const result = await enablePushNotifications();
    if (result === 'enabled') {
      setPermission('granted');
      toast.success('Push notifications on');
    } else if (result === 'denied') {
      setPermission('denied');
      toast.show({ title: 'Notifications are blocked', message: 'Turn them on for Veyvo in your device settings.', tone: 'warning' });
    } else {
      toast.show({ title: 'Push isn’t available here', message: 'It needs the installed Veyvo app with push configured.', tone: 'warning' });
    }
  };

  return (
    <Screen scroll header={<Header title="Notifications" />}>
      <View style={{ gap: space.xl, marginTop: space.sm }}>
        <Card style={{ gap: space.sm }}>
          <Text variant="subheading">Push notifications</Text>
          {!supported ? (
            <Text tone="muted">Push needs the installed Veyvo app (not available in Expo Go or simulators). In-app notifications still work.</Text>
          ) : permission === 'granted' ? (
            <>
              <Text tone="muted">On for this device.</Text>
              <Button
                title="Turn off on this device"
                variant="secondary"
                size="sm"
                onPress={async () => {
                  await disablePushNotifications();
                  toast.show({ title: 'Push turned off for this device' });
                  setPermission('off');
                }}
              />
            </>
          ) : permission === 'denied' ? (
            <>
              <Text tone="muted">Notifications are blocked in your device settings.</Text>
              <Button title="Open device settings" variant="secondary" size="sm" onPress={() => Linking.openSettings()} />
            </>
          ) : (
            <>
              <Text tone="muted">Get a heads-up when friends invite you or send a request. We never send marketing spam.</Text>
              <Button title="Turn on push" size="sm" onPress={enable} />
            </>
          )}
        </Card>

        {p ? (
          <>
            <ListGroup title="Notify me about">
              {PREFS.map(({ key, title, icon }) => (
                <ListRow
                  key={key}
                  icon={icon}
                  iconTone="accent"
                  title={title}
                  toggle={{ value: p.notification_prefs[key] !== false, onChange: (v) => set({ notification_prefs: { [key]: v } }) }}
                />
              ))}
            </ListGroup>
            <ListGroup title="Lock screen privacy">
              <ListRow
                icon={EyeOff}
                iconTone="success"
                title="Show message previews"
                subtitle="Off by default: notifications say “New message” without the text."
                toggle={{ value: p.notification_previews, onChange: (v) => set({ notification_previews: v }) }}
              />
            </ListGroup>
            <Text variant="caption" tone="faint">
              Account and safety notices are always delivered in the app.
            </Text>
          </>
        ) : null}
      </View>
    </Screen>
  );
}
