import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Vibration, View } from 'react-native';
import { router } from 'expo-router';
import { Phone, PhoneOff } from 'lucide-react-native';

import type { UserSummary } from '@/api/types';
import { UserPhoto } from '@/components/UserPhoto';
import { PressableScale, Text } from '@/components/ui';
import { post } from '@/lib/api';
import { realtime } from '@/lib/realtime';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

type Call = { roomId: string; from: UserSummary };

const RING_TIMEOUT_MS = 45_000;

/** Full-screen ring when a friend starts a video call. Mounted once at the root. */
export function IncomingCall() {
  const { colors } = useTheme();
  const [call, setCall] = useState<Call | null>(null);

  useEffect(() => {
    const offIn = realtime.on('call.incoming', (e) => setCall({ roomId: e.data.room_id, from: e.data.from }));
    const offDeclined = realtime.on('call.declined', () => toast.show({ title: 'Call declined' }));
    const offEnded = realtime.on('room.ended', (e) => setCall((c) => (c && c.roomId === e.data.room_id ? null : c)));
    return () => {
      offIn();
      offDeclined();
      offEnded();
    };
  }, []);

  useEffect(() => {
    if (!call) return;
    Vibration.vibrate([0, 600, 900], true);
    const t = setTimeout(() => setCall(null), RING_TIMEOUT_MS);
    return () => {
      clearTimeout(t);
      Vibration.cancel();
    };
  }, [call]);

  if (!call) return null;

  const accept = () => {
    const id = call.roomId;
    setCall(null);
    router.push(`/room/${id}`);
  };
  const decline = async () => {
    const id = call.roomId;
    setCall(null);
    await post(`/rooms/calls/${id}/decline`).catch(() => undefined);
  };

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={decline}>
      <View style={[styles.root, { backgroundColor: colors.bg }]} accessibilityViewIsModal>
        <Text variant="label" tone="muted">
          Incoming video call
        </Text>
        <UserPhoto user={call.from} size={150} />
        <Text variant="display" center>
          {call.from.display_name}
        </Text>
        <View style={styles.actions}>
          <PressableScale onPress={decline} style={[styles.btn, { backgroundColor: colors.danger }]} accessibilityLabel="Decline call">
            <PhoneOff size={30} color="#fff" />
          </PressableScale>
          <PressableScale onPress={accept} hapticFeedback="medium" style={[styles.btn, { backgroundColor: colors.success }]} accessibilityLabel="Accept call">
            <Phone size={30} color="#fff" />
          </PressableScale>
        </View>
        <Text variant="caption" tone="faint" center>
          Your camera stays off until you turn it on.
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, padding: space.xxl },
  actions: { flexDirection: 'row', gap: 80, marginTop: space.xxl },
  btn: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
});
