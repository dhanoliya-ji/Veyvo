import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { BadgeCheck } from 'lucide-react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

export type PhotoUser = { photo_url?: string | null; display_name?: string | null; verified?: boolean | null } | null | undefined;

type Props = {
  user: PhotoUser;
  size?: number;
  online?: boolean | null;
  /** Green ring while this person is speaking (only from real audio events). */
  speaking?: boolean;
  showVerified?: boolean;
  label?: string;
};

const TINTS = ['#9385FF', '#FF8F9A', '#43CFA0', '#FFC857', '#5AA9E6', '#E8875B'];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** A person's real profile photo, or their initials until they add one. */
export const UserPhoto = memo(function UserPhoto({ user, size = 48, online, speaking, showVerified = true, label }: Props) {
  const { colors } = useTheme();
  const name = user?.display_name || '?';
  const tint = TINTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];
  const ring = speaking ? 3 : 0;

  return (
    <View
      style={{ width: size, height: size }}
      accessible={!!label}
      accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label}
    >
      <View style={[StyleSheet.absoluteFill, { borderRadius: size, borderWidth: ring, borderColor: colors.success, padding: ring ? 2 : 0 }]}>
        {user?.photo_url ? (
          <Image
            source={{ uri: user.photo_url }}
            style={{ flex: 1, borderRadius: size }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
            recyclingKey={user.photo_url}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={{ flex: 1, borderRadius: size, backgroundColor: `${tint}33`, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: tint, fontFamily: 'Inter_700Bold', fontSize: size * 0.36 }} maxFontSizeMultiplier={1}>
              {initials(name)}
            </Text>
          </View>
        )}
      </View>
      {showVerified && user?.verified && size >= 36 ? (
        <View style={[styles.badge, { backgroundColor: colors.bg, right: -2, top: -2 }]} accessibilityLabel="Verified">
          <BadgeCheck size={Math.max(14, size * 0.26)} color={colors.primary} fill={colors.primarySoft} />
        </View>
      ) : null}
      {online ? (
        <View
          style={[styles.dot, { width: Math.max(10, size * 0.24), height: Math.max(10, size * 0.24), borderRadius: size, backgroundColor: colors.success, borderColor: colors.bg }]}
          accessibilityLabel="Online"
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  dot: { position: 'absolute', right: 0, bottom: 0, borderWidth: 2 },
  badge: { position: 'absolute', borderRadius: 999, padding: 1 },
});
