import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { BookOpen, Globe, Lock, MessageSquareText, Mic, Tent, Users, Video } from 'lucide-react-native';

import { useConfig, useCreateRoom, useInterests, useMe } from '@/api/hooks';
import { scheduleOptions, toIsoWithOffset, useHostableCommunities, useOwnedScenes } from '@/api/rooms-extra';
import type { Room, RoomInput, Scene } from '@/api/types';
import { RoomCard } from '@/components/cards';
import { FormSection, OptionCards, Stepper } from '@/components/room/FormBits';
import { TopicPicker } from '@/components/room/TopicPicker';
import { Button, Chip, Header, Input, ListGroup, ListRow, Screen, Text } from '@/components/ui';
import { ApiError, errorMessage, fieldErrors } from '@/lib/api';
import { eventTime } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

type Kind = 'hangout' | 'study';
type Format = 'voice' | 'video' | 'text';
type Visibility = 'public' | 'private';

export default function CreateRoom() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ kind?: string; community_id?: string; interest_id?: string }>();
  const me = useMe();
  const config = useConfig();
  const interests = useInterests();
  const { owned } = useOwnedScenes();
  const communities = useHostableCommunities();
  const create = useCreateRoom();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [interestId, setInterestId] = useState<number | null>(params.interest_id ? Number(params.interest_id) || null : null);
  const [kind, setKind] = useState<Kind>(params.kind === 'study' ? 'study' : 'hangout');
  const [format, setFormat] = useState<Format>('voice');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [scene, setScene] = useState<Scene>(params.kind === 'study' ? 'library' : 'cafe');
  const [capacity, setCapacity] = useState(12);
  const [openMic, setOpenMic] = useState(true);
  const [focus, setFocus] = useState(25);
  const [brk, setBrk] = useState(5);
  const [scheduleKey, setScheduleKey] = useState('now');
  const [communityId, setCommunityId] = useState<string | null>(params.community_id ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const schedule = useMemo(() => scheduleOptions(), []);
  const chosenSchedule = schedule.find((s) => s.key === scheduleKey) ?? schedule[0];
  const maxCapacity = Math.min(50, config.data?.max_room_capacity ?? 50);
  const voiceAvailable = config.data?.media_available ?? true;

  // A suggested title from the preset, so quick-start is genuinely quick.
  useEffect(() => {
    if (title) return;
    if (params.kind === 'study') setTitle('Quiet study session');
  }, [params.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Study rooms default to a quieter setup.
  const chooseKind = (k: Kind) => {
    setKind(k);
    if (k === 'study') {
      setOpenMic(false);
      if (scene === 'cafe') setScene('library');
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    const t = title.trim();
    if (t.length < 3) e.title = 'Give your hangout a name (at least 3 characters).';
    else if (t.length > 80) e.title = 'Keep the name under 80 characters.';
    if (description.length > 500) e.description = 'Keep the description under 500 characters.';
    if (!owned.has(scene)) e.scene = 'Unlock this scene in the shop first, or pick a free one.';
    if (capacity < 2 || capacity > maxCapacity) e.capacity = `Rooms can hold 2 to ${maxCapacity} people.`;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    setSubmitError(null);
    if (!validate()) {
      haptic.warning();
      return;
    }
    const body: RoomInput = {
      title: title.trim(),
      description: description.trim(),
      kind,
      format,
      visibility,
      scene,
      interest_id: interestId,
      community_id: communityId,
      capacity,
      open_mic: format !== 'text' ? openMic : true,
      scheduled_for: chosenSchedule.date ? toIsoWithOffset(chosenSchedule.date) : null,
      ...(kind === 'study' ? { focus_minutes: focus, break_minutes: brk } : {}),
    };
    try {
      const room = await create.mutateAsync(body);
      haptic.success();
      if (room.status === 'live') {
        router.replace(`/room/${room.id}`);
      } else {
        toast.success('Hangout scheduled', room.scheduled_for ? `${eventTime(room.scheduled_for)}, in your time zone.` : undefined);
        router.replace(`/room/${room.id}`);
      }
    } catch (err) {
      haptic.error();
      const fields = fieldErrors(err);
      if (Object.keys(fields).length) setErrors(fields);
      if (err instanceof ApiError && err.code === 'item_locked') setErrors((e) => ({ ...e, scene: err.message }));
      setSubmitError(errorMessage(err));
    }
  };

  const preview: Room = {
    id: 'preview',
    title: title.trim() || 'Your hangout',
    description,
    kind,
    format,
    visibility,
    scene,
    interest_id: interestId,
    community_id: communityId,
    capacity,
    status: chosenSchedule.date ? 'scheduled' : 'live',
    open_mic: openMic,
    host: me.data ? { id: me.data.id, username: me.data.username, display_name: me.data.display_name, avatar: me.data.avatar, level: me.data.level, vibe: me.data.vibe } : null,
    // Only you will be inside when it opens, so that's what the preview shows.
    participant_count: chosenSchedule.date ? 0 : 1,
    participants_preview: [],
    friends_inside: 0,
    scheduled_for: chosenSchedule.date ? chosenSchedule.date.toISOString() : null,
    started_at: null,
    created_at: new Date().toISOString(),
    my_role: 'host',
    timer: null,
  };

  return (
    <Screen
      keyboard
      header={<Header title="New hangout" close />}
      footer={
        <View style={{ gap: space.sm }}>
          {submitError ? (
            <Text variant="caption" tone="danger" center accessibilityLiveRegion="polite">
              {submitError}
            </Text>
          ) : null}
          <Button
            title={chosenSchedule.date ? 'Schedule hangout' : 'Open hangout'}
            icon={Tent}
            size="lg"
            fullWidth
            loading={create.isPending}
            onPress={submit}
          />
        </View>
      }
    >
      <ScrollView contentContainerStyle={{ gap: space.xxl, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <FormSection title="Name and vibe">
          <Input
            label="Name"
            placeholder="e.g. Sunday night chill"
            value={title}
            onChangeText={(t) => {
              setTitle(t);
              if (errors.title) setErrors((e) => ({ ...e, title: '' }));
            }}
            maxLength={80}
            counter
            error={errors.title || undefined}
            returnKeyType="next"
          />
          <Input
            label="Description (optional)"
            placeholder="What's the plan? Who should come?"
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={500}
            counter
            error={errors.description || undefined}
          />
        </FormSection>

        <FormSection title="Topic" hint="Helps the right people find your room.">
          <TopicPicker interests={interests.data} value={interestId} onChange={setInterestId} loading={interests.isLoading} />
        </FormSection>

        <FormSection title="Type">
          <OptionCards<Kind>
            value={kind}
            onChange={chooseKind}
            options={[
              { value: 'hangout', title: 'Hangout', description: 'Chat, laugh, meet people.', icon: Tent },
              { value: 'study', title: 'Study room', description: 'Focus together with a shared timer.', icon: BookOpen },
            ]}
          />
          {kind === 'study' ? (
            <View style={{ gap: space.sm }}>
              <Stepper label="Focus" value={focus} min={5} max={90} step={5} onChange={setFocus} suffix="min" />
              <Stepper label="Break" value={brk} min={1} max={30} onChange={setBrk} suffix="min" />
              <Text variant="caption" tone="muted">
                Chat pauses during focus and opens again on the break.
              </Text>
            </View>
          ) : null}
        </FormSection>

        <FormSection title="Format">
          <OptionCards<Format>
            value={format}
            onChange={setFormat}
            options={[
              { value: 'video', title: 'Video', description: 'Face to face. Cameras are optional and off by default; only verified people can turn theirs on.', icon: Video },
              { value: 'voice', title: 'Voice', description: 'Talk out loud. Needs a microphone to speak; anyone can just listen and chat.', icon: Mic },
              { value: 'text', title: 'Text', description: 'Chat only. No microphone needed.', icon: MessageSquareText },
            ]}
          />
          {format !== 'text' && !voiceAvailable ? (
            <Text variant="caption" tone="warning">
              Voice isn't set up on this server yet. Your room will open, and everyone can still chat.
            </Text>
          ) : null}
        </FormSection>

        <FormSection title="Who can join">
          <OptionCards<Visibility>
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'public', title: 'Public', description: 'Anyone on Veyvo can find and join.', icon: Globe },
              { value: 'private', title: 'Invite-only', description: 'Only people you invite can join.', icon: Lock },
            ]}
          />
        </FormSection>


        <FormSection title="Room size" error={errors.capacity || undefined}>
          <Stepper label="Capacity" value={capacity} min={2} max={maxCapacity} onChange={setCapacity} suffix="people" />
          {format !== 'text' ? (
            <ListGroup>
              <ListRow
                icon={Mic}
                iconTone="primary"
                title="Open mic"
                subtitle={openMic ? 'Everyone can talk as soon as they join.' : 'People raise a hand and you invite them to speak.'}
                toggle={{ value: openMic, onChange: setOpenMic }}
              />
            </ListGroup>
          ) : null}
        </FormSection>

        <FormSection title="When" hint="Times are in your time zone.">
          <View style={styles.wrap}>
            {schedule.map((s) => (
              <Chip key={s.key} label={s.label} selected={scheduleKey === s.key} onPress={() => setScheduleKey(s.key)} />
            ))}
          </View>
          {chosenSchedule.date ? (
            <Text variant="caption" tone="muted">
              Starts {eventTime(chosenSchedule.date.toISOString())}. You'll open the doors with "Start now".
            </Text>
          ) : null}
        </FormSection>

        {communities.list.length > 0 || communityId ? (
          <FormSection title="Community (optional)" hint="Host it inside one of your communities.">
            <View style={styles.wrap}>
              <Chip label="None" selected={!communityId} onPress={() => setCommunityId(null)} />
              {communities.list.map((c) => (
                <Chip key={c.id} label={c.name} icon={Users} selected={communityId === c.id} onPress={() => setCommunityId(c.id)} />
              ))}
            </View>
          </FormSection>
        ) : null}

        <FormSection title="Preview">
          <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <RoomCard room={preview} width="100%" onPress={() => undefined} />
          </View>
          <View style={[styles.summary, { backgroundColor: colors.surfaceAlt }]}>
            <Text variant="caption" tone="muted">
              {visibility === 'private' ? 'Invite-only' : 'Public'} · {kind === 'study' ? `Study room, ${focus}/${brk} min` : 'Hangout'} ·{' '}
              {format === 'text' ? 'Text' : `${format === 'video' ? 'Video' : 'Voice'}, ${openMic ? 'open mic' : 'raise hands'}`} · Up to {capacity}
            </Text>
          </View>
        </FormSection>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  summary: { padding: space.md, borderRadius: radius.md },
});
