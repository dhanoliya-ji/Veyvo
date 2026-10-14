import { forwardRef, useState, type ComponentType } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Eye, EyeOff, type LucideProps } from 'lucide-react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { fonts, radius, space } from '@/theme/tokens';
import { Text } from './Text';

export type InputProps = TextInputProps & {
  label?: string;
  error?: string;
  hint?: string;
  icon?: ComponentType<LucideProps>;
  secure?: boolean;
  counter?: boolean;
};

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, hint, icon: Icon, secure, counter, style, multiline, maxLength, value, onFocus, onBlur, ...rest },
  ref,
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const borderColor = error ? colors.danger : focused ? colors.primary : colors.border;

  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="label" tone="muted" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          { borderColor, backgroundColor: colors.surface, minHeight: multiline ? 96 : 50, alignItems: multiline ? 'flex-start' : 'center' },
        ]}
      >
        {Icon ? <Icon size={18} color={focused ? colors.primary : colors.textFaint} style={{ marginTop: multiline ? 14 : 0 }} /> : null}
        <TextInput
          ref={ref}
          value={value}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.primary}
          secureTextEntry={secure && hidden}
          multiline={multiline}
          maxLength={maxLength}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            styles.input,
            { color: colors.text, fontFamily: fonts.regular, paddingTop: multiline ? 13 : 0, textAlignVertical: multiline ? 'top' : 'center' },
            style,
          ]}
          {...rest}
        />
        {secure ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
          >
            {hidden ? <Eye size={18} color={colors.textMuted} /> : <EyeOff size={18} color={colors.textMuted} />}
          </Pressable>
        ) : null}
      </View>
      {error || hint || (counter && maxLength) ? (
        <View style={styles.footer}>
          <Text variant="caption" tone={error ? 'danger' : 'faint'} style={{ flex: 1 }} accessibilityLiveRegion={error ? 'polite' : 'none'}>
            {error ?? hint ?? ''}
          </Text>
          {counter && maxLength ? (
            <Text variant="caption" tone="faint">
              {(value ?? '').length}/{maxLength}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  label: { marginLeft: 2 },
  field: { flexDirection: 'row', gap: space.sm, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.md },
  input: { flex: 1, fontSize: 16, minHeight: 46, paddingVertical: 10 },
  footer: { flexDirection: 'row', gap: space.sm, marginHorizontal: 2 },
});
