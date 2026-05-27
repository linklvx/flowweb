import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';

// Mock Tiptap
const mockChainRun = vi.fn();
const mockEditorIsActive = vi.fn().mockReturnValue(false);
const mockEditorGetHTML = vi.fn().mockReturnValue('<p>test</p>');
const mockEditorGetText = vi.fn().mockReturnValue('test');
const mockEditorDestroy = vi.fn();

// Build chain pattern: editor.chain().focus().toggleBold().run()
const buildChain = () => {
  const focused: Record<string, any> = {};
  ['toggleBold', 'toggleItalic', 'toggleHeading', 'setParagraph',
   'toggleBulletList', 'toggleOrderedList', 'setHorizontalRule'].forEach((method) => {
    focused[method] = (...args: any[]) => ({ run: mockChainRun });
  });
  return {
    chain: () => ({ focus: () => focused }),
    isActive: mockEditorIsActive,
    getHTML: mockEditorGetHTML,
    getText: mockEditorGetText,
    destroy: mockEditorDestroy,
    on: vi.fn(),
    off: vi.fn(),
  };
};

vi.mock('@xyflow/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...mod,
    useReactFlow: () => ({
      getNodes: () => [{ id: 'n1', selected: true }],
    }),
  };
});

vi.mock('@tiptap/react', () => ({
  useEditor: () => buildChain(),
  EditorContent: ({ editor }: any) => (
    <div data-testid="tiptap-editor" className="tiptap-content">
      <p>rendered content</p>
    </div>
  ),
}));

// Mock nodeStore
const mockUpdateText = vi.fn();
vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = {
        nodes: { n1: { id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: { content: '<p>一只猫在窗台上</p>' } } },
        updateText: mockUpdateText,
      };
      if (typeof selector === 'function') return selector(state);
      return state;
    }),
  ),
  isTextNode: (node: any) => node?.type === 'text',
}));

import { TextInputNode } from './TextInputNode';

describe('TextInputNode (Tiptap)', () => {
  const defaultProps = { id: 'n1', data: { content: 'initial' }, selected: false } as any;

  const renderNode = (props = {}) =>
    render(
      <ReactFlowProvider>
        <TextInputNode {...defaultProps} {...props} />
      </ReactFlowProvider>
    );

  beforeEach(() => {
    mockChainRun.mockClear();
    mockEditorIsActive.mockClear();
    mockEditorIsActive.mockReturnValue(false);
    mockUpdateText.mockClear();
  });

  it('should render node title', () => {
    renderNode();
    expect(screen.getByDisplayValue(/Text/)).toBeInTheDocument();
  });

  it('should render always-visible title input', () => {
    renderNode();
    const input = screen.getByRole('textbox', { name: /节点标题/ }) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Text');
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
    expect(screen.getByDisplayValue('Text')).toBeInTheDocument();
  });

  it('should grow ghost sizer span as user types longer title', () => {
    const { container } = renderNode();
    const input = screen.getByRole('textbox', { name: /节点标题/ }) as HTMLInputElement;
    // Type a long string
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '这是一个很长的标题用来测试' } });
    // The invisible ghost span should show the draft text
    const ghost = container.querySelector('[aria-hidden="true"]') as HTMLSpanElement;
    expect(ghost.textContent).toBe('这是一个很长的标题用来测试 ');
  });

  it('should render Tiptap EditorContent instead of textarea', () => {
    renderNode();
    // EditorContent is rendered (data-testid from mock)
    expect(screen.getByTestId('tiptap-editor')).toBeInTheDocument();
    // Textarea should NOT exist
    expect(screen.queryByPlaceholderText(/点击输入文本/i)).toBeNull();
  });

  it('should show content from nodeStore in EditorContent', () => {
    renderNode();
    expect(screen.getByTestId('tiptap-editor')).toBeInTheDocument();
  });

  it('should have input and output handles', () => {
    const { container } = renderNode();
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles.length).toBe(2);
  });

  it('should show highlight border on overlay when selected', () => {
    renderNode({ selected: true });
    const overlay = document.querySelector('[data-testid="border-overlay"]');
    expect(overlay).not.toBeNull();
    const styleAttr = (overlay as HTMLElement).getAttribute('style') || '';
    expect(styleAttr).toContain('rgb(156, 163, 175)');
    expect(styleAttr).toContain('3px');
  });

  it('should show subtle border on overlay when not selected', () => {
    renderNode({ selected: false });
    const overlay = document.querySelector('[data-testid="border-overlay"]');
    expect(overlay).not.toBeNull();
    const styleAttr = (overlay as HTMLElement).getAttribute('style') || '';
    expect(styleAttr).toContain('rgb(63, 63, 70)');
    expect(styleAttr).toContain('1px');
  });

  it('should show toolbar when selected', () => {
    renderNode({ selected: true });
    // Toolbar should be rendered (passes editor prop from useEditor mock)
    expect(screen.getByLabelText('加粗')).toBeInTheDocument();
  });

  it('should not show toolbar when not selected', () => {
    renderNode({ selected: false });
    expect(screen.queryByLabelText('加粗')).toBeNull();
  });

  it('should apply bgColor to editor area wrapper (not just editor)', () => {
    const { container } = renderNode();
    // The p-3 wrapper should not have backgroundColor when bgColor is null
    const cardBody = container.querySelector('[class*="bg-\\[\\#222222\\]"]');
    const p3Div = cardBody?.querySelector('.py-4.px-3') as HTMLElement;
    expect(p3Div).toBeTruthy();
  });

  // === Resize (Task 4) ===
  it('should use default dimensions 300x300 when node has no width/height', () => {
    const { container } = renderNode();
    const card = container.querySelector('[class*="bg-\\[\\#222222\\]"]') as HTMLElement;
    const style = card?.getAttribute('style') || '';
    expect(style).toContain('width: 300px');
    expect(style).toContain('height: 300px');
  });

  it('should not show resize handles when not selected', () => {
    const { container } = renderNode({ selected: false });
    const handles = container.querySelectorAll('[class*="resize-control"]');
    expect(handles.length).toBe(0);
  });

  it('should show resize handles when single selected', () => {
    const { container } = renderNode({ selected: true });
    const handles = container.querySelectorAll('[class*="resize-control"]');
    expect(handles.length).toBeGreaterThan(0);
  });

  it('should show border overlay with data-testid when selected', () => {
    renderNode({ selected: true });
    const overlay = document.querySelector('[data-testid="border-overlay"]');
    expect(overlay).toBeInTheDocument();
  });

  it('should render 8 NodeResizer controls when single selected', () => {
    const { container } = renderNode({ selected: true });
    const controls = container.querySelectorAll('.react-flow__resize-control');
    expect(controls.length).toBe(8);
  });
});
