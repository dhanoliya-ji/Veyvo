import { View } from 'react-native';
import { router } from 'expo-router';
import { BadgeCheck, ChevronRight } from 'lucide-react-native';

import { useVerification } from '@/api/photos-extra';
import { PhotoGrid } from '@/components/photos/PhotoGrid';
import { Card, Header, Screen, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

export default function MyPhotos() {
  const { colors } = useTheme();
  const verification = useVerification();
  const v = verification.data;

  return (
    <Screen scroll header={<Header title="Your photos" subtitle="Up to 6 · the first is your profile picture" />}>
      <View style={{ gap: space.xl, marginTop: space.sm }}>
        <PhotoGrid />
        <Card onPress={() => router.push('/verification')} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }} accessibilityLabel="Selfie verification">
          <BadgeCheck size={26} color={v?.verified ? colors.primary : colors.textMuted} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">{v?.verified ? 'You’re verified' : v?.request_status === 'pending' ? 'Verification in review' : 'Get verified'}</Text>
            <Text variant="caption" tone="muted">
              {v?.verified ? 'People can see the ✓ on your profile.' : 'A quick selfie proves your photos are really you. Needed to use your camera with people you don’t know.'}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.textFaint} />
        </Card>
      </View>
    </Screen>
  );
}
