import { useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Camera, Clock, ImagePlus, Images, Star, Trash2 } from 'lucide-react-native';

import { pickPhoto, takePhoto, useDeletePhoto, useMyPhotos, useReorderPhotos, useUploadPhoto, type Photo } from '@/api/photos-extra';
import { Badge, Button, PressableScale, Sheet, Text, confirm } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const MAX = 6;

/** Up to 6 real photos. The first approved photo is your profile picture. */
export function PhotoGrid() {
  const { colors } = useTheme();
  const photos = useMyPhotos();
  const upload = useUploadPhoto();
  const remove = useDeletePhoto();
  const reorder = useReorderPhotos();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Photo | null>(null);
  const list = photos.data ?? [];

  const add = async (source: 'library' | 'camera') => {
    setAdding(false);
    const uri = source === 'library' ? await pickPhoto() : await takePhoto();
    if (uri === 'denied') {
      toast.show({ title: 'Camera access is off', message: 'Enable it in your device settings to take a photo.', tone: 'warning' });
      Linking.openSettings();
      return;
    }
    if (!uri) return;
    try {
      const p = await upload.mutateAsync(uri);
      haptic.success();
      if (p.status === 'pending') toast.show({ title: 'Photo uploaded', message: 'It will appear once it passes a quick safety review.' });
    } catch (e) {
      toast.error("Couldn't add that photo", errorMessage(e));
    }
  };

  const makeMain = async (p: Photo) => {
    setSelected(null);
    const ids = [p.id, ...list.filter((x) => x.id !== p.id).map((x) => x.id)];
    try {
      await reorder.mutateAsync(ids);
      haptic.success();
    } catch (e) {
      toast.error("Couldn't update", errorMessage(e));
    }
  };

  const del = async (p: Photo) => {
    setSelected(null);
    if (!(await confirm({ title: 'Delete this photo?', message: 'It is removed from Veyvo permanently.', confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await remove.mutateAsync(p.id);
    } catch (e) {
      toast.error("Couldn't delete", errorMessage(e));
    }
  };

  const slots = Array.from({ length: MAX }, (_, i) => list[i] ?? null);

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.grid}>
        {slots.map((p, i) =>
          p ? (
            <PressableScale
              key={p.id}
              onPress={() => setSelected(p)}
              style={[styles.slot, { backgroundColor: colors.surfaceAlt }]}
              accessibilityLabel={`Photo ${i + 1}${i === 0 ? ', profile picture' : ''}${p.status === 'pending' ? ', waiting for review' : ''}`}
            >
              {p.url ? <Image source={{ uri: p.url }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" /> : null}
              {i === 0 ? (
                <View style={[styles.tag, { backgroundColor: colors.primary }]}>
                  <Star size={10} color={colors.onPrimary} fill={colors.onPrimary} />
                  <Text variant="tiny" style={{ color: colors.onPrimary }}>
                    Main
                  </Text>
                </View>
              ) : null}
              {p.status === 'pending' ? (
                <View style={[styles.pending, { backgroundColor: colors.overlay }]}>
                  <Clock size={18} color="#fff" />
                  <Text variant="tiny" style={{ color: '#fff' }}>
                    In review
                  </Text>
                </View>
              ) : null}
            </PressableScale>
          ) : (
            <PressableScale
              key={`empty-${i}`}
              onPress={() => setAdding(true)}
              disabled={upload.isPending}
              style={[styles.slot, styles.empty, { borderColor: colors.borderStrong }]}
              accessibilityLabel="Add a photo"
            >
              {upload.isPending && i === list.length ? <ActivityIndicator color={colors.primary} /> : <ImagePlus size={24} color={i === list.length ? colors.primary : colors.textFaint} />}
            </PressableScale>
          ),
        )}
      </View>
      <Text variant="caption" tone="faint">
        Clear photos of you work best. Photos are checked for safety, and hidden location data is removed automatically.
      </Text>

      <Sheet visible={adding} onClose={() => setAdding(false)} title="Add a photo">
        <View style={{ gap: space.sm }}>
          <Button title="Choose from gallery" icon={Images} onPress={() => add('library')} fullWidth />
          <Button title="Take a photo" icon={Camera} variant="secondary" onPress={() => add('camera')} fullWidth />
        </View>
      </Sheet>

      <Sheet visible={!!selected} onClose={() => setSelected(null)} title="Photo">
        {selected ? (
          <View style={{ gap: space.sm }}>
            {selected.status === 'pending' ? <Badge label="Waiting for safety review" tone="warning" /> : null}
            {list[0]?.id !== selected.id ? <Button title="Make profile picture" icon={Star} onPress={() => makeMain(selected)} fullWidth /> : null}
            <Button title="Delete photo" icon={Trash2} variant="danger" onPress={() => del(selected)} fullWidth />
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  slot: { width: '31.6%', aspectRatio: 4 / 5, borderRadius: radius.lg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  empty: { borderWidth: 1.5, borderStyle: 'dashed' },
  tag: { position: 'absolute', left: 6, top: 6, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill },
  pending: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 4 },
});
