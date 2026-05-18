# Tiptap 富文本编辑器 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将文本节点从 Markdown textarea 升级为 Tiptap WYSIWYG 富文本编辑器

**Architecture:** TextInputNode 使用 `useEditor` 创建 Tiptap 实例，通过 props 传给 TextNodeToolbar。工具栏按钮调用 `editor.chain().focus().toggleXxx().run()`。内容以 HTML 字符串存储在 nodeStore 中（接口不变）。

**Tech Stack:** @tiptap/react@2.10.0, @tiptap/starter-kit@2.10.0, React 18, Zustand, Tailwind CSS, vitest

---

### Task 1: 安装 Tiptap 依赖

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: 安装依赖**

```bash
cd apps/web && pnpm add @tiptap/react@2.10.0 @tiptap/starter-kit@2.10.0
```

- [ ] **Step 2: 验证安装**

```bash
node -e "require('@tiptap/react'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: 提交**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml
git commit -m "chore: add @tiptap/react@2.10.0 and @tiptap/starter-kit@2.10.0"
```

---

### Task 2: 重构 TextNodeToolbar — 先写测试

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/TextNodeToolbar.test.tsx`

- [ ] **Step 1: 重写测试文件，适配新的 editor prop + Tiptap 命令**

完整替换文件内容：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Editor } from '@tiptap/react';

// Mock @xyflow/react
vi.mock('@xyflow/react', () => ({
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}));

// Mock nodeStore
const mockUpdateText = vi.fn();
vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((selector?: any) => {
    const state = {
      nodes: { n1: { type: 'text', content: '<p>test content</p>' } },
      updateText: mockUpdateText,
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
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

    const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true });
    const prevented = !fireEvent(toolbar, mouseDownEvent);
    // onMouseDown calls e.preventDefault(), so default should be prevented
    expect(mouseDownEvent.defaultPrevented).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/TextNodeToolbar.test.tsx
```

Expected: FAIL — 因为 TextNodeToolbar 还没有 `editor` prop 和 `exec`/`isActive` 逻辑

---

### Task 3: 实现 TextNodeToolbar — 使测试通过

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/TextNodeToolbar.tsx`

- [ ] **Step 1: 完整重写 TextNodeToolbar.tsx**

```typescript
import { memo, useCallback } from 'react';
import { useViewport } from '@xyflow/react';
import type { Editor } from '@tiptap/react';

interface Props {
  nodeId: string;
  editor: Editor | null;
}

function TextNodeToolbarComponent({ nodeId, editor }: Props) {
  const { zoom } = useViewport();

  // Safe execution: guard against null editor (useEditor returns null on first render)
  const exec = useCallback(
    (command: (editor: Editor) => void) => {
      if (editor) command(editor);
    },
    [editor],
  );

  // Active state helper
  const isActive = useCallback(
    (type: string, opts?: Record<string, unknown>) =>
      editor?.isActive(type, opts) ?? false,
    [editor],
  );

  // Heading buttons
  const handleH1 = useCallback(() => exec((e) => e.chain().focus().toggleHeading({ level: 1 }).run()), [exec]);
  const handleH2 = useCallback(() => exec((e) => e.chain().focus().toggleHeading({ level: 2 }).run()), [exec]);
  const handleH3 = useCallback(() => exec((e) => e.chain().focus().toggleHeading({ level: 3 }).run()), [exec]);
  const handleParagraph = useCallback(() => exec((e) => e.chain().focus().setParagraph().run()), [exec]);

  // Inline formatting
  const handleBold = useCallback(() => exec((e) => e.chain().focus().toggleBold().run()), [exec]);
  const handleItalic = useCallback(() => exec((e) => e.chain().focus().toggleItalic().run()), [exec]);

  // Lists and divider
  const handleUl = useCallback(() => exec((e) => e.chain().focus().toggleBulletList().run()), [exec]);
  const handleOl = useCallback(() => exec((e) => e.chain().focus().toggleOrderedList().run()), [exec]);
  const handleHr = useCallback(() => exec((e) => e.chain().focus().setHorizontalRule().run()), [exec]);

  // Copy: rich text clipboard (HTML + plain text)
  const handleCopy = useCallback(async () => {
    if (!editor) return;
    const text = editor.getText();
    const html = editor.getHTML();
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
    } catch {
      // Fallback: plain text only
      await navigator.clipboard.writeText(text);
    }
  }, [editor]);

  // Fullscreen
  const handleFullscreen = useCallback(() => {
    window.dispatchEvent(new CustomEvent('node:fullscreen', { detail: { nodeId } }));
  }, [nodeId]);

  // Button base class + active state
  const btnClass = (active = false) =>
    `flex items-center justify-center w-8 h-8 rounded-full hover:bg-white/10 transition-colors cursor-pointer border-none bg-transparent text-white/70 ${
      active ? 'bg-white/20' : ''
    }`;

  return (
    <div
      className="nodrag pointer-events-auto flex items-center gap-[2px] px-1 py-1 rounded-full bg-[#222]/80 backdrop-blur-lg border border-white/10 text-white/90"
      style={{
        transform: `scale(${1 / zoom})`,
        transformOrigin: 'bottom center',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Group 1: Headings */}
      <div className="flex items-center gap-[2px]">
        <button onClick={handleH1} aria-label="H1" className={btnClass(isActive('heading', { level: 1 }))} title="标题1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 18v-8l-2 2" /><path d="M4 6v12" /><path d="M12 6v12" /><path d="M11 18h2" /><path d="M3 18h2" /><path d="M4 12h8" /><path d="M3 6h2" /><path d="M11 6h2" />
          </svg>
        </button>
        <button onClick={handleH2} aria-label="H2" className={btnClass(isActive('heading', { level: 2 }))} title="标题2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 12a2 2 0 1 1 4 0c0 .591 -.417 1.318 -.816 1.858l-3.184 4.143l4 0" /><path d="M4 6v12" /><path d="M12 6v12" /><path d="M11 18h2" /><path d="M3 18h2" /><path d="M4 12h8" /><path d="M3 6h2" /><path d="M11 6h2" />
          </svg>
        </button>
        <button onClick={handleH3} aria-label="H3" className={btnClass(isActive('heading', { level: 3 }))} title="标题3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 14a2 2 0 1 0 -2 -2" /><path d="M17 16a2 2 0 1 0 2 -2" /><path d="M4 6v12" /><path d="M12 6v12" /><path d="M11 18h2" /><path d="M3 18h2" /><path d="M4 12h8" /><path d="M3 6h2" /><path d="M11 6h2" />
          </svg>
        </button>
        <button onClick={handleParagraph} aria-label="正文" className={btnClass(isActive('paragraph'))} title="正文">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 4v16" /><path d="M17 4v16" /><path d="M19 4h-9.5a4.5 4.5 0 0 0 0 9h3.5" />
          </svg>
        </button>
      </div>

      <div className="w-px h-[18px] bg-white/10" />

      {/* Group 2: Bold & Italic */}
      <div className="flex items-center gap-[2px]">
        <button onClick={handleBold} aria-label="加粗" className={btnClass(isActive('bold'))} title="加粗">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 5h6a3.5 3.5 0 0 1 0 7h-6z" /><path d="M13 12h1a3.5 3.5 0 0 1 0 7h-7v-7" />
          </svg>
        </button>
        <button onClick={handleItalic} aria-label="斜体" className={btnClass(isActive('italic'))} title="斜体">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5l6 0" /><path d="M7 19l6 0" /><path d="M14 5l-4 14" />
          </svg>
        </button>
      </div>

      <div className="w-px h-[18px] bg-white/10" />

      {/* Group 3: Lists & Divider */}
      <div className="flex items-center gap-[2px]">
        <button onClick={handleUl} aria-label="无序列表" className={btnClass(isActive('bulletList'))} title="无序列表">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l11 0" /><path d="M9 12l11 0" /><path d="M9 18l11 0" /><path d="M5 6l0 .01" /><path d="M5 12l0 .01" /><path d="M5 18l0 .01" />
          </svg>
        </button>
        <button onClick={handleOl} aria-label="有序列表" className={btnClass(isActive('orderedList'))} title="有序列表">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 6h9" /><path d="M11 12h9" /><path d="M12 18h8" /><path d="M4 16a2 2 0 1 1 4 0c0 .591 -.5 1 -1 1.5l-3 2.5h4" /><path d="M6 10v-6l-2 2" />
          </svg>
        </button>
        <button onClick={handleHr} aria-label="分割线" className={btnClass()} title="分割线">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l14 0" />
          </svg>
        </button>
      </div>

      <div className="w-px h-[18px] bg-white/10" />

      {/* Group 4: Copy & Fullscreen */}
      <div className="flex items-center gap-[2px]">
        <button onClick={handleCopy} aria-label="复制全部" className={btnClass()} title="复制全部">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z" />
            <path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1" />
          </svg>
        </button>
        <button onClick={handleFullscreen} aria-label="全屏" className={btnClass()} title="全屏">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export const TextNodeToolbar = memo(TextNodeToolbarComponent);
```

- [ ] **Step 2: 运行 TextNodeToolbar 测试**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/TextNodeToolbar.test.tsx
```

Expected: 全部 11 个测试 PASS

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/pages/canvas/components/nodes/TextNodeToolbar.tsx apps/web/src/pages/canvas/components/nodes/TextNodeToolbar.test.tsx
git commit -m "feat: refactor TextNodeToolbar to Tiptap with WYSIWYG commands and active states"
```

---

### Task 4: 重构 TextInputNode — 先写测试

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/TextInputNode.test.tsx`

- [ ] **Step 1: 更新测试，用 Tiptap EditorContent 替换 textarea 断言**

完整替换文件内容：

```typescript
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
  };
};

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
  useNodeStore: vi.fn((selector?: any) => {
    const state = {
      nodes: { n1: { type: 'text', content: '<p>一只猫在窗台上</p>' } },
      updateText: mockUpdateText,
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
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

  it('should show white border when selected', () => {
    const { container } = renderNode({ selected: true });
    expect(container.innerHTML).toContain('border-white/40');
  });

  it('should show toolbar when selected', () => {
    const { container } = renderNode({ selected: true });
    // Toolbar should be rendered inside the selected node
    expect(screen.getByLabelText('加粗')).toBeInTheDocument();
  });

  it('should not show toolbar when not selected', () => {
    renderNode({ selected: false });
    expect(screen.queryByLabelText('加粗')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行 TextInputNode 测试，确认失败**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/TextInputNode.test.tsx
```

Expected: FAIL — 因为 TextInputNode 还在用 `<textarea>`，没有 EditorContent

---

### Task 5: 实现 TextInputNode — 使测试通过

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/TextInputNode.tsx`

- [ ] **Step 1: 完整重写 TextInputNode.tsx，集成 Tiptap**

```typescript
import { memo, useCallback, useState, useRef, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useNodeStore } from '@/stores/nodeStore';
import { TextConfigPanel } from './TextConfigPanel';
import { TextNodeToolbar } from './TextNodeToolbar';

function TextInputNodeComponent({ id, selected }: NodeProps) {
  const updateText = useNodeStore((s) => s.updateText);
  const nodeData = useNodeStore((s) => s.nodes[id]) as { type: 'text'; content: string } | undefined;
  const content = nodeData?.content ?? '';

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
    ],
    content: content,
    editorProps: {
      attributes: {
        class: 'nodrag tiptap-content focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      updateText(id, editor.getHTML());
    },
  });

  // Destroy editor on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  // Title editing (unchanged from markdown version)
  const [label, setLabel] = useState('文本输入');
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(label);

  const save = useCallback(() => {
    const trimmed = draftRef.current.trim();
    if (trimmed) setLabel(trimmed);
    else {
      setDraft(label);
      draftRef.current = label;
    }
  }, [label]);

  const startEdit = useCallback(() => {
    setDraft(label);
    draftRef.current = label;
  }, [label]);

  const titleText = label || '文本输入';

  return (
    <div className="relative">
      {/* Toolbar — above title bar, shown when selected */}
      {selected && (
        <div className="absolute left-1/2 -translate-x-1/2 z-10" style={{ top: -80 }}>
          <TextNodeToolbar nodeId={id} editor={editor} />
        </div>
      )}

      {/* Title bar — below toolbar, above card body */}
      <div
        className="absolute z-[1] pointer-events-auto -translate-y-full left-1 -top-0 pb-2 w-[360px] overflow-hidden whitespace-nowrap flex items-center gap-1 text-[#999]"
        style={{ lineHeight: '18px' }}
      >
        <span className="shrink-0 flex items-center" style={{ width: 12, height: 12 }}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9.719 10.256a.583.583 0 0 1 0 1.166H2.041a.583.583 0 0 1 0-1.166h7.678ZM7.8 6.417a.583.583 0 0 1 0 1.166H2.041a.583.583 0 0 1 0-1.166H7.8ZM11.958 2.578a.583.583 0 0 1 0 1.167H2.041a.583.583 0 0 1 0-1.167h9.917Z" fill="currentColor" />
          </svg>
        </span>
        <div className="relative min-w-0 max-w-full w-max shrink">
          <span
            className="invisible whitespace-pre inline-block pointer-events-none select-none align-top"
            aria-hidden="true"
            style={{ fontSize: 12, lineHeight: '18px' }}
          >
            {titleText}
          </span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              draftRef.current = e.target.value;
            }}
            onFocus={startEdit}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') inputRef.current?.blur();
              if (e.key === 'Escape') {
                setDraft(label);
                draftRef.current = label;
                inputRef.current?.blur();
              }
            }}
            placeholder="请输入标题"
            className="nodrag absolute inset-0 box-border w-full p-0 h-auto bg-transparent text-inherit border-none outline-none"
            style={{ fontSize: 12, lineHeight: '18px', minWidth: 0 }}
            aria-label="节点标题"
            maxLength={20}
          />
        </div>
      </div>

      {/* Card body */}
      <div
        className={`bg-[#222222] border rounded-lg w-[360px] transition-colors ${
          selected ? 'border-white/40' : 'border-[#3a3a3a]'
        }`}
      >
        <Handle type="target" position={Position.Left} className="!bg-[#555] !border-0 !w-2 !h-2" />
        <div className="p-3">
          {/* Tiptap EditorContent replaces textarea */}
          <div className="w-full h-[186px] overflow-y-auto">
            <EditorContent editor={editor} />
          </div>
        </div>
        <Handle type="source" position={Position.Right} className="!bg-[#555] !border-0 !w-2 !h-2" />
      </div>

      {selected && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 z-50 pt-4">
          <TextConfigPanel nodeId={id} />
        </div>
      )}
    </div>
  );
}

export const TextInputNode = memo(TextInputNodeComponent);
```

- [ ] **Step 2: 添加 Tiptap 暗色主题 CSS**

将以下样式追加到 `apps/web/src/index.css` 末尾：

```css
/* Tiptap dark theme content styles */
.tiptap-content {
  color: #bbb;
  font-size: 13px;
  line-height: 1.7;
  outline: none;
  min-height: 170px;
}
.tiptap-content h1 {
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 8px 0;
  line-height: 1.3;
}
.tiptap-content h2 {
  font-size: 18px;
  font-weight: 600;
  color: #eee;
  margin: 12px 0 6px 0;
  line-height: 1.3;
}
.tiptap-content h3 {
  font-size: 15px;
  font-weight: 600;
  color: #ddd;
  margin: 10px 0 4px 0;
  line-height: 1.3;
}
.tiptap-content p {
  font-size: 13px;
  color: #bbb;
  margin: 0 0 8px 0;
  line-height: 1.7;
}
.tiptap-content ul,
.tiptap-content ol {
  font-size: 13px;
  color: #bbb;
  padding-left: 20px;
  line-height: 1.8;
}
.tiptap-content ul {
  list-style-type: disc;
}
.tiptap-content ol {
  list-style-type: decimal;
}
.tiptap-content li {
  margin-bottom: 2px;
}
.tiptap-content hr {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  margin: 10px 0;
}
.tiptap-content strong {
  color: #eee;
  font-weight: 700;
}
.tiptap-content em {
  font-style: italic;
  color: #ccc;
}
.tiptap-content p.is-editor-empty:first-child::before {
  color: #666;
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}
```

- [ ] **Step 3: 运行 TextInputNode 测试**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/TextInputNode.test.tsx
```

Expected: 全部 11 个测试 PASS

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/pages/canvas/components/nodes/TextInputNode.tsx apps/web/src/pages/canvas/components/nodes/TextInputNode.test.tsx
git commit -m "feat: integrate Tiptap EditorContent into TextInputNode, replace textarea"
```

---

### Task 6: 全局验证

- [ ] **Step 1: 运行全部测试**

```bash
cd apps/web && npx vitest run
```

Expected: 全部测试 PASS（约 141+ 个，分布在 31+ 个文件中）

- [ ] **Step 2: 检查 TypeScript 编译**

```bash
cd apps/web && npx tsc -b --noEmit 2>&1 | head -50
```

Expected: 无类型错误

- [ ] **Step 3: 启动开发服务器手动验证**

```bash
cd apps/web && pnpm dev
```

验证项：
1. 创建文本节点 → 确认内容区域是 Tiptap 编辑器
2. 选中文字 → 点击加粗 → 文字直接变粗（不是 `**` 包裹）
3. 点击 H1 → 文字变大变粗
4. 点击 UL → 变为无序列表
5. 选中标题 → H1 按钮高亮
6. 点击工具栏按钮 → 编辑器焦点保持不丢失

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "feat: complete Tiptap WYSIWYG rich text editor integration"
```
