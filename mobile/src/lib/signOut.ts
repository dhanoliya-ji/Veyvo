import { post } from './api';
import { queryClient } from './queryClient';
import { realtime } from './realtime';
import { disablePushNotifications } from '@/hooks/usePushNotifications';
import { useSession } from '@/stores/session';

/** Sign out on this device: revoke the session server-side, stop push to this device, wipe local caches. */
export async function signOut() {
  await disablePushNotifications();
  try {
    await post('/auth/logout');
  } catch {
    /* still sign out locally */
  }
  realtime.stop();
  queryClient.clear();
  await useSession.getState().signOutLocal('user');
}
