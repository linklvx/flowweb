import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    expect(screen.getByText(/文本输入/)).toBeInTheDocument();
  });

  it('should enter edit mode when title is clicked', () => {
    renderNode();
    fireEvent.click(screen.getByText(/文本输入/));
    const input = screen.getByRole('textbox', { name: /节点标题/ }) as HTMLInputElement;
    expect(input).toBeInTheDocument();
  });

  it('should save title on Enter key', () => {
    renderNode();
    fireEvent.click(screen.getByText(/文本输入/));
    const input = screen.getByRole('textbox', { name: /节点标题/ }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '我的节点' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('我的节点')).toBeInTheDocument();
  });

  it('should save title on blur', () => {
    renderNode();
    fireEvent.click(screen.getByText(/文本输入/));
    const input = screen.getByRole('textbox', { name: /节点标题/ }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '新标题' } });
    fireEvent.blur(input);
    expect(screen.getByText('新标题')).toBeInTheDocument();
  });

  it('should cancel edit on Escape', () => {
    renderNode();
    fireEvent.click(screen.getByText(/文本输入/));
    const input = screen.getByRole('textbox', { name: /节点标题/ }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '取消' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByText(/文本输入/)).toBeInTheDocument();
  });

  it('should render textarea', () => {
    renderNode();
    const textarea = screen.getByPlaceholderText(/点击输入文本/i);
    expect(textarea).toBeInTheDocument();
  });

  it('should show content from nodeStore', () => {
    renderNode();
    const textarea = screen.getByPlaceholderText(/点击输入文本/i) as HTMLTextAreaElement;
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
