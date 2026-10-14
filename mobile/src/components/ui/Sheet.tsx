import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space } from '@/theme/tokens';
import { Button } from './Button';
import { Text } from './Text';

type SheetProps = { visible: boolean; onClose: () => void; title?: string; children: ReactNode; scroll?: boolean };

/** Bottom sheet built on Modal so it overlays tabs and respects the Android back button. */
export function Sheet({ visible, onClose, title, children, scroll }: SheetProps) {
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, { duration: reduceMotion ? 0 : 260, easing: Easing.out(Easing.cubic) });
    } else if (mounted) {
      progress.value = withTiming(0, { duration: reduceMotion ? 0 : 200 }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
  }, [visible, mounted, progress, reduceMotion]);

  const backdrop = useAnimatedStyle(() => ({ opacity: progress.value }));
  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * 420 }] }));

  if (!mounted) return null;
  const Body = scroll ? ScrollView : View;
  return (
    <Modal transparent visible statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }, backdrop]}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        </Animated.View>
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View
            accessibilityViewIsModal
            style={[styles.panel, { backgroundColor: colors.surface, paddingBottom: insets.bottom + space.lg, maxHeight: '88%' }, panel]}
          >
            <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />
            {title ? (
              <Text variant="heading" style={{ marginBottom: space.md }} accessibilityRole="header">
                {title}
              </Text>
            ) : null}
            <Body keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {children}
            </Body>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------- Themed confirmation dialog (imperative API) ----------
type ConfirmOptions = { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean };
type ConfirmState = { options: ConfirmOptions | null; resolve: ((v: boolean) => void) | null; open: (o: ConfirmOptions) => Promise<boolean>; close: (v: boolean) => void };

const useConfirmStore = create<ConfirmState>((set, get) => ({
  options: null,
  resolve: null,
  open: (options) => new Promise<boolean>((resolve) => set({ options, resolve })),
  close: (value) => {
    get().resolve?.(value);
    set({ options: null, resolve: null });
  },
}));

export const confirm = (options: ConfirmOptions) => useConfirmStore.getState().open(options);

export function ConfirmHost() {
  const { options, close } = useConfirmStore();
  return (
    <Sheet visible={!!options} onClose={() => close(false)} title={options?.title}>
      {options?.message ? (
        <Text tone="muted" style={{ marginBottom: space.xl }}>
          {options.message}
        </Text>
      ) : null}
      <View style={{ gap: space.sm }}>
        <Button title={options?.confirmLabel ?? 'Confirm'} variant={options?.destructive ? 'danger' : 'primary'} onPress={() => close(true)} fullWidth />
        <Button title={options?.cancelLabel ?? 'Cancel'} variant="secondary" onPress={() => close(false)} fullWidth />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  panel: { borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, paddingHorizontal: screenPadding, paddingTop: space.sm },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: space.lg },
});
