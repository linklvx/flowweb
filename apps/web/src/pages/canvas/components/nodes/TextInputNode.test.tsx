import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TextInputNode } from './TextInputNode';
import { ReactFlowProvider } from '@xyflow/react';

// Mock nodeStore
const mockUpdateText = vi.fn();
vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((selector?: any) => {
    const state = {
      nodes: { 'n1': { type: 'text', content: '一只猫在窗台上' } },
      updateText: mockUpdateText,
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

describe('TextInputNode', () => {
  const defaultProps = { id: 'n1', data: { content: 'initial' }, selected: false } as any;

  const renderNode = (props = {}) =>
    render(
      <ReactFlowProvider>
        <TextInputNode {...defaultProps} {...props} />
      </ReactFlowProvider>
    );

  it('should render node title', () => {
    renderNode();
    expect(screen.getByText(/文本输入节点/)).toBeInTheDocument();
  });

  it('should render textarea', () => {
    renderNode();
    const textarea = screen.getByPlaceholderText(/输入 Prompt/i);
    expect(textarea).toBeInTheDocument();
  });

  it('should show content from nodeStore', () => {
    renderNode();
    const textarea = screen.getByPlaceholderText(/输入 Prompt/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe('一只猫在窗台上');
  });

  it('should have input and output handles', () => {
    const { container } = renderNode();
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles.length).toBe(2);
  });

  it('should show green border when selected', () => {
    const { container } = renderNode({ selected: true });
    const node = container.querySelector('.border-\\[\\#4ade80\\]');
    expect(node).toBeTruthy();
  });
});
