# AI 工具扩展弹出面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 悬浮工具栏"九宫格"按钮改名为"AI工具扩展"，点击弹出 AI 工具动作面板，选择工具后按节点类型执行不同操作。

**Architecture:** 新建 `AiToolActionPopup` 组件（复刻 ImageExtConfigPanel 弹窗 UI），`ImageNodeToolbar` 接入该组件，`ImageGenNode` 提供 `handleAiToolAction` 回调，`canvasStore` 新增 `createDerivedExtNode` 方法处理派生节点创建。ImageExtConfigPanel 零改动。

**Tech Stack:** React + TypeScript + Zustand + React Flow + Ant Design

---

### Task 1: AiToolActionPopup 组件 (TDD)

**Files:**
- Create: `apps/web/src/pages/canvas/components/nodes/AiToolActionPopup.tsx`
- Create: `apps/web/src/pages/canvas/components/nodes/AiToolActionPopup.test.tsx`

- [ ] **Step 1: 编写测试 — 渲染、onSelect 回调、外部点击关闭**

```typescript
// AiToolActionPopup.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AiToolActionPopup } from './AiToolActionPopup';
import type { AiToolId } from '@/stores/nodeStore';

// Mock AI_TOOL_GROUPS to keep test deterministic
vi.mock('./ai/aiToolConfig', () => ({
  AI_TOOL_GROUPS: [
    {
      groupName: '分镜叙事',
      items: [
        { id: 'nine_camera' as AiToolId, name: '多机位九宫格', desc: '生成多视角机位图', icon: <span>N</span> },
        { id: 'four_panel' as AiToolId, name: '剧情推演四宫格', desc: '生成四格剧情推演', icon: <span>F</span> },
      ],
    },
    {
      groupName: '设定图',
      items: [
        { id: 'face_three_view' as AiToolId, name: '角色脸部三视图', desc: '基于一张参考图生成脸部细节三视图', icon: <span>V</span> },
      ],
    },
  ],
}));

describe('AiToolActionPopup', () => {
  beforeEach(() => {
    // Clean up any portal containers
    const existing = document.getElementById('popup-test-portal');
    if (existing) existing.remove();
  });

  afterEach(() => {
    const existing = document.getElementById('popup-test-portal');
    if (existing) existing.remove();
  });

  it('should render nothing when open is false', () => {
    const { container } = render(
      <AiToolActionPopup open={false} onClose={vi.fn()} onSelect={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('should render tool groups and items when open', () => {
    render(<AiToolActionPopup open={true} onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByText('分镜叙事')).toBeTruthy();
    expect(screen.getByText('多机位九宫格')).toBeTruthy();
    expect(screen.getByText('剧情推演四宫格')).toBeTruthy();
    expect(screen.getByText('设定图')).toBeTruthy();
    expect(screen.getByText('角色脸部三视图')).toBeTruthy();
  });

  it('should call onSelect with toolId when clicking a tool card', () => {
    const onSelect = vi.fn();
    render(<AiToolActionPopup open={true} onClose={vi.fn()} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('多机位九宫格'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('nine_camera' as AiToolId);
  });

  it('should call onClose when clicking outside the popup', () => {
    const onClose = vi.fn();
    render(
      <div data-testid="outside">
        <AiToolActionPopup open={true} onClose={onClose} onSelect={vi.fn()} />
      </div>
    );
    // Click the outer div (not the popup content)
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should call onClose when pressing Escape', () => {
    const onClose = vi.fn();
    render(<AiToolActionPopup open={true} onClose={onClose} onSelect={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should not render tool descriptions by default', () => {
    render(<AiToolActionPopup open={true} onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.queryByText('生成多视角机位图')).toBeFalsy();
  });
});
```

- [ ] **Step 2: 运行测试 — 确认失败**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/AiToolActionPopup.test.tsx
```
Expected: FAIL — `AiToolActionPopup` not exported

- [ ] **Step 3: 实现 AiToolActionPopup 组件最小可用版本**

```typescript
// AiToolActionPopup.tsx
import { memo, useEffect, useRef, useCallback } from 'react';
import type { AiToolId } from '@/stores/nodeStore';
import { AI_TOOL_GROUPS } from './ai/aiToolConfig';

export interface AiToolActionPopupProps {
  open: boolean;
  onClose: () => void;
  onSelect: (toolId: AiToolId) => void;
  anchorEl?: HTMLElement | null;
}

const POPUP_BASE_CLASS = 'absolute top-full left-1/2 -translate-x-1/2 mt-2 z-[10001] rounded-2xl p-3 border border-[#363636] shadow-[0_4px_10px_rgba(0,0,0,0.25),0_2px_4px_rgba(0,0,0,0.3)]';
const POPUP_BASE_STYLE: React.CSSProperties = {
  backgroundColor: 'oklab(0.26861 0.0000122264 0.00000536442 / 0.95)',
  backdropFilter: 'blur(32px)',
  width: 680,
  maxWidth: 'calc(100vw - 16px)',
};

function AiToolActionPopupComponent({ open, onClose, onSelect, anchorEl }: AiToolActionPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);

  // External click to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Viewport boundary check
  const checkPopupBounds = useCallback(() => {
    if (!popupRef.current) return;
    const popup = popupRef.current;
    popup.style.left = '50%';
    popup.style.transform = 'translateX(-50%)';
    requestAnimationFrame(() => {
      const rect = popup.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        popup.style.left = 'auto';
        popup.style.right = '0';
        popup.style.transform = 'none';
      }
      if (rect.left < 8) {
        popup.style.left = '0';
        popup.style.right = 'auto';
        popup.style.transform = 'none';
      }
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    checkPopupBounds();
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(checkPopupBounds, 100);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(timer);
    };
  }, [open, checkPopupBounds]);

  if (!open) return null;

  // Distribute groups into 3 columns (same algorithm as ImageExtConfigPanel)
  const flatItems = AI_TOOL_GROUPS.map((g) => ({ group: g }));
  const totalWeight = flatItems.reduce((sum, item) => sum + item.group.items.length + 1, 0);
  const perCol = Math.ceil(totalWeight / 3);
  const cols: typeof flatItems[] = [[], [], []];
  let colIdx = 0;
  let colWeight = 0;
  flatItems.forEach((item) => {
    const w = item.group.items.length + 1;
    if (colWeight > 0 && colWeight + w > perCol && colIdx < 2) {
      colIdx++;
      colWeight = 0;
    }
    cols[colIdx].push(item);
    colWeight += w;
  });

  return (
    <div ref={popupRef} className={POPUP_BASE_CLASS} style={POPUP_BASE_STYLE}>
      <div className="flex gap-3">
        {cols.map((col, ci) => (
          <div key={ci} className="flex-1 flex flex-col gap-1">
            {col.map((item) => (
              <div key={item.group.groupName} className="flex flex-col gap-0.5">
                <div className="px-2 py-1">
                  <span className="text-[#999] text-xs font-medium">{item.group.groupName}</span>
                </div>
                {item.group.items.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => onSelect(tool.id)}
                    className="group flex h-[52px] w-full cursor-pointer items-center gap-2 rounded-xl p-2 text-left transition-colors duration-200 border-none bg-transparent text-[#999] hover:bg-white/5"
                  >
                    <div className="relative flex size-[34px] flex-none items-center justify-center rounded-lg bg-white/5">
                      {tool.icon}
                      {tool.isNew && (
                        <span className="pointer-events-none absolute right-[3px] top-[3px] size-1.5 rounded-full bg-[#5DDCFF] border border-[#1a1a1a]" />
                      )}
                    </div>
                    <div className="flex flex-col justify-center overflow-hidden">
                      <span className="text-sm font-medium truncate">{tool.name}</span>
                      <span className="mt-0.5 text-xs leading-4 text-[#999] opacity-0 group-hover:opacity-60 transition-opacity duration-200">{tool.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export const AiToolActionPopup = memo(AiToolActionPopupComponent);
```

- [ ] **Step 4: 运行测试 — 确认通过**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/AiToolActionPopup.test.tsx
```
Expected: all 6 tests PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/canvas/components/nodes/AiToolActionPopup.tsx apps/web/src/pages/canvas/components/nodes/AiToolActionPopup.test.tsx
git commit -m "feat: add AiToolActionPopup component with tests"
```

---

### Task 2: canvasStore.createDerivedExtNode (TDD)

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts` — 在 `addNodeWithEdge` 后添加新方法
- Modify: `apps/web/src/stores/canvasStore.test.ts` — 添加测试

- [ ] **Step 1: 在 canvasStore interface 中声明类型**

在 `canvasStore.ts` 中 `CanvasState` interface 的 `splitImageNode` 之前添加：

```typescript
import type { AiToolId } from './nodeStore';

// ...

interface CreateDerivedExtNodeParams {
  sourceNodeId: string;
  referenceImage?: string;
  aiTool: AiToolId;
}

// 在 CanvasState interface 中添加:
createDerivedExtNode: (params: CreateDerivedExtNodeParams) => string | null;
```

- [ ] **Step 2: 编写测试 — canvasStore.test.ts**

在现有测试文件末尾添加：

```typescript
import type { AiToolId } from './nodeStore';

// ... inside describe('canvasStore', () => {

describe('createDerivedExtNode', () => {
  it('should create a new imageExtGen node to the right of the source', () => {
    // First create a source imageGen node
    const sourceId = useCanvasStore.getState().addNode('image', { x: 100, y: 200 });
    // Give it a measured width by looking at what addNode sets... 
    // Actually let's test position calculation differently.
    // addNode doesn't set measured. We'll test with the default fallback of 300px.
    
    const result = (useCanvasStore.getState() as any).createDerivedExtNode?.({
      sourceNodeId: sourceId,
      referenceImage: 'file-123',
      aiTool: 'nine_camera' as AiToolId,
    });

    if (result === undefined) {
      // Method not implemented yet - expected in red phase
      expect(true).toBe(false);
      return;
    }

    const s = useCanvasStore.getState();
    const newNode = s.nodes.find((n: any) => n.id === result);
    expect(newNode).toBeTruthy();
    expect(newNode!.type).toBe('imageExtGen');
    // Position: 100 + 300 (default width) + 80 = 480
    expect(newNode!.position.x).toBe(480);
    expect(newNode!.position.y).toBe(200);
    
    // Check nodeStore data
    const nsNode = useNodeStore.getState().nodes[result];
    expect(nsNode.data.aiTool).toBe('nine_camera');
    expect(nsNode.data.allImages).toEqual([{ fileId: 'file-123' }]);
    
    // Edge created
    const edge = s.edges.find((e: any) => e.source === sourceId && e.target === result);
    expect(edge).toBeTruthy();
    
    // New node selected
    expect(s.selectedId).toBe(result);
  });

  it('should return null for non-existent source node', () => {
    const result = (useCanvasStore.getState() as any).createDerivedExtNode?.({
      sourceNodeId: 'nonexistent',
      referenceImage: 'file-123',
      aiTool: 'nine_camera' as AiToolId,
    });
    if (result === undefined) {
      expect(true).toBe(false);
      return;
    }
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: 运行测试 — 确认失败**

```bash
cd apps/web && npx vitest run src/stores/canvasStore.test.ts
```
Expected: FAIL — `createDerivedExtNode` not a function

- [ ] **Step 4: 实现 createDerivedExtNode**

在 `canvasStore.ts` 的 `addNodeWithEdge` 方法之后添加：

```typescript
createDerivedExtNode: (params) => {
  const source = get().nodes.find((n) => n.id === params.sourceNodeId);
  if (!source) return null;

  const sw = source.measured?.width ?? source.width ?? 300;
  const GAP = 80;
  const position = {
    x: source.position.x + sw + GAP,
    y: source.position.y,
  };

  const newNodeId = get().addNode('imageExt', position, {
    allImages: params.referenceImage ? [{ fileId: params.referenceImage }] : [],
    aiTool: params.aiTool,
    extConfig: { ...IMAGE_EXT_DEFAULTS },  // 显式初始化，保证 isImageExtNode 类型守卫通过
  });

  const edgeId = getId('edge');
  const edge = { id: edgeId, source: params.sourceNodeId, target: newNodeId };
  set((s) => ({ edges: [...s.edges, edge] }));

  return newNodeId;
},
```

- [ ] **Step 5: 运行测试 — 确认通过**

```bash
cd apps/web && npx vitest run src/stores/canvasStore.test.ts
```
Expected: all tests PASS

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.test.ts
git commit -m "feat: add createDerivedExtNode to canvasStore"
```

---

### Task 3: ImageNodeToolbar 接入 AiToolActionPopup

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx`

- [ ] **Step 1: 替换按钮 + 接入弹窗**

三个编辑点：

**A. 导入 (第1行之后):**
```typescript
import { AiToolActionPopup } from './AiToolActionPopup';
import type { AiToolId } from '@/stores/nodeStore';
```

**B. Props 扩展 (interface ImageNodeToolbarProps):**
```typescript
  onAiToolAction?: (toolId: AiToolId) => void;
```

**C. 解构 props (function ImageNodeToolbarComponent):**
```typescript
  onAiToolAction,
}: ImageNodeToolbarProps) {
```

**D. 添加状态和 ref (在 existing useState 附近):**
```typescript
  const [aiToolPopupOpen, setAiToolPopupOpen] = useState(false);
  const aiToolBtnRef = useRef<HTMLDivElement>(null);
```

**E. 替换按钮 (第568-569行):**
```tsx
// 移除:
<TextIconButton icon={<Grid3x3Icon />} ariaLabel="九宫格" text="九宫格" />

// 替换为:
<div ref={aiToolBtnRef} className="relative">
  <TextIconButton
    icon={<Grid3x3Icon />}
    ariaLabel="AI工具扩展"
    text="AI工具扩展"
    disabled={!hasImage}
    onClick={() => setAiToolPopupOpen((v) => !v)}
  />
  {aiToolPopupOpen && (
    <AiToolActionPopup
      open={aiToolPopupOpen}
      onClose={() => setAiToolPopupOpen(false)}
      onSelect={(toolId) => {
        setAiToolPopupOpen(false);
        onAiToolAction?.(toolId);
      }}
      anchorEl={aiToolBtnRef.current}
    />
  )}
</div>
```

- [ ] **Step 2: 运行现有测试确保不退化**

```bash
cd apps/web && npx vitest run --reporter=verbose 2>&1 | tail -20
```
Expected: no unexpected failures

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx
git commit -m "feat: add AI工具扩展 button and AiToolActionPopup to toolbar"
```

---

### Task 4: ImageGenNode 添加 handleAiToolAction

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx`

- [ ] **Step 1: 添加 import**

```typescript
import type { AiToolId } from '@/stores/nodeStore';
```

- [ ] **Step 2: 添加 useReactFlow hook（已导入，确认 fitView 可用）**

在 `ImageGenNodeComponent` 函数体内，现有 `const { fitView, getNodes, setNodes } = useReactFlow();` 已存在，无需改动。

- [ ] **Step 3: 添加 handleAiToolAction 回调**

在 `handleGridSplit` 之后添加：

```typescript
const handleAiToolAction = useCallback((toolId: AiToolId) => {
  const nodeType = useNodeStore.getState().nodes[id]?.type;
  if (nodeType === 'imageExtGen') {
    updateConfig(id, { aiTool: toolId });
  } else {
    const newNodeId = useCanvasStore.getState().createDerivedExtNode({
      sourceNodeId: id,
      referenceImage: nodeData?.fileId,
      aiTool: toolId,
    });
    if (newNodeId) {
      setTimeout(() => {
        fitView({ nodes: [{ id: newNodeId }], duration: 300 });
      }, 50);
    }
  }
}, [id, nodeData?.fileId, updateConfig, fitView]);
```

- [ ] **Step 4: 传入 ImageNodeToolbar**

在 `<ImageNodeToolbar ... />` 的 props 中添加：

```tsx
onAiToolAction={handleAiToolAction}
```

- [ ] **Step 5: 运行测试确保不退化**

```bash
cd apps/web && npx vitest run --reporter=verbose 2>&1 | tail -30
```
Expected: no unexpected failures

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx
git commit -m "feat: add handleAiToolAction to ImageGenNode"
```

---

### Task 5: 全量验证

- [ ] **Step 1: 运行所有测试**

```bash
cd apps/web && npx vitest run
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -50
```

---

## 文件变更汇总

| 文件 | 变更类型 |
|------|----------|
| `components/nodes/AiToolActionPopup.tsx` | **新建** |
| `components/nodes/AiToolActionPopup.test.tsx` | **新建** |
| `components/nodes/ImageNodeToolbar.tsx` | 修改：按钮重命名 + 弹窗接入 + onAiToolAction prop |
| `components/nodes/ImageGenNode.tsx` | 修改：新增 handleAiToolAction 回调 |
| `stores/canvasStore.ts` | 修改：新增 createDerivedExtNode 方法 |
| `stores/canvasStore.test.ts` | 修改：新增 createDerivedExtNode 测试 |

**不改动**：`ImageExtConfigPanel.tsx`、`ImageConfigPanel.tsx`、`aiToolConfig.ts`、`nodeStore.ts`
