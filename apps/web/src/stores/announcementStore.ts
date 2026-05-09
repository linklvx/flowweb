import { create } from 'zustand';

interface AnnouncementState {
  visible: boolean;
  message: string;
  linkUrl?: string;
  dismiss: () => void;
}

export const useAnnouncementStore = create<AnnouncementState>((set) => ({
  visible: false,
  message: '',
  linkUrl: undefined,
  dismiss: () => set({ visible: false }),
}));
