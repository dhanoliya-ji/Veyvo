import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, X } from 'lucide-react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { screenPadding, space } from '@/theme/tokens';
import { IconButton } from './IconButton';
import { Text } from './Text';

type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  keyboard?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  header?: ReactNode;
  footer?: ReactNode;
  edges?: ('top' | 'bottom')[];
  contentStyle?: StyleProp<ViewStyle>;
  bottomInset?: number;
};

/** Screen container: theme background, safe areas, optional scroll, pull-to-refresh and keyboard handling. */
export function Screen({ children, scroll, padded = true, keyboard, refreshing, onRefresh, header, footer, edges = ['top', 'bottom'], contentStyle, bottomInset = 0 }: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const top = edges.includes('top') ? insets.top : 0;
  const bottom = edges.includes('bottom') ? insets.bottom : 0;
  const padding = padded ? screenPadding : 0;

  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[{ paddingHorizontal: padding, paddingBottom: bottom + space.xxxl + bottomInset }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} progressBackgroundColor={colors.surface} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, paddingHorizontal: padding, paddingBottom: footer ? 0 : bottom + bottomInset }, contentStyle]}>{children}</View>
  );

  const content = (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: top }]}>
      {header}
      {body}
      {footer ? <View style={{ paddingHorizontal: screenPadding, paddingBottom: Math.max(bottom, space.lg), paddingTop: space.md }}>{footer}</View> : null}
    </View>
  );

  if (keyboard) {
    return (
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {content}
      </KeyboardAvoidingView>
    );
  }
  return content;
}

export function Header({ title, subtitle, right, back = true, close, onBack, large }: { title?: string; subtitle?: string; right?: ReactNode; back?: boolean; close?: boolean; onBack?: () => void; large?: boolean }) {
  const goBack = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  return (
    <View style={[styles.header, large && { paddingTop: space.sm, paddingBottom: space.md }]}>
      {back || close ? <IconButton icon={close ? X : ArrowLeft} label={close ? 'Close' : 'Go back'} onPress={goBack} /> : <View style={{ width: 8 }} />}
      <View style={{ flex: 1 }}>
        {title ? (
          <Text variant={large ? 'title' : 'heading'} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, minHeight: 56 },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingRight: space.xs },
});
