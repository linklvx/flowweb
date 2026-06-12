import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockNodeData: any = {
  model: 'sdxl',
  ratio: '16:9',
  resolution: '2K',
  quality: 'standard',
  status: 'idle',
};

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: (selector: any) => {
    return selector({
      nodes: { n1: { type: 'imageGen', data: mockNodeData } },
      updateConfig: vi.fn(),
    });
  },
}));

global.fetch = vi.fn((url: string) => {
  if (url.includes('/api/node-types/image/models')) {
    return Promise.resolve({
      json: () => Promise.resolve({ code: 0, data: [{ id: 'sdxl', name: 'SD XL' }, { id: 'flux', name: 'Flux' }] }),
    });
  }
  if (url.includes('/api/pricing/calculate')) {
    return Promise.resolve({ json: () => Promise.resolve({ code: 0, data: 7 }) });
  }
  return Promise.resolve({ json: () => Promise.resolve({ code: 0, data: [] }) });
}) as any;

import { EraseBottomToolbar } from './EraseBottomToolbar';

describe('EraseBottomToolbar', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders with default dropdowns and generate button', () => {
    render(<EraseBottomToolbar nodeId="n1" />);
    // Shows ratio button
    expect(screen.getByText('16:9')).toBeInTheDocument();
    // Shows resolution
    expect(screen.getByText('2K')).toBeInTheDocument();
    // Shows count
    expect(screen.getByText('1张')).toBeInTheDocument();
    // Shows model ID as fallback before models load
    expect(screen.getByText('sdxl')).toBeInTheDocument();
  });

  it('renders disabled generate button when isProcessing', () => {
    const { container } = render(<EraseBottomToolbar nodeId="n1" isProcessing={true} />);
    const btns = container.querySelectorAll('button[disabled]');
    expect(btns.length).toBeGreaterThan(0);
  });

  it('calls onGenerate when generate button clicked', () => {
    const onGenerate = vi.fn();
    render(<EraseBottomToolbar nodeId="n1" onGenerate={onGenerate} />);
    // Find the generate button (white bg arrow icon)
    const genBtn = document.querySelector('[style*="background-color: white"]') as HTMLButtonElement;
    expect(genBtn).toBeTruthy();
    genBtn.click();
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });
});
