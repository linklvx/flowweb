import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextNodeToolbar } from './TextNodeToolbar';

vi.mock('@xyflow/react', () => ({
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}));

// Mock nodeStore for getState
vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((selector?: any) => {
    const state = {
      nodes: { 'n1': { type: 'text', content: 'test content' } },
      updateText: vi.fn(),
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

describe('TextNodeToolbar', () => {
  it('should render toolbar with pill shape', () => {
    const { container } = render(<TextNodeToolbar nodeId="n1" />);
    const html = container.innerHTML;
    expect(html).toContain('rounded-full');
  });

  it('should render heading buttons H1 H2 H3', () => {
    render(<TextNodeToolbar nodeId="n1" />);
    expect(screen.getByLabelText('H1')).toBeInTheDocument();
    expect(screen.getByLabelText('H2')).toBeInTheDocument();
    expect(screen.getByLabelText('H3')).toBeInTheDocument();
  });

  it('should render bold and italic buttons', () => {
    render(<TextNodeToolbar nodeId="n1" />);
    expect(screen.getByLabelText('加粗')).toBeInTheDocument();
    expect(screen.getByLabelText('斜体')).toBeInTheDocument();
  });

  it('should render list and divider buttons', () => {
    render(<TextNodeToolbar nodeId="n1" />);
    expect(screen.getByLabelText('无序列表')).toBeInTheDocument();
    expect(screen.getByLabelText('有序列表')).toBeInTheDocument();
    expect(screen.getByLabelText('分割线')).toBeInTheDocument();
  });

  it('should render copy and fullscreen buttons', () => {
    render(<TextNodeToolbar nodeId="n1" />);
    expect(screen.getByLabelText('复制全部')).toBeInTheDocument();
    expect(screen.getByLabelText('全屏')).toBeInTheDocument();
  });

  it('should apply anti-zoom scale transform', () => {
    const { container } = render(<TextNodeToolbar nodeId="n1" />);
    const toolbar = container.querySelector('[class*="nodrag"]') as HTMLElement;
    expect(toolbar.style.transform).toContain('scale');
  });
});
