import { create } from 'zustand';

interface MenuState {
  isOpen: boolean;
  position?: { x: number; y: number };
  triggerEl: HTMLButtonElement | null;
  lastMousePos: { x: number; y: number };
  setTriggerEl: (el: HTMLButtonElement | null) => void;
  updateMousePos: (pos: { x: number; y: number }) => void;
  open: (pos?: { x: number; y: number }) => void;
  close: () => void;
  toggle: () => void;
}

export const useMenuStore = create<MenuState>((set) => ({
  isOpen: false,
  position: undefined,
  triggerEl: null,
  lastMousePos: { x: 0, y: 0 },
  setTriggerEl: (el) => set({ triggerEl: el }),
  updateMousePos: (pos) => set({ lastMousePos: pos }),
  open: (pos) => set({ isOpen: true, position: pos }),
  close: () => set({ isOpen: false, position: undefined }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}));
