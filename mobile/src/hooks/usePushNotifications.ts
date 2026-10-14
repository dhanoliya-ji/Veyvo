import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';

import { accountApi } from '@/api/hooks';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/** Remote push isn't available in Expo Go on Android or on simulators; it needs a development/production build. */
export function pushSupported(): boolean {
  if (!Device.isDevice || Platform.OS === 'web') return false;
  return Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

async function ensureChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Veyvo',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#9385FF',
    });
  }
}

async function getToken(): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null; // configure EAS (see docs/deployment.md) to enable push
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

export type PushResult = 'enabled' | 'denied' | 'unsupported' | 'error';

/** Ask for permission (call from an explicit user action) and register the device token. */
export async function enablePushNotifications(): Promise<PushResult> {
  if (!pushSupported()) return 'unsupported';
  try {
    await ensureChannel();
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return 'denied';
    const token = await getToken();
    if (!token) return 'unsupported';
    await accountApi.registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
    return 'enabled';
  } catch {
    return 'error';
  }
}

export async function disablePushNotifications() {
  try {
    const token = await getToken();
    if (token) await accountApi.removePushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
  } catch {
    /* best effort */
  }
}

function routeFor(data: Record<string, any> | undefined) {
  if (!data) return;
  const id = data.entity_id as string | undefined;
  switch (data.entity_type) {
    case 'conversation':
      return id && router.push(`/messages/${id}`);
    case 'room':
      return id && router.push(`/room/${id}`);
    case 'user':
      return id && router.push(`/user/${id}`);
    case 'friend_request':
      return router.push('/friends');
    default:
      return router.push('/notifications');
  }
}

/** Re-registers the token if permission was already granted, and opens the right screen when a notification is tapped. */
export function useNotificationRouting(enabled: boolean) {
  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    (async () => {
      if (!pushSupported()) return;
      const { status } = await Notifications.getPermissionsAsync().catch(() => ({ status: 'undetermined' as const }));
      if (status === 'granted') enablePushNotifications();
    })();
    const sub = Notifications.addNotificationResponseReceivedListener((response) => routeFor(response.notification.request.content.data as Record<string, any>));
    return () => sub.remove();
  }, [enabled]);
}
