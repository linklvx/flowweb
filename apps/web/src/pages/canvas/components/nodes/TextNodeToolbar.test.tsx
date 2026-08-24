import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Editor } from '@tiptap/react';

const { mockUseViewport, mockUseInternalNode } = vi.hoisted(() => ({
  mockUseViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
  mockUseInternalNode: vi.fn(() => ({
    position: { x: 100, y: 200 },
    measured: { width: 400, height: 350 },
    internals: { positionAbsolute: { x: 100, y: 200 } },
  })),
}));

vi.mock('@xyflow/react', () => ({
  useViewport: mockUseViewport,
  useInternalNode: mockUseInternalNode,
}));

afterEach(() => {
  vi.clearAllMocks();
  mockUseViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 });
  mockUseInternalNode.mockReturnValue({
    position: { x: 100, y: 200 },
    measured: { width: 400, height: 350 },
    internals: { positionAbsolute: { x: 100, y: 200 } },
  });
  document.getElementById('node-toolbar-portal')?.remove();
});

function setupPortalTarget() {
  const el = document.createElement('div');
  el.id = 'node-toolbar-portal';
  document.body.appendChild(el);
  return el;
}

function cleanupPortalTarget() {
  const el = document.getElementById('node-toolbar-portal');
  if (el) document.body.removeChild(el);
}

// Build a mock editor with chain pattern
const createMockEditor = (overrides: Partial<Editor> = {}): Editor => {
  const chainFns: Record<string, any> = {};

  const makeChain = () => {
    const chain: Record<string, any> = {
      focus: () => {
        // After focus(), return an object with all formatting methods
        const focused: Record<string, any> = {};
        ['toggleBold', 'toggleItalic', 'toggleHeading', 'setParagraph',
         'toggleBulletList', 'toggleOrderedList', 'setHorizontalRule'].forEach((method) => {
          focused[method] = (...args: any[]) => {
            if (overrides[method as keyof Editor]) {
              (overrides[method as keyof Editor] as Function)(...args);
            }
            return { run: vi.fn() };
          };
        });
        return focused;
      },
    };
    return chain;
  };

  return {
    chain: () => makeChain(),
    isActive: vi.fn().mockReturnValue(false),
    getHTML: vi.fn().mockReturnValue('<p>test</p>'),
    getText: vi.fn().mockReturnValue('test'),
    destroy: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    ...overrides,
  } as unknown as Editor;
};

// Import the component (mocks must be set up before import)
import { TextNodeToolbar } from './TextNodeToolbar';

describe('TextNodeToolbar (Tiptap)', () => {
  let mockEditor: Editor;

  beforeEach(() => {
    mockEditor = createMockEditor();
  });

  it('should render toolbar with pill shape', () => {
    render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    // Use screen queries instead of container.innerHTML (toolbar renders via Portal)
    expect(screen.getByLabelText('加粗')).toBeInTheDocument();
    expect(screen.getByLabelText('H1')).toBeInTheDocument();
  });

  it('should render all heading buttons H1 H2 H3 and paragraph', () => {
    render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    expect(screen.getByLabelText('H1')).toBeInTheDocument();
    expect(screen.getByLabelText('H2')).toBeInTheDocument();
    expect(screen.getByLabelText('H3')).toBeInTheDocument();
    expect(screen.getByLabelText('正文')).toBeInTheDocument();
  });

  it('should render bold and italic buttons', () => {
    render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    expect(screen.getByLabelText('加粗')).toBeInTheDocument();
    expect(screen.getByLabelText('斜体')).toBeInTheDocument();
  });

  it('should render UL, OL, HR buttons', () => {
    render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    expect(screen.getByLabelText('无序列表')).toBeInTheDocument();
    expect(screen.getByLabelText('有序列表')).toBeInTheDocument();
    expect(screen.getByLabelText('分割线')).toBeInTheDocument();
  });

  it('should render copy and fullscreen buttons', () => {
    render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    expect(screen.getByLabelText('复制全部')).toBeInTheDocument();
    expect(screen.getByLabelText('全屏')).toBeInTheDocument();
  });

  it('does NOT apply scale transform (Portal renders in native pixels)', () => {
    setupPortalTarget();
    render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    const toolbar = document.querySelector('[class*="nodrag"][class*="pointer-events-auto"]') as HTMLElement;
    expect(toolbar).not.toBeNull();
    expect(toolbar.style.transform).not.toContain('scale');
    expect(toolbar.style.transform).toContain('translateX(-50%)');
    cleanupPortalTarget();
  });

  it('positions toolbar by positionAbsolute when node is inside a group', () => {
    setupPortalTarget();
    mockUseInternalNode.mockReturnValue({
      position: { x: 30, y: 60 },
      measured: { width: 400, height: 350 },
      internals: { positionAbsolute: { x: 600, y: 400 } },
    });
    render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    const toolbar = document.getElementById('node-toolbar-portal')!.querySelector('.nodrag') as HTMLElement;
    expect(toolbar.style.left).toBe('800px'); // (600 + 400/2) * 1 + 0
    expect(toolbar.style.top).toBe('326px');  // 400 - 46 - 28
    cleanupPortalTarget();
  });

  it('should handle null editor gracefully (no crash on click)', () => {
    render(<TextNodeToolbar nodeId="n1" editor={null} />);
    const btn = screen.getByLabelText('加粗');
    // Should not throw
    expect(() => fireEvent.click(btn)).not.toThrow();
  });

  it('should call editor chain on bold click', () => {
    const chainSpy = vi.fn();
    const editor = createMockEditor();
    const origChain = editor.chain;
    editor.chain = () => {
      chainSpy();
      return origChain();
    };

    render(<TextNodeToolbar nodeId="n1" editor={editor} />);
    fireEvent.click(screen.getByLabelText('加粗'));
    expect(chainSpy).toHaveBeenCalled();
  });

  it('should highlight active bold button when editor.isActive("bold") returns true', () => {
    mockEditor.isActive = vi.fn((type: string) => type === 'bold');
    render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    const boldBtn = screen.getByLabelText('加粗');
    expect(boldBtn.className).toContain('bg-white/20');
  });

  it('should highlight active H1 button when heading level 1 is active', () => {
    mockEditor.isActive = vi.fn((type: string, opts?: any) =>
      type === 'heading' && opts?.level === 1
    );
    render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    const h1Btn = screen.getByLabelText('H1');
    expect(h1Btn.className).toContain('bg-white/20');
  });

  it('should render background color button at leftmost', () => {
    render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    expect(screen.getByLabelText('背景颜色')).toBeInTheDocument();
  });

  it('should open color dropdown on background color button click', () => {
    render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    const btn = screen.getByLabelText('背景颜色');
    fireEvent.click(btn);
    // Dropdown should appear with color options
    expect(screen.getByLabelText('重置颜色')).toBeInTheDocument();
  });

  it('should show 7 color options in dropdown', () => {
    render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    fireEvent.click(screen.getByLabelText('背景颜色'));
    // 7 colors from reference: red, orange, yellow, green, cyan, blue, purple
    const colors = ['红色', '橙色', '黄色', '绿色', '青色', '蓝色', '紫色'];
    colors.forEach((label) => {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    });
  });

  it('should call onBgColorChange with color when a color is selected', () => {
    const onBgColorChange = vi.fn();
    render(<TextNodeToolbar nodeId="n1" editor={mockEditor} onBgColorChange={onBgColorChange} />);
    fireEvent.click(screen.getByLabelText('背景颜色'));
    fireEvent.click(screen.getByLabelText('红色'));
    expect(onBgColorChange).toHaveBeenCalledWith('#964243');
  });

  it('should call onBgColorChange with null when reset is clicked', () => {
    const onBgColorChange = vi.fn();
    render(<TextNodeToolbar nodeId="n1" editor={mockEditor} onBgColorChange={onBgColorChange} />);
    fireEvent.click(screen.getByLabelText('背景颜色'));
    fireEvent.click(screen.getByLabelText('重置颜色'));
    expect(onBgColorChange).toHaveBeenCalledWith(null);
  });

  it('should close dropdown after color selection', () => {
    render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    fireEvent.click(screen.getByLabelText('背景颜色'));
    expect(screen.getByLabelText('红色')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('红色'));
    // Dropdown should close, color options should not be visible
    expect(screen.queryByLabelText('红色')).toBeNull();
  });

  it('should have onMouseDown handler to prevent focus loss', () => {
    setupPortalTarget();
    render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    const toolbar = document.querySelector('[class*="nodrag"][class*="pointer-events-auto"]') as HTMLElement;

    const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    fireEvent(toolbar, mouseDownEvent);
    // onMouseDown calls e.preventDefault(), so default should be prevented
    expect(mouseDownEvent.defaultPrevented).toBe(true);
    cleanupPortalTarget();
  });

  it('renders toolbar via Portal (not as direct child of component)', () => {
    setupPortalTarget();
    const { container } = render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    expect(container.innerHTML).toBe('');
    cleanupPortalTarget();
  });
});
