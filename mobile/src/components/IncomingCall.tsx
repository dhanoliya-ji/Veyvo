import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Vibration, View } from 'react-native';
import { router } from 'expo-router';
import { Ban, Flag, Phone, PhoneOff, Video } from 'lucide-react-native';

import { declineCallRequest, type CallFormat } from '@/api/connect-extra';
import { useBlock } from '@/api/hooks';
import type { UserSummary } from '@/api/types';
import { UserPhoto } from '@/components/UserPhoto';
import { openReport } from '@/components/safety/ReportSheet';
import { PressableScale, Text, confirm } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { realtime } from '@/lib/realtime';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

type Call = { roomId: string; from: UserSummary; format: CallFormat };

const RING_TIMEOUT_MS = 45_000;

/** Full-screen ring when a friend calls. Mounted once at the root. Declining is never shown to the caller as a rejection. */
export function IncomingCall() {
  const { colors } = useTheme();
  const block = useBlock();
  const [call, setCall] = useState<Call | null>(null);

  useEffect(() => {
    const offs = [
      realtime.on('call.incoming', (e) =>
        setCall({
          roomId: e.data.room_id,
          from: e.data.from,
          format: e.data.format === 'voice' ? 'voice' : 'video',
        }),
      ),
      // The caller only ever hears "No answer", whether the call was declined or just missed.
      realtime.on('call.ended', (e) => {
        if (e.data?.reason === 'no_answer')
          toast.show({
            title: 'No answer',
            message: 'They might be busy. Try again later or send a voice note.',
          });
      }),
      realtime.on('call.declined', () => toast.show({ title: 'No answer' })), // older servers
      realtime.on('room.ended', (e) => setCall((c) => (c && c.roomId === e.data.room_id ? null : c))),
    ];
    return () => offs.forEach((off) => off());
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
  const voice = call.format === 'voice';
  const name = call.from.display_name;

  const accept = () => {
    const id = call.roomId;
    setCall(null);
    router.push(`/room/${id}`);
  };
  const decline = async () => {
    const id = call.roomId;
    setCall(null);
    await declineCallRequest(id).catch(() => undefined);
  };
  const declineAndBlock = async () => {
    const current = call;
    const ok = await confirm({
      title: `Decline and block ${name}?`,
      message: "They won't be able to call or message you, and your friendship ends. They aren't told.",
      confirmLabel: 'Decline & block',
      destructive: true,
    });
    if (!ok) return;
    setCall(null);
    await declineCallRequest(current.roomId).catch(() => undefined);
    try {
      await block.mutateAsync({ userId: current.from.id, block: true });
      toast.success(`${name} is blocked`);
    } catch (e) {
      toast.error("Couldn't block", errorMessage(e));
    }
  };
  const report = async () => {
    const current = call;
    await decline();
    setTimeout(
      () =>
        openReport({
          targetType: 'user',
          targetId: current.from.id,
          subject: current.from.display_name,
          blockUserId: current.from.id,
        }),
      250,
    );
  };

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={decline}>
      <View style={[styles.root, { backgroundColor: colors.bg }]} accessibilityViewIsModal>
        <Text variant="label" tone="muted">
          Incoming {voice ? 'voice' : 'video'} call
        </Text>
        <UserPhoto user={call.from} size={150} />
        <Text variant="display" center>
          {name}
        </Text>
        <View style={styles.actions}>
          <PressableScale onPress={decline} style={[styles.btn, { backgroundColor: colors.danger }]} accessibilityLabel="Decline call">
            <PhoneOff size={30} color="#fff" />
          </PressableScale>
          <PressableScale
            onPress={accept}
            hapticFeedback="medium"
            style={[styles.btn, { backgroundColor: colors.success }]}
            accessibilityLabel={`Accept ${voice ? 'voice' : 'video'} call`}
          >
            {voice ? <Phone size={30} color="#fff" /> : <Video size={30} color="#fff" />}
          </PressableScale>
        </View>
        <Text variant="caption" tone="faint" center>
          {voice ? 'Voice only. No camera in this call.' : 'Your camera stays off until you turn it on.'}
        </Text>
        <View style={styles.secondary}>
          <PressableScale onPress={declineAndBlock} style={styles.link} accessibilityLabel={`Decline and block ${name}`}>
            <Ban size={16} color={colors.textMuted} />
            <Text variant="label" tone="muted">
              Decline & block
            </Text>
          </PressableScale>
          <PressableScale onPress={report} style={styles.link} accessibilityLabel={`Report ${name}`}>
            <Flag size={16} color={colors.textMuted} />
            <Text variant="label" tone="muted">
              Report
            </Text>
          </PressableScale>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xl,
    padding: space.xxl,
  },
  actions: { flexDirection: 'row', gap: 80, marginTop: space.xxl },
  btn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: { flexDirection: 'row', gap: space.xl, marginTop: space.lg },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: space.sm,
  },
});
