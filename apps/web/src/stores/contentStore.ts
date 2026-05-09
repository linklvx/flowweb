import { create } from 'zustand';
import type { ContentCard } from '@flowweb/shared';
import { apiFetch } from '@/api/client';

interface ContentState {
  cards: ContentCard[];
  loading: boolean;
  error: string | null;
  fetchCards: () => Promise<void>;
}

export const useContentStore = create<ContentState>((set) => ({
  cards: [],
  loading: false,
  error: null,
  fetchCards: async () => {
    set({ loading: true, error: null });
    try {
      const cards = await apiFetch<ContentCard[]>('/content/cards');
      set({ cards, loading: false });
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false });
    }
  },
}));
