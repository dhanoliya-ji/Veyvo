import { useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { BadgeCheck, Camera, Clock, RotateCcw, ShieldCheck } from 'lucide-react-native';

import { useMe } from '@/api/hooks';
import { useSubmitVerification, useVerification } from '@/api/photos-extra';
import { Button, Card, EmptyState, ErrorState, Header, Screen, Skeleton, Text } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

export default function Verification() {
  const { colors } = useTheme();
  const me = useMe();
  const status = useVerification();
  const submit = useSubmitVerification();
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState<'intro' | 'camera' | 'preview'>('intro');
  const [shot, setShot] = useState<string | null>(null);
  const camera = useRef<CameraView>(null);
  const v = status.data;

  const openCamera = async () => {
    const res = permission?.granted ? permission : await requestPermission();
    if (!res.granted) {
      toast.show({ title: 'Camera access is off', message: 'Enable it in your device settings to take your selfie.', tone: 'warning' });
      if (!res.canAskAgain) Linking.openSettings();
      return;
    }
    setStep('camera');
  };

  const capture = async () => {
    try {
      const pic = await camera.current?.takePictureAsync({ quality: 0.8, skipProcessing: false });
      if (pic?.uri) {
        setShot(pic.uri);
        setStep('preview');
        haptic.light();
      }
    } catch {
      toast.error("Couldn't take the photo", 'Please try again.');
    }
  };

  const send = async () => {
    if (!shot || !v) return;
    try {
      await submit.mutateAsync({ uri: shot, gesture: v.gesture });
      haptic.success();
      toast.success('Selfie sent', 'We’ll review it shortly. Your selfie is deleted after review.');
      setStep('intro');
      setShot(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'photo_required') {
        toast.show({ title: 'Add a profile photo first', message: 'We compare your selfie with it.', tone: 'warning' });
        router.replace('/photos');
        return;
      }
      toast.error("Couldn't send", errorMessage(e));
    }
  };

  if (status.isLoading) {
    return (
      <Screen header={<Header title="Get verified" />}>
        <Skeleton height={300} rounded={radius.xl} />
      </Screen>
    );
  }
  if (status.isError || !v) {
    return (
      <Screen header={<Header title="Get verified" />}>
        <ErrorState error={status.error} onRetry={() => status.refetch()} />
      </Screen>
    );
  }

  if (v.verified) {
    return (
      <Screen header={<Header title="Verification" />}>
        <EmptyState icon={BadgeCheck} title="You’re verified" message="The ✓ on your profile tells people your photos are really you." />
      </Screen>
    );
  }

  if (v.request_status === 'pending') {
    return (
      <Screen header={<Header title="Verification" />}>
        <EmptyState icon={Clock} title="In review" message="A member of our team is comparing your selfie with your profile photos. This usually takes less than a day." />
      </Screen>
    );
  }

  if (step === 'camera') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" mirror />
        <View style={styles.cameraTop}>
          <Text variant="heading" style={{ color: '#fff' }} center>
            {v.gesture_label}
          </Text>
          <Text variant="caption" style={{ color: '#ddd' }} center>
            Face the camera with good lighting
          </Text>
        </View>
        <View style={styles.cameraBottom}>
          <Button title="Cancel" variant="secondary" onPress={() => setStep('intro')} />
          <Button title="Take selfie" icon={Camera} size="lg" onPress={capture} />
        </View>
      </View>
    );
  }

  return (
    <Screen scroll header={<Header title="Get verified" />}>
      <View style={{ gap: space.xl, marginTop: space.sm }}>
        {step === 'preview' && shot ? (
          <>
            <Image source={{ uri: shot }} style={styles.preview} contentFit="cover" accessibilityLabel="Your selfie" />
            <Text tone="muted" center>
              Did you do the pose: <Text variant="bodyStrong">{v.gesture_label}</Text>?
            </Text>
            <Button title="Send for review" size="lg" onPress={send} loading={submit.isPending} fullWidth />
            <Button title="Retake" icon={RotateCcw} variant="ghost" onPress={() => setStep('camera')} />
          </>
        ) : (
          <>
            <Card style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xxl }}>
              <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
                <ShieldCheck size={32} color={colors.primary} />
              </View>
              <Text variant="title" center>
                Show it’s really you
              </Text>
              <Text tone="muted" center>
                Take one selfie doing a simple pose. We compare it with your profile photos and add a ✓ to your profile.
              </Text>
            </Card>
            {v.request_status === 'rejected' ? (
              <Card style={{ gap: 4, borderColor: colors.warning }}>
                <Text variant="bodyStrong">Last attempt wasn’t approved</Text>
                <Text variant="caption" tone="muted">
                  {v.note || 'Make sure your face is clearly visible, matches your photos, and you’re doing the pose.'}
                </Text>
              </Card>
            ) : null}
            <Card style={{ gap: space.sm }}>
              {[
                'Your selfie is private and only seen by our review team.',
                'It is deleted as soon as it has been reviewed.',
                'Verification is needed to turn on your camera with people you don’t know.',
              ].map((line) => (
                <View key={line} style={{ flexDirection: 'row', gap: space.sm }}>
                  <BadgeCheck size={16} color={colors.success} />
                  <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                    {line}
                  </Text>
                </View>
              ))}
            </Card>
            {!me.data?.photo_url ? (
              <Button title="Add a profile photo first" variant="secondary" onPress={() => router.push('/photos')} fullWidth />
            ) : (
              <Button title="Start" icon={Camera} size="lg" onPress={openCamera} fullWidth />
            )}
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  icon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  preview: { width: '100%', aspectRatio: 3 / 4, borderRadius: radius.xl },
  cameraTop: { position: 'absolute', top: 70, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.55)', padding: space.lg, borderRadius: radius.lg, gap: 4 },
  cameraBottom: { position: 'absolute', bottom: 50, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
