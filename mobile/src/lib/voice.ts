/**
 * Voice for live hangouts, powered by LiveKit.
 *
 * LiveKit needs native WebRTC code that isn't in Expo Go, so everything here loads lazily:
 * we first check the native module exists, then `require` the SDK. Nothing about speaking
 * is ever inferred: `speaking` only contains people the SDK reports as active speakers.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, NativeModules, PermissionsAndroid, Platform, TurboModuleRegistry } from 'react-native';
import type { Participant, Room as LiveKitRoom } from 'livekit-client';

import { roomMediaToken } from '@/api/hooks';
import { confirm } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';

export type VoiceState = 'unavailable' | 'unsupported' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'disconnected';

export const VOICE_COPY = {
  unsupported: 'Voice needs the Veyvo app build (not Expo Go). You can still chat.',
  unavailable: "Voice isn't set up on this server yet. You can still chat.",
  failed: "We couldn't connect to voice. Check your connection and try again.",
  disconnected: 'Voice disconnected. You can reconnect anytime.',
  micBlocked: 'Microphone access is off. Enable it in your device settings to talk.',
  micExplain:
    'Veyvo uses your microphone so people in this hangout can hear you. You are only heard while your mic is on, and you can mute anytime.',
};

type LiveKitClient = typeof import('livekit-client');
type AudioSessionApi = { startAudioSession: () => Promise<void>; stopAudioSession: () => Promise<void> };
type Loaded = { lk: LiveKitClient; AudioSession: AudioSessionApi };

declare const require: (id: string) => any;

let loaded: Loaded | null | undefined;
let explainedThisSession = false;

function hasNativeModule(name: string): boolean {
  try {
    if ((NativeModules as Record<string, unknown>)[name]) return true;
  } catch {
    /* ignore */
  }
  try {
    return TurboModuleRegistry.get(name) != null;
  } catch {
    return false;
  }
}

/** True when this build includes LiveKit's native WebRTC module (false in Expo Go). */
export function isVoiceSupported(): boolean {
  return Platform.OS !== 'web' && hasNativeModule('WebRTCModule');
}

/** Loads the SDK once. Returns null when the native module is missing or loading fails. */
function loadLiveKit(): Loaded | null {
  if (loaded !== undefined) return loaded;
  if (!isVoiceSupported()) {
    loaded = null;
    return null;
  }
  try {
    const rn = require('@livekit/react-native');
    rn.registerGlobals();
    const lk = require('livekit-client') as LiveKitClient;
    loaded = { lk, AudioSession: rn.AudioSession as AudioSessionApi };
  } catch {
    loaded = null;
  }
  return loaded;
}

type MicPermission = 'granted' | 'denied' | 'cancelled';

/** Explains why we need the mic, then asks the OS. Only called when the person turns their mic on. */
async function ensureMicPermission(): Promise<MicPermission> {
  if (Platform.OS === 'android') {
    const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
    if (await PermissionsAndroid.check(permission)) return 'granted';
    const ok = await confirm({ title: 'Turn on your microphone?', message: VOICE_COPY.micExplain, confirmLabel: 'Continue', cancelLabel: 'Not now' });
    if (!ok) return 'cancelled';
    const result = await PermissionsAndroid.request(permission);
    return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
  }
  // iOS shows its own prompt the first time audio capture starts; explain once beforehand.
  if (!explainedThisSession) {
    const ok = await confirm({ title: 'Turn on your microphone?', message: VOICE_COPY.micExplain, confirmLabel: 'Continue', cancelLabel: 'Not now' });
    if (!ok) return 'cancelled';
    explainedThisSession = true;
  }
  return 'granted';
}

function isPermissionError(e: unknown): boolean {
  const name = (e as { name?: string })?.name ?? '';
  const message = String((e as { message?: string })?.message ?? '').toLowerCase();
  return name === 'NotAllowedError' || name === 'PermissionDeniedError' || message.includes('permission') || message.includes('not allowed');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export type VoiceControls = {
  state: VoiceState;
  micOn: boolean;
  /** True while the mic is switching on or off. */
  micBusy: boolean;
  /** The OS denied microphone access; show VOICE_COPY.micBlocked with an "Open settings" button. */
  micBlocked: boolean;
  toggleMic: () => Promise<void>;
  /** userId -> 0..1 audio level, only for people the SDK reports as speaking right now. */
  speaking: Record<string, number>;
  error: string | null;
  retry: () => void;
  openSettings: () => void;
};

/**
 * Connects to a room's voice channel while `enabled`. The mic always starts OFF.
 * `canPublish` mirrors the server's `can_speak`; when it changes we mute or refresh the token.
 */
export function useVoice(roomId: string, enabled: boolean, canPublish: boolean): VoiceControls {
  const [state, setState] = useState<VoiceState>('disconnected');
  const [micOn, setMicOn] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const [micBlocked, setMicBlocked] = useState(false);
  const [speaking, setSpeaking] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const roomRef = useRef<LiveKitRoom | null>(null);
  const canPublishRef = useRef(canPublish);
  canPublishRef.current = canPublish;

  useEffect(() => {
    setMicOn(false);
    setSpeaking({});
    if (!enabled || !roomId) {
      setState('disconnected');
      setError(null);
      return;
    }
    const mods = loadLiveKit();
    if (!mods) {
      setState('unsupported');
      setError(VOICE_COPY.unsupported);
      return;
    }
    const { lk, AudioSession } = mods;
    let cancelled = false;
    let audioStarted = false;
    const room = new lk.Room({ adaptiveStream: false, dynacast: false });
    roomRef.current = room;
    setState('connecting');
    setError(null);

    const syncMic = () => {
      if (!cancelled) setMicOn(room.localParticipant.isMicrophoneEnabled);
    };

    room
      .on(lk.RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        if (cancelled) return;
        const next: Record<string, number> = {};
        for (const p of speakers) {
          if (!p.isSpeaking) continue;
          // The SDK reports these people as speaking; use its level, with a floor so the ring is visible.
          next[p.identity] = Math.min(1, Math.max(0.2, p.audioLevel || 0));
        }
        setSpeaking(next);
      })
      .on(lk.RoomEvent.ConnectionStateChanged, (s) => {
        if (cancelled) return;
        if (s === lk.ConnectionState.Connected) setState('connected');
        else if (s === lk.ConnectionState.Reconnecting || s === lk.ConnectionState.SignalReconnecting) setState('reconnecting');
        else if (s === lk.ConnectionState.Connecting) setState('connecting');
      })
      .on(lk.RoomEvent.Reconnecting, () => !cancelled && setState('reconnecting'))
      .on(lk.RoomEvent.Reconnected, () => {
        if (cancelled) return;
        setState('connected');
        syncMic();
      })
      .on(lk.RoomEvent.Disconnected, () => {
        if (cancelled) return;
        setState('disconnected');
        setError(VOICE_COPY.disconnected);
        setMicOn(false);
        setSpeaking({});
      })
      .on(lk.RoomEvent.LocalTrackPublished, syncMic)
      .on(lk.RoomEvent.LocalTrackUnpublished, syncMic)
      .on(lk.RoomEvent.ParticipantPermissionsChanged, (_prev, participant) => {
        if (cancelled || participant.identity !== room.localParticipant.identity) return;
        if (!participant.permissions?.canPublish) setMicOn(false);
      })
      .on(lk.RoomEvent.MediaDevicesError, (e: Error) => {
        if (cancelled) return;
        if (isPermissionError(e)) setMicBlocked(true);
        setMicOn(false);
      });

    (async () => {
      try {
        const token = await roomMediaToken(roomId);
        if (cancelled) return;
        try {
          await AudioSession.startAudioSession();
          audioStarted = true;
        } catch {
          /* playback may still work with the default session */
        }
        await withTimeout(room.connect(token.url, token.token, { autoSubscribe: true }), 15_000);
        if (cancelled) return;
        setState('connected');
        setError(null);
      } catch (e) {
        if (cancelled) return;
        room.disconnect().catch(() => undefined);
        if (e instanceof ApiError && e.code === 'media_unavailable') {
          setState('unavailable');
          setError(VOICE_COPY.unavailable);
        } else if (e instanceof ApiError && !e.isNetwork) {
          setState('failed');
          setError(errorMessage(e));
        } else {
          setState('failed');
          setError(VOICE_COPY.failed);
        }
      }
    })();

    return () => {
      cancelled = true;
      roomRef.current = null;
      room.removeAllListeners();
      room.disconnect().catch(() => undefined);
      if (audioStarted) AudioSession.stopAudioSession().catch(() => undefined);
    };
  }, [roomId, enabled, attempt]);

  // Promoted or demoted: mute immediately when we lose the right to speak; refresh the token
  // if the server granted it but our connection hasn't picked the new permission up.
  useEffect(() => {
    const room = roomRef.current;
    if (!room || state !== 'connected') return;
    if (!canPublish) {
      if (room.localParticipant.isMicrophoneEnabled) room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      setMicOn(false);
      return;
    }
    if (room.localParticipant.permissions?.canPublish) return;
    const t = setTimeout(() => {
      const current = roomRef.current;
      if (current && canPublishRef.current && !current.localParticipant.permissions?.canPublish) setAttempt((a) => a + 1);
    }, 2500);
    return () => clearTimeout(t);
  }, [canPublish, state]);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room || state !== 'connected' || micBusy) return;
    if (micOn) {
      setMicBusy(true);
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch {
        /* the track is gone either way */
      } finally {
        setMicOn(false);
        setMicBusy(false);
      }
      return;
    }
    if (!canPublishRef.current) return;
    const permission = await ensureMicPermission();
    if (permission === 'cancelled') return;
    if (permission === 'denied') {
      setMicBlocked(true);
      return;
    }
    setMicBusy(true);
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
      setMicOn(room.localParticipant.isMicrophoneEnabled);
      setMicBlocked(false);
    } catch (e) {
      setMicOn(false);
      if (isPermissionError(e)) setMicBlocked(true);
      else setError("Couldn't turn on your mic. Please try again.");
    } finally {
      setMicBusy(false);
    }
  }, [state, micOn, micBusy]);

  const retry = useCallback(() => {
    setMicBlocked(false);
    setAttempt((a) => a + 1);
  }, []);

  const openSettings = useCallback(() => {
    Linking.openSettings().catch(() => undefined);
  }, []);

  return { state, micOn, micBusy, micBlocked, toggleMic, speaking, error, retry, openSettings };
}
