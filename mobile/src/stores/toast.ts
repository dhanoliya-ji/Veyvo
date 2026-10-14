import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';
export type Toast = { id: number; title: string; message?: string; tone: ToastTone };

type ToastState = { toasts: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void };

let nextId = 1;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.tone === 'error' ? 4500 : 3000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  show: (t: { title: string; message?: string; tone?: ToastTone }) => useToasts.getState().push({ tone: 'info', ...t }),
  success: (title: string, message?: string) => useToasts.getState().push({ title, message, tone: 'success' }),
  error: (title: string, message?: string) => useToasts.getState().push({ title, message, tone: 'error' }),
};
