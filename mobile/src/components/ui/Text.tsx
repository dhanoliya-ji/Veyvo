import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { type, type TypeVariant } from '@/theme/tokens';

export type TextTone = 'default' | 'muted' | 'faint' | 'primary' | 'accent' | 'success' | 'danger' | 'warning' | 'onPrimary' | 'onAccent';

export type TextProps = RNTextProps & {
  variant?: TypeVariant;
  tone?: TextTone;
  center?: boolean;
};

export function Text({ variant = 'body', tone = 'default', center, style, maxFontSizeMultiplier = 1.6, ...rest }: TextProps) {
  const { colors } = useTheme();
  const color = {
    default: colors.text,
    muted: colors.textMuted,
    faint: colors.textFaint,
    primary: colors.primary,
    accent: colors.accent,
    success: colors.success,
    danger: colors.danger,
    warning: colors.warning,
    onPrimary: colors.onPrimary,
    onAccent: colors.onAccent,
  }[tone];
  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[type[variant], { color }, center && { textAlign: 'center' }, style]}
      {...rest}
    />
  );
}
