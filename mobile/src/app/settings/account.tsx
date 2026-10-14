import { useState } from 'react';
import { Linking, Share, View } from 'react-native';
import { Download, Globe, KeyRound, LogOut, Trash2 } from 'lucide-react-native';

import { accountApi, useMe } from '@/api/hooks';
import { Button, Header, Input, ListGroup, ListRow, Screen, Sheet, Text, confirm } from '@/components/ui';
import { errorMessage, fieldErrors } from '@/lib/api';
import { LEGAL_URLS } from '@/lib/config';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/queryClient';
import { realtime } from '@/lib/realtime';
import { signOut } from '@/lib/signOut';
import { useSession } from '@/stores/session';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

export default function AccountSettings() {
  const { colors } = useTheme();
  const me = useMe();
  const [sheet, setSheet] = useState<'password' | 'delete' | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openSheet = (s: 'password' | 'delete') => {
    setError(null);
    setCurrent('');
    setNext('');
    setDeletePassword('');
    setConfirmText('');
    setSheet(s);
  };

  const changePassword = async () => {
    setBusy(true);
    setError(null);
    try {
      await accountApi.changePassword(current, next);
      haptic.success();
      toast.success('Password changed', 'Other devices were signed out.');
      setSheet(null);
    } catch (e) {
      setError(fieldErrors(e).new_password ?? errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const exportData = async () => {
    setBusy(true);
    try {
      const data = await accountApi.exportData();
      await Share.share({ title: 'My Veyvo data', message: JSON.stringify(data, null, 2) });
    } catch (e) {
      toast.error("Couldn't export your data", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      await accountApi.deleteAccount(deletePassword);
      haptic.success();
      realtime.stop();
      queryClient.clear();
      setSheet(null);
      await useSession.getState().signOutLocal('deleted');
      toast.success('Your account was deleted', 'Thanks for hanging out with us.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll header={<Header title="Account & security" />}>
      <View style={{ gap: space.xl, marginTop: space.sm }}>
        <ListGroup title="Sign-in">
          <ListRow title="Email" value={me.data?.email} />
          <ListRow icon={KeyRound} iconTone="primary" title="Change password" onPress={() => openSheet('password')} />
          <ListRow
            icon={LogOut}
            iconTone="primary"
            title="Sign out of all devices"
            subtitle="Use this if you think someone else has access."
            onPress={async () => {
              if (await confirm({ title: 'Sign out everywhere?', message: 'Every device, including this one, will need to sign in again.', confirmLabel: 'Sign out everywhere', destructive: true })) {
                try {
                  await accountApi.logoutAll();
                } catch {
                  /* signing out locally anyway */
                }
                await signOut();
              }
            }}
          />
        </ListGroup>

        <ListGroup title="Your data">
          <ListRow icon={Download} iconTone="success" title="Download my data" subtitle="Everything Veyvo stores about you, as JSON." onPress={exportData} />
          <ListRow icon={Globe} iconTone="success" title="Privacy Policy" subtitle="What we collect and why" onPress={() => Linking.openURL(LEGAL_URLS.privacy)} />
        </ListGroup>

        <ListGroup title="Danger zone">
          <ListRow icon={Trash2} title="Delete account" subtitle="Permanently erase your account and personal data." destructive onPress={() => openSheet('delete')} />
        </ListGroup>
        <Text variant="caption" tone="faint">
          You can also delete your account from the web at {LEGAL_URLS.deleteAccount}.
        </Text>
      </View>

      <Sheet visible={sheet === 'password'} onClose={() => setSheet(null)} title="Change password">
        <View style={{ gap: space.md }}>
          <Input label="Current password" secure value={current} onChangeText={setCurrent} autoComplete="current-password" />
          <Input label="New password" secure value={next} onChangeText={setNext} hint="8+ characters with a letter and a number" autoComplete="new-password" />
          {error ? <Text tone="danger">{error}</Text> : null}
          <Button title="Update password" onPress={changePassword} loading={busy} disabled={!current || next.length < 8} fullWidth />
        </View>
      </Sheet>

      <Sheet visible={sheet === 'delete'} onClose={() => setSheet(null)} title="Delete your account?" scroll>
        <View style={{ gap: space.md }}>
          <Text tone="muted">This is permanent and happens immediately. We'll erase:</Text>
          {['Your profile, avatar and interests', 'Messages you sent and your hangout chat', 'Friends, requests and blocks', 'Gems, items, quests and game history'].map((line) => (
            <Text key={line} variant="body">
              •  {line}
            </Text>
          ))}
          <Text variant="caption" tone="faint">
            Reports you filed are kept without your name so open safety reviews can finish. Live hangouts you host will end.
          </Text>
          <Input label="Password" secure value={deletePassword} onChangeText={setDeletePassword} autoComplete="current-password" />
          <Input label="Type DELETE to confirm" value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" />
          {error ? <Text tone="danger">{error}</Text> : null}
          <Button
            title="Permanently delete"
            variant="danger"
            onPress={deleteAccount}
            loading={busy}
            disabled={!deletePassword || confirmText.trim().toUpperCase() !== 'DELETE'}
            fullWidth
            style={{ borderWidth: 1, borderColor: colors.danger }}
          />
          <Button title="Keep my account" variant="secondary" onPress={() => setSheet(null)} fullWidth />
        </View>
      </Sheet>
    </Screen>
  );
}
