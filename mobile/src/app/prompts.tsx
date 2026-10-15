import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Plus, Trash2 } from 'lucide-react-native';

import { useMe } from '@/api/hooks';
import { usePromptCatalogue, useSavePrompts } from '@/api/discover-extra';
import { Button, Card, ErrorState, Header, IconButton, Input, PressableScale, RowSkeleton, Screen, SectionHeader, Text } from '@/components/ui';
import { errorMessage, fieldErrors } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const MAX_PROMPTS = 3;
const MAX_ANSWER = 150;

type Answer = { key: string; answer: string };

export default function Prompts() {
  const { colors } = useTheme();
  const me = useMe();
  const catalogue = usePromptCatalogue();
  const save = useSavePrompts();
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (me.data && !loaded) {
      setAnswers((me.data.prompts ?? []).map((p) => ({ key: p.key, answer: p.answer })));
      setLoaded(true);
    }
  }, [me.data, loaded]);

  const text = (key: string) => catalogue.data?.find((p) => p.key === key)?.text ?? '';
  const chosen = new Set(answers.map((a) => a.key));
  const full = answers.length >= MAX_PROMPTS;
  const incomplete = answers.some((a) => !a.answer.trim());

  const add = (key: string) => {
    if (full || chosen.has(key)) return;
    haptic.tap();
    setAnswers((list) => [...list, { key, answer: '' }]);
  };
  const remove = (key: string) => setAnswers((list) => list.filter((a) => a.key !== key));
  const setAnswer = (key: string, answer: string) => setAnswers((list) => list.map((a) => (a.key === key ? { ...a, answer } : a)));

  const submit = async () => {
    try {
      await save.mutateAsync(answers.map((a) => ({ key: a.key, answer: a.answer.trim() })));
      haptic.success();
      toast.success('Prompts saved', 'They now show on your profile and in Friend Swipe.');
      router.back();
    } catch (e) {
      const fields = fieldErrors(e);
      toast.error("Couldn't save your prompts", Object.values(fields)[0] ?? errorMessage(e));
    }
  };

  return (
    <Screen
      scroll
      keyboard
      header={<Header title="Profile prompts" subtitle={`${answers.length} of ${MAX_PROMPTS} chosen`} />}
      footer={<Button title="Save" size="lg" onPress={submit} disabled={incomplete || !loaded} loading={save.isPending} fullWidth />}
    >
      <View style={{ gap: space.xl, marginTop: space.sm }}>
        <Text tone="muted">Pick up to {MAX_PROMPTS} prompts and answer them. They give people an easy way to start a conversation — friends can reply to them right from your profile.</Text>

        {answers.length ? (
          <View style={{ gap: space.md }}>
            {answers.map((a) => (
              <Card key={a.key} style={{ gap: space.sm }}>
                <View style={styles.rowBetween}>
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {text(a.key)}
                  </Text>
                  <IconButton icon={Trash2} label={`Remove "${text(a.key)}"`} size={36} onPress={() => remove(a.key)} />
                </View>
                <Input value={a.answer} onChangeText={(v) => setAnswer(a.key, v)} placeholder="Your answer" multiline maxLength={MAX_ANSWER} counter accessibilityLabel={`Answer: ${text(a.key)}`} />
              </Card>
            ))}
          </View>
        ) : null}

        <View>
          <SectionHeader title={full ? 'All set' : 'Choose a prompt'} subtitle={full ? `Remove one to pick a different prompt.` : undefined} />
          {catalogue.isLoading ? <RowSkeleton count={4} /> : null}
          {catalogue.isError ? <ErrorState error={catalogue.error} onRetry={() => catalogue.refetch()} compact /> : null}
          <View style={{ gap: space.sm }}>
            {(catalogue.data ?? [])
              .filter((p) => !chosen.has(p.key))
              .map((p) => (
                <PressableScale
                  key={p.key}
                  onPress={() => add(p.key)}
                  disabled={full}
                  scaleTo={0.985}
                  accessibilityLabel={`Add prompt: ${p.text}`}
                  style={[styles.option, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <Text style={{ flex: 1 }}>{p.text}</Text>
                  <Plus size={18} color={colors.primary} />
                </PressableScale>
              ))}
          </View>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
