import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MultiImageConfigPanel } from './MultiImageConfigPanel';
import { ReactFlowProvider } from '@xyflow/react';

const { getMockNodeData, setMockNodeData } = vi.hoisted(() => {
  let mockNodeData: any = { images: [], mainImageIndex: 0, expanded: false, nodeStatus: 'idle' };
  return {
    getMockNodeData: () => mockNodeData,
    setMockNodeData: (d: any) => { mockNodeData = d; },
  };
});

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((selector?: any) => {
    const state = {
      nodes: { 'mimg1': { id: 'mimg1', type: 'multiImageGen', position: { x: 0, y: 0 }, data: getMockNodeData() } },
      updateMultiImageImages: vi.fn(),
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

vi.mock('@/api/storageApi', () => ({
  presignUpload: vi.fn(),
  confirmUpload: vi.fn(),
}));

vi.mock('axios', () => ({
  default: { post: vi.fn().mockResolvedValue({}) },
}));

function makeImage(id: string) {
  return { id, url: `http://media/${id}`, name: `img-${id}`, status: 'success' as const };
}

describe('MultiImageConfigPanel', () => {
  const renderPanel = () =>
    render(
      <ReactFlowProvider>
        <MultiImageConfigPanel nodeId="mimg1" />
      </ReactFlowProvider>
    );

  it('should render panel', () => {
    renderPanel();
    const panel = document.querySelector('.nodrag.nopan');
    expect(panel).toBeInTheDocument();
  });

  it('should show upload button', () => {
    renderPanel();
    const uploadBtn = screen.getByText('上传图片');
    expect(uploadBtn).toBeInTheDocument();
  });

  it('should render image thumbnails', () => {
    setMockNodeData({ images: [makeImage('a'), makeImage('b')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderPanel();
    expect(screen.getByText('img-a')).toBeInTheDocument();
    expect(screen.getByText('img-b')).toBeInTheDocument();
  });

  it('should show clear all button', () => {
    setMockNodeData({ images: [makeImage('a')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderPanel();
    const clearBtn = screen.getByText('清空全部');
    expect(clearBtn).toBeInTheDocument();
  });

  it('should render delete button for each image', () => {
    setMockNodeData({ images: [makeImage('a')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderPanel();
    const deleteBtns = screen.getAllByText('✕');
    expect(deleteBtns.length).toBe(1);
  });

  it('should clear images on clear all confirm', () => {
    window.confirm = vi.fn(() => true);
    setMockNodeData({ images: [makeImage('a')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderPanel();
    const clearBtn = screen.getByText('清空全部');
    fireEvent.click(clearBtn);
    expect(window.confirm).toHaveBeenCalled();
  });
});
