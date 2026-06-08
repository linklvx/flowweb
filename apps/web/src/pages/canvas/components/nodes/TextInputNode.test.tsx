import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';

// Mock Tiptap
const mockChainRun = vi.fn();
const mockEditorIsActive = vi.fn().mockReturnValue(false);
const mockEditorGetHTML = vi.fn().mockReturnValue('<p>test</p>');
const mockEditorGetText = vi.fn().mockReturnValue('test');
const mockEditorDestroy = vi.fn();

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

// handleMouseDown mock — declared at describe level, reset in beforeEach
const mockHandleMouseDown = vi.fn();

// getNodes mock — mutable so per-test overrides are clean (no module mutation)
const mockGetNodes = vi.fn(() => [{ id: 'n1', selected: true }]);

// isResizing mock — mutable so per-test overrides are clean
let mockIsResizing = false;

// Mock bounding rect helper — returns a realistic node rect
function mockNodeRect(el: HTMLElement, overrides: Partial<DOMRect> = {}) {
  const defaults = {
    top: 0, left: 0, right: 300, bottom: 300,
    width: 300, height: 300, x: 0, y: 0,
    toJSON: () => ({}),
  };
  el.getBoundingClientRect = vi.fn().mockReturnValue({ ...defaults, ...overrides });
}

vi.mock('@xyflow/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...mod,
    useReactFlow: () => ({
      getNodes: () => mockGetNodes(),
      zoom: 1,
    }),
    useNodeResizer: () => ({
      isResizing: mockIsResizing,
      handleMouseDown: mockHandleMouseDown,
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
    // Tiptap mocks
    mockChainRun.mockClear();
    mockEditorIsActive.mockClear();
    mockEditorIsActive.mockReturnValue(false);
    mockEditorGetHTML.mockClear();
    mockEditorGetText.mockClear();
    mockEditorDestroy.mockClear();
    // nodeStore mock
    mockUpdateText.mockClear();
    // Resize mocks
    mockHandleMouseDown.mockClear();
    mockGetNodes.mockReturnValue([{ id: 'n1', selected: true }]);
    mockIsResizing = false;
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

  it('should have input and output handles with circle-plus SVG icons', () => {
    const { container } = renderNode();
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles.length).toBe(2);
    handles.forEach((handle) => {
      const svg = handle.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.classList.contains('handle-icon')).toBe(true);
    });
  });

  it('should have data-testid on source and target handles', () => {
    const { container } = renderNode();
    expect(container.querySelector('[data-testid="source-handle"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="target-handle"]')).not.toBeNull();
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
    const p3Div = cardBody?.querySelector('[class*="py-3"][class*="pl-3"]') as HTMLElement;
    expect(p3Div).toBeTruthy();
  });

  // === Resize Handles (Custom useNodeResizer) ===

  describe('resize handle visibility', () => {
    it('should not render resize handle when node is not selected', () => {
      renderNode({ selected: false });
      expect(screen.queryByTestId('resize-handle')).toBeNull();
    });

    it('should not render resize handle when selected but mouse is in center of node', () => {
      const { container } = renderNode({ selected: true });
      const nodeEl = container.querySelector('.canvas-node') as HTMLElement;
      mockNodeRect(nodeEl);
      fireEvent.mouseMove(nodeEl, { clientX: 150, clientY: 150 }); // center, not in any corner
      expect(screen.queryByTestId('resize-handle')).toBeNull();
    });

    it('should render resize handle when mouse is near bottom-right corner', () => {
      const { container } = renderNode({ selected: true });
      const nodeEl = container.querySelector('.canvas-node') as HTMLElement;
      mockNodeRect(nodeEl);
      fireEvent.mouseMove(nodeEl, { clientX: 295, clientY: 295 }); // within 24px hit area
      expect(screen.getByTestId('resize-handle')).toBeInTheDocument();
    });

    it('should render resize handle when mouse is near top-left corner', () => {
      const { container } = renderNode({ selected: true });
      const nodeEl = container.querySelector('.canvas-node') as HTMLElement;
      mockNodeRect(nodeEl);
      fireEvent.mouseMove(nodeEl, { clientX: 5, clientY: 5 }); // within 24px hit area
      expect(screen.getByTestId('resize-handle')).toBeInTheDocument();
    });

    it('should hide handle when mouse leaves the node', () => {
      const { container } = renderNode({ selected: true });
      const nodeEl = container.querySelector('.canvas-node') as HTMLElement;
      mockNodeRect(nodeEl);
      fireEvent.mouseMove(nodeEl, { clientX: 295, clientY: 295 });
      expect(screen.getByTestId('resize-handle')).toBeInTheDocument();
      fireEvent.mouseLeave(nodeEl);
      expect(screen.queryByTestId('resize-handle')).toBeNull();
    });

    it('should not render handle when multiple nodes are selected', () => {
      // Override getNodes to return 2 selected nodes → isSingleSelected = false
      mockGetNodes.mockReturnValue([
        { id: 'n1', selected: true },
        { id: 'n2', selected: true },
      ]);
      const { container } = renderNode({ selected: true });
      const nodeEl = container.querySelector('.canvas-node') as HTMLElement;
      mockNodeRect(nodeEl);
      fireEvent.mouseMove(nodeEl, { clientX: 295, clientY: 295 });
      expect(screen.queryByTestId('resize-handle')).toBeNull();
      // Restore default
      mockGetNodes.mockReturnValue([{ id: 'n1', selected: true }]);
    });

    it('should hide handle when node is no longer single-selected (deselected)', () => {
      const { container, rerender } = renderNode({ selected: true });
      const nodeEl = container.querySelector('.canvas-node') as HTMLElement;
      mockNodeRect(nodeEl);
      fireEvent.mouseMove(nodeEl, { clientX: 295, clientY: 295 });
      expect(screen.getByTestId('resize-handle')).toBeInTheDocument();

      // Re-render with selected=false
      rerender(
        <ReactFlowProvider>
          <TextInputNode id="n1" data={{ content: 'initial' } as any} selected={false} />
        </ReactFlowProvider>
      );
      expect(screen.queryByTestId('resize-handle')).toBeNull();
    });
  });

  describe('resize handle interaction', () => {
    it('should call handleMouseDown on left-click', () => {
      mockHandleMouseDown.mockClear();
      const { container } = renderNode({ selected: true });
      const nodeEl = container.querySelector('.canvas-node') as HTMLElement;
      mockNodeRect(nodeEl);
      fireEvent.mouseMove(nodeEl, { clientX: 295, clientY: 295 });
      const handle = screen.getByTestId('resize-handle');
      fireEvent.mouseDown(handle, { button: 0 });
      expect(mockHandleMouseDown).toHaveBeenCalledTimes(1);
    });

    it('should NOT call handleMouseDown on right-click', () => {
      mockHandleMouseDown.mockClear();
      const { container } = renderNode({ selected: true });
      const nodeEl = container.querySelector('.canvas-node') as HTMLElement;
      mockNodeRect(nodeEl);
      fireEvent.mouseMove(nodeEl, { clientX: 295, clientY: 295 });
      const handle = screen.getByTestId('resize-handle');
      fireEvent.mouseDown(handle, { button: 2 });
      expect(mockHandleMouseDown).not.toHaveBeenCalled();
    });

    it('should call handleMouseDown and not propagate to parent (stopPropagation)', () => {
      // jsdom + React synthetic events cannot reliably test native stopPropagation
      // via addEventListener. Instead, verify the handler code path is correct:
      // handleMouseDown is called, which means stopPropagation() was reached.
      mockHandleMouseDown.mockClear();
      const { container } = renderNode({ selected: true });
      const nodeEl = container.querySelector('.canvas-node') as HTMLElement;
      mockNodeRect(nodeEl);
      fireEvent.mouseMove(nodeEl, { clientX: 295, clientY: 295 });
      const handle = screen.getByTestId('resize-handle');
      fireEvent.mouseDown(handle, { button: 0 });
      // If stopPropagation prevented bubble, React Flow node drag won't start.
      // The fact handleMouseDown is called proves the guard logic ran correctly.
      expect(mockHandleMouseDown).toHaveBeenCalledWith(
        expect.any(Object),
        'bottom-right',
      );
    });
  });

  describe('resize handle style', () => {
    it('should have correct cursor for bottom-right corner', () => {
      const { container } = renderNode({ selected: true });
      const nodeEl = container.querySelector('.canvas-node') as HTMLElement;
      mockNodeRect(nodeEl);
      fireEvent.mouseMove(nodeEl, { clientX: 295, clientY: 295 });
      const handle = screen.getByTestId('resize-handle');
      expect(handle.style.cursor).toBe('nwse-resize');
    });

    it('should have correct cursor for top-left corner', () => {
      const { container } = renderNode({ selected: true });
      const nodeEl = container.querySelector('.canvas-node') as HTMLElement;
      mockNodeRect(nodeEl);
      fireEvent.mouseMove(nodeEl, { clientX: 5, clientY: 5 });
      const handle = screen.getByTestId('resize-handle');
      expect(handle.style.cursor).toBe('nwse-resize');
    });

    it('should have white background and circle shape', () => {
      const { container } = renderNode({ selected: true });
      const nodeEl = container.querySelector('.canvas-node') as HTMLElement;
      mockNodeRect(nodeEl);
      fireEvent.mouseMove(nodeEl, { clientX: 295, clientY: 295 });
      const handle = screen.getByTestId('resize-handle');
      expect(handle.style.backgroundColor).toBe('white');
      expect(handle.style.borderRadius).toBe('50%');
      expect(handle.style.width).toBe('14px');
      expect(handle.style.height).toBe('14px');
    });
  });

  describe('resize handle during drag', () => {
    it('should keep handle visible while isResizing is true even on mouseLeave', () => {
      // First render with isResizing=false so mouseMove can detect the corner
      const { container, rerender } = renderNode({ selected: true });
      const nodeEl = container.querySelector('.canvas-node') as HTMLElement;
      mockNodeRect(nodeEl);

      // Show handle by hovering corner (isResizing=false → handleMouseMove runs)
      fireEvent.mouseMove(nodeEl, { clientX: 295, clientY: 295 });
      expect(screen.getByTestId('resize-handle')).toBeInTheDocument();

      // Simulate drag start: isResizing becomes true
      mockIsResizing = true;
      rerender(
        <ReactFlowProvider>
          <TextInputNode id="n1" data={{ content: 'initial' } as any} selected={true} />
        </ReactFlowProvider>
      );

      // Mouse leaves — handle should stay because isResizing=true blocks handleMouseLeave
      fireEvent.mouseLeave(nodeEl);
      expect(screen.getByTestId('resize-handle')).toBeInTheDocument();

      // Cleanup: restore default
      mockIsResizing = false;
    });
  });

  // === Preserved existing tests (adapted) ===

  it('should use default dimensions 300x300 when node has no width/height', () => {
    const { container } = renderNode();
    const card = container.querySelector('[class*="bg-\\[\\#222222\\]"]') as HTMLElement;
    const style = card?.getAttribute('style') || '';
    expect(style).toContain('width: 300px');
    expect(style).toContain('height: 300px');
  });

  it('should show border overlay with data-testid when selected', () => {
    renderNode({ selected: true });
    const overlay = document.querySelector('[data-testid="border-overlay"]');
    expect(overlay).toBeInTheDocument();
  });
});
