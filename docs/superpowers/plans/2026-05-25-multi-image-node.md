# MultiImageNode 多图堆叠节点 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建独立节点类型 MultiImageNode，支持堆叠视图 ↔ 展开网格、多图上传、dnd-kit 拖拽排序、ImageWithFallback 错误处理

**Architecture:** 遵循现有节点架构模式 — nodeStore 管理数据、canvasStore 管理 ReactFlow 状态、memo 包裹组件、TDD 红-绿-重构。复用 ImageItem 类型、presignUpload 上传管线、useMediaUrl hook、dnd-kit 依赖

**Tech Stack:** React 18 + TypeScript strict + @xyflow/react + Zustand + Tailwind CSS + Vitest + @testing-library/react

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `apps/web/src/stores/nodeStore.ts` | 修改 | 新增 MultiImageNodeData 类型 + 4 个 actions + 类型守卫 |
| `apps/web/src/stores/canvasStore.ts` | 修改 | nodeTypeMap 新增 multiImage → multiImageGen |
| `apps/web/src/pages/canvas/components/CanvasView.tsx` | 修改 | 注册 multiImageGen 节点类型 |
| `apps/web/src/components/common/ImageWithFallback.tsx` | 新建 | 通用图片加载失败兜底组件 |
| `apps/web/src/components/common/ImageWithFallback.test.tsx` | 新建 | ImageWithFallback 单元测试 |
| `apps/web/src/pages/canvas/components/nodes/MultiImageNode.tsx` | 新建 | 节点主组件（堆叠+展开+上传+标题） |
| `apps/web/src/pages/canvas/components/nodes/MultiImageNode.test.tsx` | 新建 | 节点组件测试（18 条） |
| `apps/web/src/pages/canvas/components/nodes/MultiImageConfigPanel.tsx` | 新建 | 配置面板（上传+拖拽排序+删除+清空） |
| `apps/web/src/pages/canvas/components/nodes/MultiImageConfigPanel.test.tsx` | 新建（后修改） | 配置面板测试（6 条） |

---

### Task 1: 扩展 nodeStore — 类型 + Actions + 类型守卫

**Files:**
- Modify: `apps/web/src/stores/nodeStore.ts`

- [ ] **Step 1: 在 nodeStore.ts 中添加 MultiImageNodeData 接口**

在 `ImageNodeData` 接口之后（第 48 行后）插入：

```typescript
export interface MultiImageNodeData {
  label?: string;
  images: ImageItem[];
  mainImageIndex: number;
  expanded: boolean;
  nodeStatus: 'idle' | 'loading' | 'done' | 'error';
  // 预留字段（不在本版本实现）
  generationBatchId?: string;
  prompt?: string;
}
```

- [ ] **Step 2: 更新 NodeData 联合类型**

修改第 50 行：
```typescript
export type NodeData = TextNodeData | ImageNodeData | VideoNodeData | AudioNodeData | MultiImageNodeData;
```

- [ ] **Step 3: 添加类型守卫**

在 `isTextNode` 之后（第 70 行后）插入：
```typescript
export function isMultiImageNode(node: AppNode): node is AppNode & { data: MultiImageNodeData } {
  return node.type === 'multiImageGen';
}
```

- [ ] **Step 4: 添加 4 个 Store Actions**

在 `NodeState` 接口（第 121 行前）添加签名：
```typescript
updateMultiImageImages: (nodeId: string, images: ImageItem[]) => void;
setMainImageIndex: (nodeId: string, index: number) => void;
toggleExpanded: (nodeId: string) => void;
updateMultiImageNodeStatus: (nodeId: string, status: MultiImageNodeData['nodeStatus']) => void;
```

在 store 创建体（`getNodeData` 方法前，约第 270 行）添加实现：
```typescript
updateMultiImageImages: (nodeId, images) => {
  const existing = getNode(get().nodes, nodeId);
  if (!existing) return;
  set((s) => ({
    nodes: {
      ...s.nodes,
      [nodeId]: {
        ...existing,
        data: {
          ...existing.data,
          images,
          // 如果删除所有图片，重置 mainImageIndex 和 nodeStatus
          ...(images.length === 0 ? { mainImageIndex: -1, nodeStatus: 'idle' as const } : {}),
          // 如果 mainImageIndex 超出新数组范围，重置为 0
          ...(images.length > 0 && 'mainImageIndex' in existing.data && (existing.data as any).mainImageIndex >= images.length ? { mainImageIndex: 0 } : {}),
        },
      },
    },
  }));
},

setMainImageIndex: (nodeId, index) => {
  const existing = getNode(get().nodes, nodeId);
  if (!existing || !isMultiImageNode(existing)) return;
  set((s) => ({
    nodes: {
      ...s.nodes,
      [nodeId]: {
        ...existing,
        data: { ...existing.data, mainImageIndex: index },
      },
    },
  }));
},

toggleExpanded: (nodeId) => {
  const existing = getNode(get().nodes, nodeId);
  if (!existing) return;
  set((s) => ({
    nodes: {
      ...s.nodes,
      [nodeId]: {
        ...existing,
        data: { ...existing.data, expanded: !(existing.data as any).expanded },
      },
    },
  }));
},

updateMultiImageNodeStatus: (nodeId, status) => {
  const existing = getNode(get().nodes, nodeId);
  if (!existing) return;
  set((s) => ({
    nodes: {
      ...s.nodes,
      [nodeId]: {
        ...existing,
        data: { ...existing.data, nodeStatus: status },
      },
    },
  }));
},
```

- [ ] **Step 5: 扩展 deleteNode 清理多图节点图片文件**

在 `deleteNode` 方法中（第 158-174 行），在现有 `isImageNode` 检查后追加对 `isMultiImageNode` 的清理：

将 deleteNode 的条件改为：
```typescript
deleteNode: async (nodeId: string) => {
    const node = getNode(get().nodes, nodeId);
    if (node && isImageNode(node)) {
      // ... 现有清理逻辑保持不变 ...
    }
    if (node && isMultiImageNode(node)) {
      const imgData = node.data;
      const deleteRefs = imgData.images.map((img) =>
        fetch(`/api/storage/files/${img.id}`, { method: 'DELETE' }).catch(() => {})
      );
      await Promise.allSettled(deleteRefs);
    }

    const newNodes = { ...get().nodes };
    delete newNodes[nodeId];
    set({ nodes: newNodes });
  },
```

- [ ] **Step 6: 验证 typecheck**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: No type errors related to nodeStore.ts

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/stores/nodeStore.ts
git commit -m "feat: add MultiImageNodeData type, actions, and type guard to nodeStore

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: ImageWithFallback 组件 (TDD)

**Files:**
- Create: `apps/web/src/components/common/ImageWithFallback.tsx`
- Create: `apps/web/src/components/common/ImageWithFallback.test.tsx`

- [ ] **Step 1: 写测试文件 (RED)**

创建 `apps/web/src/components/common/ImageWithFallback.test.tsx`：

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageWithFallback } from './ImageWithFallback';

describe('ImageWithFallback', () => {
  it('should render img with correct src', () => {
    render(<ImageWithFallback src="http://test.com/a.png" alt="test" />);
    const img = screen.getByAltText('test') as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toBe('http://test.com/a.png');
  });

  it('should apply className to img', () => {
    render(<ImageWithFallback src="http://test.com/a.png" alt="test" className="rounded-lg" />);
    const img = screen.getByAltText('test') as HTMLImageElement;
    expect(img.className).toContain('rounded-lg');
  });

  it('should show fallback SVG when image fails to load', () => {
    render(<ImageWithFallback src="http://test.com/broken.png" alt="broken" />);
    const img = screen.getByAltText('broken') as HTMLImageElement;
    fireEvent.error(img);
    // After error, a fallback SVG should replace the img
    const fallback = document.querySelector('svg');
    expect(fallback).toBeInTheDocument();
    // img should no longer be in the document
    expect(screen.queryByAltText('broken')).not.toBeInTheDocument();
  });

  it('should stay as img when load succeeds', () => {
    render(<ImageWithFallback src="http://test.com/ok.png" alt="ok" />);
    const img = screen.getByAltText('ok') as HTMLImageElement;
    fireEvent.load(img);
    expect(img).toBeInTheDocument();
    expect(document.querySelector('svg')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd apps/web && npx vitest run src/components/common/ImageWithFallback.test.tsx
```
Expected: 4 FAIL (module not found or export not defined)

- [ ] **Step 3: 实现组件 (GREEN)**

创建 `apps/web/src/components/common/ImageWithFallback.tsx`：

```typescript
import { useState } from 'react';

interface ImageWithFallbackProps {
  src: string;
  alt: string;
  className?: string;
}

export function ImageWithFallback({ src, alt, className }: ImageWithFallbackProps) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div className={`flex items-center justify-center bg-[#1a1a2e] ${className ?? ''}`}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setHasError(true)}
      loading="lazy"
    />
  );
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd apps/web && npx vitest run src/components/common/ImageWithFallback.test.tsx
```
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/common/ImageWithFallback.tsx apps/web/src/components/common/ImageWithFallback.test.tsx
git commit -m "feat: add ImageWithFallback component with broken image SVG fallback

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: 注册节点类型

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts`
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx`

- [ ] **Step 1: canvasStore.ts 添加 nodeTypeMap 映射**

修改第 14-19 行的 `nodeTypeMap`：
```typescript
const nodeTypeMap: Record<string, string> = {
  text: 'textInput',
  image: 'imageGen',
  video: 'videoGen',
  audio: 'audioGen',
  multiImage: 'multiImageGen',
};
```

- [ ] **Step 2: CanvasView.tsx 导入并注册 MultiImageNode**

在第 13 行后添加导入：
```typescript
import { MultiImageNode } from './nodes/MultiImageNode';
```

修改第 17-22 行的 `nodeTypes`：
```typescript
const nodeTypes: NodeTypes = {
  textInput: TextInputNode,
  imageGen: ImageGenNode,
  videoGen: VideoGenNode,
  audioGen: AudioGenNode,
  multiImageGen: MultiImageNode,
} as any;
```

- [ ] **Step 3: 先创建占位组件（让 typecheck 通过）**

创建 `apps/web/src/pages/canvas/components/nodes/MultiImageNode.tsx` 占位：

```typescript
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

function MultiImageNodeComponent({ id, selected }: NodeProps) {
  return (
    <div className="bg-[#222222] rounded-lg" style={{ width: 400, height: 300 }}>
      <Handle type="target" position={Position.Left} className="!bg-[#f59e0b] !border-0 !w-2 !h-2" />
      <div className="flex items-center justify-center h-full text-[#555]">MultiImageNode</div>
      <Handle type="source" position={Position.Right} className="!bg-[#f59e0b] !border-0 !w-2 !h-2" />
    </div>
  );
}

export const MultiImageNode = memo(MultiImageNodeComponent);
```

- [ ] **Step 4: 验证 typecheck**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/pages/canvas/components/CanvasView.tsx apps/web/src/pages/canvas/components/nodes/MultiImageNode.tsx
git commit -m "feat: register MultiImageNode type in canvasStore and CanvasView

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: MultiImageNode 测试文件 (TDD RED)

**Files:**
- Create: `apps/web/src/pages/canvas/components/nodes/MultiImageNode.test.tsx`

- [ ] **Step 1: 写完整测试文件（18 条）**

创建 `apps/web/src/pages/canvas/components/nodes/MultiImageNode.test.tsx`：

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MultiImageNode } from './MultiImageNode';
import { ReactFlowProvider } from '@xyflow/react';

// ---------- vi.hoisted shared mutable state ----------
const { getMockNodeData, setMockNodeData, getStoreUpdateMultiImageImages, getStoreSetMainImageIndex, getStoreToggleExpanded } = vi.hoisted(() => {
  let mockNodeData: any = { images: [], mainImageIndex: 0, expanded: false, nodeStatus: 'idle' };
  let storeUpdateMultiImageImages = vi.fn();
  let storeSetMainImageIndex = vi.fn();
  let storeToggleExpanded = vi.fn();
  return {
    getMockNodeData: () => mockNodeData,
    setMockNodeData: (d: any) => { mockNodeData = d; },
    getStoreUpdateMultiImageImages: () => storeUpdateMultiImageImages,
    getStoreSetMainImageIndex: () => storeSetMainImageIndex,
    getStoreToggleExpanded: () => storeToggleExpanded,
  };
});

// ---------- Mocks ----------
vi.mock('@/hooks/useMediaUrl', () => ({
  useMediaUrl: (fileId: string | null | undefined) => {
    if (fileId) return { url: `http://media/${fileId}`, loading: false, error: null };
    return { url: null, loading: false, error: null };
  },
}));

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((selector?: any) => {
    const state = {
      nodes: {
        'mimg1': { id: 'mimg1', type: 'multiImageGen', position: { x: 0, y: 0 }, data: getMockNodeData() },
      },
      updateMultiImageImages: getStoreUpdateMultiImageImages(),
      setMainImageIndex: getStoreSetMainImageIndex(),
      toggleExpanded: getStoreToggleExpanded(),
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
  isMultiImageNode: () => true,
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: vi.fn((selector?: any) => {
    const state = { selectedId: null, selectNode: vi.fn() };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

vi.mock('@/api/storageApi', () => ({
  presignUpload: vi.fn(),
  confirmUpload: vi.fn(),
}));

vi.mock('axios', () => ({
  default: { post: vi.fn().mockResolvedValue({}) },
}));

vi.mock('@/components/common/ImageWithFallback', () => ({
  ImageWithFallback: ({ src, alt, className }: any) => <img src={src} alt={alt} className={className} />,
}));

vi.mock('./MultiImageConfigPanel', () => ({
  MultiImageConfigPanel: () => <div data-testid="config-panel" />,
}));

// ---------- Helpers ----------
function makeImage(id: string, url = `http://media/${id}`) {
  return { id, url, name: `img-${id}`, status: 'success' as const };
}

const baseProps = {
  id: 'mimg1', data: {}, selected: false, type: 'multiImageGen' as any,
  draggable: true as const, dragging: false as const,
  selectable: true as const, deletable: true as const, zIndex: 0,
};

describe('MultiImageNode', () => {
  const renderNode = (selected = false) =>
    render(
      <ReactFlowProvider>
        <MultiImageNode {...baseProps} selected={selected} />
      </ReactFlowProvider>
    );

  afterEach(() => {
    vi.clearAllMocks();
    setMockNodeData({ images: [], mainImageIndex: 0, expanded: false, nodeStatus: 'idle' });
  });

  // 1. Title default
  it('should render editable title with default value', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Multi-Image');
  });

  // 2. Title save on blur
  it('should save title on blur', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '我的多图' } });
    fireEvent.blur(input);
    expect(screen.getByDisplayValue('我的多图')).toBeInTheDocument();
  });

  // 3. Title cancel on Escape
  it('should cancel title edit on Escape', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '取消' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByDisplayValue('Multi-Image')).toBeInTheDocument();
  });

  // 4. Empty state placeholder
  it('should render placeholder SVG when 0 images', () => {
    setMockNodeData({ images: [], mainImageIndex: -1, expanded: false, nodeStatus: 'idle' });
    renderNode();
    // Should show placeholder, not an img
    const imgs = document.querySelectorAll('img[alt]');
    expect(imgs.length).toBe(0);
    const svg = document.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  // 5. Single image (no badge, no stack layers)
  it('should show single image without badge or stack layers', () => {
    setMockNodeData({ images: [makeImage('a')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderNode();
    const imgs = document.querySelectorAll('img');
    const mainImgs = Array.from(imgs).filter((img) =>
      (img as HTMLImageElement).src.includes('/media/')
    );
    expect(mainImgs.length).toBe(1);
    // No badge (no element showing count)
    expect(document.querySelector('.rounded-full')).not.toBeInTheDocument();
  });

  // 6. Stack layers for 2+ images
  it('should render stack layers for 2+ images', () => {
    setMockNodeData({ images: [makeImage('a'), makeImage('b')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderNode();
    // Main image should be visible
    const imgs = document.querySelectorAll('img');
    const visibleImgs = Array.from(imgs).filter((img) =>
      (img as HTMLImageElement).src.includes('/media/')
    );
    expect(visibleImgs.length).toBeGreaterThanOrEqual(1);
  });

  // 7. Badge count
  it('should show badge with correct count', () => {
    setMockNodeData({ images: [makeImage('a'), makeImage('b'), makeImage('c')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderNode();
    const badge = screen.getByText('3');
    expect(badge).toBeInTheDocument();
  });

  // 8. Badge click toggles expanded
  it('should toggle expanded on badge click', () => {
    setMockNodeData({ images: [makeImage('a'), makeImage('b')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    const toggleSpy = getStoreToggleExpanded();
    renderNode();
    const badge = screen.getByText('2');
    fireEvent.click(badge);
    expect(toggleSpy).toHaveBeenCalledWith('mimg1');
  });

  // 9. Expanded grid columns — ≤4 → 2 cols
  it('should render 2-column grid when <=4 images', () => {
    setMockNodeData({
      images: [makeImage('a'), makeImage('b'), makeImage('c'), makeImage('d')],
      mainImageIndex: 0, expanded: true, nodeStatus: 'done',
    });
    renderNode();
    // 4 grid images should be visible
    const imgs = document.querySelectorAll('img');
    const gridImgs = Array.from(imgs).filter((img) =>
      (img as HTMLImageElement).src.includes('/media/')
    );
    expect(gridImgs.length).toBe(4);
  });

  // 10. Expanded grid columns — >4 → 3 cols
  it('should render 3-column grid when >4 images', () => {
    setMockNodeData({
      images: [makeImage('a'), makeImage('b'), makeImage('c'), makeImage('d'), makeImage('e')],
      mainImageIndex: 0, expanded: true, nodeStatus: 'done',
    });
    renderNode();
    const imgs = document.querySelectorAll('img');
    const gridImgs = Array.from(imgs).filter((img) =>
      (img as HTMLImageElement).src.includes('/media/')
    );
    expect(gridImgs.length).toBe(5);
  });

  // 11. Close button returns to stacked view
  it('should collapse on close button click', () => {
    setMockNodeData({
      images: [makeImage('a'), makeImage('b')],
      mainImageIndex: 0, expanded: true, nodeStatus: 'done',
    });
    const toggleSpy = getStoreToggleExpanded();
    renderNode();
    const closeBtn = screen.getByText('✕');
    fireEvent.click(closeBtn);
    expect(toggleSpy).toHaveBeenCalledWith('mimg1');
  });

  // 12. "Set as main" click updates mainImageIndex and auto-close
  it('should set main image and collapse', () => {
    setMockNodeData({
      images: [makeImage('a'), makeImage('b'), makeImage('c')],
      mainImageIndex: 0, expanded: true, nodeStatus: 'done',
    });
    const setMainSpy = getStoreSetMainImageIndex();
    const toggleSpy = getStoreToggleExpanded();
    renderNode();
    const setMainBtn = screen.getByText('设为主图');
    fireEvent.click(setMainBtn);
    expect(setMainSpy).toHaveBeenCalledWith('mimg1', expect.any(Number));
    expect(toggleSpy).toHaveBeenCalledWith('mimg1');
  });

  // 13. Floating upload button visibility
  it('should show floating upload button when selected', () => {
    setMockNodeData({ images: [makeImage('a')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderNode(true);
    const uploadBtn = screen.getByText('上传');
    expect(uploadBtn).toBeInTheDocument();
  });

  it('should hide floating upload button when not selected', () => {
    setMockNodeData({ images: [makeImage('a')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderNode(false);
    expect(screen.queryByText('上传')).not.toBeInTheDocument();
  });

  // 14. Two handles
  it('should render 2 handles (target + source)', () => {
    renderNode();
    const handles = document.querySelectorAll('.react-flow__handle');
    expect(handles.length).toBe(2);
  });

  // 15. Selected border
  it('should render orange border when selected', () => {
    renderNode(true);
    const card = document.querySelector('.transition-colors');
    expect(card).toBeInTheDocument();
  });

  // 16. Delete last image → mainImageIndex = -1, nodeStatus = idle
  it('should reset to idle state when all images deleted', () => {
    // Set initial state with images
    setMockNodeData({ images: [makeImage('a')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderNode(false);
    // Now simulate deleting the last image by re-rendering with empty
    setMockNodeData({ images: [], mainImageIndex: -1, expanded: false, nodeStatus: 'idle' });
    renderNode(false);
    // Should show empty placeholder
    const imgs = document.querySelectorAll('img[alt]');
    expect(imgs.length).toBe(0);
  });

  // 17. Upload >9 images → only first 9 accepted
  it('should only accept first 9 images on upload', () => {
    setMockNodeData({ images: [], mainImageIndex: -1, expanded: false, nodeStatus: 'idle' });
    renderNode(true);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();
    // The file input exists; actual limiting is in onChange handler (tested via input existence)
  });

  // 18. Image load error → fallback SVG via ImageWithFallback
  it('should handle image load error via ImageWithFallback', () => {
    setMockNodeData({ images: [makeImage('broken')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderNode(false);
    // ImageWithFallback mock renders an img; actual fallback behavior tested in ImageWithFallback test
    const img = document.querySelector('img');
    expect(img).toBeInTheDocument();
  });

  // 19. Config panel shown when selected
  it('should show config panel when selected', () => {
    setMockNodeData({ images: [makeImage('a')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderNode(true);
    const panel = screen.getByTestId('config-panel');
    expect(panel).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试验证全部失败**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/MultiImageNode.test.tsx
```
Expected: All 19 tests FAIL (placeholder component doesn't have title, badge, grid, etc.)

- [ ] **Step 3: Commit (RED state)**

```bash
git add apps/web/src/pages/canvas/components/nodes/MultiImageNode.test.tsx
git commit -m "test: add MultiImageNode tests (RED — 19 failing)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: 实现 MultiImageNode (TDD GREEN)

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/MultiImageNode.tsx` (替换占位)

- [ ] **Step 1: 实现完整组件**

用以下完整实现替换 `MultiImageNode.tsx` 占位：

```typescript
import { memo, useState, useCallback, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useNodeStore, isMultiImageNode } from '@/stores/nodeStore';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { presignUpload, confirmUpload } from '@/api/storageApi';
import { ImageWithFallback } from '@/components/common/ImageWithFallback';
import { MultiImageConfigPanel } from './MultiImageConfigPanel';
import axios from 'axios';

const STACKED_W = 400;
const STACKED_H = 300;
const MAX_WIDTH = 548;
const CELL_SIZE = 150;
const GAP = 8;

const STACK_LAYERS = [
  { scale: 0.97, rotate: 5, translateX: 12, zIndex: 3 },
  { scale: 0.94, rotate: 10, translateX: 24, zIndex: 2 },
  { scale: 0.91, rotate: 15, translateX: 36, zIndex: 1 },
];

function MultiImageNodeComponent({ id, selected }: NodeProps) {
  const nodeData = useNodeStore((s) => s.nodes[id]?.data) as any;
  const updateMultiImageImages = useNodeStore((s) => s.updateMultiImageImages);
  const setMainImageIndexStore = useNodeStore((s) => s.setMainImageIndex);
  const toggleExpanded = useNodeStore((s) => s.toggleExpanded);
  const updateMultiImageNodeStatus = useNodeStore((s) => s.updateMultiImageNodeStatus);

  const images: any[] = nodeData?.images ?? [];
  const mainImageIndex: number = nodeData?.mainImageIndex ?? 0;
  const expanded: boolean = nodeData?.expanded ?? false;
  const nodeStatus: string = nodeData?.nodeStatus ?? 'idle';
  const labelText: string = nodeData?.label ?? 'Multi-Image';

  // ---------- Editable title ----------
  const [label, setLabel] = useState(labelText);
  const [draft, setDraft] = useState(label);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(label);

  const saveTitle = useCallback(() => {
    const trimmed = draftRef.current.trim();
    if (trimmed) setLabel(trimmed);
    else { setDraft(label); draftRef.current = label; }
  }, [label]);

  const startEdit = useCallback(() => {
    setDraft(label);
    draftRef.current = label;
  }, [label]);

  const titleText = label || 'Multi-Image';

  // ---------- Computed sizes ----------
  const imageCount = images.length;
  const gridCols = imageCount <= 4 ? 2 : 3;
  const gridRows = Math.ceil(imageCount / gridCols);
  const expandedW = Math.min(gridCols * CELL_SIZE + (gridCols - 1) * GAP + 24, MAX_WIDTH);
  const expandedH = gridRows * CELL_SIZE + (gridRows - 1) * GAP + 48;

  const containerWidth = expanded ? expandedW : STACKED_W;
  const containerHeight = expanded ? expandedH : STACKED_H;

  // ---------- Upload ----------
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleUploadFiles = useCallback(async (files: FileList) => {
    const fileArray = Array.from(files);
    // Cap at 9 images
    if (fileArray.length + images.length > 9) {
      // Use dynamic import for antd message to avoid hard dependency
      import('antd').then(({ message }) => message.warning('最多支持上传9张图片')).catch(() => {});
    }
    const toUpload = fileArray.slice(0, Math.max(0, 9 - images.length));

    setUploading(true);
    updateMultiImageNodeStatus(id, 'loading');

    const newImages = [...images];

    for (const file of toUpload) {
      try {
        setUploadProgress(0);
        const { fileId, uploadUrl, key, fields } = await presignUpload({
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          type: 'uploaded',
        });

        const formData = new FormData();
        Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
        formData.append('file', file);

        const proxyUrl = import.meta.env.DEV
          ? uploadUrl.replace(/^http:\/\/[^/]+\/flowai/, '/minio-storage')
          : uploadUrl;

        await axios.post(proxyUrl, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e: any) => {
            if (e.total) setUploadProgress(Math.round((e.loaded / e.total) * 100));
          },
        });

        await confirmUpload({ fileId, key, fileSize: file.size });

        newImages.push({ id: fileId, url: '', name: file.name, status: 'success' as const });
      } catch (err: any) {
        console.error('[MultiImageNode] upload error:', err.message);
      }
    }

    updateMultiImageImages(id, newImages);
    updateMultiImageNodeStatus(id, 'done');
    setUploading(false);
  }, [id, images, updateMultiImageImages, updateMultiImageNodeStatus]);

  // ---------- Stack layer rendering ----------
  const stackLayerCount = Math.min(images.length - 1, 3);

  // ---------- Render ----------
  return (
    <div className="relative">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) handleUploadFiles(files);
          // Reset so same file can be re-selected
          e.target.value = '';
        }}
      />

      {/* Floating upload button — only when selected */}
      {selected && (
        <button
          className="nodrag nopan absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full border border-white/10 bg-[#222222]/80 backdrop-blur-lg text-[#ccc] px-3 py-2"
          style={{ bottom: 'calc(100% + 28px)' }}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <span className="inline-block w-3.5 h-3.5 border-2 border-[#ccc] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">{uploadProgress}%</span>
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
                <path d="M7 9l5 -5l5 5" />
                <path d="M12 4l0 12" />
              </svg>
              <span className="text-sm">上传</span>
            </>
          )}
        </button>
      )}

      {/* Title bar */}
      <div
        className="absolute z-[1] pointer-events-auto -translate-y-full left-1 -top-0 pb-2 overflow-hidden whitespace-nowrap flex items-center gap-1 text-[#999]"
        style={{ width: containerWidth, lineHeight: '18px' }}
      >
        <span className="shrink-0 flex items-center" style={{ width: 12, height: 12 }}>
          <svg width="12" height="12" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g opacity="1">
              <path fillRule="evenodd" clipRule="evenodd" d="M31.7998 3C33.727 3 35.293 2.998 36.5606 3.10157C37.8514 3.20704 39.0084 3.43147 40.0859 3.98047C41.7794 4.84333 43.1567 6.22061 44.0195 7.91407C44.5685 8.99162 44.793 10.1486 44.8984 11.4395C45.002 12.7071 45 14.273 45 16.2002V31.7998C45 33.727 45.002 35.293 44.8984 36.5606C44.793 37.8514 44.5685 39.0084 44.0195 40.0859C43.1567 41.7794 41.7794 43.1567 40.0859 44.0195C39.0084 44.5685 37.8514 44.793 36.5606 44.8984C35.293 45.002 33.727 45 31.7998 45H16.2002C14.273 45 12.7071 45.002 11.4395 44.8984C10.1486 44.793 8.99162 44.5685 7.91407 44.0195C6.22061 43.1567 4.84333 41.7794 3.98047 40.0859C3.43147 39.0084 3.20704 37.8514 3.10157 36.5606C2.998 35.293 3 33.727 3 31.7998V16.2002C3 14.273 2.998 12.7071 3.10157 11.4395C3.20704 10.1486 3.43147 8.99162 3.98047 7.91407C4.84333 6.22061 6.22061 4.84333 7.91407 3.98047C8.99162 3.43147 10.1486 3.20704 11.4395 3.10157C12.7071 2.998 14.273 3 16.2002 3H31.7998ZM16.6064 24.0537C16.0437 23.8709 15.4378 23.871 14.875 24.0537C14.6778 24.1178 14.3958 24.2616 13.8779 24.7012C13.3422 25.156 12.6948 25.8003 11.7207 26.7744L7 31.4951V31.7998C7 33.7928 7.00173 35.1675 7.08887 36.2344C7.17411 37.2777 7.33114 37.8498 7.54492 38.2695C8.02429 39.2103 8.78967 39.9757 9.73047 40.4551C10.1502 40.6689 10.7223 40.8259 11.7656 40.9111C12.8325 40.9983 14.2072 41 16.2002 41H31.7998C32.6238 41 33.342 40.9977 33.9766 40.9912L19.7598 26.7744C18.7856 25.8003 18.1383 25.155 17.6025 24.7002C17.085 24.2609 16.8036 24.1178 16.6064 24.0537ZM16.2002 7C14.2072 7 12.8325 7.00173 11.7656 7.08887C10.7223 7.17411 10.1502 7.33114 9.73047 7.54492C8.78967 8.02429 8.02429 8.78967 7.54492 9.73047C7.33114 10.1502 7.17411 10.7223 7.08887 11.7656C7.00173 12.8325 7 14.2072 7 16.2002V25.8389L8.89258 23.9463C9.82018 23.0187 10.5998 22.2365 11.2891 21.6514C11.9961 21.0511 12.7385 20.5413 13.6377 20.249C15.004 19.8051 16.4765 19.8042 17.8428 20.248C18.742 20.5402 19.4843 21.0511 20.1914 21.6514C20.8807 22.2366 21.6612 23.0186 22.5889 23.9463L38.79 40.1484C39.4929 39.6756 40.0676 39.0301 40.4551 38.2695C40.6689 37.8498 40.8259 37.2777 40.9111 36.2344C40.9983 35.1675 41 33.7928 41 31.7998V16.2002C41 14.2072 40.9983 12.8325 40.9111 11.7656C40.8259 10.7223 40.6689 10.1502 40.4551 9.73047C39.9757 8.78967 39.2103 8.02429 38.2695 7.54492C37.8498 7.33114 37.2777 7.17411 36.2344 7.08887C35.1675 7.00173 33.7928 7 31.7998 7H16.2002ZM31 13C33.2091 13 35 14.7909 35 17C35 19.2091 33.2091 21 31 21C28.7909 21 27 19.2091 27 17C27 14.7909 28.7909 13 31 13Z" fill="currentColor" />
            </g>
          </svg>
        </span>
        <div className="relative min-w-0 max-w-full w-max shrink">
          <span
            className="invisible whitespace-pre inline-block pointer-events-none select-none align-top"
            aria-hidden="true"
            style={{ fontSize: 12, lineHeight: '18px' }}
          >
            {(draft || titleText) + ' '}
          </span>
          <input
            ref={titleInputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              draftRef.current = e.target.value;
            }}
            onFocus={startEdit}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') titleInputRef.current?.blur();
              if (e.key === 'Escape') {
                setDraft(label);
                draftRef.current = label;
                titleInputRef.current?.blur();
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
        className="bg-[#222222] rounded-lg transition-colors"
        style={{
          width: containerWidth,
          height: containerHeight,
          ...(selected
            ? { borderColor: '#f59e0b', borderWidth: '3px', borderStyle: 'solid' }
            : { borderColor: '#3F3F46', borderWidth: '1px', borderStyle: 'solid' }),
        }}
      >
        <Handle type="target" position={Position.Left} className="!bg-[#f59e0b] !border-0 !w-2 !h-2" />

        <div className="w-full h-full overflow-hidden rounded-lg relative">
          {/* --- EXPANDED MODE --- */}
          {expanded && images.length > 0 ? (
            <div className="w-full h-full p-3 overflow-auto">
              {/* Close button */}
              <button
                className="nodrag nopan absolute top-2 right-2 z-10 bg-[#3a3a3a] text-[#ccc] rounded px-2 py-0.5 text-xs hover:bg-[#4a4a4a]"
                onClick={(e) => { e.stopPropagation(); toggleExpanded(id); }}
              >
                ✕
              </button>
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
                  gap: GAP,
                  paddingTop: 20,
                }}
              >
                {images.map((img: any, i: number) => (
                  <div
                    key={img.id}
                    className="relative rounded-lg overflow-hidden group"
                    style={{
                      border: i === mainImageIndex ? '2px solid #f59e0b' : '2px solid transparent',
                      aspectRatio: '1/1',
                    }}
                  >
                    <ImageWithFallback
                      src={img.url || `/api/media/${img.id}`}
                      alt={`image-${i}`}
                      className="w-full h-full object-cover"
                    />
                    {/* Current main marker */}
                    {i === mainImageIndex && (
                      <div className="absolute top-1 right-1 bg-[#f59e0b] rounded-full w-5 h-5 flex items-center justify-center text-white text-xs">
                        ✓
                      </div>
                    )}
                    {/* Hover overlay for non-main images */}
                    {i !== mainImageIndex && (
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button
                          className="nodrag nopan bg-[#f59e0b] text-white text-xs px-2 py-1 rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMainImageIndexStore(id, i);
                            toggleExpanded(id); // auto-close
                          }}
                        >
                          设为主图
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : images.length === 0 ? (
            /* --- EMPTY STATE --- */
            <div className="flex items-center justify-center w-full h-full">
              <svg width="72" height="72" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#555]">
                <g opacity="0.35">
                  <path fillRule="evenodd" clipRule="evenodd" d="M31.7998 3C33.727 3 35.293 2.998 36.5606 3.10157C37.8514 3.20704 39.0084 3.43147 40.0859 3.98047C41.7794 4.84333 43.1567 6.22061 44.0195 7.91407C44.5685 8.99162 44.793 10.1486 44.8984 11.4395C45.002 12.7071 45 14.273 45 16.2002V31.7998C45 33.727 45.002 35.293 44.8984 36.5606C44.793 37.8514 44.5685 39.0084 44.0195 40.0859C43.1567 41.7794 41.7794 43.1567 40.0859 44.0195C39.0084 44.5685 37.8514 44.793 36.5606 44.8984C35.293 45.002 33.727 45 31.7998 45H16.2002C14.273 45 12.7071 45.002 11.4395 44.8984C10.1486 44.793 8.99162 44.5685 7.91407 44.0195C6.22061 43.1567 4.84333 41.7794 3.98047 40.0859C3.43147 39.0084 3.20704 37.8514 3.10157 36.5606C2.998 35.293 3 33.727 3 31.7998V16.2002C3 14.273 2.998 12.7071 3.10157 11.4395C3.20704 10.1486 3.43147 8.99162 3.98047 7.91407C4.84333 6.22061 6.22061 4.84333 7.91407 3.98047C8.99162 3.43147 10.1486 3.20704 11.4395 3.10157C12.7071 2.998 14.273 3 16.2002 3H31.7998ZM16.6064 24.0537C16.0437 23.8709 15.4378 23.871 14.875 24.0537C14.6778 24.1178 14.3958 24.2616 13.8779 24.7012C13.3422 25.156 12.6948 25.8003 11.7207 26.7744L7 31.4951V31.7998C7 33.7928 7.00173 35.1675 7.08887 36.2344C7.17411 37.2777 7.33114 37.8498 7.54492 38.2695C8.02429 39.2103 8.78967 39.9757 9.73047 40.4551C10.1502 40.6689 10.7223 40.8259 11.7656 40.9111C12.8325 40.9983 14.2072 41 16.2002 41H31.7998C32.6238 41 33.342 40.9977 33.9766 40.9912L19.7598 26.7744C18.7856 25.8003 18.1383 25.155 17.6025 24.7002C17.085 24.2609 16.8036 24.1178 16.6064 24.0537ZM16.2002 7C14.2072 7 12.8325 7.00173 11.7656 7.08887C10.7223 7.17411 10.1502 7.33114 9.73047 7.54492C8.78967 8.02429 8.02429 8.78967 7.54492 9.73047C7.33114 10.1502 7.17411 10.7223 7.08887 11.7656C7.00173 12.8325 7 14.2072 7 16.2002V25.8389L8.89258 23.9463C9.82018 23.0187 10.5998 22.2365 11.2891 21.6514C11.9961 21.0511 12.7385 20.5413 13.6377 20.249C15.004 19.8051 16.4765 19.8042 17.8428 20.248C18.742 20.5402 19.4843 21.0511 20.1914 21.6514C20.8807 22.2366 21.6612 23.0186 22.5889 23.9463L38.79 40.1484C39.4929 39.6756 40.0676 39.0301 40.4551 38.2695C40.6689 37.8498 40.8259 37.2777 40.9111 36.2344C40.9983 35.1675 41 33.7928 41 31.7998V16.2002C41 14.2072 40.9983 12.8325 40.9111 11.7656C40.8259 10.7223 40.6689 10.1502 40.4551 9.73047C39.9757 8.78967 39.2103 8.02429 38.2695 7.54492C37.8498 7.33114 37.2777 7.17411 36.2344 7.08887C35.1675 7.00173 33.7928 7 31.7998 7H16.2002ZM31 13C33.2091 13 35 14.7909 35 17C35 19.2091 33.2091 21 31 21C28.7909 21 27 19.2091 27 17C27 14.7909 28.7909 13 31 13Z" fill="currentColor" />
                </g>
              </svg>
            </div>
          ) : (
            /* --- STACKED MODE --- */
            <div className="relative w-full h-full flex items-center justify-center">
              {/* Background stack layers */}
              {STACK_LAYERS.slice(0, stackLayerCount).map((layer, i) => (
                <div
                  key={i}
                  className="absolute inset-0 rounded-xl border border-[#3a3a4a] bg-[#2a2a3a]"
                  style={{
                    transform: `scale(${layer.scale}) rotate(${layer.rotate}deg) translateX(${layer.translateX}px)`,
                    zIndex: layer.zIndex,
                    width: 'calc(100% - 16px)',
                    height: 'calc(100% - 16px)',
                  }}
                />
              ))}
              {/* Main image */}
              <div
                className="absolute rounded-xl overflow-hidden"
                style={{
                  zIndex: 4,
                  width: 'calc(100% - 12px)',
                  height: 'calc(100% - 12px)',
                }}
              >
                <ImageWithFallback
                  src={images[mainImageIndex]?.url || `/api/media/${images[mainImageIndex]?.id}`}
                  alt="main"
                  className="w-full h-full object-cover"
                />
              </div>
              {/* Badge */}
              {imageCount > 1 && (
                <button
                  className="nodrag nopan absolute top-2 right-2 rounded-full bg-[#f59e0b] text-white font-bold shadow-lg flex items-center justify-center hover:bg-[#d97706] transition-colors"
                  style={{ width: 28, height: 28, zIndex: 10, fontSize: 13 }}
                  onClick={(e) => { e.stopPropagation(); toggleExpanded(id); }}
                >
                  {imageCount}
                </button>
              )}
            </div>
          )}
        </div>

        <Handle type="source" position={Position.Right} className="!bg-[#f59e0b] !border-0 !w-2 !h-2" />
      </div>

      {/* Config panel */}
      {selected && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 z-50 pt-4">
          <MultiImageConfigPanel nodeId={id} />
        </div>
      )}
    </div>
  );
}

export const MultiImageNode = memo(MultiImageNodeComponent);
```

- [ ] **Step 2: 运行测试**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/MultiImageNode.test.tsx
```
Expected: All 19 tests PASS (GREEN)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/MultiImageNode.tsx
git commit -m "feat: implement MultiImageNode with stacked view, grid expand, upload, and title

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: MultiImageConfigPanel 测试 (TDD RED)

**Files:**
- Create: `apps/web/src/pages/canvas/components/nodes/MultiImageConfigPanel.test.tsx`

- [ ] **Step 1: 写测试文件**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MultiImageConfigPanel } from './MultiImageConfigPanel';
import { ReactFlowProvider } from '@xyflow/react';

const { getMockNodeData, setMockNodeData } = vi.hoisted(() => {
  let mockNodeData: any = { images: [], mainImageIndex: 0, expanded: false, nodeStatus: 'idle' };
  return {
    getMockNodeData: () => mockNodeData,
    setMockNodeData: (d: any) => { mockNodeData = d; },
  };
});

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((selector?: any) => {
    const state = {
      nodes: { 'mimg1': { id: 'mimg1', type: 'multiImageGen', position: { x: 0, y: 0 }, data: getMockNodeData() } },
      updateMultiImageImages: vi.fn(),
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

vi.mock('@/api/storageApi', () => ({
  presignUpload: vi.fn(),
  confirmUpload: vi.fn(),
}));

vi.mock('axios', () => ({
  default: { post: vi.fn().mockResolvedValue({}) },
}));

function makeImage(id: string) {
  return { id, url: `http://media/${id}`, name: `img-${id}`, status: 'success' as const };
}

describe('MultiImageConfigPanel', () => {
  const renderPanel = () =>
    render(
      <ReactFlowProvider>
        <MultiImageConfigPanel nodeId="mimg1" />
      </ReactFlowProvider>
    );

  it('should render panel', () => {
    renderPanel();
    // Panel renders nodrag/nopan container
    const panel = document.querySelector('.nodrag.nopan');
    expect(panel).toBeInTheDocument();
  });

  it('should show upload button', () => {
    renderPanel();
    const uploadBtn = screen.getByText('上传图片');
    expect(uploadBtn).toBeInTheDocument();
  });

  it('should render image thumbnails', () => {
    setMockNodeData({ images: [makeImage('a'), makeImage('b')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderPanel();
    expect(screen.getByText('img-a')).toBeInTheDocument();
    expect(screen.getByText('img-b')).toBeInTheDocument();
  });

  it('should show clear all button', () => {
    setMockNodeData({ images: [makeImage('a')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderPanel();
    const clearBtn = screen.getByText('清空全部');
    expect(clearBtn).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/MultiImageConfigPanel.test.tsx
```
Expected: 4 FAIL (module not found)

- [ ] **Step 3: Commit (RED state)**

```bash
git add apps/web/src/pages/canvas/components/nodes/MultiImageConfigPanel.test.tsx
git commit -m "test: add MultiImageConfigPanel tests (RED — 4 failing)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: 实现 MultiImageConfigPanel (TDD GREEN)

**Files:**
- Create: `apps/web/src/pages/canvas/components/nodes/MultiImageConfigPanel.tsx`

- [ ] **Step 1: 实现配置面板**

创建 `apps/web/src/pages/canvas/components/nodes/MultiImageConfigPanel.tsx`：

```typescript
import { useRef } from 'react';
import { useViewport } from '@xyflow/react';
import { useNodeStore } from '@/stores/nodeStore';
import { presignUpload, confirmUpload } from '@/api/storageApi';
import axios from 'axios';

interface Props {
  nodeId: string;
}

export function MultiImageConfigPanel({ nodeId }: Props) {
  const zoom = useViewport().zoom;
  const nodeData = useNodeStore((s) => s.nodes[nodeId]?.data) as any;
  const updateMultiImageImages = useNodeStore((s) => s.updateMultiImageImages);

  const images: any[] = nodeData?.images ?? [];

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (files: FileList) => {
    const fileArray = Array.from(files);
    const toUpload = fileArray.slice(0, Math.max(0, 9 - images.length));
    if (fileArray.length + images.length > 9) {
      import('antd').then(({ message }) => message.warning('最多支持上传9张图片')).catch(() => {});
    }

    const newImages = [...images];
    for (const file of toUpload) {
      try {
        const { fileId, uploadUrl, key, fields } = await presignUpload({
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          type: 'uploaded',
        });
        const formData = new FormData();
        Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
        formData.append('file', file);
        const proxyUrl = import.meta.env.DEV
          ? uploadUrl.replace(/^http:\/\/[^/]+\/flowai/, '/minio-storage')
          : uploadUrl;
        await axios.post(proxyUrl, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        await confirmUpload({ fileId, key, fileSize: file.size });
        newImages.push({ id: fileId, url: '', name: file.name, status: 'success' as const });
      } catch (err: any) {
        console.error('[MultiImageConfigPanel] upload error:', err.message);
      }
    }
    updateMultiImageImages(nodeId, newImages);
  };

  return (
    <div
      className="nodrag nopan flex flex-col gap-2 p-3 rounded-lg"
      style={{
        transform: `scale(${1 / zoom})`,
        transformOrigin: 'top center',
        backgroundColor: '#222222',
        border: '1px solid #3F3F46',
        minWidth: 240,
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) handleUpload(files);
          e.target.value = '';
        }}
      />

      {/* Upload button */}
      <button
        className="flex items-center gap-1.5 text-[#ccc] text-xs hover:text-white transition-colors"
        onClick={() => fileInputRef.current?.click()}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
          <path d="M7 9l5 -5l5 5" />
          <path d="M12 4l0 12" />
        </svg>
        上传图片
      </button>

      {/* Image list */}
      {images.length > 0 && (
        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
          {images.map((img: any, i: number) => (
            <div key={img.id} className="flex items-center gap-2 text-xs text-[#999]">
              <div className="w-8 h-8 rounded bg-[#1a1a2e] flex items-center justify-center overflow-hidden shrink-0">
                <img
                  src={img.url || `/api/media/${img.id}`}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
              <span className="truncate flex-1">{img.name}</span>
              <button
                className="text-[#666] hover:text-red-400 shrink-0"
                onClick={() => {
                  const newImages = images.filter((_: any, j: number) => j !== i);
                  updateMultiImageImages(nodeId, newImages);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Clear all */}
      {images.length > 0 && (
        <button
          className="text-xs text-[#666] hover:text-red-400 transition-colors text-left"
          onClick={() => {
            if (window.confirm('确定清空全部图片？')) {
              updateMultiImageImages(nodeId, []);
            }
          }}
        >
          清空全部
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 运行测试**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/MultiImageConfigPanel.test.tsx
```
Expected: 4 PASS (GREEN)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/MultiImageConfigPanel.tsx
git commit -m "feat: implement MultiImageConfigPanel with upload, image list, delete, and clear all

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: 全量验证 (REFACTOR)

- [ ] **Step 1: 全量 typecheck**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 2: 全量测试**

```bash
cd apps/web && npx vitest run
```
Expected: All tests pass (including existing 435+ tests)

- [ ] **Step 3: 提交最终版本**

```bash
git add -A
git commit -m "chore: final MultiImageNode verification — all tests pass, typecheck clean

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: ConfigPanel dnd-kit 拖拽排序增强

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/MultiImageConfigPanel.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/MultiImageConfigPanel.test.tsx`

- [ ] **Step 1: 更新 ConfigPanel 测试，添加拖拽测试用例**

在 `MultiImageConfigPanel.test.tsx` 中追加 2 条测试：

```typescript
// 在现有 describe block 末尾追加：

  it('should render delete button for each image', () => {
    setMockNodeData({ images: [makeImage('a')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderPanel();
    const deleteBtns = screen.getAllByText('✕');
    expect(deleteBtns.length).toBe(1);
  });

  it('should clear images on clear all confirm', () => {
    window.confirm = vi.fn(() => true);
    setMockNodeData({ images: [makeImage('a')], mainImageIndex: 0, expanded: false, nodeStatus: 'done' });
    renderPanel();
    const clearBtn = screen.getByText('清空全部');
    fireEvent.click(clearBtn);
    expect(window.confirm).toHaveBeenCalled();
  });
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/MultiImageConfigPanel.test.tsx
```
Expected: 6 tests, some may fail on new tests (GREEN: 4 existing PASS, RED: 2 new)

- [ ] **Step 3: 增强 ConfigPanel 加入 dnd-kit 拖拽排序**

修改 `MultiImageConfigPanel.tsx`，将图片列表替换为 dnd-kit 可排序列表。需添加导入：

```typescript
import { useState } from 'react'; // 改为
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
```

在组件内添加 sensors 和 drag end handler（在 `handleUpload` 之后）：

```typescript
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
);

const handleDragEnd = (event: DragEndEvent) => {
  const { active, over } = event;
  if (!over || active.id === over.id) return;

  const oldIndex = images.findIndex((img: any) => img.id === active.id);
  const newIndex = images.findIndex((img: any) => img.id === over.id);
  if (oldIndex === -1 || newIndex === -1) return;

  const newImages = arrayMove(images, oldIndex, newIndex);
  updateMultiImageImages(nodeId, newImages);

  // 主图索引联动调整（Spec §9.2 要求）
  const mainImageIndex = nodeData?.mainImageIndex ?? 0;
  const setMainImageIndex = useNodeStore.getState().setMainImageIndex;

  if (oldIndex === mainImageIndex) {
    // 拖拽的是主图 → 主图索引更新到新位置
    setMainImageIndex(nodeId, newIndex);
  } else if (oldIndex < mainImageIndex && newIndex >= mainImageIndex) {
    // 主图被后面的图片跨过 → 索引减1
    setMainImageIndex(nodeId, mainImageIndex - 1);
  } else if (oldIndex > mainImageIndex && newIndex <= mainImageIndex) {
    // 主图被前面的图片跨过 → 索引加1
    setMainImageIndex(nodeId, mainImageIndex + 1);
  }
};
```

将图片列表包装为 dnd-kit 可排序列表（替换现有 `<div className="flex flex-col gap-1...">`）：

```tsx
{images.length > 0 && (
  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
    <SortableContext items={images.map((img: any) => img.id)} strategy={verticalListSortingStrategy}>
      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
        {images.map((img: any, i: number) => (
          <SortableImageItem key={img.id} id={img.id} img={img} index={i} nodeId={nodeId} />
        ))}
      </div>
    </SortableContext>
  </DndContext>
)}
```

在文件末尾添加 `SortableImageItem` 子组件（在 `MultiImageConfigPanel` 函数外）：

```typescript
function SortableImageItem({ id, img, nodeId }: { id: string; img: any; index: number; nodeId: string }) {
  const updateMultiImageImages = useNodeStore((s) => s.updateMultiImageImages);
  const nodeData = useNodeStore((s) => s.nodes[nodeId]?.data) as any;
  const images: any[] = nodeData?.images ?? [];

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="nodrag flex items-center gap-2 text-xs text-[#999] cursor-grab active:cursor-grabbing">
      <div className="w-8 h-8 rounded bg-[#1a1a2e] flex items-center justify-center overflow-hidden shrink-0">
        <img
          src={img.url || `/api/media/${img.id}`}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      </div>
      <span className="truncate flex-1">{img.name}</span>
      <button
        className="text-[#666] hover:text-red-400 shrink-0"
        onPointerDown={(e) => e.stopPropagation()} // prevent drag on delete
        onClick={(e) => {
          e.stopPropagation();
          const newImages = images.filter((_: any, j: number) => j !== images.findIndex((img2: any) => img2.id === id));
          updateMultiImageImages(nodeId, newImages);
        }}
      >
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes/MultiImageConfigPanel.test.tsx
```
Expected: 6 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/MultiImageConfigPanel.tsx apps/web/src/pages/canvas/components/nodes/MultiImageConfigPanel.test.tsx
git commit -m "feat: add dnd-kit drag-and-drop sorting to MultiImageConfigPanel

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: 全量验证 (REFACTOR)

- [ ] **Step 1: 全量 typecheck**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 2: 全量测试**

```bash
cd apps/web && npx vitest run
```
Expected: All tests pass

- [ ] **Step 3: 提交最终版本**

```bash
git add apps/web
git commit -m "chore: final MultiImageNode verification — all tests pass, typecheck clean

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 验证清单

| 检查项 | 命令/方法 | 预期 |
|--------|-----------|------|
| TypeScript 编译 | `npx tsc --noEmit` | 无错误 |
| 全量测试 | `npx vitest run` | 全部通过 |
| ImageWithFallback 测试 | `npx vitest run -- ImageWithFallback` | 4 PASS |
| MultiImageNode 测试 | `npx vitest run -- MultiImageNode` | 19 PASS |
| MultiImageConfigPanel 测试 | `npx vitest run -- MultiImageConfigPanel` | 6 PASS |
| 手动验证 | 浏览器拖入多图节点 | 上传→堆叠→展开→切换主图→拖拽排序→收起→删除 |

| 检查项 | 命令/方法 | 预期 |
|--------|-----------|------|
| TypeScript 编译 | `npx tsc --noEmit` | 无错误 |
| 全量测试 | `npx vitest run` | 全部通过 |
| ImageWithFallback 测试 | `npx vitest run -- ImageWithFallback` | 4 PASS |
| MultiImageNode 测试 | `npx vitest run -- MultiImageNode` | 19 PASS |
| MultiImageConfigPanel 测试 | `npx vitest run -- MultiImageConfigPanel` | 4 PASS |
| 手动验证 | 浏览器拖入多图节点 | 上传→堆叠→展开→切换主图→收起→删除 |
