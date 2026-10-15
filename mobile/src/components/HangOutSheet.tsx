import { useState } from 'react';
import { router } from 'expo-router';
import { ArrowLeft, Dices, Hand, Home, Mic, Phone, Sparkles, Video } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';

import { startCallWithFormat, waveRequest, type CallFormat } from '@/api/connect-extra';
import { GAME_META, type GameType } from '@/api/games-extra';
import { inviteToGame } from '@/api/invites-extra';
import { qk, useMe } from '@/api/hooks';
import type { Conversation, GameView, RoomDetail, UserSummary } from '@/api/types';
import { Button, IconButton, ListGroup, ListRow, Sheet } from '@/components/ui';
import { errorMessage, post } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';

/** Games that work well for two friends. */
const DUO_GAMES: GameType[] = ['chess', 'four_in_a_row', 'crazy_eights', 'ludo', 'truth_or_dare'];

type Props = {
  user: UserSummary;
  visible: boolean;
  onClose: () => void;
  /** Already in the chat with them: "Voice note" just closes the sheet and points at the mic. */
  inChat?: boolean;
};

/** One place to hang out with a friend: call, play, a private room, a voice note or a wave. */
export function HangOutSheet({ user, visible, onClose, inChat }: Props) {
  const qc = useQueryClient();
  const me = useMe();
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const name = user.display_name;

  const close = () => {
    setPicking(false);
    onClose();
  };

  const run = (key: string, fn: () => Promise<void>, failTitle: string) => async () => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      haptic.error();
      toast.error(failTitle, errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const conversation = () => post<Conversation>('/conversations', { user_id: user.id });

  const call = (format: CallFormat) =>
    run(
      format,
      async () => {
        const room = await startCallWithFormat(user.id, format);
        haptic.medium();
        close();
        router.push(`/room/${room.id}`);
      },
      `Couldn't call ${name}`,
    );

  const playGame = (type: GameType) =>
    run(
      `game:${type}`,
      async () => {
        const game = await post<GameView>('/games', { game_type: type });
        // Send a real game invite (a notification for them); nothing is posted in your chat.
        try {
          const res = await inviteToGame(game.id, [user.id]);
          if (res.invited.length) toast.success(`Invited ${name} to ${GAME_META[type].name}`);
          else toast.show({ title: `${name} isn't taking game invites right now`, message: `Share code ${game.code} instead.` });
        } catch (e) {
          toast.show({ title: `Share code ${game.code} with ${name}`, message: errorMessage(e) });
        }
        qc.invalidateQueries({ queryKey: qk.myGames });
        haptic.success();
        close();
        router.push(`/game/${game.id}`);
      },
      "Couldn't start a game",
    );

  const privateRoom = run(
    'room',
    async () => {
      const mine = me.data?.display_name ?? 'My';
      const title = `${mine} & ${name}`.slice(0, 80).padEnd(3, '.');
      const room = await post<RoomDetail>('/rooms', {
        title,
        kind: 'hangout',
        format: 'voice',
        visibility: 'private',
        scene: 'cafe',
        capacity: 8,
        open_mic: true,
      });
      try {
        await post(`/rooms/${room.id}/invite`, { user_id: user.id });
        toast.success(`Invited ${name}`);
      } catch (e) {
        toast.error(`Couldn't invite ${name}`, errorMessage(e));
      }
      qc.invalidateQueries({ queryKey: qk.roomsAll });
      close();
      router.push(`/room/${room.id}`);
    },
    "Couldn't start a room",
  );

  const voiceNote = run(
    'voice',
    async () => {
      close();
      if (inChat) {
        toast.show({
          title: 'Hold the mic to record',
          message: 'Let go to send. Slide left to cancel.',
        });
        return;
      }
      const conv = await conversation();
      router.push(`/messages/${conv.id}`);
    },
    "Couldn't open your chat",
  );

  const wave = run(
    'wave',
    async () => {
      const res = await waveRequest(user.id);
      haptic.success();
      close();
      toast.show(
        res.matched
          ? {
              title: `You and ${name} both waved 👋`,
              message: 'Perfect time for a call!',
              tone: 'success',
            }
          : { title: `You waved at ${name} 👋`, tone: 'success' },
      );
    },
    "Couldn't wave",
  );

  if (picking) {
    return (
      <Sheet visible={visible} onClose={close} title="Pick a game" scroll>
        <ListGroup>
          {DUO_GAMES.map((type) => (
            <ListRow
              key={type}
              icon={Dices}
              iconTone="accent"
              title={GAME_META[type].name}
              subtitle={busy === `game:${type}` ? 'Starting…' : GAME_META[type].tagline}
              onPress={playGame(type)}
            />
          ))}
        </ListGroup>
        <Button title="Back" icon={ArrowLeft} variant="ghost" onPress={() => setPicking(false)} style={{ marginTop: 12 }} />
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={close} title={`Hang out with ${name}`} scroll>
      <ListGroup>
        <ListRow icon={Phone} iconTone="success" title="Voice call" subtitle={busy === 'voice' ? 'Calling…' : 'Just talk'} onPress={call('voice')} />
        <ListRow icon={Video} iconTone="primary" title="Video call" subtitle={busy === 'video' ? 'Calling…' : 'Your camera starts off'} onPress={call('video')} />
        <ListRow icon={Dices} iconTone="accent" title="Play a game" subtitle="Chess, Four in a Row, cards and more" onPress={() => setPicking(true)} />
        <ListRow icon={Home} iconTone="primary" title="Start a private room" subtitle={busy === 'room' ? 'Setting it up…' : `Invite-only, with ${name}`} onPress={privateRoom} />
        <ListRow icon={Mic} iconTone="warning" title="Voice note" subtitle="Up to 60 seconds" onPress={voiceNote} />
        <ListRow icon={Hand} iconTone="success" title="Wave 👋" subtitle="A quick hi. Wave back and it's a match." onPress={wave} />
      </ListGroup>
    </Sheet>
  );
}

/** Button that opens the Hang out sheet (for profiles, friend rows and anywhere else). */
export function HangOutButton({ user, compact, inChat }: { user: UserSummary; compact?: boolean; inChat?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {compact ? (
        <IconButton icon={Sparkles} label={`Hang out with ${user.display_name}`} onPress={() => setOpen(true)} />
      ) : (
        <Button title="Hang out" icon={Sparkles} onPress={() => setOpen(true)} style={{ flex: 1 }} />
      )}
      <HangOutSheet user={user} visible={open} onClose={() => setOpen(false)} inChat={inChat} />
    </>
  );
}
