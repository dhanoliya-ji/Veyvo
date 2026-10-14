import { Linking, Platform, View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import {
  Bell,
  BookOpen,
  Crown,
  FileText,
  Hash,
  HelpCircle,
  KeyRound,
  LogOut,
  MessageSquareWarning,
  Moon,
  BadgeCheck,
  Camera,
  Shield,
  ShieldCheck,
  UserRound,
  UserX,
} from 'lucide-react-native';

import { useMe } from '@/api/hooks';
import { UserPhoto } from '@/components/UserPhoto';
import { Badge, Card, Header, ListGroup, ListRow, Screen, Text, confirm } from '@/components/ui';
import { LEGAL_URLS, SUPPORT_EMAIL } from '@/lib/config';
import { signOut } from '@/lib/signOut';
import { usePreferences } from '@/stores/preferences';
import { space } from '@/theme/tokens';

export default function SettingsHome() {
  const me = useMe();
  const theme = usePreferences((s) => s.theme);
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const reportProblem = () => {
    const body = encodeURIComponent(`\n\n---\nApp version: ${version}\nPlatform: ${Platform.OS} ${Platform.Version}`);
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Problem report')}&body=${body}`);
  };

  return (
    <Screen scroll header={<Header title="Settings" />}>
      <View style={{ gap: space.xl }}>
        {me.data ? (
          <Card onPress={() => router.push('/settings/profile')} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }} accessibilityLabel="Edit profile">
            <UserPhoto user={me.data} size={52} />
            <View style={{ flex: 1 }}>
              <Text variant="subheading" numberOfLines={1}>
                {me.data.display_name}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                @{me.data.username} · {me.data.email}
              </Text>
            </View>
          </Card>
        ) : null}

        <ListGroup title="Profile">
          <ListRow icon={UserRound} iconTone="primary" title="Edit profile" subtitle="Name, username, bio" onPress={() => router.push('/settings/profile')} />
          <ListRow icon={Camera} iconTone="primary" title="Photos" subtitle="Your profile photos" onPress={() => router.push('/photos')} />
          <ListRow icon={BadgeCheck} iconTone="primary" title="Verification" value={me.data?.verified ? 'Verified' : undefined} onPress={() => router.push('/verification')} />
          <ListRow icon={Hash} iconTone="primary" title="Interests" value={me.data ? `${me.data.interests.length} selected` : undefined} onPress={() => router.push('/settings/interests')} />
        </ListGroup>

        <ListGroup title="Privacy & safety">
          <ListRow icon={Shield} iconTone="success" title="Privacy" subtitle="Who can find, message and invite you" onPress={() => router.push('/settings/privacy')} />
          <ListRow icon={UserX} iconTone="success" title="Blocked accounts" onPress={() => router.push('/settings/blocked')} />
          <ListRow icon={ShieldCheck} iconTone="success" title="Safety centre" onPress={() => router.push('/safety')} />
        </ListGroup>

        <ListGroup title="Preferences">
          <ListRow icon={Bell} iconTone="accent" title="Notifications" onPress={() => router.push('/settings/notifications')} />
          <ListRow icon={Moon} iconTone="accent" title="Appearance & accessibility" value={theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light'} onPress={() => router.push('/settings/appearance')} />
        </ListGroup>

        <ListGroup title="Account">
          <ListRow icon={KeyRound} title="Account & security" subtitle="Password, devices, your data, delete account" onPress={() => router.push('/settings/account')} />
          <ListRow icon={Crown} iconTone="warning" title="Veyvo Plus" subtitle="Ad-free and extra perks" right={me.data?.plus_active ? <Badge label="Active" tone="success" /> : undefined} onPress={() => router.push('/plus')} />
        </ListGroup>

        <ListGroup title="About">
          <ListRow icon={BookOpen} title="Community Guidelines" onPress={() => Linking.openURL(LEGAL_URLS.guidelines)} />
          <ListRow icon={FileText} title="Terms of Service" onPress={() => Linking.openURL(LEGAL_URLS.terms)} />
          <ListRow icon={FileText} title="Privacy Policy" onPress={() => Linking.openURL(LEGAL_URLS.privacy)} />
          <ListRow icon={HelpCircle} title="Help & support" onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
          <ListRow icon={MessageSquareWarning} title="Report a problem" onPress={reportProblem} />
        </ListGroup>

        <ListGroup>
          <ListRow
            icon={LogOut}
            title="Log out"
            destructive
            onPress={async () => {
              if (await confirm({ title: 'Log out?', message: "You'll need your email and password to sign back in.", confirmLabel: 'Log out', destructive: true })) {
                await signOut();
              }
            }}
          />
        </ListGroup>
        <Text variant="caption" tone="faint" center>
          Veyvo {version}
        </Text>
      </View>
    </Screen>
  );
}
