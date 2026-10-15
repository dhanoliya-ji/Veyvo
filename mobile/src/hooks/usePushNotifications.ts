import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { router, type Href } from 'expo-router';

import { accountApi } from '@/api/hooks';

type NotificationsModule = typeof import('expo-notifications');

/** Remote push isn't available in Expo Go (SDK 53+) or on simulators; it needs a development/production build. */
export function pushSupported(): boolean {
  if (!Device.isDevice || Platform.OS === 'web') return false;
  return Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

let cached: NotificationsModule | null | undefined;

/**
 * Load expo-notifications lazily. In Expo Go on Android, merely importing the module throws,
 * so it must never be imported at the top level of any file.
 */
export function getNotifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  if (!pushSupported()) {
    cached = null;
    return cached;
  }
  try {
    const mod: NotificationsModule = require('expo-notifications');
    mod.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
    cached = mod;
  } catch {
    cached = null;
  }
  return cached;
}

export async function getPushPermission(): Promise<'granted' | 'denied' | 'undetermined' | 'unsupported'> {
  const N = getNotifications();
  if (!N) return 'unsupported';
  try {
    const { status } = await N.getPermissionsAsync();
    return status as 'granted' | 'denied' | 'undetermined';
  } catch {
    return 'undetermined';
  }
}

async function ensureChannel(N: NotificationsModule) {
  if (Platform.OS === 'android') {
    await N.setNotificationChannelAsync('default', {
      name: 'Veyvo',
      importance: N.AndroidImportance.DEFAULT,
      lightColor: '#9385FF',
    });
  }
}

async function getToken(N: NotificationsModule): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null; // configure EAS (see docs/deployment.md) to enable push
  const { data } = await N.getExpoPushTokenAsync({ projectId });
  return data;
}

export type PushResult = 'enabled' | 'denied' | 'unsupported' | 'error';

/** Ask for permission (call from an explicit user action) and register the device token. */
export async function enablePushNotifications(): Promise<PushResult> {
  const N = getNotifications();
  if (!N) return 'unsupported';
  try {
    await ensureChannel(N);
    const current = await N.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') status = (await N.requestPermissionsAsync()).status;
    if (status !== 'granted') return 'denied';
    const token = await getToken(N);
    if (!token) return 'unsupported';
    await accountApi.registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
    return 'enabled';
  } catch {
    return 'error';
  }
}

export async function disablePushNotifications() {
  const N = getNotifications();
  if (!N) return;
  try {
    const token = await getToken(N);
    if (token) await accountApi.removePushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
  } catch {
    /* best effort */
  }
}

function routeFor(data: Record<string, any> | undefined) {
  if (!data) return;
  const id = data.entity_id as string | undefined;
  // Game invites open the game lobby; friendship milestones open the friend's profile (with Hang out).
  if (data.type === 'game_invite') return id && router.push(`/game/${id}`);
  if (data.type === 'milestone') return id && router.push(`/user/${id}`);
  switch (data.entity_type) {
    case 'conversation':
      return id && router.push(`/messages/${id}`);
    case 'room':
      return id && router.push(`/room/${id}`);
    case 'user':
      return id && router.push(`/user/${id}`);
    case 'friend_request':
      return router.push('/friends');
    case 'game':
      return id && router.push(`/game/${id}`);
    case 'squad':
      return router.push((id ? `/squads/${id}` : '/squads') as Href);
    case 'pen_pal':
      return router.push((id ? `/letters/${id}` : '/letters') as Href);
    default:
      return router.push('/notifications');
  }
}

/** Re-registers the token if permission was already granted, and opens the right screen when a notification is tapped. */
export function useNotificationRouting(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const N = getNotifications();
    if (!N) return;
    (async () => {
      if ((await getPushPermission()) === 'granted') enablePushNotifications();
    })();
    const sub = N.addNotificationResponseReceivedListener((response) => routeFor(response.notification.request.content.data as Record<string, any>));
    return () => sub.remove();
  }, [enabled]);
}
