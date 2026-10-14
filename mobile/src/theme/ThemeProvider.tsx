import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import * as SystemUI from 'expo-system-ui';

import { usePreferences } from '@/stores/preferences';
import { palettes, type ColorScheme, type Palette } from './tokens';

type ThemeValue = {
  scheme: ColorScheme;
  colors: Palette;
  reduceMotion: boolean;
};

const ThemeContext = createContext<ThemeValue>({ scheme: 'dark', colors: palettes.dark, reduceMotion: false });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const preference = usePreferences((s) => s.theme);
  const reduceMotionPref = usePreferences((s) => s.reduceMotion);
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setSystemReduceMotion).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystemReduceMotion);
    return () => sub.remove();
  }, []);

  const scheme: ColorScheme = preference === 'system' ? (system === 'light' ? 'light' : 'dark') : preference;
  const value = useMemo(
    () => ({ scheme, colors: palettes[scheme], reduceMotion: reduceMotionPref || systemReduceMotion }),
    [scheme, reduceMotionPref, systemReduceMotion],
  );

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(value.colors.bg).catch(() => undefined);
  }, [value.colors.bg]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
