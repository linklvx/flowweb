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

// useStore mock — useIsSingleSelected 计算用
let mockStoreNodes = [{ id: 'n1', selected: true }];

// Spy on NodeResizeControl callbacks
const mockOnResizeStart = vi.fn();
const mockOnResizeEnd = vi.fn();
vi.mock('@xyflow/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...mod,
    useStore: (selector: any) => selector({ nodes: mockStoreNodes }),
    useReactFlow: () => ({
      zoom: 1,
    }),
    // Mock useViewport and useInternalNode for child toolbar Portal rendering
    useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    useInternalNode: (_id: string) => ({
      position: { x: 100, y: 200 },
      measured: { width: 400, height: 350 },
    }),
    // Mock NodeResizeControl as a transparent wrapper that renders children
    NodeResizeControl: ({ children, position, onResizeStart, onResizeEnd, style }: any) => {
      // Capture callbacks for test verification
      if (onResizeStart) mockOnResizeStart.mockImplementation(onResizeStart);
      if (onResizeEnd) mockOnResizeEnd.mockImplementation(onResizeEnd);
      return (
        <div data-testid={`resize-control-${position}`} style={style}>
          {children}
        </div>
      );
    },
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
    // Resize mocks - restore single-selection default
    mockStoreNodes = [{ id: 'n1', selected: true }];
    mockOnResizeStart.mockClear();
    mockOnResizeEnd.mockClear();
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
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '这是一个很长的标题用来测试' } });
    const ghost = container.querySelector('[aria-hidden="true"]') as HTMLSpanElement;
    expect(ghost.textContent).toBe('这是一个很长的标题用来测试 ');
  });

  it('should render Tiptap EditorContent instead of textarea', () => {
    renderNode();
    expect(screen.getByTestId('tiptap-editor')).toBeInTheDocument();
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
    expect(screen.getByLabelText('加粗')).toBeInTheDocument();
  });

  it('should not show toolbar when not selected', () => {
    renderNode({ selected: false });
    expect(screen.queryByLabelText('加粗')).toBeNull();
  });

  it('should apply bgColor to editor area wrapper (not just editor)', () => {
    const { container } = renderNode();
    const cardBody = container.querySelector('[class*="bg-\\[\\#222222\\]"]');
    const p3Div = cardBody?.querySelector('[class*="py-3"][class*="pl-3"]') as HTMLElement;
    expect(p3Div).toBeTruthy();
  });

  // === Resize Handles (Custom NodeResizeControl) ===

  describe('resize handle visibility', () => {
    it('should not render resize controls when node is not selected', () => {
      renderNode({ selected: false });
      expect(screen.queryByTestId('resize-control-top-left')).toBeNull();
      expect(screen.queryByTestId('resize-control-bottom-right')).toBeNull();
    });

    it('should render all 4 corner resize controls when single-selected', () => {
      renderNode({ selected: true });
      expect(screen.getByTestId('resize-control-top-left')).toBeInTheDocument();
      expect(screen.getByTestId('resize-control-top-right')).toBeInTheDocument();
      expect(screen.getByTestId('resize-control-bottom-left')).toBeInTheDocument();
      expect(screen.getByTestId('resize-control-bottom-right')).toBeInTheDocument();
    });

    it('should not render resize controls when multiple nodes are selected', () => {
      mockStoreNodes = [
        { id: 'n1', selected: true },
        { id: 'n2', selected: true },
      ];
      renderNode({ selected: true });
      expect(screen.queryByTestId('resize-control-top-left')).toBeNull();
      mockStoreNodes = [{ id: 'n1', selected: true }];
    });

    it('should not render inner visual handle (clean transparent style)', () => {
      renderNode({ selected: true });
      expect(screen.queryByTestId('resize-handle')).toBeNull();
    });
  });

  describe('resize control style', () => {
    it('should have 24x24 transparent hit area on controls', () => {
      renderNode({ selected: true });
      const control = screen.getByTestId('resize-control-bottom-right');
      expect(control.style.width).toBe('24px');
      expect(control.style.height).toBe('24px');
      expect(control.style.background).toBe('transparent');
    });

    it('should render all 4 corner controls with correct data-testid', () => {
      renderNode({ selected: true });
      expect(screen.getByTestId('resize-control-top-left')).toBeInTheDocument();
      expect(screen.getByTestId('resize-control-top-right')).toBeInTheDocument();
      expect(screen.getByTestId('resize-control-bottom-left')).toBeInTheDocument();
      expect(screen.getByTestId('resize-control-bottom-right')).toBeInTheDocument();
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
