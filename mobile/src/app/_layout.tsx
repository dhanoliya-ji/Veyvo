import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider, focusManager } from '@tanstack/react-query';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, useFonts } from '@expo-google-fonts/inter';

import { useMe } from '@/api/hooks';
import { ErrorBoundary, restartToHome } from '@/components/ErrorBoundary';
import { IncomingCall } from '@/components/IncomingCall';
import { MatchModalHost } from '@/components/discover/MatchModal';
import { GameInviteBanner } from '@/components/games/GameInviteBanner';
import { PresenceNudges } from '@/components/presence/PresenceNudge';
import { AccountBlockedOverlay } from '@/components/safety/AccountBlockedOverlay';
import { ReportHost } from '@/components/safety/ReportSheet';
import { ConfirmHost, OfflineBanner, Toaster } from '@/components/ui';
import { useDiscoverRealtime } from '@/hooks/useDiscoverRealtime';
import { useGameInvites } from '@/hooks/useGameInvites';
import { usePresenceRealtime } from '@/hooks/usePresenceRealtime';
import { useNotificationRouting } from '@/hooks/usePushNotifications';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { useSquadsRealtime } from '@/hooks/useSquadsRealtime';
import { installCrashReporting, setCrashRoute } from '@/lib/crash';
import { queryClient } from '@/lib/queryClient';
import { startNetworkMonitoring } from '@/stores/network';
import { usePreferences, usePreferencesHydrated } from '@/stores/preferences';
import { useSession } from '@/stores/session';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

installCrashReporting();
SplashScreen.preventAutoHideAsync().catch(() => undefined);
startNetworkMonitoring();

// Refetch stale data when the app returns to the foreground.
AppState.addEventListener('change', (status) => {
  if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
});

function AuthGate() {
  const status = useSession((s) => s.status);
  const segments = useSegments();
  const me = useMe(status === 'signedIn');
  const ready = status === 'signedOut' || (status === 'signedIn' && (me.data || me.isError));
  const tourSeen = usePreferences((s) => s.tourSeen);
  const prefsHydrated = usePreferencesHydrated();
  const tourOpened = useRef(false);

  // Crash reports include the screen pattern (e.g. "room/[id]"), never real ids.
  useEffect(() => {
    setCrashRoute(segments.join('/') || null);
  }, [segments]);

  // First-time welcome tour: once per device, only after sign-in, email verification and onboarding.
  useEffect(() => {
    if (status !== 'signedIn' || !me.data?.email_verified || !me.data.onboarded) return;
    if (!prefsHydrated || tourSeen || tourOpened.current) return;
    if (segments[0] !== '(tabs)') return; // wait until we've landed in the app (not on a deep-linked screen)
    tourOpened.current = true;
    router.push('/tour');
  }, [status, me.data, prefsHydrated, tourSeen, segments]);

  useEffect(() => {
    if (status === 'loading') return;
    const group = segments[0];
    const inAuth = group === '(auth)';
    const inOnboarding = group === '(onboarding)';

    if (status === 'signedOut') {
      if (!inAuth) router.replace('/welcome');
      return;
    }
    if (!me.data) return;
    if (!me.data.email_verified) {
      if (segments.join('/') !== '(auth)/verify') router.replace('/verify');
    } else if (!me.data.onboarded) {
      if (!inOnboarding) router.replace('/setup');
    } else if (inAuth || inOnboarding || !group) {
      router.replace('/home');
    }
  }, [status, me.data, segments]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  useRealtimeSync(status === 'signedIn' && !!me.data?.onboarded);
  useNotificationRouting(status === 'signedIn' && !!me.data?.onboarded);
  usePresenceRealtime(status === 'signedIn' && !!me.data?.onboarded);
  useDiscoverRealtime(status === 'signedIn' && !!me.data?.onboarded);
  useSquadsRealtime(status === 'signedIn' && !!me.data?.onboarded);
  useGameInvites(status === 'signedIn' && !!me.data?.onboarded);
  return null;
}

function Shell() {
  const { colors, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}
        // Each screen gets its own error boundary: a crash shows a friendly screen and Restart goes Home.
        screenLayout={({ children }) => <ErrorBoundary onRestart={() => restartToHome()}>{children}</ErrorBoundary>}
      >
        <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
        <Stack.Screen name="(onboarding)" options={{ animation: 'fade' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="room/[id]" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
        <Stack.Screen name="room/create" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="game/[id]" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
        <Stack.Screen name="tour" options={{ presentation: 'fullScreenModal', animation: 'fade_from_bottom', gestureEnabled: false }} />
      </Stack>
      <AuthGate />
      <OfflineBanner />
      <Toaster />
      <ConfirmHost />
      <ReportHost />
      <AccountBlockedOverlay />
      <IncomingCall />
      <PresenceNudges />
      <MatchModalHost />
      <GameInviteBanner />
    </>
  );
}

export default function RootLayout() {
  const hydrate = useSession((s) => s.hydrate);
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (!fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            {/* Last-resort boundary for anything outside a screen (banners, sheets, overlays). */}
            <ErrorBoundary onRestart={() => restartToHome(50)}>
              <Shell />
            </ErrorBoundary>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

