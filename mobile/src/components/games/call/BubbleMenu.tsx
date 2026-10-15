import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ban, Eye, EyeOff, Flag, UserRound, Volume2, VolumeX } from 'lucide-react-native';

import { useBlock } from '@/api/hooks';
import type { Participant } from '@/api/types';
import { UserPhoto } from '@/components/UserPhoto';
import { openReport } from '@/components/safety/ReportSheet';
import { Badge, Divider, ListGroup, ListRow, Sheet, Text, confirm } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import type { VoiceControls } from '@/lib/voice';
import { toast } from '@/stores/toast';
import { space } from '@/theme/tokens';

type Props = {
  person: Participant | null;
  meId: string;
  voice: VoiceControls;
  setVideoShown: (userId: string, show: boolean) => void;
  onClose: () => void;
};

/** Per-person options in a game call. Everything here except Report and Block only changes what you see and hear. */
export function BubbleMenu({ person, meId, voice, setVideoShown, onClose }: Props) {
  const block = useBlock();
  const p = person;
  const isMe = !!p && p.id === meId;
  const camOn = !!p && voice.camerasOn.has(p.id);
  const shown = !!p && !!voice.videos[p.id];
  const mutedForMe = !!p && voice.audioMuted.has(p.id);

  const doBlock = async () => {
    if (!p) return;
    const ok = await confirm({
      title: `Block ${p.display_name}?`,
      message: "You won't hear or see them, and they can't message or invite you. They aren't told.",
      confirmLabel: 'Block',
      destructive: true,
    });
    if (!ok) return;
    // Stop hearing and seeing them straight away, even before the server confirms.
    voice.setAudioMuted(p.id, true);
    setVideoShown(p.id, false);
    try {
      await block.mutateAsync({ userId: p.id, block: true });
      toast.success(`${p.display_name} is blocked`);
      onClose();
    } catch (e) {
      toast.error("Couldn't block", errorMessage(e));
    }
  };

  return (
    <Sheet visible={!!p} onClose={onClose} scroll>
      {p ? (
        <View style={{ gap: space.lg }}>
          <View style={styles.head}>
            <UserPhoto user={p} size={56} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="heading" numberOfLines={1}>
                {isMe ? 'You' : p.display_name}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {p.is_friend && !isMe ? <Badge label="Friend" tone="success" /> : null}
                {camOn ? <Badge label="Camera on" tone="neutral" /> : null}
                {mutedForMe ? <Badge label="Muted for you" tone="warning" /> : null}
              </View>
            </View>
          </View>

          {isMe ? (
            <Text variant="caption" tone="muted">
              This is you. Use the call bar to turn your mic or camera on and off.
            </Text>
          ) : (
            <>
              <ListGroup title="Just for you">
                {camOn ? (
                  <>
                    <ListRow
                      icon={shown ? EyeOff : Eye}
                      title={shown ? 'Hide their video' : 'Show their video'}
                      subtitle={shown ? "Only you stop seeing it. They aren't told." : 'Their camera is on.'}
                      onPress={() => {
                        setVideoShown(p.id, !shown);
                        onClose();
                      }}
                    />
                    <Divider inset={64} />
                  </>
                ) : null}
                <ListRow
                  icon={mutedForMe ? Volume2 : VolumeX}
                  title={mutedForMe ? 'Unmute for me' : 'Mute for me'}
                  subtitle={mutedForMe ? undefined : "Only you stop hearing them. They aren't told."}
                  onPress={() => {
                    voice.setAudioMuted(p.id, !mutedForMe);
                    toast.show({ title: mutedForMe ? `You can hear ${p.display_name} again` : `${p.display_name} is muted for you`, tone: 'info' });
                    onClose();
                  }}
                />
                <Divider inset={64} />
                <ListRow
                  icon={UserRound}
                  iconTone="primary"
                  title="View profile"
                  onPress={() => {
                    onClose();
                    router.push(`/user/${p.id}`);
                  }}
                />
              </ListGroup>
              <ListGroup title="Safety">
                <ListRow
                  icon={Flag}
                  destructive
                  title={`Report ${p.display_name}`}
                  onPress={() => {
                    onClose();
                    openReport({ targetType: 'user', targetId: p.id, subject: `${p.display_name} in this game call`, blockUserId: p.id });
                  }}
                />
                <Divider inset={64} />
                <ListRow icon={Ban} destructive title={`Block ${p.display_name}`} onPress={doBlock} />
              </ListGroup>
            </>
          )}
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
