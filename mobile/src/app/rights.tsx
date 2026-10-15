import type { ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import {
  Database,
  Gamepad2,
  Heart,
  Mail,
  MessageCircle,
  Phone,
  Shield,
  UserX,
  Users,
  Video,
  type LucideProps,
} from 'lucide-react-native';

import { Card, Header, ListGroup, ListRow, Screen, SectionHeader, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

type Area = { icon: ComponentType<LucideProps>; title: string; rights: string[] };

/** Every control a person has, in one place. Each of these is enforced on the server, not just hidden in the app. */
const AREAS: Area[] = [
  {
    icon: Phone,
    title: 'Calls',
    rights: [
      'Decline any call. Declining is never shown as a "rejection".',
      'Decline and block in one tap from the incoming call screen.',
      'Hang up or end the call for everyone at any time.',
      'Report the call from the call screen.',
    ],
  },
  {
    icon: Video,
    title: 'Camera & video',
    rights: [
      'Your camera always starts off. Only you can turn it on.',
      'Video from people who aren’t your friends stays hidden until you tap Show.',
      'Hide anyone’s video or mute anyone just for yourself.',
      'Only verified people can use their camera with strangers.',
    ],
  },
  {
    icon: Gamepad2,
    title: 'Games',
    rights: [
      'Leave a game or its voice call whenever you want.',
      'Everyone joins game calls muted with strangers.',
      'Report or block a player right from their bubble.',
    ],
  },
  {
    icon: MessageCircle,
    title: 'Chat & voice notes',
    rights: [
      'Only friends can message you. Strangers never can.',
      'Delete your messages and voice notes, or clear a whole chat.',
      'Report any message or voice note. Reports are confidential.',
    ],
  },
  {
    icon: Heart,
    title: 'Friend Swipe',
    rights: [
      'Skips are silent. Nobody ever finds out you skipped them.',
      'Nobody can see who liked them. You only connect when both say yes.',
      'Hide yourself from Friend Swipe, or show only to verified people.',
    ],
  },
  {
    icon: Users,
    title: 'Squads & rooms',
    rights: [
      'Leave any squad or room instantly.',
      'People you block can’t add you to squads or see you in rooms.',
      'Hosts can mute, turn off cameras and remove people.',
    ],
  },
  {
    icon: Mail,
    title: 'Slow Letters',
    rights: [
      'Pen pals only see your name and photo, never your location.',
      'End a pen pal connection or report a letter at any time.',
      'Turn off pen pal matching in privacy settings.',
    ],
  },
  {
    icon: Database,
    title: 'Your data',
    rights: [
      'Download everything Veyvo stores about you.',
      'Delete your account and photos permanently.',
      'Choose who sees your photos, online status and profile.',
    ],
  },
];

export default function YourRights() {
  const { colors } = useTheme();
  return (
    <Screen scroll header={<Header title="Your rights & controls" />}>
      <View style={{ gap: space.xxl, marginTop: space.sm }}>
        <Card style={{ gap: space.sm, backgroundColor: colors.primarySoft, borderColor: 'transparent' }}>
          <Text variant="heading">You decide who you talk to</Text>
          <Text tone="muted">
            Every control below works everywhere in Veyvo and is enforced by our servers, so it can’t be bypassed. None of them notify the other person.
          </Text>
        </Card>

        <View style={{ gap: space.md }}>
          {AREAS.map(({ icon: Icon, title, rights }) => (
            <View key={title} style={[styles.area, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
                  <Icon size={18} color={colors.primary} />
                </View>
                <Text variant="bodyStrong">{title}</Text>
              </View>
              {rights.map((r) => (
                <View key={r} style={{ flexDirection: 'row', gap: space.sm }}>
                  <Text tone="muted">•</Text>
                  <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                    {r}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        <View>
          <SectionHeader title="Manage" />
          <ListGroup>
            <ListRow icon={Shield} iconTone="success" title="Privacy settings" onPress={() => router.push('/settings/privacy')} />
            <ListRow icon={UserX} iconTone="success" title="Blocked accounts" onPress={() => router.push('/settings/blocked')} />
            <ListRow icon={Database} iconTone="success" title="Download or delete my data" onPress={() => router.push('/settings/account')} />
          </ListGroup>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  area: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  icon: { width: 32, height: 32, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
