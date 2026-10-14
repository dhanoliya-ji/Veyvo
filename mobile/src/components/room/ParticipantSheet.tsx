import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Award, Ban, Flag, Hand, Mic, MicOff, ShieldCheck, ShieldOff, UserMinus, UserRound, UserX } from 'lucide-react-native';

import { useBlock, useConfig, useGiveKudos, useRoomAction } from '@/api/hooks';
import type { ModerateAction, Participant } from '@/api/types';
import { UserPhoto } from '@/components/UserPhoto';
import { openReport } from '@/components/safety/ReportSheet';
import { Badge, Chip, Divider, ListGroup, ListRow, Sheet, Text, confirm } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { space } from '@/theme/tokens';
import { ROLE_LABEL } from './constants';

type Props = {
  roomId: string;
  participant: Participant | null;
  meId: string | undefined;
  iAmHost: boolean;
  canModerate: boolean;
  /** Speaking roles and muting only matter in voice rooms. */
  isVoice: boolean;
  onClose: () => void;
};

export function ParticipantSheet({ roomId, participant, meId, iAmHost, canModerate, isVoice, onClose }: Props) {
  const config = useConfig();
  const kudos = useGiveKudos();
  const block = useBlock();
  const { moderate } = useRoomAction(roomId);
  const [kudosOpen, setKudosOpen] = useState(false);
  const p = participant;
  const isMe = !!p && p.id === meId;
  const targetIsHost = p?.role === 'host';
  // Only the host manages moderators; nobody moderates the host or themselves.
  const canManage = !!p && canModerate && !isMe && !targetIsHost && (p.role !== 'moderator' || iAmHost);

  const close = () => {
    setKudosOpen(false);
    onClose();
  };

  const act = async (action: ModerateAction, label: string) => {
    if (!p) return;
    if (action === 'remove' || action === 'ban') {
      const ok = await confirm({
        title: action === 'ban' ? `Ban ${p.display_name}?` : `Remove ${p.display_name}?`,
        message: action === 'ban' ? "They'll be removed and can't come back to this hangout." : 'They will be removed from the hangout. They can rejoin later if it is public.',
        confirmLabel: action === 'ban' ? 'Ban' : 'Remove',
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      await moderate.mutateAsync({ userId: p.id, action });
      haptic.success();
      toast.success(label);
      close();
    } catch (e) {
      toast.error("Couldn't do that", errorMessage(e));
    }
  };

  const giveKudos = async (tag: string, name: string) => {
    if (!p) return;
    try {
      await kudos.mutateAsync({ userId: p.id, tag });
      haptic.success();
      toast.success(`You gave ${p.display_name} “${name}”`);
      close();
    } catch (e) {
      toast.error("Couldn't send kudos", errorMessage(e));
    }
  };

  const doBlock = async () => {
    if (!p) return;
    const ok = await confirm({
      title: `Block ${p.display_name}?`,
      message: "They won't be able to message you, invite you or see you in rooms, and you won't see them. They aren't told.",
      confirmLabel: 'Block',
      destructive: true,
    });
    if (!ok) return;
    try {
      await block.mutateAsync({ userId: p.id, block: true });
      toast.success(`${p.display_name} is blocked`);
      close();
    } catch (e) {
      toast.error("Couldn't block", errorMessage(e));
    }
  };

  const kudosTags = Object.entries(config.data?.kudos_tags ?? {});

  return (
    <Sheet visible={!!p} onClose={close} scroll>
      {p ? (
        <View style={{ gap: space.lg }}>
          <View style={styles.head}>
            <UserPhoto user={p} size={64} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="heading" numberOfLines={1}>
                {p.display_name}
                {isMe ? ' (you)' : ''}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                <Badge label={ROLE_LABEL[p.role] ?? p.role} tone={p.role === 'host' ? 'warning' : p.role === 'moderator' ? 'primary' : 'neutral'} />
                {p.is_friend ? <Badge label="Friend" tone="success" /> : null}
                {p.hand_raised ? <Badge label="Hand raised" tone="warning" /> : null}
                {p.muted_by_host ? <Badge label="Muted by host" tone="danger" /> : null}
              </View>
            </View>
          </View>

          {!isMe ? (
            <ListGroup>
              <ListRow
                icon={UserRound}
                iconTone="primary"
                title="View profile"
                onPress={() => {
                  close();
                  router.push(`/user/${p.id}`);
                }}
              />
              <Divider inset={64} />
              <ListRow icon={Award} iconTone="accent" title="Give kudos" subtitle="A little thank-you they'll see on their profile." onPress={() => setKudosOpen((o) => !o)} />
              {kudosOpen ? (
                <View style={styles.kudos}>
                  {kudosTags.length === 0 ? (
                    <Text variant="caption" tone="muted">
                      Loading kudos...
                    </Text>
                  ) : (
                    kudosTags.map(([tag, name]) => <Chip key={tag} label={name} onPress={() => giveKudos(tag, name)} />)
                  )}
                </View>
              ) : null}
            </ListGroup>
          ) : null}

          {canManage ? (
            <ListGroup title="Moderation">
              {isVoice && p.hand_raised && p.role === 'listener' ? (
                <>
                  <ListRow icon={Mic} iconTone="success" title="Invite to speak" subtitle="Accept their raised hand." onPress={() => act('make_speaker', `${p.display_name} can speak now`)} />
                  <Divider inset={64} />
                  <ListRow icon={Hand} title="Lower hand" onPress={() => act('lower_hand', 'Hand lowered')} />
                  <Divider inset={64} />
                </>
              ) : null}
              {isVoice && p.role === 'listener' && !p.hand_raised ? (
                <>
                  <ListRow icon={Mic} iconTone="success" title="Make speaker" onPress={() => act('make_speaker', `${p.display_name} can speak now`)} />
                  <Divider inset={64} />
                </>
              ) : null}
              {isVoice && (p.role === 'speaker' || p.role === 'moderator') ? (
                <>
                  <ListRow icon={UserMinus} title="Move to listeners" onPress={() => act('make_listener', `${p.display_name} is now listening`)} />
                  <Divider inset={64} />
                </>
              ) : null}
              {iAmHost && p.role !== 'moderator' ? (
                <>
                  <ListRow icon={ShieldCheck} iconTone="primary" title="Make moderator" subtitle="They can help manage the room." onPress={() => act('make_moderator', `${p.display_name} is now a moderator`)} />
                  <Divider inset={64} />
                </>
              ) : null}
              {iAmHost && p.role === 'moderator' ? (
                <>
                  <ListRow icon={ShieldOff} title="Remove moderator" onPress={() => act('make_speaker', `${p.display_name} is no longer a moderator`)} />
                  <Divider inset={64} />
                </>
              ) : null}
              {isVoice ? (
                <>
                  {p.muted_by_host ? (
                    <ListRow icon={Mic} title="Allow to talk again" onPress={() => act('unmute', `${p.display_name} can talk again`)} />
                  ) : (
                    <ListRow icon={MicOff} title="Mute" subtitle="They can't talk until you allow it." onPress={() => act('mute', `${p.display_name} is muted`)} />
                  )}
                  <Divider inset={64} />
                </>
              ) : null}
              <ListRow icon={UserX} destructive title="Remove from hangout" onPress={() => act('remove', `${p.display_name} was removed`)} />
              <Divider inset={64} />
              <ListRow icon={Ban} destructive title="Ban from hangout" onPress={() => act('ban', `${p.display_name} was banned`)} />
            </ListGroup>
          ) : null}

          {!isMe ? (
            <ListGroup title="Safety">
              <ListRow
                icon={Flag}
                destructive
                title={`Report ${p.display_name}`}
                onPress={() => {
                  close();
                  openReport({ targetType: 'user', targetId: p.id, subject: p.display_name, blockUserId: p.id });
                }}
              />
              <Divider inset={64} />
              <ListRow icon={Ban} destructive title={`Block ${p.display_name}`} onPress={doBlock} />
            </ListGroup>
          ) : (
            <Text variant="caption" tone="muted">
              {p.role === 'host' ? "You're hosting this hangout." : "This is you. Tap someone else's seat to see options."}
            </Text>
          )}
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  kudos: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.lg },
});
