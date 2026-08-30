import { create } from 'zustand';
import { apiFetch } from '@/api/client';
import type { AnnouncementInfo } from '@flowweb/shared';

interface AnnouncementState {
  announcement: AnnouncementInfo | null;
  loaded: boolean;
  fetchActive: () => Promise<void>;
  dismiss: () => void;
}

const dismissedKey = (id: string) => `announcement_dismissed_${id}`;

export const useAnnouncementStore = create<AnnouncementState>((set, get) => ({
  announcement: null,
  loaded: false,
  fetchActive: async () => {
    if (get().loaded) return;
    try {
      const data = await apiFetch<AnnouncementInfo | null>('/announcements/active');
      set({
        announcement: data && !sessionStorage.getItem(dismissedKey(data.id)) ? data : null,
        loaded: true,
      });
    } catch {
      set({ announcement: null, loaded: true });
    }
  },
  dismiss: () => {
    const { announcement } = get();
    if (announcement) sessionStorage.setItem(dismissedKey(announcement.id), '1');
    set({ announcement: null });
  },
}));
