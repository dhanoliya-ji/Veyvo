import { Linking, Modal, StyleSheet, View } from 'react-native';
import { ShieldOff } from 'lucide-react-native';

import { Button, Text } from '@/components/ui';
import { LEGAL_URLS, SUPPORT_EMAIL } from '@/lib/config';
import { queryClient } from '@/lib/queryClient';
import { realtime } from '@/lib/realtime';
import { useSession } from '@/stores/session';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

/** Full-screen notice when the server reports the account as suspended or banned. */
export function AccountBlockedOverlay() {
  const { colors } = useTheme();
  const block = useSession((s) => s.accountBlock);
  if (!block) return null;
  const banned = block.code === 'account_banned';
  const until = block.until ? new Date(block.until).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null;

  const signOut = async () => {
    realtime.stop();
    queryClient.clear();
    await useSession.getState().signOutLocal('user');
    useSession.getState().clearAccountBlock();
  };

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <View style={[styles.icon, { backgroundColor: colors.dangerSoft }]}>
          <ShieldOff size={30} color={colors.danger} />
        </View>
        <Text variant="title" center>
          {banned ? 'Account banned' : 'Account suspended'}
        </Text>
        <Text tone="muted" center>
          {banned
            ? 'This account was banned for breaking the Community Guidelines.'
            : `This account is temporarily suspended${until ? ` until ${until}` : ''} for breaking the Community Guidelines.`}
        </Text>
        {block.reason ? (
          <View style={[styles.reason, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text variant="caption" tone="faint">
              Reason
            </Text>
            <Text>{block.reason}</Text>
          </View>
        ) : null}
        <Text variant="caption" tone="faint" center>
          Think this is a mistake? Email {SUPPORT_EMAIL} to appeal.
        </Text>
        <View style={{ gap: space.sm, alignSelf: 'stretch', marginTop: space.lg }}>
          <Button title="Read the Community Guidelines" variant="secondary" onPress={() => Linking.openURL(LEGAL_URLS.guidelines)} fullWidth />
          <Button title="Contact support" variant="secondary" onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Account%20appeal`)} fullWidth />
          <Button title="Sign out" variant="ghost" onPress={signOut} fullWidth />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.md },
  icon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  reason: { alignSelf: 'stretch', padding: space.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
});
