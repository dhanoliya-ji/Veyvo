import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { KeyRound, Lock, Mail } from 'lucide-react-native';

import { Button, Header, Input, Screen, Text } from '@/components/ui';
import { errorMessage, fieldErrors, post } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { space } from '@/theme/tokens';

export default function Forgot() {
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ dev_code?: string | null }>('/auth/forgot-password', { email: email.trim() });
      setDevCode(res.dev_code ?? null);
      setStep('reset');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/auth/reset-password', { email: email.trim(), code, new_password: password });
      haptic.success();
      toast.success('Password updated', 'You can log in with your new password.');
      router.replace('/login');
    } catch (e) {
      haptic.error();
      setError(fieldErrors(e).new_password ?? errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll keyboard header={<Header title="Reset password" />}>
      {step === 'email' ? (
        <View style={{ gap: space.lg, marginTop: space.sm }}>
          <Text tone="muted">Enter your account email. If it matches an account, we'll send a reset code.</Text>
          <Input label="Email" icon={Mail} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={error ?? undefined} />
          <Button title="Send code" size="lg" onPress={sendCode} loading={busy} fullWidth />
        </View>
      ) : (
        <View style={{ gap: space.lg, marginTop: space.sm }}>
          <Text tone="muted">If {email.trim()} has a Veyvo account, a 6-digit code is on its way.</Text>
          {devCode ? (
            <Text variant="caption" tone="warning">
              Development server: your code is {devCode}
            </Text>
          ) : null}
          <Input label="Code" icon={KeyRound} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" />
          <Input label="New password" icon={Lock} secure value={password} onChangeText={setPassword} hint="8+ characters with a letter and a number" autoComplete="new-password" />
          {error ? <Text tone="danger">{error}</Text> : null}
          <Button title="Update password" size="lg" onPress={reset} loading={busy} disabled={code.length !== 6 || password.length < 8} fullWidth />
          <Button title="Use a different email" variant="ghost" onPress={() => setStep('email')} />
        </View>
      )}
    </Screen>
  );
}
