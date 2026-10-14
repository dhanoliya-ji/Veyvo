import { useState } from 'react';
import { Platform, View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock, Mail } from 'lucide-react-native';

import type { AuthResponse } from '@/api/types';
import { Button, Header, Input, Screen, Text } from '@/components/ui';
import { ApiError, errorMessage, post } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/queryClient';
import { useSession } from '@/stores/session';
import { space } from '@/theme/tokens';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
type Form = z.infer<typeof schema>;

export default function Login() {
  const [error, setError] = useState<string | null>(null);
  const reason = useSession((s) => s.signOutReason);
  const { control, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await post<AuthResponse>('/auth/login', { email: values.email.trim(), password: values.password, platform: Platform.OS });
      haptic.success();
      queryClient.clear();
      await useSession.getState().setTokens(res.access_token, res.refresh_token);
    } catch (e) {
      haptic.error();
      if (e instanceof ApiError && (e.code === 'account_banned' || e.code === 'account_suspended')) {
        const until = e.details?.until ? ` until ${new Date(String(e.details.until)).toLocaleDateString()}` : '';
        setError(e.code === 'account_banned' ? 'This account has been banned for breaking the Community Guidelines.' : `This account is suspended${until}.`);
      } else {
        setError(errorMessage(e));
      }
    }
  });

  return (
    <Screen scroll keyboard header={<Header title="Welcome back" />}>
      <View style={{ gap: space.lg, marginTop: space.sm }}>
        {reason === 'expired' ? (
          <Text tone="muted">Your session ended. Please log in again.</Text>
        ) : null}
        <Controller
          control={control}
          name="email"
          render={({ field, fieldState }) => (
            <Input label="Email" icon={Mail} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
          )}
        />
        <Controller
          control={control}
          name="password"
          render={({ field, fieldState }) => (
            <Input label="Password" icon={Lock} secure value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} autoComplete="current-password" textContentType="password" onSubmitEditing={onSubmit} returnKeyType="go" />
          )}
        />
        {error ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button title="Log in" size="lg" onPress={onSubmit} loading={formState.isSubmitting} fullWidth />
        <Button title="Forgot password?" variant="ghost" onPress={() => router.push('/forgot')} />
      </View>
    </Screen>
  );
}
