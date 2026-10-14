import type { AvatarConfig } from '@/api/types';

// Mirrors backend/app/content/catalog.py (AVATAR_OPTIONS / COSMETICS).
export const AVATAR_OPTIONS = {
  skin: ['#FFDFC4', '#F0C8A0', '#E0AC69', '#C68642', '#A0663D', '#8D5524', '#6B3E26', '#4A2C1D'],
  hairColor: ['#1F1A17', '#4A3226', '#7B4B2A', '#B5651D', '#D9A441', '#E8D5A3', '#9E9E9E', '#E86A8E', '#7C6CF2', '#3FB4C9'],
  outfitColor: ['#9385FF', '#FF8F9A', '#43CFA0', '#FFC857', '#5AA9E6', '#2D2F45', '#F5F5FB', '#E4572E'],
  bg: ['#2A2650', '#3A2340', '#1F3B3A', '#3B3020', '#20304A', '#3A2A2A'],
  eyes: ['round', 'happy', 'sleepy', 'wink', 'sparkle'],
  brows: ['soft', 'raised', 'flat'],
  mouth: ['smile', 'grin', 'calm', 'open'],
} as const;

export const DEFAULT_AVATAR: AvatarConfig = {
  skin: '#E0AC69',
  hair: 'curlyTop',
  hairColor: '#1F1A17',
  eyes: 'round',
  brows: 'soft',
  mouth: 'smile',
  outfit: 'hoodie',
  outfitColor: '#9385FF',
  accessory: 'none',
  bg: '#2A2650',
};

export const LABELS: Record<string, string> = {
  round: 'Round',
  happy: 'Happy',
  sleepy: 'Sleepy',
  wink: 'Wink',
  sparkle: 'Sparkle',
  soft: 'Soft',
  raised: 'Raised',
  flat: 'Flat',
  smile: 'Smile',
  grin: 'Grin',
  calm: 'Calm',
  open: 'Surprised',
};

export function randomAvatar(): AvatarConfig {
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];
  return {
    skin: pick(AVATAR_OPTIONS.skin),
    hair: pick(['curlyTop', 'bob', 'short', 'long', 'bun', 'buzz', 'afro', 'braids']),
    hairColor: pick(AVATAR_OPTIONS.hairColor),
    eyes: pick(AVATAR_OPTIONS.eyes),
    brows: pick(AVATAR_OPTIONS.brows),
    mouth: pick(['smile', 'grin', 'calm']),
    outfit: pick(['tee', 'hoodie', 'collar', 'sweater']),
    outfitColor: pick(AVATAR_OPTIONS.outfitColor),
    accessory: pick(['none', 'none', 'glasses', 'headphones']),
    bg: pick(AVATAR_OPTIONS.bg),
  };
}

/** Lighten (amount > 0) or darken (amount < 0) a hex colour. */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const channel = (shift: number) => {
    const v = (num >> shift) & 0xff;
    const out = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(out)));
  };
  return `#${[channel(16), channel(8), channel(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export type Cosmetic = { key: string; slot: 'hair' | 'outfit' | 'accessory' | 'scene'; value: string; name: string; price: number; eventOnly?: boolean };

// Mirrors backend COSMETICS. The server is the authority on ownership and prices.
export const COSMETICS: Cosmetic[] = [
  { key: 'hair_curly_top', slot: 'hair', value: 'curlyTop', name: 'Curly top', price: 0 },
  { key: 'hair_bob', slot: 'hair', value: 'bob', name: 'Bob', price: 0 },
  { key: 'hair_short', slot: 'hair', value: 'short', name: 'Short', price: 0 },
  { key: 'hair_long', slot: 'hair', value: 'long', name: 'Long', price: 0 },
  { key: 'hair_bun', slot: 'hair', value: 'bun', name: 'Top bun', price: 0 },
  { key: 'hair_buzz', slot: 'hair', value: 'buzz', name: 'Buzz', price: 0 },
  { key: 'hair_afro', slot: 'hair', value: 'afro', name: 'Afro', price: 0 },
  { key: 'hair_braids', slot: 'hair', value: 'braids', name: 'Braids', price: 0 },
  { key: 'hair_spiky', slot: 'hair', value: 'spiky', name: 'Spiky', price: 60 },
  { key: 'hair_mohawk', slot: 'hair', value: 'mohawk', name: 'Mohawk', price: 90 },
  { key: 'outfit_tee', slot: 'outfit', value: 'tee', name: 'T-shirt', price: 0 },
  { key: 'outfit_hoodie', slot: 'outfit', value: 'hoodie', name: 'Hoodie', price: 0 },
  { key: 'outfit_collar', slot: 'outfit', value: 'collar', name: 'Collared shirt', price: 0 },
  { key: 'outfit_sweater', slot: 'outfit', value: 'sweater', name: 'Sweater', price: 0 },
  { key: 'outfit_jacket', slot: 'outfit', value: 'jacket', name: 'Varsity jacket', price: 80 },
  { key: 'outfit_overalls', slot: 'outfit', value: 'overalls', name: 'Overalls', price: 70 },
  { key: 'outfit_star', slot: 'outfit', value: 'star', name: 'Star tee', price: 120 },
  { key: 'acc_none', slot: 'accessory', value: 'none', name: 'None', price: 0 },
  { key: 'acc_glasses', slot: 'accessory', value: 'glasses', name: 'Round glasses', price: 0 },
  { key: 'acc_headphones', slot: 'accessory', value: 'headphones', name: 'Headphones', price: 0 },
  { key: 'acc_cap', slot: 'accessory', value: 'cap', name: 'Cap', price: 40 },
  { key: 'acc_beanie', slot: 'accessory', value: 'beanie', name: 'Beanie', price: 50 },
  { key: 'acc_sunglasses', slot: 'accessory', value: 'sunglasses', name: 'Sunglasses', price: 60 },
  { key: 'acc_flower', slot: 'accessory', value: 'flower', name: 'Flower clip', price: 50 },
  { key: 'acc_crown', slot: 'accessory', value: 'crown', name: 'Tiny crown', price: 200 },
  { key: 'acc_scarf', slot: 'accessory', value: 'scarf', name: 'Cozy scarf', price: 0, eventOnly: true },
  { key: 'scene_beach', slot: 'scene', value: 'beach', name: 'Beach at dusk', price: 150 },
  { key: 'scene_space', slot: 'scene', value: 'space', name: 'Space station', price: 250 },
];
