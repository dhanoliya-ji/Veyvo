import { useState } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { BadgeCheck, Flag } from 'lucide-react-native';

import type { Photo } from '@/api/photos-extra';
import { openReport } from '@/components/safety/ReportSheet';
import { IconButton, PressableScale, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, space } from '@/theme/tokens';

type Props = { photos: Photo[]; name: string; verified?: boolean; ownerId: string; canReport: boolean };

/** Swipeable photo gallery for a profile, with a report option on every photo. */
export function PhotoGallery({ photos, name, verified, ownerId, canReport }: Props) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const w = width - screenPadding * 2;
  const [index, setIndex] = useState(0);

  const report = (p: Photo) => openReport({ targetType: 'photo', targetId: p.id, subject: `${name}'s photo`, blockUserId: ownerId });

  return (
    <View style={{ width: w, alignSelf: 'center' }}>
      <FlatList
        data={photos}
        keyExtractor={(p) => p.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / w))}
        renderItem={({ item, index: i }) => (
          <PressableScale
            scaleTo={1}
            onLongPress={canReport ? () => report(item) : undefined}
            accessibilityLabel={`${name}, photo ${i + 1} of ${photos.length}`}
            accessibilityHint={canReport ? 'Long press to report this photo' : undefined}
            style={{ width: w, aspectRatio: 4 / 5, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}
          >
            {item.url ? <Image source={{ uri: item.url }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={150} /> : null}
          </PressableScale>
        )}
      />
      {photos.length > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {photos.map((p, i) => (
            <View key={p.id} style={[styles.dot, { backgroundColor: i === index ? '#fff' : 'rgba(255,255,255,0.45)', width: i === index ? 18 : 6 }]} />
          ))}
        </View>
      ) : null}
      {verified ? (
        <View style={[styles.verified, { backgroundColor: 'rgba(16,17,26,0.7)' }]}>
          <BadgeCheck size={14} color="#fff" />
          <Text variant="tiny" style={{ color: '#fff' }}>
            Verified
          </Text>
        </View>
      ) : null}
      {canReport && photos[index] ? (
        <IconButton icon={Flag} label="Report this photo" size={36} variant="filled" onPress={() => report(photos[index])} style={styles.flag} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { position: 'absolute', top: space.md, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  dot: { height: 6, borderRadius: 3 },
  verified: { position: 'absolute', left: space.md, bottom: space.md, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  flag: { position: 'absolute', right: space.md, bottom: space.md, opacity: 0.85 },
});
