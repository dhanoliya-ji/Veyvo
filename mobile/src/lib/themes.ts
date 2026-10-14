/**
 * Game themes (bought with gems in the shop, applied via PUT /me/game-theme).
 * Mirrors backend COSMETICS (slots chess_board, card_back, ludo_board). Boards read the
 * player's choice from `useMe().data.game_theme` and fall back to the defaults.
 */

export type ChessTheme = { light: string; dark: string; frame: string; highlight: string; lastMove: string };
export type CardBackTheme = { base: string; pattern: string; border: string };
export type LudoTheme = { red: string; green: string; yellow: string; blue: string; track: string; board: string; star: string };

export const CHESS_THEMES: Record<string, ChessTheme> = {
  classic: { light: '#EEEED2', dark: '#769656', frame: '#4B5D3A', highlight: '#F6F669', lastMove: 'rgba(246,246,105,0.55)' },
  walnut: { light: '#F0D9B5', dark: '#B58863', frame: '#6B4A2F', highlight: '#F7EC74', lastMove: 'rgba(247,236,116,0.5)' },
  marble: { light: '#EDEDED', dark: '#9E9E9E', frame: '#5C5C5C', highlight: '#9EC5FE', lastMove: 'rgba(158,197,254,0.55)' },
  ocean: { light: '#DEE9F1', dark: '#4A7CA3', frame: '#2C4B63', highlight: '#FFE08A', lastMove: 'rgba(255,224,138,0.55)' },
  midnight: { light: '#5F6A8A', dark: '#2B3049', frame: '#151827', highlight: '#9385FF', lastMove: 'rgba(147,133,255,0.5)' },
};

export const CARD_BACKS: Record<string, CardBackTheme> = {
  navy: { base: '#1E2A55', pattern: '#2F3F7A', border: '#FFFFFF' },
  crimson: { base: '#8E1B2C', pattern: '#B32A40', border: '#FFFFFF' },
  emerald: { base: '#0E5E46', pattern: '#178060', border: '#FFFFFF' },
  gold: { base: '#2B2210', pattern: '#C9A24A', border: '#E9C46A' },
  cozy: { base: '#7A3E2A', pattern: '#E8875B', border: '#F5E6D3' },
};

export const LUDO_THEMES: Record<string, LudoTheme> = {
  classic: { red: '#E53935', green: '#43A047', yellow: '#FDD835', blue: '#1E88E5', track: '#FFFFFF', board: '#F4F1EA', star: '#9E9E9E' },
  pastel: { red: '#F28B82', green: '#81C995', yellow: '#FDD663', blue: '#8AB4F8', track: '#FFFFFF', board: '#FBF8F3', star: '#C0B9AD' },
  royal: { red: '#B71C1C', green: '#1B5E20', yellow: '#F9A825', blue: '#0D47A1', track: '#FFF8E1', board: '#2B2140', star: '#D4AF37' },
};

export const DEFAULT_THEME = { chess_board: 'classic', card_back: 'navy', ludo_board: 'classic' } as const;

export function themeFor(gameTheme: Record<string, string> | undefined | null) {
  const t = { ...DEFAULT_THEME, ...(gameTheme ?? {}) };
  return {
    chess: CHESS_THEMES[t.chess_board] ?? CHESS_THEMES.classic,
    cardBack: CARD_BACKS[t.card_back] ?? CARD_BACKS.navy,
    ludo: LUDO_THEMES[t.ludo_board] ?? LUDO_THEMES.classic,
  };
}
