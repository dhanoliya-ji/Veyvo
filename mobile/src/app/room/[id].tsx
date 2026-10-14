import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  BookOpenText,
  ChevronDown,
  Ear,
  Ellipsis,
  Flag,
  Gamepad2,
  Hand,
  LogOut,
  Mic,
  MicOff,
  Power,
  Settings2,
  Smile,
  SwitchCamera,
  UserPlus,
  Video,
  VideoOff,
  X,
} from 'lucide-react-native';

import { joinRoomRequest, leaveRoomRequest, qk, useBlocked, useCreateGame, useMe, useRoom, useRoomAction, useRoomChat, useRoomGames } from '@/api/hooks';
import { GAME_META, ROOM_GAME_TYPES, type GameType } from '@/api/games-extra';
import { describeRoomError, setRoomTimer, upsertRoomMessage } from '@/api/rooms-extra';
import type { GameView, Participant, RoomDetail, RoomMessage, TimerState } from '@/api/types';
import { LiveDot } from '@/components/LiveDot';
import { ChatPanel } from '@/components/room/ChatPanel';
import { ControlButton } from '@/components/room/ControlButton';
import { FocusTimerCard } from '@/components/room/FocusTimerCard';
import { InviteSheet } from '@/components/room/InviteSheet';
import { ParticipantSheet } from '@/components/room/ParticipantSheet';
import { PeoplePanel } from '@/components/room/PeoplePanel';
import { REACTIONS, reactionLabel } from '@/components/room/constants';
import { RoomSettingsSheet } from '@/components/room/RoomSettingsSheet';
import { EndedView, JoiningView, RoomErrorView, ScheduledView, leaveScreen } from '@/components/room/RoomStates';
import { ConnectionBanner } from '@/components/room/VoiceBanner';
import { openReport } from '@/components/safety/ReportSheet';
import { VideoGrid } from '@/components/room/VideoGrid';
import { Button, Divider, IconButton, ListGroup, ListRow, PressableScale, SegmentedControl, Sheet, Text, confirm } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { realtime, useRealtimeStatus } from '@/lib/realtime';
import { useVoice } from '@/lib/voice';
import { useNetwork } from '@/stores/network';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

type Phase = 'idle' | 'joining' | 'joined' | 'error' | 'ended' | 'removed';
type EndReason = 'host' | 'self' | 'ended' | 'removed';
type FloatingReaction = { key: string; userId: string; label: string };

export default function LiveRoom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const roomId = String(id ?? '');
  const qc = useQueryClient();
  const me = useMe();
  const meId = me.data?.id;
  const room = useRoom(roomId);
  const data = room.data;

  const [phase, setPhase] = useState<Phase>('idle');
  const [joinError, setJoinError] = useState<ReturnType<typeof describeRoomError> | null>(null);
  const [endReason, setEndReason] = useState<EndReason>('ended');
  const joinedRef = useRef(false);
  const aliveRef = useRef(true);
  // The status when we first saw the room decides whether we auto-join (live) or show event details (scheduled).
  const [firstStatus, setFirstStatus] = useState<string | null>(null);
  const lastRejoin = useRef(0);
  if (data && firstStatus === null) setFirstStatus(data.status);

  const join = useCallback(
    async (silent = false) => {
      if (!silent) setPhase('joining');
      try {
        const detail = await joinRoomRequest(roomId);
        if (!aliveRef.current) {
          // The screen closed while we were joining: give the seat back straight away.
          leaveRoomRequest(roomId).catch(() => undefined);
          return false;
        }
        qc.setQueryData(qk.room(roomId), detail);
        joinedRef.current = true;
        setJoinError(null);
        setPhase('joined');
        return true;
      } catch (e) {
        if (!aliveRef.current) return false;
        const info = describeRoomError(e);
        // A silent re-join that fails because we're briefly offline shouldn't kick anyone out.
        if (silent && info.kind === 'offline') return false;
        joinedRef.current = false;
        if (info.kind === 'ended') {
          setEndReason('ended');
          setPhase('ended');
        } else {
          setJoinError(info);
          setPhase('error');
        }
        return false;
      }
    },
    [roomId, qc],
  );

  // Auto-join only when the room was already live when we opened it.
  useEffect(() => {
    if (phase !== 'idle' || !data) return;
    if (data.status === 'ended') {
      setEndReason('ended');
      setPhase('ended');
    } else if (data.status === 'live' && firstStatus === 'live') {
      join();
    }
  }, [phase, data, join, firstStatus]);

  // Leave on unmount (back button, navigation, app closing the screen).
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (joinedRef.current) {
        joinedRef.current = false;
        leaveRoomRequest(roomId).catch(() => undefined);
      }
      qc.invalidateQueries({ queryKey: qk.roomsAll });
      qc.invalidateQueries({ queryKey: qk.home });
    };
  }, [roomId, qc]);

  const markEnded = useCallback((reason: EndReason) => {
    joinedRef.current = false;
    setEndReason(reason);
    setPhase('ended');
  }, []);

  const markRemoved = useCallback(() => {
    joinedRef.current = false;
    setEndReason('removed');
    setPhase('removed');
    // The root layout already shows a toast; just take them out of the room.
    setTimeout(leaveScreen, 250);
  }, []);

  if (room.isError && !data) {
    const info = describeRoomError(room.error);
    return <RoomErrorView {...info} onRetry={() => room.refetch()} />;
  }
  if (phase === 'error' && joinError) return <RoomErrorView {...joinError} onRetry={() => join()} />;
  if (phase === 'ended' || phase === 'removed') return <EndedView reason={endReason} />;
  if (!data) return <JoiningView />;

  if (phase !== 'joined') {
    if (data.status === 'scheduled' || (data.status === 'live' && firstStatus === 'scheduled' && phase !== 'joining')) {
      return (
        <ScheduledView
          room={data}
          isHost={!!meId && data.host?.id === meId}
          starting={phase === 'joining'}
          onStart={() => join()}
          nowLive={data.status === 'live'}
        />
      );
    }
    return <JoiningView title={data.title} />;
  }

  return (
    <LiveStage
      room={data}
      meId={meId}
      onRejoin={() => {
        if (Date.now() - lastRejoin.current < 15_000) return;
        lastRejoin.current = Date.now();
        join(true);
      }}
      onEnded={markEnded}
      onRemoved={markRemoved}
      onLeave={() => {
        if (joinedRef.current) {
          joinedRef.current = false;
          leaveRoomRequest(roomId).catch(() => undefined);
        }
        leaveScreen();
      }}
    />
  );
}

// ---------------------------------------------------------------------------

type StageProps = {
  room: RoomDetail;
  meId: string | undefined;
  onRejoin: () => void;
  onEnded: (reason: EndReason) => void;
  onRemoved: () => void;
  onLeave: () => void;
};

function LiveStage({ room, meId, onRejoin, onEnded, onRemoved, onLeave }: StageProps) {
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const qc = useQueryClient();
  const roomId = room.id;
  const actions = useRoomAction(roomId);
  const chat = useRoomChat(roomId);
  const games = useRoomGames(roomId);
  const createGame = useCreateGame();
  const blocked = useBlocked();
  const online = useNetwork((s) => s.online);
  const realtimeStatus = useRealtimeStatus((s) => s.status);

  const [tab, setTab] = useState<'chat' | 'people'>('chat');
  const [selected, setSelected] = useState<Participant | null>(null);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [gamePickerOpen, setGamePickerOpen] = useState(false);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [dismissedGames, setDismissedGames] = useState<Set<string>>(new Set());

  const isVoice = room.format === 'voice' || room.format === 'video';
  const isVideo = room.format === 'video';
  const iAmHost = !!meId && room.host?.id === meId;
  const mine = room.participants.find((p) => p.id === meId);
  const handRaised = !!mine?.hand_raised;
  const mutedByHost = !!mine?.muted_by_host;
  const friendIds = useMemo(() => new Set(room.participants.filter((p) => p.is_friend).map((p) => p.id)), [room.participants]);
  // Friends' cameras show automatically; anyone else's video stays hidden (not even downloaded) until tapped.
  const voice = useVoice(roomId, isVoice && room.media_available, room.can_speak, { canVideo: isVideo && !!room.can_video, autoShowVideo: (id) => friendIds.has(id) || room.kind === 'call' });

  const blockedIds = useMemo(() => new Set((blocked.data ?? []).map((b) => b.id)), [blocked.data]);
  const blockedRef = useRef(blockedIds);
  blockedRef.current = blockedIds;
  const meRef = useRef(meId);
  meRef.current = meId;
  const handlers = useRef({ onEnded, onRemoved, onRejoin });
  handlers.current = { onEnded, onRemoved, onRejoin };

  const addReaction = useCallback(
    (userId: string, reaction: string) => {
      const key = `${userId}-${Date.now()}`;
      setReactions((list) => [...list.filter((r) => r.userId !== userId), { key, userId, label: reactionLabel(reaction) }]);
      setTimeout(() => setReactions((list) => list.filter((r) => r.key !== key)), reduceMotion ? 2500 : 2000);
    },
    [reduceMotion],
  );

  // Realtime: keep the room in step with everyone else.
  useEffect(() => {
    const unsubscribe = realtime.subscribe(`room:${roomId}`);
    const ours = (e: { data: any }) => e.data?.room_id === roomId;
    const refetch = () => qc.invalidateQueries({ queryKey: qk.room(roomId) });
    const offs = [
      realtime.on('room.participant_joined', (e) => ours(e) && refetch()),
      realtime.on('room.participant_left', (e) => ours(e) && refetch()),
      realtime.on('room.updated', (e) => ours(e) && refetch()),
      realtime.on('room.participant_updated', (e) => {
        if (!ours(e)) return;
        if (e.data.user_id === meRef.current && (e.data.action === 'remove' || e.data.action === 'ban')) handlers.current.onRemoved();
        else refetch();
      }),
      realtime.on('room.message', (e) => {
        if (!ours(e)) return;
        const msg = e.data as RoomMessage;
        if (blockedRef.current.has(msg.sender?.id)) return;
        upsertRoomMessage(qc, roomId, msg);
      }),
      realtime.on('room.reaction', (e) => {
        if (!ours(e) || e.data.user_id === meRef.current || blockedRef.current.has(e.data.user_id)) return;
        addReaction(e.data.user_id, e.data.reaction);
      }),
      realtime.on('room.timer', (e) => ours(e) && setRoomTimer(qc, roomId, e.data.timer as TimerState | null)),
      realtime.on('room.ended', (e) => ours(e) && handlers.current.onEnded('host')),
      realtime.on('room.game_created', (e) => {
        if (!ours(e)) return;
        qc.invalidateQueries({ queryKey: qk.roomGames(roomId) });
      }),
      realtime.on('room.removed', (e) => ours(e) && handlers.current.onRemoved()),
      // Presence lapses if we were disconnected for a while: re-join quietly to keep our seat.
      realtime.on('client.reconnected', () => handlers.current.onRejoin()),
      realtime.on('client.foreground', () => handlers.current.onRejoin()),
    ];
    return () => {
      offs.forEach((off) => off());
      unsubscribe();
    };
  }, [roomId, qc, addReaction]);

  // Reconcile with the 20s detail refetch: ended rooms close; a lost seat is re-taken.
  const iAmPresent = !!meId && room.participants.some((p) => p.id === meId);
  useEffect(() => {
    if (room.status === 'ended') handlers.current.onEnded('ended');
    else if (meId && !iAmPresent) handlers.current.onRejoin();
  }, [room.status, iAmPresent, meId]);

  // Study timer: when a phase ends, fetch the server's rolled-forward state.
  const phaseEndsAt = room.timer?.phase_ends_at;
  useEffect(() => {
    if (!phaseEndsAt) return;
    const ms = new Date(phaseEndsAt).getTime() - Date.now();
    const t = setTimeout(() => qc.invalidateQueries({ queryKey: qk.room(roomId) }), Math.max(500, ms + 800));
    return () => clearTimeout(t);
  }, [phaseEndsAt, roomId, qc]);

  const presentIds = useMemo(() => new Set(room.participants.map((p) => p.id)), [room.participants]);

  const activeGame = (games.data ?? []).find((g: GameView) => (g.status === 'lobby' || g.status === 'active') && !dismissedGames.has(g.id));
  const chatLocked = room.kind === 'study' && room.timer?.phase === 'focus' && !room.can_moderate;
  const stageHeight = Math.round(Math.max(170, Math.min(250, windowHeight * 0.27)));

  // ----- actions -----
  const sendChat = async (content: string) => {
    try {
      const msg = await actions.chat.mutateAsync(content);
      upsertRoomMessage(qc, roomId, msg);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'chat_locked') {
        toast.show({ title: 'Chat opens during the break', tone: 'info' });
        qc.invalidateQueries({ queryKey: qk.room(roomId) });
      } else {
        toast.error('Message not sent', errorMessage(e));
      }
      return false;
    }
  };

  const react = (key: string) => {
    if (meId) addReaction(meId, key);
    haptic.light();
    actions.react.mutate(key, { onError: (e) => toast.error("Couldn't send that", errorMessage(e)) });
  };

  const toggleHand = () => {
    const next = !handRaised;
    actions.hand.mutate(next, {
      onSuccess: () => {
        haptic.light();
        if (next) toast.show({ title: 'Hand raised', message: 'The host will see it and can invite you to speak.', tone: 'info' });
      },
      onError: (e) => toast.error("Couldn't update your hand", errorMessage(e)),
    });
  };

  const startGame = async (gameType: GameType) => {
    setGamePickerOpen(false);
    if (createGame.isPending) return;
    try {
      const game = await createGame.mutateAsync({ game_type: gameType, room_id: roomId });
      qc.invalidateQueries({ queryKey: qk.roomGames(roomId) });
      router.push(`/game/${game.id}`);
    } catch (e) {
      toast.error("Couldn't start a game", errorMessage(e));
    }
  };

  const endHangout = async () => {
    setMoreOpen(false);
    const ok = await confirm({
      title: 'End this hangout for everyone?',
      message: 'Everyone will be let out and the room will close. This cannot be undone.',
      confirmLabel: 'End hangout',
      destructive: true,
    });
    if (!ok) return;
    try {
      await actions.end.mutateAsync();
      haptic.success();
      onEnded('self');
    } catch (e) {
      toast.error("Couldn't end the hangout", errorMessage(e));
    }
  };

  const leave = async () => {
    if (iAmHost) {
      const ok = await confirm({
        title: 'Leave your hangout?',
        message: 'The room stays open for everyone else. To close it for everyone, choose End hangout from More.',
        confirmLabel: 'Leave',
        cancelLabel: 'Stay',
      });
      if (!ok) return;
    }
    haptic.light();
    onLeave();
  };

  const reportRoom = () => {
    setMoreOpen(false);
    openReport({ targetType: 'room', targetId: roomId, subject: `the hangout “${room.title}”`, blockUserId: room.host && room.host.id !== meId ? room.host.id : undefined });
  };

  const timerControl = (action: 'start' | 'skip' | 'stop') =>
    actions.timer.mutate({ action }, { onSuccess: (t) => setRoomTimer(qc, roomId, t ?? null), onError: (e) => toast.error("Couldn't change the timer", errorMessage(e)) });

  // ----- role line -----
  let roleIcon = Ear;
  let roleText = "You're listening";
  if (!isVoice) {
    roleIcon = BookOpenText;
    roleText = room.kind === 'study' ? 'Study room · text chat' : 'Text hangout · chat below';
  } else if (mutedByHost) {
    roleIcon = MicOff;
    roleText = 'The host muted you';
  } else if (room.can_speak) {
    roleIcon = voice.micOn ? Mic : MicOff;
    roleText = voice.micOn ? "You're speaking · mic on" : "You're a speaker · mic off";
  } else if (handRaised) {
    roleIcon = Hand;
    roleText = 'Hand raised · waiting for the host';
  }
  const RoleIcon = roleIcon;

  // ----- control bar -----
  const showMic = isVoice && (room.can_speak || mutedByHost);
  const showHand = isVoice && !room.can_speak && !mutedByHost && !room.open_mic;
  const canInvite = room.visibility === 'public' || room.can_moderate;
  const micReady = voice.state === 'connected';

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ paddingTop: insets.top, flex: 1 }}>
          {/* Top bar */}
          <View style={styles.topBar}>
            <IconButton icon={ChevronDown} label="Leave hangout" onPress={leave} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="subheading" numberOfLines={1} accessibilityRole="header">
                {room.title}
              </Text>
              <View style={styles.topMeta}>
                <View style={[styles.livePill, { backgroundColor: colors.successSoft }]} accessibilityLabel={`Live, ${room.participant_count} of ${room.capacity} people inside`}>
                  <LiveDot />
                  <Text variant="tiny" tone="success">
                    LIVE · {room.participant_count}/{room.capacity}
                  </Text>
                </View>
                <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {room.kind === 'call' ? 'Video call' : room.kind === 'study' ? 'Study' : isVideo ? 'Video' : isVoice ? 'Voice' : 'Text'}
                  {room.visibility === 'private' ? ' · Invite-only' : ''}
                  {room.host ? ` · ${iAmHost ? 'You host' : `Hosted by ${room.host.display_name}`}` : ''}
                </Text>
              </View>
            </View>
            <IconButton icon={Flag} label="Report this hangout" onPress={reportRoom} />
          </View>

          <View style={{ paddingHorizontal: space.md, gap: space.sm }}>
            <ConnectionBanner voice={voice} serverHasVoice={!isVoice || room.media_available} realtimeStatus={realtimeStatus} online={online} />
            {isVoice ? (
              <ScrollView style={{ maxHeight: isVideo ? windowHeight * 0.48 : stageHeight }} contentContainerStyle={{ paddingVertical: 2 }} nestedScrollEnabled>
                <VideoGrid
                  participants={room.participants}
                  meId={meId ?? ''}
                  videos={voice.videos}
                  camerasOn={voice.camerasOn}
                  speaking={voice.speaking}
                  compact={!isVideo}
                  reactions={reactions}
                  onReveal={voice.setVideoVisible}
                  onPressTile={setSelected}
                  onReport={(p) => openReport({ targetType: 'user', targetId: p.id, subject: `${p.display_name} in this hangout`, blockUserId: p.id })}
                />
              </ScrollView>
            ) : null}
            <View style={[styles.roleRow, { backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityLiveRegion="polite">
              <RoleIcon size={16} color={room.can_speak && voice.micOn ? colors.success : colors.textMuted} />
              <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
                {roleText}
              </Text>
              <PressableScale onPress={() => setRulesOpen(true)} hitSlop={8} accessibilityLabel="Room rules" style={styles.rulesLink}>
                <Text variant="caption" tone="primary">
                  Rules
                </Text>
              </PressableScale>
            </View>
            {room.kind === 'study' ? <FocusTimerCard timer={room.timer} isHost={room.can_moderate} busy={actions.timer.isPending} onControl={timerControl} /> : null}
            {activeGame ? (
              <Animated.View entering={reduceMotion ? undefined : FadeIn} exiting={reduceMotion ? undefined : FadeOut} style={[styles.gameBanner, { backgroundColor: colors.accentSoft }]}>
                <Gamepad2 size={18} color={colors.accent} />
                <Text variant="label" style={{ flex: 1 }} numberOfLines={2}>
                  {GAME_META[activeGame.game_type]?.name ?? 'A game'} {activeGame.status === 'lobby' ? 'starting' : 'in progress'} · {activeGame.players.length} playing
                </Text>
                <Button title="Join" size="sm" variant="accent" onPress={() => router.push(`/game/${activeGame.id}`)} accessibilityLabel="Join the game" />
                <IconButton icon={X} size={36} label="Dismiss game banner" onPress={() => setDismissedGames((s) => new Set(s).add(activeGame.id))} />
              </Animated.View>
            ) : null}
            <SegmentedControl
              options={[
                { value: 'chat', label: 'Chat' },
                { value: 'people', label: `People · ${room.participants.length}` },
              ]}
              value={tab}
              onChange={setTab}
            />
          </View>

          <View style={{ flex: 1, minHeight: 120 }}>
            {tab === 'chat' ? (
              <ChatPanel
                messages={chat.data}
                loading={chat.isLoading}
                meId={meId}
                lockedReason={chatLocked ? 'Chat opens during the break' : null}
                onSend={sendChat}
              />
            ) : (
              <PeoplePanel
                participants={room.participants}
                meId={meId}
                speaking={voice.speaking}
                canModerate={room.can_moderate}
                isVoice={isVoice}
                onPress={setSelected}
                onInviteToSpeak={(p) =>
                  actions.moderate.mutate(
                    { userId: p.id, action: 'make_speaker' },
                    { onSuccess: () => toast.success(`${p.display_name} can speak now`), onError: (e) => toast.error("Couldn't do that", errorMessage(e)) },
                  )
                }
              />
            )}
          </View>

          {/* Reactions tray sits above the bar, never over it. */}
          {reactionsOpen ? (
            <View style={[styles.tray, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.md }}>
                {REACTIONS.map((r) => {
                  const Icon = r.icon;
                  return (
                    <PressableScale key={r.key} onPress={() => react(r.key)} accessibilityLabel={`React: ${r.label}`} style={[styles.reaction, { backgroundColor: colors.surfaceAlt }]}>
                      <Icon size={16} color={colors.accent} />
                      <Text variant="label">{r.label}</Text>
                    </PressableScale>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {/* Control bar: always visible, never covered. */}
          <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm), borderTopColor: colors.border, backgroundColor: colors.surface }]}>
            {showMic ? (
              <ControlButton
                icon={voice.micOn ? Mic : MicOff}
                label={mutedByHost ? 'Muted' : voice.micOn ? 'Mic on' : 'Mic off'}
                tone={mutedByHost ? 'warn' : voice.micOn ? 'on' : 'off'}
                busy={voice.micBusy}
                disabled={mutedByHost || !micReady}
                onPress={voice.toggleMic}
                accessibilityLabel={mutedByHost ? 'Microphone, muted by the host' : voice.micOn ? 'Turn microphone off' : 'Turn microphone on'}
                accessibilityHint={!micReady && !mutedByHost ? 'Voice is not connected yet' : undefined}
              />
            ) : null}
            {isVideo && room.can_speak ? (
              <ControlButton
                icon={voice.camOn ? Video : VideoOff}
                label={voice.camOn ? 'Camera on' : 'Camera'}
                tone={voice.camOn ? 'on' : 'off'}
                busy={voice.camBusy}
                disabled={!micReady}
                onPress={() => {
                  if (!room.can_video && !voice.camOn) {
                    if (room.video_requires_verification) {
                      toast.show({ title: 'Get verified to use your camera', message: 'Verification keeps video safe for everyone. It takes one selfie.', tone: 'info' });
                      router.push('/verification');
                    } else toast.show({ title: 'The host turned your camera off', tone: 'warning' });
                    return;
                  }
                  voice.toggleCamera();
                }}
                accessibilityLabel={voice.camOn ? 'Turn camera off' : 'Turn camera on'}
              />
            ) : null}
            {isVideo && voice.camOn ? <ControlButton icon={SwitchCamera} label="Flip" onPress={voice.flipCamera} accessibilityLabel="Switch between front and back camera" /> : null}
            {showHand ? (
              <ControlButton
                icon={Hand}
                label={handRaised ? 'Lower hand' : 'Raise hand'}
                tone={handRaised ? 'warn' : 'off'}
                busy={actions.hand.isPending}
                onPress={toggleHand}
                accessibilityHint={handRaised ? undefined : 'Asks the host to let you speak'}
              />
            ) : null}
            <ControlButton icon={Smile} label="React" active={reactionsOpen} onPress={() => setReactionsOpen((o) => !o)} accessibilityLabel={reactionsOpen ? 'Hide reactions' : 'Show reactions'} />
            {canInvite ? <ControlButton icon={UserPlus} label="Invite" onPress={() => setInviteOpen(true)} accessibilityLabel="Invite friends" /> : null}
            <ControlButton icon={Ellipsis} label="More" onPress={() => setMoreOpen(true)} accessibilityLabel="More options: games, report, settings" />
            <View style={{ flex: 1 }} />
            <PressableScale onPress={leave} hapticFeedback="medium" accessibilityRole="button" accessibilityLabel="Leave hangout" style={[styles.leave, { backgroundColor: colors.danger }]}>
              <LogOut size={18} color="#FFFFFF" />
              <Text variant="button" style={{ color: '#FFFFFF' }}>
                Leave
              </Text>
            </PressableScale>
          </View>
        </View>
      </KeyboardAvoidingView>

      <ParticipantSheet roomId={roomId} participant={selected} meId={meId} iAmHost={iAmHost} canModerate={room.can_moderate} isVoice={isVoice} onClose={() => setSelected(null)} />
      <InviteSheet roomId={roomId} visible={inviteOpen} onClose={() => setInviteOpen(false)} presentIds={presentIds} />
      {room.can_moderate ? <RoomSettingsSheet room={room} visible={settingsOpen} onClose={() => setSettingsOpen(false)} /> : null}

      <Sheet visible={moreOpen} onClose={() => setMoreOpen(false)} title="More" scroll>
        <View style={{ gap: space.lg }}>
          <ListGroup>
            <ListRow
              icon={Gamepad2}
              iconTone="accent"
              title="Start a game"
              subtitle="Truth or Dare, Werewolf, Crazy Eights or Ludo"
              onPress={() => {
                setMoreOpen(false);
                setGamePickerOpen(true);
              }}
            />
            {canInvite ? (
              <>
                <Divider inset={64} />
                <ListRow
                  icon={UserPlus}
                  iconTone="primary"
                  title="Invite friends"
                  onPress={() => {
                    setMoreOpen(false);
                    setInviteOpen(true);
                  }}
                />
              </>
            ) : null}
            <Divider inset={64} />
            <ListRow
              icon={BookOpenText}
              title="Room rules"
              onPress={() => {
                setMoreOpen(false);
                setRulesOpen(true);
              }}
            />
          </ListGroup>
          {room.can_moderate ? (
            <ListGroup title="Host tools">
              <ListRow
                icon={Settings2}
                title="Room settings"
                subtitle="Name, open mic and scene"
                onPress={() => {
                  setMoreOpen(false);
                  setSettingsOpen(true);
                }}
              />
              {iAmHost ? (
                <>
                  <Divider inset={64} />
                  <ListRow icon={Power} destructive title="End hangout" subtitle="Closes the room for everyone" onPress={endHangout} />
                </>
              ) : null}
            </ListGroup>
          ) : null}
          <ListGroup title="Safety">
            <ListRow icon={Flag} destructive title="Report this hangout" onPress={reportRoom} />
            <Divider inset={64} />
            <ListRow
              icon={LogOut}
              destructive
              title="Leave now"
              onPress={() => {
                setMoreOpen(false);
                onLeave();
              }}
            />
          </ListGroup>
        </View>
      </Sheet>

      <Sheet visible={gamePickerOpen} onClose={() => setGamePickerOpen(false)} title="Start a game" scroll>
        <ListGroup>
          {ROOM_GAME_TYPES.map((type, i) => (
            <View key={type}>
              {i ? <Divider inset={64} /> : null}
              <ListRow icon={Gamepad2} iconTone="accent" title={GAME_META[type].name} subtitle={`${GAME_META[type].tagline} · ${GAME_META[type].minPlayers}–${GAME_META[type].maxPlayers} players`} onPress={() => startGame(type)} />
            </View>
          ))}
        </ListGroup>
      </Sheet>

      <Sheet visible={rulesOpen} onClose={() => setRulesOpen(false)} title="Room rules" scroll>
        <View style={{ gap: space.md }}>
          {room.rules.map((r, i) => (
            <View key={r} style={{ flexDirection: 'row', gap: space.md }}>
              <Text variant="label" tone="primary">
                {i + 1}
              </Text>
              <Text style={{ flex: 1 }}>{r}</Text>
            </View>
          ))}
          <Button title="Got it" onPress={() => setRulesOpen(false)} fullWidth />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.xs, minHeight: 56 },
  topMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, height: 22, borderRadius: radius.pill },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, minHeight: 44 },
  rulesLink: { minHeight: 44, minWidth: 56, alignItems: 'center', justifyContent: 'center' },
  gameBanner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.md, paddingRight: space.xs, paddingVertical: space.xs, borderRadius: radius.md },
  tray: { paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  reaction: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, height: 40, borderRadius: radius.pill },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  leave: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, height: 48, borderRadius: radius.pill, minWidth: 96, justifyContent: 'center' },
});
