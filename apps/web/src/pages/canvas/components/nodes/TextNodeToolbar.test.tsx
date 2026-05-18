import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Editor } from '@tiptap/react';

// Mock @xyflow/react
vi.mock('@xyflow/react', () => ({
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}));

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
    const { container } = render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    expect(container.innerHTML).toContain('rounded-full');
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

  it('should apply anti-zoom scale transform', () => {
    const { container } = render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    const toolbar = container.querySelector('[class*="nodrag"]') as HTMLElement;
    expect(toolbar.style.transform).toContain('scale');
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
    const { container } = render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
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

  it('should have onMouseDown handler to prevent focus loss', () => {
    const { container } = render(<TextNodeToolbar nodeId="n1" editor={mockEditor} />);
    const toolbar = container.querySelector('[class*="nodrag"]') as HTMLElement;

    const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    fireEvent(toolbar, mouseDownEvent);
    // onMouseDown calls e.preventDefault(), so default should be prevented
    expect(mouseDownEvent.defaultPrevented).toBe(true);
  });
});
