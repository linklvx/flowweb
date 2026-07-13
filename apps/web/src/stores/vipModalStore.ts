import { create } from 'zustand';

interface VipModalState {
  visible: boolean;
  open: () => void;
  close: () => void;
}

export const useVipModalStore = create<VipModalState>((set) => ({
  visible: false,
  open: () => set({ visible: true }),
  close: () => set({ visible: false }),
}));
