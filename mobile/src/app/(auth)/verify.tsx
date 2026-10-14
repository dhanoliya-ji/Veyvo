import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { MailCheck } from 'lucide-react-native';

import { qk, useMe } from '@/api/hooks';
import { Button, Input, Screen, Text } from '@/components/ui';
import { errorMessage, post } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/queryClient';
import { useDevCode } from '@/stores/devCode';
import { useSession } from '@/stores/session';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

export default function Verify() {
  const { colors } = useTheme();
  const me = useMe();
  const devCode = useDevCode((s) => s.code);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await post('/auth/verify-email', { code: value });
      haptic.success();
      useDevCode.getState().set(null);
      await queryClient.invalidateQueries({ queryKey: qk.me });
    } catch (e) {
      haptic.error();
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      const res = await post<{ dev_code?: string | null }>('/auth/resend-verification');
      useDevCode.getState().set(res.dev_code);
      setCooldown(30);
      toast.success('New code sent', 'Check your inbox (and spam folder).');
    } catch (e) {
      toast.error("Couldn't resend", errorMessage(e));
    }
  };

  return (
    <Screen scroll keyboard>
      <View style={{ gap: space.lg, marginTop: space.huge }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft }}>
          <MailCheck size={28} color={colors.primary} />
        </View>
        <Text variant="title">Check your email</Text>
        <Text tone="muted">
          We sent a 6-digit code to <Text variant="bodyStrong">{me.data?.email ?? 'your email'}</Text>. Enter it below to confirm it's you.
        </Text>
        <Input
          label="Verification code"
          value={code}
          onChangeText={(t) => {
            const v = t.replace(/\D/g, '').slice(0, 6);
            setCode(v);
            if (v.length === 6) submit(v);
          }}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          placeholder="000000"
          error={error ?? undefined}
          style={{ fontSize: 22, letterSpacing: 8 }}
        />
        {devCode ? (
          <Text variant="caption" tone="warning">
            Development server: your code is {devCode}
          </Text>
        ) : null}
        <Button title="Verify" size="lg" onPress={() => submit()} loading={busy} disabled={code.length !== 6} fullWidth />
        <Button title={cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'} variant="ghost" onPress={resend} disabled={cooldown > 0} />
        <Button title="Use a different account" variant="ghost" onPress={() => useSession.getState().signOutLocal('user')} />
      </View>
    </Screen>
  );
}
