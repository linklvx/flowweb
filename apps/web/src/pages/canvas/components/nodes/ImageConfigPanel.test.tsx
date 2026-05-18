import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageConfigPanel } from './ImageConfigPanel';

vi.mock('@xyflow/react', () => ({
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}));

const mockUpdateConfig = vi.fn();
const mockSetStatus = vi.fn();

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((selector?: any) => {
    const state = {
      nodes: {
        'img1': { type: 'image', status: 'idle', style: '写实', extraPrompt: '', model: 'SD XL', resolution: '1024×1024', count: 1 },
      },
      updateConfig: mockUpdateConfig,
      setStatus: mockSetStatus,
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

describe('ImageConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render style tag buttons', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    expect(screen.getByText('写实')).toBeInTheDocument();
    expect(screen.getByText('动漫')).toBeInTheDocument();
  });

  it('should render section labels', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    expect(screen.getByText('模型')).toBeInTheDocument();
    expect(screen.getByText('分辨率')).toBeInTheDocument();
    expect(screen.getByText('生成数量')).toBeInTheDocument();
  });

  it('should render execute button with ▶ symbol', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    expect(screen.getByText('▶')).toBeInTheDocument();
  });

  it('should render credit display', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    expect(screen.getByText(/消耗积分/i)).toBeInTheDocument();
  });

  it('should render supplementary prompt input', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    expect(screen.getByPlaceholderText(/补充说明/i)).toBeInTheDocument();
  });

  it('should call updateConfig when style tag clicked', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    fireEvent.click(screen.getByText('动漫'));
    expect(mockUpdateConfig).toHaveBeenCalledWith('img1', { style: '动漫' });
  });

  it('should call setStatus when execute button clicked', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    fireEvent.click(screen.getByText('▶'));
    expect(mockSetStatus).toHaveBeenCalledWith('img1', 'loading');
  });
});
