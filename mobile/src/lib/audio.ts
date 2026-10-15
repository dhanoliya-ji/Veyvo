/**
 * expo-audio, loaded only when its native module is in this build (voice notes are hidden otherwise,
 * e.g. in an old dev client). Components that use its hooks must only render when `loadAudio()` is non-null.
 */
import { Platform } from 'react-native';

type ExpoAudio = typeof import('expo-audio');

declare const require: (id: string) => any;

let loaded: ExpoAudio | null | undefined;

function hasExpoModule(name: string): boolean {
  try {
    const modules = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
    return !!modules?.[name];
  } catch {
    return false;
  }
}

export function loadAudio(): ExpoAudio | null {
  if (loaded !== undefined) return loaded;
  if (Platform.OS === 'web' || !hasExpoModule('ExpoAudio')) {
    loaded = null;
    return loaded;
  }
  try {
    loaded = require('expo-audio') as ExpoAudio;
  } catch {
    loaded = null;
  }
  return loaded;
}

export const isAudioSupported = () => loadAudio() !== null;

/** "0:07", "1:00" */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
