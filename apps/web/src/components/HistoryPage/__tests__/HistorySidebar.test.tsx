import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistorySidebar } from '../HistorySidebar';

// Mock historyStore
const mockSetActiveTab = vi.fn();
vi.mock('@/stores/historyStore', () => ({
  useHistoryStore: (selector: any) =>
    selector({
      activeTab: 'image',
      counts: { image: 12, video: 5, audio: 3 },
      setActiveTab: mockSetActiveTab,
    }),
}));

describe('HistorySidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all 3 category items', () => {
    render(<HistorySidebar />);
    expect(screen.getByText('图片历史')).toBeInTheDocument();
    expect(screen.getByText('视频历史')).toBeInTheDocument();
    expect(screen.getByText('音频历史')).toBeInTheDocument();
  });

  it('shows file counts for each category', () => {
    render(<HistorySidebar />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('calls setActiveTab when clicking a category', () => {
    render(<HistorySidebar />);
    fireEvent.click(screen.getByText('视频历史'));
    expect(mockSetActiveTab).toHaveBeenCalledWith('video');
  });

  it('calls setActiveTab when clicking audio category', () => {
    render(<HistorySidebar />);
    fireEvent.click(screen.getByText('音频历史'));
    expect(mockSetActiveTab).toHaveBeenCalledWith('audio');
  });
});
