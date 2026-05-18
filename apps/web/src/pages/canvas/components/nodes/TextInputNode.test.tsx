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
    expect(screen.getByDisplayValue(/文本输入/)).toBeInTheDocument();
  });

  it('should render always-visible title input', () => {
    renderNode();
    const input = screen.getByRole('textbox', { name: /节点标题/ }) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('文本输入');
  });

  it('should save title on Enter key', () => {
    renderNode();
    const input = screen.getByRole('textbox', { name: /节点标题/ }) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '我的节点' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByDisplayValue('我的节点')).toBeInTheDocument();
  });

  it('should save title on blur', () => {
    renderNode();
    const input = screen.getByRole('textbox', { name: /节点标题/ }) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '新标题' } });
    fireEvent.blur(input);
    expect(screen.getByDisplayValue('新标题')).toBeInTheDocument();
  });

  it('should cancel edit on Escape', () => {
    renderNode();
    const input = screen.getByRole('textbox', { name: /节点标题/ }) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '取消' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByDisplayValue('文本输入')).toBeInTheDocument();
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

  it('should show white border ring when selected', () => {
    const { container } = renderNode({ selected: true });
    const html = container.innerHTML;
    expect(html).toContain('border-white/40');
  });
});
