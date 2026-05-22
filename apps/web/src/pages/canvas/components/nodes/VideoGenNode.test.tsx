import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoGenNode } from './VideoGenNode';
import { ReactFlowProvider } from '@xyflow/react';

let mockNodeData: any = { fileId: undefined, status: 'idle', model: '' };

vi.mock('@/hooks/useMediaUrl', () => ({
  useMediaUrl: (fileId: string | null | undefined) => {
    if (fileId) return { url: `http://media/${fileId}`, loading: false, error: null };
    return { url: null, loading: false, error: null };
  },
}));

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((selector?: any) => {
    const state = {
      nodes: { 'v1': { id: 'v1', type: 'video', position: { x: 0, y: 0 }, data: mockNodeData } },
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

vi.mock('./VideoConfigPanel', () => ({
  VideoConfigPanel: () => <div>config panel</div>,
}));

describe('VideoGenNode', () => {
  const renderNode = (selected = false) =>
    render(<ReactFlowProvider><VideoGenNode id="v1" data={{}} selected={selected} type="videoGen" draggable={true} dragging={false} selectable={true} deletable={true} zIndex={0} {...{} as any} /></ReactFlowProvider>);

  it('should render editable node title with default value', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('视频生成');
  });

  it('should save title on blur', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '我的视频' } });
    fireEvent.blur(input);
    expect(screen.getByDisplayValue('我的视频')).toBeInTheDocument();
  });

  it('should cancel edit on Escape', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '取消' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByDisplayValue('视频生成')).toBeInTheDocument();
  });

  it('should render preview placeholder when no video', () => {
    renderNode();
    expect(screen.getByText(/视频预览区/i)).toBeInTheDocument();
  });

  it('should render video element when videoUrl exists', () => {
    mockNodeData = { fileId: 'test-file-id', status: 'done', model: '' };
    renderNode();
    const sourceEl = document.querySelector('source');
    expect(sourceEl).toBeTruthy();
    expect(sourceEl).toHaveAttribute('src', 'http://media/test-file-id');
  });

  it('should have 2 handles', () => {
    mockNodeData = { fileId: undefined, status: 'idle', model: '' };
    const { container } = renderNode();
    expect(container.querySelectorAll('.react-flow__handle').length).toBe(2);
  });

  it('should show config panel when selected', () => {
    renderNode(true);
    expect(screen.getByText('config panel')).toBeInTheDocument();
  });
});
