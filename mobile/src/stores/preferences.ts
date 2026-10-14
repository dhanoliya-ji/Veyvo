import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemePreference = 'system' | 'light' | 'dark';

type Preferences = {
  theme: ThemePreference;
  reduceMotion: boolean;
  haptics: boolean;
  recentSearches: string[];
  setTheme: (theme: ThemePreference) => void;
  setReduceMotion: (value: boolean) => void;
  setHaptics: (value: boolean) => void;
  addRecentSearch: (q: string) => void;
  clearRecentSearches: () => void;
};

/** Device-local UI preferences. Nothing here is sent to the server. */
export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      theme: 'system',
      reduceMotion: false,
      haptics: true,
      recentSearches: [],
      setTheme: (theme) => set({ theme }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setHaptics: (haptics) => set({ haptics }),
      addRecentSearch: (q) =>
        set((s) => ({ recentSearches: [q, ...s.recentSearches.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8) })),
      clearRecentSearches: () => set({ recentSearches: [] }),
    }),
    {
      name: 'veyvo-preferences',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ theme: s.theme, reduceMotion: s.reduceMotion, haptics: s.haptics, recentSearches: s.recentSearches }),
    },
  ),
);
