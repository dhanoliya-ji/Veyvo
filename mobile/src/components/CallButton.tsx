import { useState } from 'react';
import { router } from 'expo-router';
import { Video } from 'lucide-react-native';

import { startCallRequest } from '@/api/hooks';
import { Button, IconButton } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';

/** Start a private video call with a friend. The server checks you're friends and both allow contact. */
export function CallButton({ userId, name, compact }: { userId: string; name: string; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const call = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const room = await startCallRequest(userId);
      haptic.medium();
      router.push(`/room/${room.id}`);
    } catch (e) {
      toast.error(`Couldn't call ${name}`, errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (compact) return <IconButton icon={Video} label={`Video call ${name}`} onPress={call} disabled={busy} />;
  return <Button title="Video call" icon={Video} variant="secondary" onPress={call} loading={busy} style={{ flex: 1 }} />;
}
