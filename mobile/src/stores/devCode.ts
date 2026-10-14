import { create } from 'zustand';

/**
 * Development only: the backend returns one-time codes in API responses when APP_ENV=development
 * (no email provider configured). Production servers never send this.
 */
export const useDevCode = create<{ code: string | null; set: (code: string | null | undefined) => void }>((set) => ({
  code: null,
  set: (code) => set({ code: code ?? null }),
}));
