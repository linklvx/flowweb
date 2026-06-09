# 文本节点缩放手柄灵敏度优化 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `TextInputNode` 的 `NodeResizer` 组件替换为 `useNodeResizer` hook，实现四角按需显示 + 24px 扩大触发区域的自定义缩放手柄。

**Architecture:** 用 `useNodeResizer` hook 获取 `handleMouseDown` 和 `isResizing`，在最外层 `div.canvas-node` 绑定 `onMouseMove`/`onMouseLeave` 检测鼠标与四角的距离，仅渲染当前悬停角的单个手柄。`handleMouseDown` 通过 `stopPropagation` 阻止节点拖拽冲突。

**Tech Stack:** React 18 + @xyflow/react ^12.0.0 + TipTap + Vitest + @testing-library/react

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/web/src/pages/canvas/components/nodes/TextInputNode.tsx` | 修改 | 替换 NodeResizer → useNodeResizer + 自定义手柄 |
| `apps/web/src/pages/canvas/components/nodes/TextInputNode.test.tsx` | 修改 | 更新 mock + 重写 resize 测试 |

---

### Task 1: RED — 更新测试文件，为新行为编写失败测试

**文件:**
- 修改: `apps/web/src/pages/canvas/components/nodes/TextInputNode.test.tsx`

**说明:** 更新 `@xyflow/react` mock 以包含 `useNodeResizer` 和 `zoom`。重写所有 resize 相关测试，删除旧的 `NodeResizer` 8-controls 测试，新增自定义手柄行为测试。

**mockHandleMouseDown** 和 **mockGetBoundingClientRect** 在 `describe` 顶层声明，`beforeEach` 中重置。

- [ ] **Step 1: 更新 mock 配置**

在 `vi.mock('@xyflow/react', ...)` 中添加 `useNodeResizer` mock 和 `zoom`：

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
```

**同时更新 `beforeEach`** — 替换现有的 `beforeEach` 为完整版本：

```typescript
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
```

- [ ] **Step 2: 删除旧的 NodeResizer 测试**

删除以下测试（不再适用）：
- `'should render 8 NodeResizer controls when single selected'`（旧代码行 228-232）

保留并适配以下测试：
- `'should not show resize handles when not selected'` — 改为查询 `[data-testid="resize-handle"]`
- `'should show resize handles when single selected'` — 需要 mock rect + fireEvent.mouseMove

- [ ] **Step 3: 重写 resize 测试套件**

替换旧的 resize 测试块（从 `// === Resize (Task 4) ===` 开始）为以下内容：

```typescript
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

    it('should stop mousedown propagation (prevent node drag)', () => {
      const { container } = renderNode({ selected: true });
      const nodeEl = container.querySelector('.canvas-node') as HTMLElement;
      mockNodeRect(nodeEl);
      fireEvent.mouseMove(nodeEl, { clientX: 295, clientY: 295 });
      const handle = screen.getByTestId('resize-handle');
      const parentHandler = vi.fn();
      nodeEl.addEventListener('mousedown', parentHandler);
      fireEvent.mouseDown(handle, { button: 0 });
      expect(parentHandler).not.toHaveBeenCalled(); // stopPropagation prevented bubble
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
      mockIsResizing = true;
      const { container } = renderNode({ selected: true });
      const nodeEl = container.querySelector('.canvas-node') as HTMLElement;
      mockNodeRect(nodeEl);

      // Show handle by hovering corner
      fireEvent.mouseMove(nodeEl, { clientX: 295, clientY: 295 });
      expect(screen.getByTestId('resize-handle')).toBeInTheDocument();

      // Mouse leaves — handle should stay because isResizing=true
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
```

- [ ] **Step 4: 运行测试确认失败 (RED)**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/TextInputNode.test.tsx
```

预期：多个测试 FAIL，因为：
- `useNodeResizer` 尚未导入 → 编译错误或 mock 不匹配
- `NodeResizer` 仍在使用 → `react-flow__resize-control` 选择器测试失败
- 新增 `[data-testid="resize-handle"]` 测试 → 元素不存在

- [ ] **Step 5: 提交 RED 测试**

```bash
git add apps/web/src/pages/canvas/components/nodes/TextInputNode.test.tsx
git commit -m "test: add failing tests for custom resize handle (RED)"
```

---

### Task 2: GREEN — 实现自定义缩放手柄逻辑

**文件:**
- 修改: `apps/web/src/pages/canvas/components/nodes/TextInputNode.tsx`

**说明:** 替换 `NodeResizer` 为 `useNodeResizer` hook，实现四角检测 + 按需渲染。

- [ ] **Step 1: 更新 import**

修改第 1-2 行：

```typescript
// 旧
import { memo, useCallback, useState, useRef, useEffect } from 'react';
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react';

// 新
import { memo, useCallback, useState, useRef, useEffect } from 'react';
import { useNodeResizer, useReactFlow, type NodeProps } from '@xyflow/react';
```

- [ ] **Step 2: 在组件函数顶部添加配置常量、类型和状态**

在 `function TextInputNodeComponent({ id, selected }: NodeProps) {` 之后，第 12 行 `const updateText` 之前插入：

```typescript
  // ========== Resize config & state ==========

  type CornerType = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | null;

  const RESIZE_CONFIG = {
    minWidth: 300,
    minHeight: 300,
    maxWidth: 2000,
    maxHeight: 1500,
    hitAreaSize: 24,
    visualHandleSize: 14,
    handleOffset: -7,
    handleColor: '#9CA3AF',
  } as const;

  const [activeCorner, setActiveCorner] = useState<CornerType>(null);
  const containerRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 3: 更新 useReactFlow 解构以获取 zoom**

修改第 16 行：

```typescript
// 旧
  const { getNodes } = useReactFlow();

// 新
  const { getNodes, zoom } = useReactFlow();
```

- [ ] **Step 4: 添加 useNodeResizer hook**

在第 19 行 `const isSingleSelected = ...` 之后插入：

```typescript
  // useNodeResizer replaces NodeResizer component
  const { isResizing, handleMouseDown: handleResizeMouseDown } = useNodeResizer({
    nodeId: id,
    minWidth: RESIZE_CONFIG.minWidth,
    minHeight: RESIZE_CONFIG.minHeight,
    maxWidth: RESIZE_CONFIG.maxWidth,
    maxHeight: RESIZE_CONFIG.maxHeight,
    keepAspectRatio: false,
    shouldResize: () => true,
  });
```

注意：将 `handleMouseDown` 重命名为 `handleResizeMouseDown` 以避免与手柄自身的 `onMouseDown` 命名冲突。

- [ ] **Step 5: 添加角检测和事件处理函数**

在 `useNodeResizer` hook 之后，`const editor = useEditor(...)` 之前插入：

```typescript
  // Calculate which corner the mouse is near
  const calculateActiveCorner = useCallback((e: React.MouseEvent): CornerType => {
    if (!containerRef.current || !isSingleSelected) return null;

    const rect = containerRef.current.getBoundingClientRect();
    const hitSize = RESIZE_CONFIG.hitAreaSize / zoom;
    const { clientX, clientY } = e;

    // top-left
    if (clientX >= rect.left && clientX <= rect.left + hitSize &&
        clientY >= rect.top && clientY <= rect.top + hitSize) {
      return 'top-left';
    }
    // top-right
    if (clientX >= rect.right - hitSize && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.top + hitSize) {
      return 'top-right';
    }
    // bottom-left
    if (clientX >= rect.left && clientX <= rect.left + hitSize &&
        clientY >= rect.bottom - hitSize && clientY <= rect.bottom) {
      return 'bottom-left';
    }
    // bottom-right
    if (clientX >= rect.right - hitSize && clientX <= rect.right &&
        clientY >= rect.bottom - hitSize && clientY <= rect.bottom) {
      return 'bottom-right';
    }

    return null;
  }, [isSingleSelected, zoom]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isResizing) return;
    const corner = calculateActiveCorner(e);
    setActiveCorner((prev) => (prev !== corner ? corner : prev));
  }, [calculateActiveCorner, isResizing]);

  const handleMouseLeave = useCallback(() => {
    if (!isResizing) setActiveCorner(null);
  }, [isResizing]);

  // 兜底：处理 handleMouseLeave 覆盖不到的极端情况。
  // 例如 blur handler dispatch mouseup → isResizing 变 false，但鼠标仍在角上。
  // 正常路径由 handleMouseLeave 清理，此 effect 保证 resize 结束后必然清除。
  useEffect(() => {
    if (!isResizing) setActiveCorner(null);
  }, [isResizing]);

  // Window blur → cancel resize
  useEffect(() => {
    const handleBlur = () => {
      if (isResizing) {
        document.dispatchEvent(new MouseEvent('mouseup'));
        setTimeout(() => setActiveCorner(null), 0);
      }
    };
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [isResizing]);
```

- [ ] **Step 6: 添加手柄样式生成函数**

在 `handleMouseLeave` 之后，`handleDoubleClick`（实际上当前代码没有这个，在 `const editor = useEditor(...)` 之后区域）插入。放在 `const titleText = label || 'Text';` 之前（第 71 行之前）：

```typescript
  // Generate inline style for the active corner handle
  const getHandleStyle = (corner: CornerType): React.CSSProperties => {
    if (!corner) return {};

    const cursorMap: Record<string, string> = {
      'top-left': 'nwse-resize',
      'bottom-right': 'nwse-resize',
      'top-right': 'nesw-resize',
      'bottom-left': 'nesw-resize',
    };

    const offset = RESIZE_CONFIG.handleOffset;
    const size = RESIZE_CONFIG.visualHandleSize;

    const base: React.CSSProperties = {
      position: 'absolute',
      width: size,
      height: size,
      borderRadius: '50%',
      backgroundColor: 'white',
      border: `2px solid ${RESIZE_CONFIG.handleColor}`,
      zIndex: 9999,
      cursor: cursorMap[corner] || 'default',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      transition: 'opacity 0.15s ease-out',
    };

    switch (corner) {
      case 'top-left':     return { ...base, top: offset, left: offset };
      case 'top-right':    return { ...base, top: offset, right: offset };
      case 'bottom-left':  return { ...base, bottom: offset, left: offset };
      case 'bottom-right': return { ...base, bottom: offset, right: offset };
      default: return base;
    }
  };
```

- [ ] **Step 7: 修改 JSX — 在最外层容器上添加 ref + 事件，插入自定义手柄，移除 NodeResizer**

修改第 73-74 行的最外层 div：

```typescript
// 旧
  return (
    <div className="relative canvas-node">

// 新
  return (
    <div
      ref={containerRef}
      className="relative canvas-node"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
```

在第 133 行 `{/* Target handle */}` 之后，第 135 行 `{/* Card body */}` 之前，插入自定义手柄：

```typescript
      {/* Target handle — outside overflow-hidden */}
      <NodeHandle type="target" testId="target-handle" />

      {/* Custom resize handle — rendered outside overflow-hidden, only when a corner is active */}
      {isSingleSelected && activeCorner && (
        <div
          data-testid="resize-handle"
          style={getHandleStyle(activeCorner)}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            handleResizeMouseDown(e, activeCorner);
          }}
        />
      )}

      {/* Card body */}
```

移除旧的 `NodeResizer` 组件（原第 140-147 行）：

```typescript
// 删除以下代码：
        <NodeResizer
          minWidth={300}
          minHeight={300}
          maxWidth={2000}
          maxHeight={1500}
          isVisible={isSingleSelected}
          color="#9CA3AF"
        />
```

修改 border overlay 的 z-index（第 164 行），因为不再需要低于 NodeResizer：

```typescript
// 旧
            zIndex: 10,

// 新（手柄在最外层，不再与 overlay 竞争层级；降低 overlay 的 z-index 含义不变）
            zIndex: 5,
```

- [ ] **Step 8: 运行测试确认通过 (GREEN)**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/TextInputNode.test.tsx
```

预期：所有测试 PASS。

- [ ] **Step 9: TypeScript 类型检查**

```bash
cd apps/web && npx tsc --noEmit
```

预期：无类型错误。

- [ ] **Step 10: 提交 GREEN 实现**

```bash
git add apps/web/src/pages/canvas/components/nodes/TextInputNode.tsx apps/web/src/pages/canvas/components/nodes/TextInputNode.test.tsx
git commit -m "feat: replace NodeResizer with useNodeResizer for custom corner-only resize handles

- Replace NodeResizer component with useNodeResizer hook
- Show single resize handle only when mouse hovers a corner
- 24px transparent hit area (3x larger than default 8px)
- Hit area adapts to canvas zoom (hitSize / zoom)
- stopPropagation prevents accidental node drag
- Window blur cancels active resize
- Right-click ignored, left-click only"
```

---

### Task 3: 验证 — 完整测试 + 手动冒烟

- [ ] **Step 1: 运行全量测试**

```bash
cd apps/web && npx vitest run
```

确认无回归。

- [ ] **Step 2: 启动 dev server 手动验证**

```bash
cd apps/web && pnpm dev
```

在浏览器中验证：
1. 创建一个文本节点
2. 选中节点 → 鼠标移到四角 → 确认手柄按需出现
3. 拖拽手柄 → 确认缩放正常
4. 检查 title bar 在 resize 后位置是否正确（使用 `nodeWidth` prop）

---

## 验收检查清单

- [ ] `NodeResizer` import 已移除
- [ ] `useNodeResizer` hook 正确配置（`nodeId`, min/max, `keepAspectRatio`, `shouldResize`）
- [ ] 手柄渲染在 `overflow-hidden` div 外部
- [ ] `onMouseMove` / `onMouseLeave` 绑定在最外层容器
- [ ] `e.stopPropagation()` 在手柄 `onMouseDown` 中调用
- [ ] `e.button !== 0` 过滤右键点击
- [ ] 窗口 blur 时取消拖拽并清除手柄
- [ ] `handleMouseDown` 传入完整小写连字符方向参数
- [ ] 16 条测试全部通过
- [ ] TypeScript strict 无错误
- [ ] `syncNodeDimensions` (CanvasView.tsx) 无需修改，dimensions change 自动触发
- [ ] 代码中无四边中点（top/right/bottom/left）手柄逻辑，仅处理四角
- [ ] `NodeResizer` 组件导入已完全移除，无残留（包括 `@xyflow/node-resizer/dist/style.css` 等 CSS 导入）
