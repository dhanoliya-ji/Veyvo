import { useState } from 'react';
import { router } from 'expo-router';
import { Phone, Video } from 'lucide-react-native';

import { startCallWithFormat, type CallFormat } from '@/api/connect-extra';
import { Button, IconButton } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';

/** Start a private voice or video call with a friend. The server checks you're friends and both allow contact. */
export function CallButton({ userId, name, compact, format = 'video' }: { userId: string; name: string; compact?: boolean; format?: CallFormat }) {
  const [busy, setBusy] = useState(false);
  const voice = format === 'voice';
  const call = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const room = await startCallWithFormat(userId, format);
      haptic.medium();
      router.push(`/room/${room.id}`);
    } catch (e) {
      toast.error(`Couldn't call ${name}`, errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const icon = voice ? Phone : Video;
  if (compact) return <IconButton icon={icon} label={`${voice ? 'Voice' : 'Video'} call ${name}`} onPress={call} disabled={busy} />;
  return <Button title={voice ? 'Voice call' : 'Video call'} icon={icon} variant="secondary" onPress={call} loading={busy} style={{ flex: 1 }} />;
}
