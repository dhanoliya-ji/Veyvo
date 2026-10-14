import { forwardRef } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Moment } from '@/api/moments-extra';
import { UserPhoto, type PhotoUser } from '@/components/UserPhoto';
import { Text } from '@/components/ui';
import { radius, space } from '@/theme/tokens';

// The card is always drawn in Veyvo's dark brand colours so shared images look the same everywhere.
const INK = '#10111A';
const SURFACE = '#191B28';
const TEXT = '#F5F5FB';
const MUTED = '#A5A8BA';
const VIOLET = '#9385FF';
const CORAL = '#FF8F9A';

const ACCENT_FOR: Record<string, string> = {
  game_finished: '#6D5DF6',
  room_hangout: '#3D7BD8',
  streak_milestone: '#E8875B',
  level_up: '#2FA884',
  friend_made: '#E2607A',
};

export function momentHeadline(m: Moment): { big: string; label: string } {
  const s = m.stats ?? {};
  switch (m.kind) {
    case 'game_finished':
      return s.players > 1 ? { big: `#${s.rank}`, label: `of ${s.players} players · ${s.score ?? 0} pts` } : { big: `${s.score ?? 0}`, label: 'points' };
    case 'room_hangout':
      return { big: `${s.minutes ?? 0}`, label: s.room_kind === 'study' ? 'minutes focused' : 'minutes hanging out' };
    case 'streak_milestone':
      return { big: `${s.streak_days ?? 0}`, label: 'day streak' };
    case 'level_up':
      return { big: `${s.level ?? 1}`, label: 'level reached' };
    case 'friend_made':
      return { big: `${s.friends ?? 1}`, label: s.friends === 1 ? 'friend on Veyvo' : 'friends on Veyvo' };
    default:
      return { big: '', label: '' };
  }
}

type Props = { moment: Moment; user?: PhotoUser; name?: string; width: number };

/**
 * Shareable recap card. Shows only the owner's photo and numbers — never anyone else's name or face.
 */
export const MomentCard = forwardRef<View, Props>(function MomentCard({ moment, user, name, width }, ref) {
  const accent = ACCENT_FOR[moment.kind] ?? VIOLET;
  const head = momentHeadline(moment);
  const height = Math.round(width * 1.25);
  const date = new Date(moment.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <View ref={ref} collapsable={false} style={[styles.card, { width, height }]} accessible accessibilityLabel={`${moment.title}. ${head.big} ${head.label}.`}>
      <View style={[styles.scene, { height: height * 0.46 }]}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: accent }]} />
        <View style={[styles.glow, { width: width * 0.9, height: width * 0.9, borderRadius: width, left: -width * 0.25, top: -width * 0.35 }]} />
        <View style={[styles.glow, { width: width * 0.6, height: width * 0.6, borderRadius: width, right: -width * 0.2, bottom: -width * 0.3 }]} />
        <View style={styles.brandPill}>
          <View style={styles.logo}>
            <Text variant="label" style={{ color: INK }} maxFontSizeMultiplier={1}>
              V
            </Text>
          </View>
          <Text variant="label" style={{ color: TEXT }} maxFontSizeMultiplier={1}>
            Veyvo
          </Text>
        </View>
      </View>
      <View style={[styles.avatarRing, { top: height * 0.46 - width * 0.14 }]}>
        <UserPhoto user={user} size={width * 0.26} showVerified={false} />
      </View>
      <View style={[styles.body, { paddingTop: width * 0.15 }]}>
        <Text variant="subheading" style={{ color: MUTED }} center maxFontSizeMultiplier={1}>
          {name ? `${name} · ${date}` : date}
        </Text>
        <Text style={[styles.big, { fontSize: width * 0.2, lineHeight: width * 0.23 }]} center maxFontSizeMultiplier={1}>
          {head.big}
        </Text>
        <Text variant="bodyStrong" style={{ color: CORAL }} center maxFontSizeMultiplier={1}>
          {head.label}
        </Text>
        <Text variant="heading" style={{ color: TEXT, marginTop: space.sm }} center numberOfLines={2} maxFontSizeMultiplier={1}>
          {moment.title}
        </Text>
      </View>
      <View style={styles.footer}>
        <Text variant="caption" style={{ color: MUTED }} center maxFontSizeMultiplier={1}>
          Meet your people. Find your vibe.
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { backgroundColor: SURFACE, borderRadius: radius.xxl, overflow: 'hidden' },
  scene: { width: '100%', overflow: 'hidden' },
  glow: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.12)' },
  brandPill: { position: 'absolute', top: space.md, left: space.md, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(16,17,26,0.7)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  logo: { width: 20, height: 20, borderRadius: 6, backgroundColor: VIOLET, alignItems: 'center', justifyContent: 'center' },
  avatarRing: { position: 'absolute', alignSelf: 'center', padding: 5, borderRadius: 999, backgroundColor: SURFACE },
  body: { flex: 1, alignItems: 'center', paddingHorizontal: space.xl, gap: 2 },
  big: { fontFamily: 'Inter_800ExtraBold', color: TEXT, letterSpacing: -1 },
  footer: { paddingBottom: space.lg, paddingHorizontal: space.lg },
});
