import { View } from 'react-native';
import { Accessibility, Smartphone, Vibrate } from 'lucide-react-native';

import { useMe } from '@/api/hooks';
import { UserPhoto } from '@/components/UserPhoto';
import { Card, Header, ListGroup, ListRow, Screen, SegmentedControl, Text } from '@/components/ui';
import { usePreferences, type ThemePreference } from '@/stores/preferences';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

export default function Appearance() {
  const { colors, scheme } = useTheme();
  const me = useMe();
  const { theme, setTheme, reduceMotion, setReduceMotion, haptics, setHaptics } = usePreferences();

  return (
    <Screen scroll header={<Header title="Appearance & accessibility" />}>
      <View style={{ gap: space.xl, marginTop: space.sm }}>
        <Card style={{ gap: space.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <UserPhoto user={me.data} size={44} />
            <View style={{ flex: 1 }}>
              <Text variant="subheading">Preview</Text>
              <Text variant="caption" tone="muted">
                Currently {scheme} · accent <Text variant="caption" style={{ color: colors.primary }}>violet</Text> and{' '}
                <Text variant="caption" style={{ color: colors.accent }}>coral</Text>
              </Text>
            </View>
          </View>
          <SegmentedControl<ThemePreference>
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </Card>
        <ListGroup title="Accessibility">
          <ListRow
            icon={Accessibility}
            iconTone="primary"
            title="Reduce motion"
            subtitle="Minimise animations. Also follows your device setting."
            toggle={{ value: reduceMotion, onChange: setReduceMotion }}
          />
          <ListRow icon={Vibrate} iconTone="primary" title="Haptic feedback" subtitle="Subtle vibrations on key actions." toggle={{ value: haptics, onChange: setHaptics }} />
        </ListGroup>
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <Smartphone size={14} color={colors.textFaint} />
          <Text variant="caption" tone="faint" style={{ flex: 1 }}>
            Text size follows your device's font settings. These preferences are stored only on this device.
          </Text>
        </View>
      </View>
    </Screen>
  );
}
