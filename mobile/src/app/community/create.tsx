import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Globe, Lock, Plus, Sparkles, Users, X } from 'lucide-react-native';

import { useCreateCommunity, useInterests } from '@/api/hooks';
import { FormSection, OptionCards } from '@/components/room/FormBits';
import { TopicPicker } from '@/components/room/TopicPicker';
import { Badge, Button, Header, IconButton, Input, Screen, Text } from '@/components/ui';
import { errorMessage, fieldErrors } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

// Mirrors the backend defaults so people start from sensible ground rules.
const DEFAULT_RULES = ['Be kind and respectful.', 'Stay on topic.', 'No spam or self-promotion.', 'Report anything that breaks the Community Guidelines.'];
const MAX_RULES = 5;

type Visibility = 'public' | 'private';

export default function CreateCommunity() {
  const { colors } = useTheme();
  const interests = useInterests();
  const create = useCreateCommunity();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [interestId, setInterestId] = useState<number | null>(null);
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [rules, setRules] = useState<string[]>(DEFAULT_RULES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const topic = interests.data?.find((i) => i.id === interestId);

  const validate = () => {
    const e: Record<string, string> = {};
    const n = name.trim();
    if (n.length < 3) e.name = 'Give it a name (at least 3 characters).';
    else if (n.length > 60) e.name = 'Keep the name under 60 characters.';
    if (description.length > 500) e.description = 'Keep the description under 500 characters.';
    if (rules.some((r) => r.trim().length > 200)) e.rules = 'Keep each rule short (under 200 characters).';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    setSubmitError(null);
    if (!validate()) {
      haptic.warning();
      return;
    }
    try {
      const community = await create.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        interest_id: interestId,
        visibility,
        rules: rules.map((r) => r.trim()).filter(Boolean),
      });
      haptic.success();
      toast.success(`${community.name} is live`, 'Invite people and host your first hangout.');
      router.replace(`/community/${community.id}`);
    } catch (err) {
      haptic.error();
      const fields = fieldErrors(err);
      if (Object.keys(fields).length) setErrors(fields);
      setSubmitError(errorMessage(err));
    }
  };

  const initials =
    (name.trim() || 'New community')
      .split(' ')
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'NC';

  return (
    <Screen
      keyboard
      header={<Header title="New community" close />}
      footer={
        <View style={{ gap: space.sm }}>
          {submitError ? (
            <Text variant="caption" tone="danger" center accessibilityLiveRegion="polite">
              {submitError}
            </Text>
          ) : null}
          <Button title="Create community" icon={Sparkles} size="lg" fullWidth loading={create.isPending} onPress={submit} />
        </View>
      }
    >
      <ScrollView contentContainerStyle={{ gap: space.xxl, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <FormSection title="Basics">
          <Input
            label="Name"
            placeholder="e.g. Late night readers"
            value={name}
            onChangeText={(t) => {
              setName(t);
              if (errors.name) setErrors((e) => ({ ...e, name: '' }));
            }}
            maxLength={60}
            counter
            error={errors.name || undefined}
          />
          <Input
            label="Description"
            placeholder="Who is it for? What happens here?"
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={500}
            counter
            error={errors.description || undefined}
          />
        </FormSection>

        <FormSection title="Topic" hint="Helps people with the same interests find you.">
          <TopicPicker interests={interests.data} value={interestId} onChange={setInterestId} loading={interests.isLoading} />
        </FormSection>

        <FormSection title="Who can join">
          <OptionCards<Visibility>
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'public', title: 'Public', description: 'Anyone can join and see posts.', icon: Globe },
              { value: 'private', title: 'Private', description: 'People request to join. Only members see inside.', icon: Lock },
            ]}
          />
        </FormSection>

        <FormSection title="Rules" hint={`Up to ${MAX_RULES}. Clear rules make moderating easier.`} error={errors.rules || undefined}>
          <View style={{ gap: space.sm }}>
            {rules.map((rule, i) => (
              <View key={i} style={styles.ruleRow}>
                <Text variant="label" tone="primary" style={{ width: 18 }}>
                  {i + 1}
                </Text>
                <View style={{ flex: 1 }}>
                  <Input value={rule} onChangeText={(t) => setRules((list) => list.map((r, j) => (j === i ? t : r)))} maxLength={200} accessibilityLabel={`Rule ${i + 1}`} placeholder="Write a rule" />
                </View>
                <IconButton icon={X} label={`Remove rule ${i + 1}`} onPress={() => setRules((list) => list.filter((_, j) => j !== i))} />
              </View>
            ))}
            {rules.length < MAX_RULES ? <Button title="Add a rule" icon={Plus} variant="ghost" onPress={() => setRules((list) => [...list, ''])} style={{ alignSelf: 'flex-start' }} /> : null}
          </View>
        </FormSection>

        <FormSection title="Preview">
          <View style={[styles.preview, { backgroundColor: colors.surface, borderColor: colors.border }]} accessible accessibilityLabel={`Preview: ${name.trim() || 'New community'}`}>
            <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
              <Text variant="heading" tone="primary">
                {initials}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text variant="subheading" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {name.trim() || 'New community'}
                </Text>
                {visibility === 'private' ? <Lock size={12} color={colors.textMuted} /> : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Users size={12} color={colors.textMuted} />
                <Text variant="caption" tone="muted">
                  1 member (you, the owner)
                </Text>
              </View>
              {topic ? <Badge label={topic.name} tone="primary" /> : null}
            </View>
          </View>
          {description.trim() ? (
            <Text variant="caption" tone="muted" numberOfLines={3}>
              {description.trim()}
            </Text>
          ) : null}
        </FormSection>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  preview: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  badge: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
