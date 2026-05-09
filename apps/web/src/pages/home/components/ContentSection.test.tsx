import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentSection } from './ContentSection';

// Mock contentStore
const mockFetchCards = vi.fn();

vi.mock('@/stores/contentStore', () => ({
  useContentStore: vi.fn(() => ({
    cards: [],
    loading: false,
    error: null,
    fetchCards: mockFetchCards,
  })),
}));

// Mock ContentCard to simplify — just render the title
vi.mock('./ContentCard', () => ({
  ContentCard: ({ card }: any) => <div data-testid="card">{card.title}</div>,
}));

import { useContentStore } from '@/stores/contentStore';

describe('ContentSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render section heading', () => {
    render(<ContentSection />);
    expect(screen.getByText('精选工作流模板')).toBeInTheDocument();
  });

  it('should call fetchCards on mount', () => {
    render(<ContentSection />);
    expect(mockFetchCards).toHaveBeenCalledOnce();
  });

  it('should render cards from store', () => {
    const mockCards = [
      { id: '1', title: 'Card 1', coverUrl: '/a.jpg', tags: ['推荐'], desc: 'desc1' },
      { id: '2', title: 'Card 2', coverUrl: '/b.jpg', tags: [], desc: 'desc2' },
    ];
    (useContentStore as any).mockReturnValue({
      cards: mockCards,
      loading: false,
      error: null,
      fetchCards: mockFetchCards,
    });

    render(<ContentSection />);
    expect(screen.getByText('Card 1')).toBeInTheDocument();
    expect(screen.getByText('Card 2')).toBeInTheDocument();
  });

  it('should show loading skeleton when loading', () => {
    (useContentStore as any).mockReturnValue({
      cards: [],
      loading: true,
      error: null,
      fetchCards: mockFetchCards,
    });

    const { container } = render(<ContentSection />);
    // Should have animated placeholder divs
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should show error message when error exists', () => {
    (useContentStore as any).mockReturnValue({
      cards: [],
      loading: false,
      error: '网络错误',
      fetchCards: mockFetchCards,
    });

    render(<ContentSection />);
    expect(screen.getByText('网络错误')).toBeInTheDocument();
  });
});
