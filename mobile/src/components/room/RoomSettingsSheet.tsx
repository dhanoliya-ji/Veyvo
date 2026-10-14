import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Mic } from 'lucide-react-native';

import { useRoomAction } from '@/api/hooks';
import { useOwnedScenes } from '@/api/rooms-extra';
import type { RoomDetail, Scene } from '@/api/types';
import { Button, Input, ListGroup, ListRow, Sheet, Text } from '@/components/ui';
import { errorMessage, fieldErrors } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { space } from '@/theme/tokens';
import { ScenePicker } from './ScenePicker';

type Props = { room: RoomDetail; visible: boolean; onClose: () => void };

export function RoomSettingsSheet({ room, visible, onClose }: Props) {
  const { update } = useRoomAction(room.id);
  const { owned } = useOwnedScenes();
  const [title, setTitle] = useState(room.title);
  const [openMic, setOpenMic] = useState(room.open_mic);
  const [scene, setScene] = useState<Scene>(room.scene);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setTitle(room.title);
      setOpenMic(room.open_mic);
      setScene(room.scene);
      setError(null);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const t = title.trim();
    if (t.length < 3 || t.length > 80) {
      setError('The name needs 3 to 80 characters.');
      return;
    }
    const changes: { title?: string; open_mic?: boolean; scene?: Scene } = {};
    if (t !== room.title) changes.title = t;
    if (openMic !== room.open_mic) changes.open_mic = openMic;
    if (scene !== room.scene) changes.scene = scene;
    if (!Object.keys(changes).length) return onClose();
    try {
      await update.mutateAsync(changes);
      haptic.success();
      toast.success('Room updated');
      onClose();
    } catch (e) {
      setError(fieldErrors(e).title ?? errorMessage(e));
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Room settings" scroll>
      <View style={{ gap: space.lg }}>
        <Input label="Name" value={title} onChangeText={setTitle} maxLength={80} counter />
        {room.format === 'voice' ? (
          <ListGroup>
            <ListRow
              icon={Mic}
              iconTone="primary"
              title="Open mic"
              subtitle={openMic ? 'Everyone can talk.' : 'People raise a hand to talk.'}
              toggle={{ value: openMic, onChange: setOpenMic }}
            />
          </ListGroup>
        ) : null}
        <View style={{ gap: space.sm }}>
          <Text variant="label" tone="muted">
            Scene
          </Text>
          <ScenePicker
            value={scene}
            onChange={setScene}
            owned={owned}
            onLockedPress={() => {
              onClose();
              router.push('/shop');
            }}
          />
        </View>
        {error ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button title="Save changes" onPress={save} loading={update.isPending} fullWidth />
      </View>
    </Sheet>
  );
}
