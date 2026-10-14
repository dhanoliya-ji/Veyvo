import type { TextStyle } from 'react-native';

export type ColorScheme = 'light' | 'dark';

export type Palette = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  surfaceRaised: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  onPrimary: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  overlay: string;
  skeleton: string;
  tabBar: string;
  shadow: string;
  gold: string;
};

const dark: Palette = {
  bg: '#10111A',
  surface: '#191B28',
  surfaceAlt: '#222438',
  surfaceRaised: '#262940',
  border: '#272A3D',
  borderStrong: '#363A54',
  text: '#F5F5FB',
  textMuted: '#A5A8BA',
  textFaint: '#6F7289',
  primary: '#9385FF',
  primaryPressed: '#7D6EF2',
  primarySoft: 'rgba(147,133,255,0.16)',
  onPrimary: '#14122B',
  accent: '#FF8F9A',
  accentSoft: 'rgba(255,143,154,0.15)',
  onAccent: '#2A1015',
  success: '#43CFA0',
  successSoft: 'rgba(67,207,160,0.15)',
  warning: '#FFC857',
  warningSoft: 'rgba(255,200,87,0.15)',
  danger: '#FF6B7A',
  dangerSoft: 'rgba(255,107,122,0.15)',
  overlay: 'rgba(6,7,12,0.72)',
  skeleton: '#232538',
  tabBar: '#171927',
  shadow: '#000000',
  gold: '#FFC857',
};

// Light theme is tuned separately (not inverted): deeper accents keep AA contrast on white.
const light: Palette = {
  bg: '#F6F5FB',
  surface: '#FFFFFF',
  surfaceAlt: '#EFEDF8',
  surfaceRaised: '#FFFFFF',
  border: '#E4E2EE',
  borderStrong: '#D2CFE2',
  text: '#171826',
  textMuted: '#5C5F73',
  textFaint: '#8D90A3',
  primary: '#5B4BE0',
  primaryPressed: '#4C3CD0',
  primarySoft: 'rgba(91,75,224,0.10)',
  onPrimary: '#FFFFFF',
  accent: '#D9485A',
  accentSoft: 'rgba(217,72,90,0.10)',
  onAccent: '#FFFFFF',
  success: '#17946B',
  successSoft: 'rgba(23,148,107,0.10)',
  warning: '#B7791F',
  warningSoft: 'rgba(183,121,31,0.12)',
  danger: '#D33A4C',
  dangerSoft: 'rgba(211,58,76,0.10)',
  overlay: 'rgba(16,17,26,0.45)',
  skeleton: '#ECEAF4',
  tabBar: '#FFFFFF',
  shadow: '#2B2556',
  gold: '#C98A12',
};

export const palettes: Record<ColorScheme, Palette> = { dark, light };

// 4-point spacing grid.
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  pill: 999,
} as const;

export const screenPadding = 20;
export const touchTarget = 44;

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
};

export type TypeVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'bodyStrong'
  | 'label'
  | 'caption'
  | 'tiny'
  | 'button';

export const type: Record<TypeVariant, TextStyle> = {
  display: { fontFamily: fonts.extrabold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  title: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  heading: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, letterSpacing: -0.2 },
  subheading: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  tiny: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 0.3 },
  button: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
};

export const motion = {
  fast: 140,
  base: 220,
  slow: 360,
  spring: { damping: 18, stiffness: 220, mass: 0.9 },
} as const;
