import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useContentStore } from './contentStore';

// Mock the API client
vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '@/api/client';
const mockApiFetch = vi.mocked(apiFetch);

describe('contentStore', () => {
  beforeEach(() => {
    useContentStore.setState({ cards: [], loading: false, error: null });
    vi.clearAllMocks();
  });

  it('should initialize with empty state', () => {
    const state = useContentStore.getState();
    expect(state.cards).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('should fetch cards and update state', async () => {
    const mockCards = [
      { id: '1', title: 'Test', coverUrl: 'url', tags: ['推荐'], desc: 'desc' },
    ];
    mockApiFetch.mockResolvedValue(mockCards);

    await useContentStore.getState().fetchCards();

    const state = useContentStore.getState();
    expect(state.cards).toEqual(mockCards);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('should set loading true during fetch', async () => {
    mockApiFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    useContentStore.getState().fetchCards();
    expect(useContentStore.getState().loading).toBe(true);
  });

  it('should set error on fetch failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));

    await useContentStore.getState().fetchCards();

    const state = useContentStore.getState();
    expect(state.error).toBe('Network error');
    expect(state.loading).toBe(false);
  });
});
