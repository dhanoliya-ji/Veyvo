import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { leaveRoomRequest, qk, useConfig, useRoom } from '@/api/hooks';
import type { GameView, RoomDetail } from '@/api/types';
import { errorMessage, post } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { realtime } from '@/lib/realtime';
import { isVoiceSupported, useVoice, type VoiceControls } from '@/lib/voice';
import { toast } from '@/stores/toast';

export const joinGameCallRequest = (gameId: string) => post<RoomDetail>(`/games/${gameId}/call`);

export type GameCall = {
  /** False when this server or build has no voice (e.g. Expo Go) or you aren't a player: hide the call UI. */
  available: boolean;
  inCall: boolean;
  joining: boolean;
  /** Someone has a call going for this game. */
  live: boolean;
  count: number;
  room: RoomDetail | undefined;
  voice: VoiceControls;
  join: () => Promise<void>;
  leave: () => void;
  /** Show or hide someone's video just for you. Hidden stays hidden, even for friends. */
  setVideoShown: (userId: string, show: boolean) => void;
};

/**
 * The private voice/video call for a game's players (a room of kind "game").
 * Mic and camera always start off; people tap to turn them on.
 */
export function useGameCall(game: GameView | undefined, meId: string, isPlayer: boolean): GameCall {
  const qc = useQueryClient();
  const config = useConfig();
  const gameId = game?.id ?? '';
  const [roomId, setRoomId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const roomQuery = useRoom(roomId ?? '', !!roomId);
  const room = roomId ? roomQuery.data : undefined;

  const available = isVoiceSupported() && (config.data?.media_available ?? false) && isPlayer && !!game && game.status !== 'cancelled';

  const friendIds = useMemo(() => new Set((room?.participants ?? []).filter((p) => p.is_friend).map((p) => p.id)), [room?.participants]);
  const hiddenVideos = useRef<Set<string>>(new Set());
  // Friends' cameras show automatically; strangers' stay hidden (not even downloaded) until tapped.
  const voice = useVoice(roomId ?? '', !!roomId && !!room?.media_available, !!room?.can_speak, {
    canVideo: !!room?.can_video,
    autoShowVideo: (id) => !hiddenVideos.current.has(id) && friendIds.has(id),
  });
  const setVideoVisible = voice.setVideoVisible;
  const setVideoShown = useCallback(
    (userId: string, show: boolean) => {
      if (show) hiddenVideos.current.delete(userId);
      else hiddenVideos.current.add(userId);
      setVideoVisible(userId, show);
    },
    [setVideoVisible],
  );

  const joinedRef = useRef<string | null>(null);
  const refreshGame = useCallback(() => {
    if (gameId) qc.invalidateQueries({ queryKey: qk.game(gameId) });
  }, [qc, gameId]);

  const join = useCallback(async () => {
    if (!gameId || joining) return;
    setJoining(true);
    try {
      const detail = await joinGameCallRequest(gameId);
      qc.setQueryData(qk.room(detail.id), detail);
      joinedRef.current = detail.id;
      setRoomId(detail.id);
      haptic.success();
      refreshGame();
    } catch (e) {
      haptic.error();
      toast.error("Couldn't join the call", errorMessage(e));
    } finally {
      setJoining(false);
    }
  }, [gameId, joining, qc, refreshGame]);

  const dropCall = useCallback(() => {
    joinedRef.current = null;
    setRoomId(null);
    refreshGame();
  }, [refreshGame]);

  const leave = useCallback(() => {
    const id = joinedRef.current;
    if (id) leaveRoomRequest(id).catch(() => undefined);
    haptic.light();
    dropCall();
  }, [dropCall]);

  // Leaving the game screen always leaves the call.
  useEffect(
    () => () => {
      const id = joinedRef.current;
      joinedRef.current = null;
      if (id) leaveRoomRequest(id).catch(() => undefined);
    },
    [],
  );

  // Not a player any more (left the game): leave the call too.
  useEffect(() => {
    if (!isPlayer && joinedRef.current) leave();
  }, [isPlayer, leave]);

  // Realtime: keep the call's people and permissions fresh.
  const meRef = useRef(meId);
  meRef.current = meId;
  useEffect(() => {
    if (!roomId) return;
    const unsubscribe = realtime.subscribe(`room:${roomId}`);
    const ours = (e: { data: any }) => e.data?.room_id === roomId;
    const refetch = () => qc.invalidateQueries({ queryKey: qk.room(roomId) });
    const offs = [
      realtime.on('room.participant_joined', (e) => ours(e) && refetch()),
      realtime.on('room.participant_left', (e) => ours(e) && refetch()),
      realtime.on('room.participant_updated', (e) => {
        if (!ours(e)) return;
        if (e.data.user_id === meRef.current && (e.data.action === 'remove' || e.data.action === 'ban')) {
          toast.show({ title: 'You were removed from the call', tone: 'warning' });
          dropCall();
          return;
        }
        if (e.data.user_id === meRef.current && e.data.action === 'camera_off') {
          toast.show({
            title: 'Your camera was turned off',
            message: e.data.automatic ? 'An automatic safety check flagged your video. A moderator will review it.' : 'The host turned your camera off.',
            tone: 'warning',
          });
        }
        refetch();
      }),
      realtime.on('room.ended', (e) => ours(e) && dropCall()),
      realtime.on('room.removed', (e) => ours(e) && dropCall()),
    ];
    return () => {
      offs.forEach((off) => off());
      unsubscribe();
    };
  }, [roomId, qc, dropCall]);

  // The call ended, or our seat lapsed while we were away: rejoin quietly (at most every 15s).
  const lastRejoin = useRef(0);
  const iAmPresent = !!room && room.participants.some((p) => p.id === meId);
  useEffect(() => {
    if (!room || !roomId) return;
    if (room.status === 'ended') {
      dropCall();
    } else if (meId && !iAmPresent && Date.now() - lastRejoin.current > 15_000) {
      lastRejoin.current = Date.now();
      joinGameCallRequest(gameId)
        .then((detail) => {
          if (joinedRef.current !== roomId) return;
          qc.setQueryData(qk.room(detail.id), detail);
          joinedRef.current = detail.id;
          setRoomId(detail.id);
        })
        .catch(() => dropCall());
    }
  }, [room, roomId, meId, iAmPresent, gameId, qc, dropCall]);

  return {
    available,
    inCall: !!roomId,
    joining,
    live: !!game?.call_live,
    count: game?.call_count ?? 0,
    room,
    voice,
    join,
    leave,
    setVideoShown,
  };
}
