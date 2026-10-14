import { View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

/** Entry route. The AuthGate in the root layout redirects to the right place. */
export default function Index() {
  const { colors } = useTheme();
  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}
