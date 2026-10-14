import { useRef, useState } from 'react';
import { Linking, StyleSheet, View, type TextInput } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, Lock, Mail, ShieldAlert } from 'lucide-react-native';

import type { AuthResponse } from '@/api/types';
import { Button, Header, Input, PressableScale, Screen, Text } from '@/components/ui';
import { ApiError, errorMessage, fieldErrors, post } from '@/lib/api';
import { LEGAL_URLS } from '@/lib/config';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/queryClient';
import { useDevCode } from '@/stores/devCode';
import { useSession } from '@/stores/session';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z
    .string()
    .min(8, 'Use at least 8 characters.')
    .max(128, 'Use at most 128 characters.')
    .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'Include at least one letter and one number.'),
  day: z.string().regex(/^\d{1,2}$/, 'Day'),
  month: z.string().regex(/^\d{1,2}$/, 'Month'),
  year: z.string().regex(/^\d{4}$/, 'Year'),
  accept: z.literal(true, { message: 'Please accept to continue.' }),
});
type Form = z.infer<typeof schema>;

function toIsoDate(d: string, m: string, y: string): string | null {
  const day = Number(d);
  const month = Number(m);
  const year = Number(y);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export default function Register() {
  const { colors } = useTheme();
  const [underage, setUnderage] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const monthRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);
  const { control, handleSubmit, setError, formState } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', day: '', month: '', year: '', accept: false as unknown as true },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const birth = toIsoDate(values.day, values.month, values.year);
    if (!birth) {
      setError('day', { message: 'Enter a real date.' });
      return;
    }
    try {
      const res = await post<AuthResponse>(
        '/auth/register',
        { email: values.email.trim(), password: values.password, birth_date: birth, accept_terms: true },
      );
      haptic.success();
      useDevCode.getState().set(res.dev_code);
      queryClient.clear();
      await useSession.getState().setTokens(res.access_token, res.refresh_token);
      // AuthGate routes to email verification.
    } catch (e) {
      if (e instanceof ApiError && e.code === 'underage') {
        setUnderage(true);
        return;
      }
      const fields = fieldErrors(e);
      if (fields.email) setError('email', { message: fields.email });
      if (fields.password) setError('password', { message: fields.password });
      if (!fields.email && !fields.password) setFormError(errorMessage(e));
      haptic.error();
    }
  });

  if (underage) {
    return (
      <Screen header={<Header />}>
        <View style={styles.center}>
          <View style={[styles.badge, { backgroundColor: colors.warningSoft }]}>
            <ShieldAlert size={28} color={colors.warning} />
          </View>
          <Text variant="title" center>
            Veyvo is for adults
          </Text>
          <Text tone="muted" center>
            You need to be 18 or older to use Veyvo. We haven't saved any of the information you entered.
          </Text>
          <Button title="Back to start" variant="secondary" onPress={() => router.replace('/welcome')} style={{ marginTop: space.lg }} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll keyboard header={<Header title="Create your account" />}>
      <View style={{ gap: space.lg, marginTop: space.sm }}>
        <Controller
          control={control}
          name="email"
          render={({ field, fieldState }) => (
            <Input label="Email" icon={Mail} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" />
          )}
        />
        <Controller
          control={control}
          name="password"
          render={({ field, fieldState }) => (
            <Input label="Password" icon={Lock} secure value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} hint="8+ characters with a letter and a number" autoComplete="new-password" textContentType="newPassword" />
          )}
        />

        <View style={{ gap: space.xs }}>
          <Text variant="label" tone="muted" style={{ marginLeft: 2 }}>
            Date of birth
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {(['day', 'month', 'year'] as const).map((name) => (
              <View key={name} style={{ flex: name === 'year' ? 1.4 : 1 }}>
                <Controller
                  control={control}
                  name={name}
                  render={({ field, fieldState }) => (
                    <Input
                      ref={name === 'month' ? monthRef : name === 'year' ? yearRef : undefined}
                      value={field.value}
                      onChangeText={(t) => {
                        const v = t.replace(/\D/g, '');
                        field.onChange(v);
                        if (name === 'day' && v.length === 2) monthRef.current?.focus();
                        if (name === 'month' && v.length === 2) yearRef.current?.focus();
                      }}
                      placeholder={name === 'day' ? 'DD' : name === 'month' ? 'MM' : 'YYYY'}
                      keyboardType="number-pad"
                      maxLength={name === 'year' ? 4 : 2}
                      accessibilityLabel={`Birth ${name}`}
                      error={fieldState.error ? ' ' : undefined}
                    />
                  )}
                />
              </View>
            ))}
          </View>
          <Text variant="caption" tone={formState.errors.day || formState.errors.month || formState.errors.year ? 'danger' : 'faint'} style={{ marginLeft: 2 }}>
            {formState.errors.day?.message === 'Enter a real date.'
              ? 'Enter a real date.'
              : formState.errors.day || formState.errors.month || formState.errors.year
                ? 'Enter your full date of birth.'
                : "Used only to confirm you're 18+. We don't store it."}
          </Text>
        </View>

        <Controller
          control={control}
          name="accept"
          render={({ field, fieldState }) => (
            <View style={{ gap: 4 }}>
              <PressableScale
                onPress={() => field.onChange(!field.value)}
                style={styles.checkRow}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!field.value }}
                accessibilityLabel="I agree to the Terms, Privacy Policy and Community Guidelines"
              >
                <View style={[styles.checkbox, { borderColor: field.value ? colors.primary : colors.borderStrong, backgroundColor: field.value ? colors.primary : 'transparent' }]}>
                  {field.value ? <Check size={14} color={colors.onPrimary} strokeWidth={3} /> : null}
                </View>
                <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                  I agree to the{' '}
                  <Text variant="caption" tone="primary" onPress={() => Linking.openURL(LEGAL_URLS.terms)}>
                    Terms
                  </Text>
                  ,{' '}
                  <Text variant="caption" tone="primary" onPress={() => Linking.openURL(LEGAL_URLS.privacy)}>
                    Privacy Policy
                  </Text>{' '}
                  and{' '}
                  <Text variant="caption" tone="primary" onPress={() => Linking.openURL(LEGAL_URLS.guidelines)}>
                    Community Guidelines
                  </Text>
                  .
                </Text>
              </PressableScale>
              {fieldState.error ? (
                <Text variant="caption" tone="danger">
                  {fieldState.error.message}
                </Text>
              ) : null}
            </View>
          )}
        />

        {formError ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {formError}
          </Text>
        ) : null}
        <Button title="Create account" size="lg" onPress={onSubmit} loading={formState.isSubmitting} fullWidth />
        <Text variant="caption" tone="faint" center>
          Already have an account?{' '}
          <Text variant="caption" tone="primary" onPress={() => router.replace('/login')}>
            Log in
          </Text>
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: space.lg },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  checkbox: { width: 24, height: 24, borderRadius: radius.sm, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
