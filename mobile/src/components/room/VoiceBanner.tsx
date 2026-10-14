import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { CloudOff, Info, MicOff, RefreshCw, Settings, Smartphone, WifiOff } from 'lucide-react-native';

import { Button, Text } from '@/components/ui';
import { VOICE_COPY, type VoiceControls } from '@/lib/voice';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

type Props = { voice: VoiceControls; serverHasVoice: boolean; realtimeStatus: string; online: boolean };

/** One line that explains the room's connection state. Hidden when everything is fine. */
export function ConnectionBanner({ voice, serverHasVoice, realtimeStatus, online }: Props) {
  const { colors } = useTheme();

  let icon = Info;
  let tone: 'info' | 'warn' | 'error' = 'info';
  let text: string | null = null;
  let spinner = false;
  let action: { label: string; onPress: () => void; icon: typeof Info } | null = null;

  if (!online) {
    icon = WifiOff;
    tone = 'warn';
    text = "You're offline. We'll reconnect you automatically.";
  } else if (realtimeStatus === 'reconnecting' || realtimeStatus === 'connecting') {
    tone = 'warn';
    spinner = true;
    text = 'Reconnecting to the room...';
  } else if (voice.micBlocked) {
    icon = MicOff;
    tone = 'warn';
    text = VOICE_COPY.micBlocked;
    action = { label: 'Open settings', onPress: voice.openSettings, icon: Settings };
  } else if (!serverHasVoice) {
    icon = CloudOff;
    text = VOICE_COPY.unavailable;
  } else {
    switch (voice.state) {
      case 'connecting':
        spinner = true;
        text = 'Connecting to voice...';
        break;
      case 'reconnecting':
        spinner = true;
        tone = 'warn';
        text = 'Voice reconnecting...';
        break;
      case 'unsupported':
        icon = Smartphone;
        text = VOICE_COPY.unsupported;
        break;
      case 'unavailable':
        icon = CloudOff;
        text = voice.error ?? VOICE_COPY.unavailable;
        break;
      case 'failed':
        icon = CloudOff;
        tone = 'error';
        text = voice.error ?? VOICE_COPY.failed;
        action = { label: 'Retry', onPress: voice.retry, icon: RefreshCw };
        break;
      case 'disconnected':
        if (voice.error) {
          icon = CloudOff;
          tone = 'warn';
          text = voice.error;
          action = { label: 'Reconnect', onPress: voice.retry, icon: RefreshCw };
        }
        break;
      default:
        if (voice.error) {
          tone = 'warn';
          text = voice.error;
        }
    }
  }

  if (!text) return null;
  const tint = tone === 'error' ? colors.danger : tone === 'warn' ? colors.warning : colors.textMuted;
  const bg = tone === 'error' ? colors.dangerSoft : tone === 'warn' ? colors.warningSoft : colors.surfaceAlt;
  const Icon = icon;
  return (
    <View style={[styles.banner, { backgroundColor: bg }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      {spinner ? <ActivityIndicator size="small" color={tint} /> : <Icon size={16} color={tint} />}
      <Text variant="caption" style={{ flex: 1, color: tone === 'info' ? colors.textMuted : colors.text }}>
        {text}
      </Text>
      {action ? <Button title={action.label} icon={action.icon} size="sm" variant="secondary" onPress={action.onPress} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, minHeight: 44 },
});
