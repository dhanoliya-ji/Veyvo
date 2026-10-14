import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';

import { del, get, post, put, uploadImage } from '@/lib/api';
import { qk } from './hooks';
import type { UserSummary } from './types';

export type Photo = { id: string; url: string | null; position: number; status: 'pending' | 'approved' | 'rejected'; width: number; height: number; created_at: string };

export type VerificationStatus = {
  verified: boolean;
  verified_at: string | null;
  request_status: 'pending' | 'approved' | 'rejected' | null;
  note: string | null;
  gesture: string;
  gesture_label: string;
};

export type PendingVerification = { id: string; user: UserSummary; gesture: string; selfie_url: string | null; photos: Photo[]; created_at: string };
export type PendingPhoto = Photo & { user: UserSummary; moderation: Record<string, unknown> };

export const photoKeys = {
  mine: ['my-photos'] as const,
  user: (id: string) => ['user-photos', id] as const,
  verification: ['verification'] as const,
  modVerifications: ['mod-verifications'] as const,
  modPhotos: ['mod-photos'] as const,
};

export const useMyPhotos = () => useQuery({ queryKey: photoKeys.mine, queryFn: () => get<Photo[]>('/me/photos') });

function useInvalidatePhotos() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: photoKeys.mine });
    qc.invalidateQueries({ queryKey: qk.me });
    qc.invalidateQueries({ queryKey: ['profile'] });
  };
}

export function useUploadPhoto() {
  const done = useInvalidatePhotos();
  return useMutation({ mutationFn: (uri: string) => uploadImage<Photo>('/me/photos', uri), onSuccess: done });
}

export function useDeletePhoto() {
  const done = useInvalidatePhotos();
  return useMutation({ mutationFn: (id: string) => del(`/me/photos/${id}`), onSuccess: done });
}

export function useReorderPhotos() {
  const done = useInvalidatePhotos();
  return useMutation({ mutationFn: (ids: string[]) => put<Photo[]>('/me/photos/order', { ids }), onSuccess: done });
}

export const useVerification = () => useQuery({ queryKey: photoKeys.verification, queryFn: () => get<VerificationStatus>('/me/verification') });

export function useSubmitVerification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ uri, gesture }: { uri: string; gesture: string }) => uploadImage<VerificationStatus>('/me/verification', uri, { gesture }),
    onSuccess: () => qc.invalidateQueries({ queryKey: photoKeys.verification }),
  });
}

export const useModVerifications = () => useQuery({ queryKey: photoKeys.modVerifications, queryFn: () => get<PendingVerification[]>('/moderation/verifications') });
export const useModPhotos = () => useQuery({ queryKey: photoKeys.modPhotos, queryFn: () => get<PendingPhoto[]>('/moderation/photos') });

export function useReview(kind: 'verifications' | 'photos') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'approve' | 'reject'; note?: string }) => post(`/moderation/${kind}/${id}`, { decision, note: note ?? '' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: kind === 'photos' ? photoKeys.modPhotos : photoKeys.modVerifications }),
  });
}

/** Pick a photo from the gallery (system photo picker — no broad storage permission needed). */
export async function pickPhoto(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [4, 5], quality: 0.85, exif: false });
  return result.canceled ? null : (result.assets[0]?.uri ?? null);
}

/** Take a photo with the camera (asks for camera permission first). */
export async function takePhoto(): Promise<string | null | 'denied'> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return 'denied';
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [4, 5], quality: 0.85, exif: false, cameraType: ImagePicker.CameraType.front });
  return result.canceled ? null : (result.assets[0]?.uri ?? null);
}
