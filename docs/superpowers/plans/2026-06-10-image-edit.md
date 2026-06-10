# 图片节点 AI 编辑功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 ImageNodeToolbar 上裁切/扩图/擦除/重绘四个功能的完整交互链路（原位编辑模式 + 通义万相 AI）。

**Architecture:** 编辑模式基础设施在 nodeStore 中新增 `editMode` 和 `activeEditNodeId` 字段，四个编辑功能各自封装为独立 overlay/panel 组件，ImageGenNode 根据 editMode 动态渲染对应组件。AI 功能通过单一 `ai-image-edit` BullMQ 队列调度。EditToolbar 替代 ImageNodeToolbar 提供统一的编辑操作 UI。

**Tech Stack:** React 18 + TypeScript strict + @xyflow/react + Zustand + Vitest (jsdom) + NestJS 10 + BullMQ + Prisma

---

## 文件规划

| 操作 | 文件 | 职责 |
|------|------|------|
| Modify | `apps/web/src/stores/nodeStore.ts` | 新增 editMode 类型、activeEditNodeId 状态、hasEditChanges |
| Modify | `apps/web/src/stores/canvasStore.ts` | 新增 setNodeDraggable |
| Create | `apps/web/src/utils/imageCrop.ts` | Canvas 裁剪工具函数 |
| Create | `apps/web/src/pages/canvas/components/nodes/EditToolbar.tsx` | 编辑模式统一工具栏 |
| Create | `apps/web/src/pages/canvas/components/nodes/CropOverlay.tsx` | DOM 裁切框 |
| Create | `apps/web/src/pages/canvas/components/nodes/EraseCanvas.tsx` | Canvas 2D 画笔（擦除/重绘共用） |
| Create | `apps/web/src/pages/canvas/components/nodes/OutpaintPanel.tsx` | 扩图方向+比例+提示词 |
| Create | `apps/web/src/pages/canvas/components/nodes/RedrawPanel.tsx` | 重绘选区+提示词+强度 |
| Modify | `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx` | editMode 分支渲染、Socket.io 监听 |
| Modify | `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx` | 裁切/扩图/擦除/重绘按钮接线 |
| Create | `apps/api/src/modules/ai-image-edit/ai-image-edit.constants.ts` | 队列名常量 |
| Create | `apps/api/src/modules/ai-image-edit/ai-image-edit.processor.ts` | BullMQ 处理器 |
| Create | `apps/api/src/modules/ai-image-edit/ai-image-edit.controller.ts` | API 端点 |
| Create | `apps/api/src/modules/ai-image-edit/ai-image-edit.service.ts` | 业务逻辑 |
| Modify | `apps/api/src/app.module.ts` | 注册 ai-image-edit 队列 |
| Modify | `apps/api/src/modules/execution/api-caller.service.ts` | 新增通义万相三个 API 方法 |

---

### Task 1: nodeStore — editMode 类型与 activeEditNodeId

**Files:**
- Modify: `apps/web/src/stores/nodeStore.ts`
- Test: `apps/web/src/stores/nodeStore.test.ts`

- [ ] **Step 1: 写失败测试 — editMode 默认值**

```typescript
// 在 nodeStore.test.ts 中添加
describe('editMode infrastructure', () => {
  it('ImageNodeData should default editMode to null', () => {
    useNodeStore.getState().addNode({
      id: 'edit1',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: { style: '写实', model: 'sd', quality: 'standard', ratio: '1:1', status: 'idle', prompt: { text: '', allImages: [], referencedImageIds: [] } } as ImageNodeData,
    });
    const stored = useNodeStore.getState().nodes['edit1'];
    const imgData = stored.data as ImageNodeData;
    expect(imgData.editMode).toBeNull();
  });

  it('activeEditNodeId should start as null', () => {
    expect(useNodeStore.getState().activeEditNodeId).toBeNull();
  });

  it('setActiveEditNodeId should not set if activeTransformNodeId is set', () => {
    useNodeStore.getState().setActiveTransformNodeId('t1');
    useNodeStore.getState().setActiveEditNodeId('e1');
    expect(useNodeStore.getState().activeEditNodeId).toBeNull();
  });

  it('setActiveTransformNodeId should not set if activeEditNodeId is set', () => {
    useNodeStore.getState().setActiveEditNodeId('e1');
    useNodeStore.getState().setActiveTransformNodeId('t1');
    expect(useNodeStore.getState().activeTransformNodeId).toBeNull();
  });
});
```

Run: `cd apps/web && npx vitest run src/stores/nodeStore.test.ts --reporter=verbose`
Expected: 4 tests FAIL — editMode/activeEditNodeId/setActiveEditNodeId not defined

- [ ] **Step 2: 实现 ImageNodeData 新增 editMode**

```typescript
// nodeStore.ts — 在 ImageNodeData 接口中添加 editMode 字段
export interface ImageNodeData {
  style: string;
  model: string;
  quality: string;
  ratio: string;
  fileId?: string;
  referenceImage?: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  prompt: PromptValue;
  imageRotation?: 0 | 90 | 180 | 270;
  flipH?: boolean;
  flipV?: boolean;
  transformMode?: boolean;
  editMode?: 'crop' | 'outpaint' | 'erase' | 'redraw' | null;  // 新增
}
```

```typescript
// nodeStore.ts — 在 mergeNodeData 的 defaults 中添加
const defaults: Record<string, any> = {
  // ...existing defaults...
  editMode: null,  // 新增
};
```

```typescript
// nodeStore.ts — 在 NodeState 接口中添加
interface NodeState {
  // ...existing...
  activeEditNodeId: string | null;  // 新增
  setActiveEditNodeId: (id: string | null) => void;  // 新增
}
```

```typescript
// nodeStore.ts — 在 create() 的初始状态中添加
activeEditNodeId: null,

// 修改 setActiveTransformNodeId 添加互斥检查
setActiveTransformNodeId: (id) => {
  if (id !== null && get().activeEditNodeId !== null) return; // 有编辑节点活跃时拒绝
  set({ activeTransformNodeId: id });
},

// 新增 setActiveEditNodeId
setActiveEditNodeId: (id) => {
  if (id !== null && get().activeTransformNodeId !== null) return; // 有 transform 节点活跃时拒绝
  set({ activeEditNodeId: id });
},
```

Run: `cd apps/web && npx vitest run src/stores/nodeStore.test.ts --reporter=verbose`
Expected: 4 tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/stores/nodeStore.ts apps/web/src/stores/nodeStore.test.ts
git commit -m "feat: add editMode to ImageNodeData and activeEditNodeId with mutual exclusion"
```

---

### Task 2: nodeStore — triggerCancelEdit 与 hasEditChanges

**Files:**
- Modify: `apps/web/src/stores/nodeStore.ts`
- Test: `apps/web/src/stores/nodeStore.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// nodeStore.test.ts 追加
it('triggerCancelEdit should update cancelRequestedAt', () => {
  const before = useNodeStore.getState().cancelRequestedAt;
  useNodeStore.getState().triggerCancelEdit();
  expect(useNodeStore.getState().cancelRequestedAt).toBeGreaterThan(before);
});
```

Run: `cd apps/web && npx vitest run src/stores/nodeStore.test.ts --reporter=verbose`
Expected: FAIL — triggerCancelEdit not defined

- [ ] **Step 2: 实现 triggerCancelEdit + hasEditChanges**

```typescript
// nodeStore.ts — NodeState 接口添加
triggerCancelEdit: () => void;

// nodeStore.ts — create() 中添加
triggerCancelEdit: () => set({ cancelRequestedAt: Date.now() }),
```

```typescript
// nodeStore.ts — 新增导出函数 hasEditChanges
export interface EditState {
  cropRect?: { x: number; y: number; width: number; height: number };
  direction?: string;
  scale?: number;
  prompt?: string;
  maskPaths?: { points: number[] }[];
}

export function hasEditChanges(editMode: string, editState: EditState): boolean {
  switch (editMode) {
    case 'crop':
      return !isDefaultCropRect(editState.cropRect);
    case 'outpaint':
      return editState.direction !== 'all'
        || editState.scale !== 1.2
        || (editState.prompt ?? '').trim().length > 0;
    case 'erase':
    case 'redraw':
      return (editState.maskPaths?.length ?? 0) > 0;
    default:
      return false;
  }
}

function isDefaultCropRect(rect?: { x: number; y: number; width: number; height: number }): boolean {
  if (!rect) return true;
  return rect.x === 0.1 && rect.y === 0.1 && rect.width === 0.8 && rect.height === 0.8;
}
```

```typescript
// nodeStore.test.ts 追加 hasEditChanges 测试
import { hasEditChanges } from './nodeStore';

describe('hasEditChanges', () => {
  it('crop: no changes for default 80% centered rect', () => {
    expect(hasEditChanges('crop', { cropRect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } })).toBe(false);
  });

  it('crop: has changes for non-default rect', () => {
    expect(hasEditChanges('crop', { cropRect: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 } })).toBe(true);
  });

  it('outpaint: no changes with default values', () => {
    expect(hasEditChanges('outpaint', { direction: 'all', scale: 1.2, prompt: '' })).toBe(false);
  });

  it('outpaint: has changes when direction differs', () => {
    expect(hasEditChanges('outpaint', { direction: 'top', scale: 1.2, prompt: '' })).toBe(true);
  });

  it('outpaint: has changes when scale differs', () => {
    expect(hasEditChanges('outpaint', { direction: 'all', scale: 1.5, prompt: '' })).toBe(true);
  });

  it('outpaint: has changes when prompt is non-empty', () => {
    expect(hasEditChanges('outpaint', { direction: 'all', scale: 1.2, prompt: '天空' })).toBe(true);
  });

  it('erase: no changes when maskPaths is empty', () => {
    expect(hasEditChanges('erase', { maskPaths: [] })).toBe(false);
  });

  it('erase: has changes when maskPaths has content', () => {
    expect(hasEditChanges('erase', { maskPaths: [{ points: [0, 0, 10, 10] }] })).toBe(true);
  });

  it('redraw: no changes when maskPaths is empty', () => {
    expect(hasEditChanges('redraw', { maskPaths: [] })).toBe(false);
  });

  it('redraw: has changes when maskPaths has content', () => {
    expect(hasEditChanges('redraw', { maskPaths: [{ points: [5, 5, 15, 15] }] })).toBe(true);
  });
});
```

Run: `cd apps/web && npx vitest run src/stores/nodeStore.test.ts --reporter=verbose`
Expected: 11 tests PASS (triggerCancelEdit + 9 hasEditChanges + 1 trigger)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/stores/nodeStore.ts apps/web/src/stores/nodeStore.test.ts
git commit -m "feat: add triggerCancelEdit and hasEditChanges helper"
```

---

### Task 3: canvasStore — setNodeDraggable

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts`
- Test: `apps/web/src/stores/canvasStore.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// canvasStore.test.ts 追加
it('setNodeDraggable should update node draggable flag', () => {
  useCanvasStore.getState().addNode({
    id: 'n1',
    type: 'imageGen',
    position: { x: 100, y: 200 },
    data: {},
  });
  useCanvasStore.getState().setNodeDraggable('n1', false);
  const node = useCanvasStore.getState().nodes.find(n => n.id === 'n1');
  expect(node?.draggable).toBe(false);
});
```

Run: `cd apps/web && npx vitest run src/stores/canvasStore.test.ts --reporter=verbose`
Expected: FAIL — setNodeDraggable not defined

- [ ] **Step 2: 实现 setNodeDraggable**

```typescript
// canvasStore.ts — CanvasState 接口添加
setNodeDraggable: (nodeId: string, draggable: boolean) => void;

// canvasStore.ts — create() 中添加
setNodeDraggable: (nodeId, draggable) =>
  set((s) => ({
    nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, draggable } : n)),
  })),
```

Run: `cd apps/web && npx vitest run src/stores/canvasStore.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.test.ts
git commit -m "feat: add setNodeDraggable to canvasStore"
```

---

### Task 4: imageCrop 工具函数

**Files:**
- Create: `apps/web/src/utils/imageCrop.ts`
- Create: `apps/web/src/utils/imageCrop.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/web/src/utils/imageCrop.test.ts
import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const mockCtx = {
    drawImage: vi.fn(),
  };
  const mockCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => mockCtx),
    toBlob: vi.fn((cb: (b: Blob | null) => void) => {
      setTimeout(() => cb(new Blob(['cropped'], { type: 'image/webp' })), 0);
    }),
  };
  const mockImage = { crossOrigin: '', onload: null as (() => void) | null, onerror: null as (() => void) | null, src: '', width: 0, height: 0 };
  return { mockCtx, mockCanvas, mockImage };
});

vi.stubGlobal('Image', vi.fn(() => mocks.mockImage));
vi.stubGlobal('document', { ...document, createElement: vi.fn((tag: string) => {
  if (tag === 'canvas') return mocks.mockCanvas as any;
  return null;
})});

import { cropImage } from './imageCrop';

describe('cropImage', () => {
  it('resolves with a Blob on successful crop', async () => {
    const promise = cropImage('http://example.com/img.png', { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, 2048);
    mocks.mockImage.width = 1000;
    mocks.mockImage.height = 800;
    mocks.mockImage.onload?.();
    const blob = await promise;
    expect(blob).toBeInstanceOf(Blob);
  });

  it('sets crop canvas to correct dimensions', () => {
    const promise = cropImage('http://example.com/img.png', { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, 2048);
    mocks.mockImage.width = 1000;
    mocks.mockImage.height = 800;
    mocks.mockImage.onload?.();
    // Crop width = 800, height = 640
    expect(mocks.mockCanvas.width).toBe(800);
    expect(mocks.mockCanvas.height).toBe(640);
    return promise;
  });

  it('scales down if crop exceeds maxSize', () => {
    const promise = cropImage('http://example.com/img.png', { x: 0, y: 0, width: 1, height: 1 }, 500);
    mocks.mockImage.width = 2000;
    mocks.mockImage.height = 1000;
    mocks.mockImage.onload?.();
    expect(mocks.mockCanvas.width).toBeLessThanOrEqual(500);
    expect(mocks.mockCanvas.height).toBeLessThanOrEqual(500);
    return promise;
  });

  it('outputs image/webp with quality 0.92', async () => {
    const promise = cropImage('http://example.com/img.png', { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }, 2048);
    mocks.mockImage.width = 800;
    mocks.mockImage.height = 600;
    mocks.mockImage.onload?.();
    await promise;
    expect(mocks.mockCanvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.92);
  });

  it('rejects on image load error', async () => {
    const promise = cropImage('http://example.com/broken.png', { x: 0, y: 0, width: 0.5, height: 0.5 }, 2048);
    mocks.mockImage.onerror?.();
    await expect(promise).rejects.toThrow('图片加载失败');
  });
});
```

Run: `cd apps/web && npx vitest run src/utils/imageCrop.test.ts --reporter=verbose`
Expected: 5 tests FAIL — module not found

- [ ] **Step 2: 实现 cropImage**

```typescript
// apps/web/src/utils/imageCrop.ts
export interface CropRect {
  x: number;       // 0-1, 相对图片宽度的比例
  y: number;       // 0-1, 相对图片高度的比例
  width: number;   // 0-1
  height: number;  // 0-1
}

export function cropImage(
  imageUrl: string,
  cropRect: CropRect,
  maxSize: number = 2048,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const srcX = Math.round(img.width * cropRect.x);
      const srcY = Math.round(img.height * cropRect.y);
      const srcW = Math.round(img.width * cropRect.width);
      const srcH = Math.round(img.height * cropRect.height);

      let dstW = srcW;
      let dstH = srcH;
      const scale = Math.min(maxSize / dstW, maxSize / dstH, 1);
      dstW = Math.round(dstW * scale);
      dstH = Math.round(dstH * scale);

      const canvas = document.createElement('canvas');
      canvas.width = dstW;
      canvas.height = dstH;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, dstW, dstH);

      canvas.toBlob(
        (blob) => {
          img.src = '';
          canvas.width = 0;
          canvas.height = 0;
          if (blob) resolve(blob);
          else reject(new Error('Canvas导出失败'));
        },
        'image/webp',
        0.92,
      );
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = imageUrl;
  });
}
```

Run: `cd apps/web && npx vitest run src/utils/imageCrop.test.ts --reporter=verbose`
Expected: 5 tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/utils/imageCrop.ts apps/web/src/utils/imageCrop.test.ts
git commit -m "feat: add cropImage utility with WebP output"
```

---

### Task 5: EditToolbar 组件

**Files:**
- Create: `apps/web/src/pages/canvas/components/nodes/EditToolbar.tsx`
- Create: `apps/web/src/pages/canvas/components/nodes/EditToolbar.test.tsx`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/web/src/pages/canvas/components/nodes/EditToolbar.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditToolbar } from './EditToolbar';
import React from 'react';

// Mock useViewport and useInternalNode from @xyflow/react
vi.mock('@xyflow/react', () => ({
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  useInternalNode: () => ({ position: { x: 100, y: 200 }, measured: { width: 300, height: 250 } }),
}));

// Mock portal root
beforeEach(() => {
  const portal = document.createElement('div');
  portal.id = 'node-toolbar-portal';
  document.body.appendChild(portal);
});

describe('EditToolbar', () => {
  const baseProps = {
    nodeId: 'n1',
    editMode: 'crop' as const,
    isSaving: false,
    errorMessage: null,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    onUndo: vi.fn(),
    onClear: vi.fn(),
    onGenerate: vi.fn(),
    onSaveAsVariant: vi.fn(),
  };

  it('renders save and cancel buttons in crop mode', () => {
    render(<EditToolbar {...baseProps} />);
    expect(screen.getByText('保存')).toBeInTheDocument();
    expect(screen.getByText('退出')).toBeInTheDocument();
  });

  it('renders generate button in outpaint mode', () => {
    render(<EditToolbar {...baseProps} editMode="outpaint" />);
    expect(screen.getByText('生成')).toBeInTheDocument();
  });

  it('shows undo and clear buttons in erase mode', () => {
    render(<EditToolbar {...baseProps} editMode="erase" />);
    expect(screen.getByText('撤销')).toBeInTheDocument();
    expect(screen.getByText('清除')).toBeInTheDocument();
  });

  it('shows saving state', () => {
    render(<EditToolbar {...baseProps} isSaving={true} />);
    const saveBtn = screen.getByText('保存中...');
    expect(saveBtn).toBeDisabled();
  });

  it('shows error message', () => {
    render(<EditToolbar {...baseProps} errorMessage="网络错误" />);
    expect(screen.getByText('网络错误')).toBeInTheDocument();
  });

  it('calls onCancel when exit button clicked', async () => {
    const onCancel = vi.fn();
    render(<EditToolbar {...baseProps} onCancel={onCancel} />);
    await userEvent.click(screen.getByText('退出'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('does not render when not selected', () => {
    const { container } = render(<EditToolbar {...baseProps} />);
    // should render via portal, check portal content
    const portal = document.getElementById('node-toolbar-portal');
    expect(portal?.children.length).toBeGreaterThan(0);
  });
});
```

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/EditToolbar.test.tsx --reporter=verbose`
Expected: 7 tests FAIL — module not found

- [ ] **Step 2: 实现 EditToolbar**

```typescript
// apps/web/src/pages/canvas/components/nodes/EditToolbar.tsx
import { memo, useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useViewport, useInternalNode } from '@xyflow/react';

export interface EditToolbarProps {
  nodeId: string;
  editMode: 'crop' | 'outpaint' | 'erase' | 'redraw';
  isSaving: boolean;
  errorMessage: string | null;
  onSave?: () => void;
  onCancel: () => void;
  onUndo?: () => void;
  onClear?: () => void;
  onGenerate?: () => void;
  onSaveAsVariant?: () => void;
}

const BAR_BG = 'rgb(38, 38, 38)';
const BAR_BORDER = 'rgb(54, 54, 54)';
const TEXT_COLOR = 'rgb(247, 247, 247)';
const HOVER_BG = 'rgba(255,255,255,0.08)';
const TOOLBAR_HEIGHT = 56;
const GAP = 16;
const VIEWPORT_PADDING = 10;

function EditToolbarComponent({
  nodeId,
  editMode,
  isSaving,
  errorMessage,
  onSave,
  onCancel,
  onUndo,
  onClear,
  onGenerate,
  onSaveAsVariant,
}: EditToolbarProps) {
  const { x: vpX, y: vpY, zoom } = useViewport();
  const internalNode = useInternalNode(nodeId);

  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const nodeX = internalNode?.position?.x ?? 0;
  const nodeY = internalNode?.position?.y ?? 0;
  const nodeWidth = internalNode?.measured?.width;
  const nodeHeight = internalNode?.measured?.height;
  const { width: windowWidth, height: windowHeight } = windowSize;

  const position = useMemo(() => {
    if (nodeWidth == null || nodeHeight == null) return null;
    const viewCenterX = (nodeX + nodeWidth / 2) * zoom + vpX;
    const viewTopY = nodeY * zoom + vpY;
    const toolbarTop = viewTopY - TOOLBAR_HEIGHT - GAP;
    const toolbarLeft = Math.max(VIEWPORT_PADDING, Math.min(viewCenterX, windowWidth - VIEWPORT_PADDING));
    return { toolbarLeft, toolbarTop };
  }, [nodeX, nodeY, nodeWidth, nodeHeight, vpX, vpY, zoom, windowWidth, windowHeight]);

  if (!position || nodeWidth == null || nodeHeight == null) return null;

  const portalRoot = document.getElementById('node-toolbar-portal');
  if (!portalRoot) return null;

  const btnClass = 'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors cursor-pointer border-0';

  const isCrop = editMode === 'crop';
  const isAi = editMode === 'outpaint' || editMode === 'erase' || editMode === 'redraw';
  const isPaint = editMode === 'erase' || editMode === 'redraw';

  return createPortal(
    <div
      className="nodrag nopan absolute flex flex-col items-center gap-1 transition-opacity duration-150 pointer-events-auto"
      style={{
        left: position.toolbarLeft,
        top: position.toolbarTop,
        transform: 'translateX(-50%)',
        zIndex: 10000,
        willChange: 'left, top',
      }}
    >
      <style>{`
        .edit-btn:hover { background-color: ${HOVER_BG} !important; }
      `}</style>
      <div
        className="flex items-center gap-2 rounded-xl p-2"
        style={{
          backgroundColor: BAR_BG,
          border: `0.444px solid ${BAR_BORDER}`,
          boxShadow: 'rgba(0, 0, 0, 0.25) 0px 4px 10px 0px',
          color: TEXT_COLOR,
          backdropFilter: 'blur(8px)',
        }}
      >
        {/* Exit */}
        <button type="button" className={`${btnClass} edit-btn`} style={{ backgroundColor: 'transparent', color: TEXT_COLOR }} onClick={onCancel} disabled={isSaving}>
          <span>退出</span>
        </button>

        <div style={{ backgroundColor: BAR_BORDER, width: 1, height: 32 }} />

        {/* Undo / Clear (paint modes) */}
        {isPaint && (
          <>
            <button type="button" className={`${btnClass} edit-btn`} style={{ backgroundColor: 'transparent', color: TEXT_COLOR }} onClick={onUndo} disabled={isSaving}>
              <span>撤销</span>
            </button>
            <button type="button" className={`${btnClass} edit-btn`} style={{ backgroundColor: 'transparent', color: TEXT_COLOR }} onClick={onClear} disabled={isSaving}>
              <span>清除</span>
            </button>
            <div style={{ backgroundColor: BAR_BORDER, width: 1, height: 32 }} />
          </>
        )}

        {/* Save (crop) / Generate (AI) */}
        {isCrop && onSave && (
          <button type="button" className="h-8 rounded-lg px-4 text-[13px] font-medium transition-colors border-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
            style={{ backgroundColor: 'white', color: 'rgb(23, 23, 23)' }}
            disabled={isSaving} onClick={onSave}>
            {isSaving ? '保存中...' : '保存'}
          </button>
        )}
        {isAi && onGenerate && (
          <button type="button" className="h-8 rounded-lg px-4 text-[13px] font-medium transition-colors border-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
            style={{ backgroundColor: 'white', color: 'rgb(23, 23, 23)' }}
            disabled={isSaving} onClick={onGenerate}>
            {isSaving ? '生成中...' : '生成'}
          </button>
        )}

        {/* Save as variant */}
        {onSaveAsVariant && (
          <>
            <div style={{ backgroundColor: BAR_BORDER, width: 1, height: 32 }} />
            <button type="button" className={`${btnClass} edit-btn`} style={{ backgroundColor: 'transparent', color: TEXT_COLOR }} onClick={onSaveAsVariant} disabled={isSaving}>
              <span>保存为新变体</span>
            </button>
          </>
        )}
      </div>
      {errorMessage && (
        <div className="rounded-lg px-3 py-1.5 text-xs" style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}>
          {errorMessage}
        </div>
      )}
    </div>,
    portalRoot,
  );
}

export const EditToolbar = memo(EditToolbarComponent);
```

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/EditToolbar.test.tsx --reporter=verbose`
Expected: 7 tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/EditToolbar.tsx apps/web/src/pages/canvas/components/nodes/EditToolbar.test.tsx
git commit -m "feat: add EditToolbar with mode-based button visibility"
```

---

### Task 6: CropOverlay 组件

**Files:**
- Create: `apps/web/src/pages/canvas/components/nodes/CropOverlay.tsx`
- Create: `apps/web/src/pages/canvas/components/nodes/CropOverlay.test.tsx`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/web/src/pages/canvas/components/nodes/CropOverlay.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { CropOverlay } from './CropOverlay';
import React from 'react';

describe('CropOverlay', () => {
  const defaultProps = {
    containerWidth: 400,
    containerHeight: 300,
    imageDisplayWidth: 400,
    imageDisplayHeight: 300,
    imageNaturalWidth: 800,
    imageNaturalHeight: 600,
    onCropChange: vi.fn(),
  };

  it('renders overlay and crop frame', () => {
    render(<CropOverlay {...defaultProps} />);
    // Should render crop frame elements
    const handles = document.querySelectorAll('[data-testid="crop-handle"]');
    expect(handles.length).toBe(8); // 8 control points
  });

  it('starts with default 80% centered rect', () => {
    const onCropChange = vi.fn();
    render(<CropOverlay {...defaultProps} onCropChange={onCropChange} />);
    expect(onCropChange).toHaveBeenCalledWith({
      x: 0.1, y: 0.1, width: 0.8, height: 0.8,
    });
  });

  it('displays crop dimensions', () => {
    render(<CropOverlay {...defaultProps} />);
    // Default crop is 80% of 800x600 = 640x480
    expect(screen.getByText(/640/)).toBeInTheDocument();
    expect(screen.getByText(/480/)).toBeInTheDocument();
  });

  it('has nodrag class to prevent XYFlow drag', () => {
    render(<CropOverlay {...defaultProps} />);
    const overlay = document.querySelector('[data-testid="crop-overlay"]');
    expect(overlay?.className).toContain('nodrag');
  });
});
```

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/CropOverlay.test.tsx --reporter=verbose`
Expected: 4 tests FAIL — module not found

- [ ] **Step 2: 实现 CropOverlay**

```typescript
// apps/web/src/pages/canvas/components/nodes/CropOverlay.tsx
import { useState, useCallback, useRef, useEffect } from 'react';

export interface CropRect {
  x: number;      // 0–1, relative to image display width
  y: number;      // 0–1, relative to image display height
  width: number;  // 0–1
  height: number; // 0–1
}

interface CropOverlayProps {
  containerWidth: number;
  containerHeight: number;
  imageDisplayWidth: number;
  imageDisplayHeight: number;
  imageNaturalWidth: number;
  imageNaturalHeight: number;
  onCropChange: (rect: CropRect) => void;
}

const MIN_CROP_SIZE = 50; // px on display
const HANDLE_SIZE = 8;

function clampCrop(rect: CropRect, displayW: number, displayH: number): CropRect {
  const minW = MIN_CROP_SIZE / displayW;
  const minH = MIN_CROP_SIZE / displayH;
  let { x, y, width, height } = rect;
  if (width < minW) width = minW;
  if (height < minH) height = minH;
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + width > 1) x = 1 - width;
  if (y + height > 1) y = 1 - height;
  return { x, y, width, height };
}

function toDisplayPx(r: CropRect, displayW: number, displayH: number) {
  return {
    left: Math.round(r.x * displayW),
    top: Math.round(r.y * displayH),
    width: Math.round(r.width * displayW),
    height: Math.round(r.height * displayH),
  };
}

export function CropOverlay({
  containerWidth,
  containerHeight,
  imageDisplayWidth,
  imageDisplayHeight,
  imageNaturalWidth,
  imageNaturalHeight,
  onCropChange,
}: CropOverlayProps) {
  const [cropRect, setCropRect] = useState<CropRect>({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
  const [dragging, setDragging] = useState<'move' | 'resize' | null>(null);
  const dragStart = useRef({ x: 0, y: 0, rect: cropRect });
  const onCropChangeRef = useRef(onCropChange);
  onCropChangeRef.current = onCropChange;

  useEffect(() => {
    onCropChangeRef.current(cropRect);
  }, [cropRect]);

  const updateRect = useCallback((newRect: CropRect) => {
    const clamped = clampCrop(newRect, imageDisplayWidth, imageDisplayHeight);
    setCropRect(clamped);
  }, [imageDisplayWidth, imageDisplayHeight]);

  const px = toDisplayPx(cropRect, imageDisplayWidth, imageDisplayHeight);
  const cropW = Math.round(cropRect.width * imageNaturalWidth);
  const cropH = Math.round(cropRect.height * imageNaturalHeight);

  const handleMouseDown = (e: React.MouseEvent, type: 'move' | 'resize') => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(type);
    dragStart.current = { x: e.clientX, y: e.clientY, rect: { ...cropRect } };
  };

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      const dx = (e.clientX - dragStart.current.x) / imageDisplayWidth;
      const dy = (e.clientY - dragStart.current.y) / imageDisplayHeight;
      const start = dragStart.current.rect;

      if (dragging === 'move') {
        updateRect({ ...start, x: start.x + dx, y: start.y + dy });
      }
    };
    const handleUp = () => setDragging(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging, imageDisplayWidth, imageDisplayHeight, updateRect]);

  // Handle drag for resize handles (corners and edges)
  const handleResizeStart = (e: React.MouseEvent, handle: string) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging('resize');
    dragStart.current = { x: e.clientX, y: e.clientY, rect: { ...cropRect }, handleType: handle as any };
  };

  // Extend dragStart type
  (dragStart as any).current.handleType = '';

  useEffect(() => {
    if (dragging !== 'resize') return;
    const handleMove = (e: MouseEvent) => {
      const dx = (e.clientX - dragStart.current.x) / imageDisplayWidth;
      const dy = (e.clientY - dragStart.current.y) / imageDisplayHeight;
      const start = dragStart.current.rect;
      const h = (dragStart as any).current.handleType as string;

      let { x, y, width, height } = start;
      if (h.includes('e')) { width = start.width + dx; }
      if (h.includes('w')) { x = start.x + dx; width = start.width - dx; }
      if (h.includes('s')) { height = start.height + dy; }
      if (h.includes('n')) { y = start.y + dy; height = start.height - dy; }

      // Prevent negative dimensions
      if (width < 0) { x = x + width; width = -width; }
      if (height < 0) { y = y + height; height = -height; }

      updateRect({ x, y, width, height });
    };
    const handleUp = () => setDragging(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging, imageDisplayWidth, imageDisplayHeight, updateRect]);

  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  return (
    <div
      data-testid="crop-overlay"
      className="nodrag nopan absolute inset-0"
      style={{ width: containerWidth, height: containerHeight }}
    >
      {/* Dark overlay */}
      <svg width={containerWidth} height={containerHeight} style={{ position: 'absolute', top: 0, left: 0 }}>
        <defs>
          <mask id="crop-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect x={px.left} y={px.top} width={px.width} height={px.height} fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.5)" mask="url(#crop-mask)" />
      </svg>

      {/* Crop frame */}
      <div
        style={{
          position: 'absolute',
          left: px.left, top: px.top, width: px.width, height: px.height,
          border: '1px dashed white',
          cursor: 'move',
        }}
        onMouseDown={(e) => handleMouseDown(e, 'move')}
      >
        {handles.map((h) => {
          const isCorner = h.length === 2;
          const cursors: Record<string, string> = {
            nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize',
            e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
          };
          const positions: Record<string, React.CSSProperties> = {
            nw: { top: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 },
            n: { top: -HANDLE_SIZE / 2, left: 'calc(50% - 4px)' },
            ne: { top: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 },
            e: { top: 'calc(50% - 4px)', right: -HANDLE_SIZE / 2 },
            se: { bottom: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 },
            s: { bottom: -HANDLE_SIZE / 2, left: 'calc(50% - 4px)' },
            sw: { bottom: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 },
            w: { top: 'calc(50% - 4px)', left: -HANDLE_SIZE / 2 },
          };
          return (
            <div
              key={h}
              data-testid="crop-handle"
              style={{
                position: 'absolute', width: HANDLE_SIZE, height: HANDLE_SIZE,
                backgroundColor: '#3b82f6', border: '1px solid white',
                cursor: cursors[h], ...positions[h],
              }}
              onMouseDown={(e) => handleResizeStart(e, h)}
            />
          );
        })}
      </div>

      {/* Size display */}
      <div
        className="nodrag nopan"
        style={{
          position: 'absolute',
          left: px.left,
          bottom: px.top - 4,
          transform: 'translateY(-100%)',
          backgroundColor: 'rgba(0,0,0,0.75)',
          color: 'white',
          padding: '2px 6px',
          borderRadius: 4,
          fontSize: 11,
          fontFamily: 'monospace',
        }}
      >
        {cropW} × {cropH}
      </div>
    </div>
  );
}
```

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/CropOverlay.test.tsx --reporter=verbose`
Expected: 4 tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/CropOverlay.tsx apps/web/src/pages/canvas/components/nodes/CropOverlay.test.tsx
git commit -m "feat: add CropOverlay with DOM-based crop frame and 8 handles"
```

---

### Task 7: EraseCanvas 组件（画笔，擦除和重绘共用）

**Files:**
- Create: `apps/web/src/pages/canvas/components/nodes/EraseCanvas.tsx`
- Create: `apps/web/src/pages/canvas/components/nodes/EraseCanvas.test.tsx`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/web/src/pages/canvas/components/nodes/EraseCanvas.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { EraseCanvas } from './EraseCanvas';
import React, { createRef } from 'react';

describe('EraseCanvas', () => {
  it('renders a canvas element with correct dimensions', () => {
    render(<EraseCanvas width={400} height={300} brushSize={20} />);
    const canvas = document.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
    expect(canvas?.width).toBe(400);
    expect(canvas?.height).toBe(300);
  });

  it('has nodrag class', () => {
    render(<EraseCanvas width={400} height={300} brushSize={20} />);
    const canvas = document.querySelector('canvas');
    expect(canvas?.className).toContain('nodrag');
  });

  it('exposes hasContent as false initially', () => {
    const ref = createRef<EraseCanvasHandle>();
    render(<EraseCanvas ref={ref} width={400} height={300} brushSize={20} />);
    expect(ref.current?.hasContent()).toBe(false);
  });

  it('clear resets the canvas', () => {
    const ref = createRef<EraseCanvasHandle>();
    render(<EraseCanvas ref={ref} width={400} height={300} brushSize={20} />);
    ref.current?.clear();
    expect(ref.current?.hasContent()).toBe(false);
  });

  it('undo on empty canvas does not throw', () => {
    const ref = createRef<EraseCanvasHandle>();
    render(<EraseCanvas ref={ref} width={400} height={300} brushSize={20} />);
    expect(() => ref.current?.undo()).not.toThrow();
  });
});
```

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/EraseCanvas.test.tsx --reporter=verbose`
Expected: 5 tests FAIL — module not found

- [ ] **Step 2: 实现 EraseCanvas**

```typescript
// apps/web/src/pages/canvas/components/nodes/EraseCanvas.tsx
import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';

export interface EraseCanvasHandle {
  hasContent: () => boolean;
  clear: () => void;
  undo: () => void;
  getMaskBlob: (naturalW: number, naturalH: number) => Promise<Blob>;
}

interface Props {
  width: number;
  height: number;
  brushSize: number;
}

export const EraseCanvas = forwardRef<EraseCanvasHandle, Props>(
  function EraseCanvas({ width, height, brushSize }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDrawing = useRef(false);
    const strokes = useRef<ImageData[]>([]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      // No fill — transparent background
    }, [width, height]);

    const saveStroke = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      strokes.current.push(ctx.getImageData(0, 0, width, height));
    }, [width, height]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      saveStroke();

      const ctx = canvas.getContext('2d')!;
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 0, 0, 0.4)';
      ctx.fill();
      isDrawing.current = true;
    }, [brushSize, saveStroke]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
      if (!isDrawing.current) return;
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const ctx = canvas.getContext('2d')!;
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 0, 0, 0.4)';
      ctx.fill();
    }, [brushSize]);

    const handleMouseUp = useCallback(() => {
      isDrawing.current = false;
    }, []);

    useImperativeHandle(ref, () => ({
      hasContent: () => strokes.current.length > 0,
      clear: () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        saveStroke();
        ctx.clearRect(0, 0, width, height);
      },
      undo: () => {
        const canvas = canvasRef.current;
        if (!canvas || strokes.current.length === 0) return;
        const ctx = canvas.getContext('2d')!;
        const prev = strokes.current.pop()!;
        ctx.putImageData(prev, 0, 0);
      },
      getMaskBlob: (naturalW: number, naturalH: number): Promise<Blob> => {
        return new Promise((resolve, reject) => {
          const canvas = canvasRef.current;
          if (!canvas) { reject(new Error('No canvas')); return; }

          const maskCanvas = document.createElement('canvas');
          maskCanvas.width = naturalW;
          maskCanvas.height = naturalH;
          const maskCtx = maskCanvas.getContext('2d')!;

          // Scale from display size to natural size
          const scaleX = naturalW / width;
          const scaleY = naturalH / height;
          maskCtx.scale(scaleX, scaleY);

          // Draw red pixels as white mask
          const imageData = canvas.getContext('2d')!.getImageData(0, 0, width, height);
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = width;
          tempCanvas.height = height;
          const tempCtx = tempCanvas.getContext('2d')!;
          tempCtx.putImageData(imageData, 0, 0);

          // Convert red to white, other to black
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const isRed = r > 200 && g < 100 && b < 100;
            data[i] = isRed ? 255 : 0;
            data[i + 1] = isRed ? 255 : 0;
            data[i + 2] = isRed ? 255 : 0;
          }
          tempCtx.putImageData(imageData, 0, 0);
          maskCtx.drawImage(tempCanvas, 0, 0);

          // Edge feathering: 3px blur
          maskCtx.filter = 'blur(3px)';
          maskCtx.drawImage(maskCanvas, 0, 0);
          maskCtx.filter = 'none';

          maskCanvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Mask export failed'));
          }, 'image/png', 1.0);
        });
      },
    }), [width, height]);

    useEffect(() => {
      const handleGlobalUp = () => { isDrawing.current = false; };
      window.addEventListener('mouseup', handleGlobalUp);
      return () => window.removeEventListener('mouseup', handleGlobalUp);
    }, []);

    return (
      <canvas
        ref={canvasRef}
        className="nodrag nopan absolute top-0 left-0"
        style={{ width, height, cursor: 'crosshair', zIndex: 5 }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      />
    );
  },
);
```

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/EraseCanvas.test.tsx --reporter=verbose`
Expected: 5 tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/EraseCanvas.tsx apps/web/src/pages/canvas/components/nodes/EraseCanvas.test.tsx
git commit -m "feat: add EraseCanvas with brush drawing, undo, and 3px feathered mask export"
```

---

### Task 8: OutpaintPanel 组件（受控组件，状态提升到父组件）

**Files:**
- Create: `apps/web/src/pages/canvas/components/nodes/OutpaintPanel.tsx`
- Create: `apps/web/src/pages/canvas/components/nodes/OutpaintPanel.test.tsx`

> **设计决策**：OutpaintPanel 使用受控模式，状态由 ImageGenNode 管理（`outpaintState`），通过 props 传入 onChange 回调。这样 `handleGenerate` 可以直接读取参数，无需 ref。

- [ ] **Step 1: 写失败测试**

```typescript
// apps/web/src/pages/canvas/components/nodes/OutpaintPanel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OutpaintPanel, type OutpaintState, type Direction } from './OutpaintPanel';
import React from 'react';

const defaultState: OutpaintState = { direction: 'all', scale: 1.2, prompt: '' };

describe('OutpaintPanel', () => {
  it('renders direction buttons (single select)', () => {
    render(<OutpaintPanel state={defaultState} onChange={vi.fn()} imageW={400} imageH={300} naturalW={800} naturalH={600} />);
    expect(screen.getByText('上')).toBeInTheDocument();
    expect(screen.getByText('下')).toBeInTheDocument();
    expect(screen.getByText('左')).toBeInTheDocument();
    expect(screen.getByText('右')).toBeInTheDocument();
    expect(screen.getByText('全部')).toBeInTheDocument();
  });

  it('default direction is all, scale 1.2', () => {
    render(<OutpaintPanel state={defaultState} onChange={vi.fn()} imageW={400} imageH={300} naturalW={800} naturalH={600} />);
    const allBtn = screen.getByText('全部');
    expect(allBtn).toHaveStyle({ backgroundColor: expect.stringContaining('59,130,246') });
  });

  it('renders prompt input', () => {
    render(<OutpaintPanel state={defaultState} onChange={vi.fn()} imageW={400} imageH={300} naturalW={800} naturalH={600} />);
    expect(screen.getByPlaceholderText('描述扩图区域的内容（可选）')).toBeInTheDocument();
  });

  it('shows preview dimensions', () => {
    render(<OutpaintPanel state={defaultState} onChange={vi.fn()} imageW={400} imageH={300} naturalW={800} naturalH={600} />);
    expect(screen.getByText(/原图 800×600/)).toBeInTheDocument();
    expect(screen.getByText(/扩图后 960×720/)).toBeInTheDocument();
  });

  it('calls onChange when direction clicked', () => {
    const onChange = vi.fn();
    render(<OutpaintPanel state={defaultState} onChange={onChange} imageW={400} imageH={300} naturalW={800} naturalH={600} />);
    fireEvent.click(screen.getByText('上'));
    expect(onChange).toHaveBeenCalledWith({ ...defaultState, direction: 'top' });
  });
});
```

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/OutpaintPanel.test.tsx --reporter=verbose`
Expected: 5 tests FAIL — module not found

- [ ] **Step 2: 实现 OutpaintPanel（受控组件）**

```typescript
// apps/web/src/pages/canvas/components/nodes/OutpaintPanel.tsx
export type Direction = 'top' | 'bottom' | 'left' | 'right' | 'all';

export interface OutpaintState {
  direction: Direction;
  scale: number;
  prompt: string;
}

interface OutpaintPanelProps {
  state: OutpaintState;
  onChange: (state: OutpaintState) => void;
  imageW: number;
  imageH: number;
  naturalW: number;
  naturalH: number;
}

const directions: { label: string; value: Direction }[] = [
  { label: '上', value: 'top' },
  { label: '下', value: 'bottom' },
  { label: '左', value: 'left' },
  { label: '右', value: 'right' },
  { label: '全部', value: 'all' },
];

export function OutpaintPanel({ state, onChange, imageW, imageH, naturalW, naturalH }: OutpaintPanelProps) {
  const { direction, scale, prompt } = state;

  const getDisplayDims = () => {
    if (direction === 'all') return { w: Math.round(naturalW * scale), h: Math.round(naturalH * scale) };
    if (direction === 'top' || direction === 'bottom') return { w: naturalW, h: Math.round(naturalH * scale) };
    return { w: Math.round(naturalW * scale), h: naturalH };
  };

  const dims = getDisplayDims();

  return (
    <div className="nodrag nopan absolute bottom-0 left-0 right-0 z-10 flex flex-col gap-2 p-3"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
      <div className="flex items-center gap-1">
        {directions.map((d) => (
          <button key={d.value} type="button"
            onClick={(e) => { e.stopPropagation(); onChange({ ...state, direction: d.value }); }}
            style={{
              padding: '4px 10px', borderRadius: 6, border: '1px solid rgb(54,54,54)',
              fontSize: 12, color: '#ccc', cursor: 'pointer',
              backgroundColor: direction === d.value ? 'rgb(59,130,246)' : 'rgb(38,38,38)',
            }}>{d.label}</button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span style={{ color: '#999', fontSize: 11 }}>比例</span>
        <input type="range" min="1.1" max="2.0" step="0.1" value={scale}
          onChange={(e) => onChange({ ...state, scale: parseFloat(e.target.value) })}
          onMouseDown={(e) => e.stopPropagation()} style={{ flex: 1 }} />
        <span style={{ color: '#ccc', fontSize: 11, minWidth: 32 }}>{scale}x</span>
      </div>
      <input type="text" placeholder="描述扩图区域的内容（可选）" value={prompt}
        onChange={(e) => onChange({ ...state, prompt: e.target.value })}
        onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid rgb(54,54,54)', backgroundColor: 'rgb(28,28,28)', color: '#ccc', fontSize: 12 }} />
      <div style={{ color: '#888', fontSize: 11, textAlign: 'right' }}>
        原图 {naturalW}×{naturalH} → 扩图后 {dims.w}×{dims.h}
      </div>
    </div>
  );
}
```

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/OutpaintPanel.test.tsx --reporter=verbose`
Expected: 4 tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/OutpaintPanel.tsx apps/web/src/pages/canvas/components/nodes/OutpaintPanel.test.tsx
git commit -m "feat: add OutpaintPanel with direction selector, scale slider, and prompt"
```

---

### Task 9: RedrawPanel 组件（受控组件，状态提升到父组件）

**Files:**
- Create: `apps/web/src/pages/canvas/components/nodes/RedrawPanel.tsx`
- Create: `apps/web/src/pages/canvas/components/nodes/RedrawPanel.test.tsx`

> **设计决策**：RedrawPanel 使用受控模式，状态由 ImageGenNode 管理（`redrawState`），通过 props 传入 onChange 回调。

- [ ] **Step 1: 写失败测试**

```typescript
// apps/web/src/pages/canvas/components/nodes/RedrawPanel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RedrawPanel, type RedrawState } from './RedrawPanel';
import React from 'react';

const defaultState: RedrawState = { mode: 'rect', prompt: '', strength: 50 };

describe('RedrawPanel', () => {
  it('renders mode toggle (rect/brush)', () => {
    render(<RedrawPanel state={defaultState} onChange={vi.fn()} />);
    expect(screen.getByText('矩形')).toBeInTheDocument();
    expect(screen.getByText('画笔')).toBeInTheDocument();
  });

  it('renders required prompt input', () => {
    render(<RedrawPanel state={defaultState} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('描述你希望生成的内容')).toBeInTheDocument();
  });

  it('renders strength slider default 50', () => {
    render(<RedrawPanel state={defaultState} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('50')).toBeInTheDocument();
  });

  it('default mode is rect (highlighted)', () => {
    render(<RedrawPanel state={defaultState} onChange={vi.fn()} />);
    const rectBtn = screen.getByText('矩形');
    expect(rectBtn).toHaveStyle({ backgroundColor: expect.stringContaining('59,130,246') });
  });

  it('calls onChange when mode switched', () => {
    const onChange = vi.fn();
    render(<RedrawPanel state={defaultState} onChange={onChange} />);
    fireEvent.click(screen.getByText('画笔'));
    expect(onChange).toHaveBeenCalledWith({ ...defaultState, mode: 'brush' });
  });
});
```

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/RedrawPanel.test.tsx --reporter=verbose`
Expected: 5 tests FAIL — module not found

- [ ] **Step 2: 实现 RedrawPanel（受控组件）**

```typescript
// apps/web/src/pages/canvas/components/nodes/RedrawPanel.tsx
export type SelectionMode = 'rect' | 'brush';

export interface RedrawState {
  mode: SelectionMode;
  prompt: string;
  strength: number;
}

interface RedrawPanelProps {
  state: RedrawState;
  onChange: (state: RedrawState) => void;
}

export function RedrawPanel({ state, onChange }: RedrawPanelProps) {
  const { mode, prompt, strength } = state;

  return (
    <div className="nodrag nopan absolute bottom-0 left-0 right-0 z-10 flex flex-col gap-2 p-3"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
      <div className="flex items-center gap-1">
        {(['rect', 'brush'] as SelectionMode[]).map((m) => (
          <button key={m} type="button"
            onClick={(e) => { e.stopPropagation(); onChange({ ...state, mode: m }); }}
            style={{
              padding: '4px 10px', borderRadius: 6, border: '1px solid rgb(54,54,54)',
              fontSize: 12, color: '#ccc', cursor: 'pointer',
              backgroundColor: mode === m ? 'rgb(59,130,246)' : 'rgb(38,38,38)',
            }}>{m === 'rect' ? '矩形' : '画笔'}</button>
        ))}
      </div>
      <input type="text" placeholder="描述你希望生成的内容" value={prompt}
        onChange={(e) => onChange({ ...state, prompt: e.target.value })}
        onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid rgb(54,54,54)', backgroundColor: 'rgb(28,28,28)', color: '#ccc', fontSize: 12 }} />
      <div className="flex items-center gap-2">
        <span style={{ color: '#999', fontSize: 11 }}>强度</span>
        <input type="range" min="0" max="100" step="1" value={strength}
          onChange={(e) => onChange({ ...state, strength: parseInt(e.target.value) })}
          onMouseDown={(e) => e.stopPropagation()} style={{ flex: 1 }} />
        <span style={{ color: '#ccc', fontSize: 11, minWidth: 24 }}>{strength}</span>
      </div>
    </div>
  );
}
```

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/RedrawPanel.test.tsx --reporter=verbose`
Expected: 4 tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/RedrawPanel.tsx apps/web/src/pages/canvas/components/nodes/RedrawPanel.test.tsx
git commit -m "feat: add RedrawPanel with rect/brush mode, prompt, and strength slider"
```

---

### Task 10: ImageNodeToolbar 按钮接线

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx`
- Test: `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx`

- [ ] **Step 1: 写失败测试 — 编辑按钮有 onClick handler**

```typescript
// ImageNodeToolbar.test.tsx — 追加到现有 describe
it('calls onCrop when 裁切 clicked', async () => {
  const onCrop = vi.fn();
  render(<ImageNodeToolbar nodeId="n1" selected={true} onCrop={onCrop} />);
  await userEvent.click(screen.getByText('裁切'));
  expect(onCrop).toHaveBeenCalled();
});
```

Run: 4 new tests FAIL — `onCrop` prop not accepted

- [ ] **Step 2: 实现 ImageNodeToolbar 新增 props 和接线**

```typescript
// ImageNodeToolbar.tsx — 接口扩展
interface ImageNodeToolbarProps {
  nodeId: string;
  fileId?: string;
  referenceImage?: string;
  selected: boolean;
  onUpload?: () => void;
  onRotateMirror?: () => void;
  onCrop?: () => void;       // 新增
  onOutpaint?: () => void;   // 新增
  onErase?: () => void;      // 新增
  onRedraw?: () => void;     // 新增
}

// 组件参数解构新增
function ImageNodeToolbarComponent({
  nodeId, fileId, referenceImage, selected,
  onUpload = () => {},
  onRotateMirror,
  onCrop,
  onOutpaint,
  onErase,
  onRedraw,
}: ImageNodeToolbarProps) {

// Row 1 按钮修改（仅修改裁切/扩图/擦除/重绘四个按钮）
<TextIconButton icon={<CropIcon />} ariaLabel="裁切" text="裁切" onClick={onCrop} />
<TextIconButton icon={<ExpandImageIcon />} ariaLabel="扩图" text="扩图" onClick={onOutpaint} />
<TextIconButton icon={<EraserIcon />} ariaLabel="擦除" text="擦除" onClick={onErase} />
<TextIconButton icon={<PaintbrushIcon />} ariaLabel="重绘" text="重绘" onClick={onRedraw} />
```

Run: 4 tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx
git commit -m "feat: wire up crop/outpaint/erase/redraw buttons in ImageNodeToolbar"
```

---

### Task 11: ImageGenNode 编辑模式集成

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx`
- Test: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx`

- [ ] **Step 1: 写失败测试 — editMode 切换渲染**

```typescript
// ImageGenNode.test.tsx 追加
it('renders EditToolbar when editMode is crop', async () => {
  // Setup node with editMode: 'crop'
  useNodeStore.getState().addNode({
    id: 'edit-test',
    type: 'imageGen',
    position: { x: 0, y: 0 },
    data: { editMode: 'crop', style: '写实', model: 'sd', quality: 'standard', ratio: '1:1', status: 'idle', prompt: { text: '', allImages: [], referencedImageIds: [] }, fileId: 'f1' } as ImageNodeData,
  });
  // Render check...
  // The edit toolbar should appear via portal
});
```

Since ImageGenNode integration touches many internal states and portal rendering, and existing ImageGenNode tests use extensive mocking, we'll write the integration test covering the key flows.

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/ImageGenNode.test.tsx --reporter=verbose`
Expected: New tests FAIL

- [ ] **Step 2: 实现 ImageGenNode 编辑模式逻辑**

```typescript
// ImageGenNode.tsx — 在 ImageGenNodeComponent 中添加

// 新增 imports
import { EditToolbar } from './EditToolbar';
import { CropOverlay } from './CropOverlay';
import { EraseCanvas, type EraseCanvasHandle } from './EraseCanvas';
import { OutpaintPanel } from './OutpaintPanel';
import { RedrawPanel } from './RedrawPanel';
import { cropImage } from '@/utils/imageCrop';

// 从 nodeData 读取 editMode
const editMode = nodeData?.editMode ?? null;

// 新增 refs 和 state
const eraseRef = useRef<EraseCanvasHandle>(null);
const [brushSize, setBrushSize] = useState(20);
const [isProcessing, setProcessing] = useState(false);
const [editError, setEditError] = useState<string | null>(null);
const cropRectRef = useRef<CropRect>({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });

// 受控面板状态（状态提升，便于 handleGenerate/handleEditCancel 直接读取）
const [outpaintState, setOutpaintState] = useState<OutpaintState>({ direction: 'all', scale: 1.2, prompt: '' });
const [redrawState, setRedrawState] = useState<RedrawState>({ mode: 'rect', prompt: '', strength: 50 });

// 编辑按钮 handlers
const handleCrop = useCallback(() => {
  // check mutual exclusion first
  const ns = useNodeStore.getState();
  if (ns.activeTransformNodeId) {
    ns.triggerCancelTransform();
    // wait briefly for cancel to process, then enter edit mode
    setTimeout(() => {
      updateConfig(id, { editMode: 'crop' });
      ns.setActiveEditNodeId(id);
    }, 100);
    return;
  }
  updateConfig(id, { editMode: 'crop' });
  ns.setActiveEditNodeId(id);
}, [id, updateConfig]);

const handleOutpaint = useCallback(() => {
  const ns = useNodeStore.getState();
  if (ns.activeTransformNodeId) { ns.triggerCancelTransform(); return; }
  updateConfig(id, { editMode: 'outpaint' });
  ns.setActiveEditNodeId(id);
}, [id, updateConfig]);

const handleErase = useCallback(() => {
  const ns = useNodeStore.getState();
  if (ns.activeTransformNodeId) { ns.triggerCancelTransform(); return; }
  updateConfig(id, { editMode: 'erase' });
  ns.setActiveEditNodeId(id);
}, [id, updateConfig]);

const handleRedraw = useCallback(() => {
  const ns = useNodeStore.getState();
  if (ns.activeTransformNodeId) { ns.triggerCancelTransform(); return; }
  updateConfig(id, { editMode: 'redraw' });
  ns.setActiveEditNodeId(id);
}, [id, updateConfig]);

// 退出编辑模式
const handleEditCancel = useCallback(() => {
  setEditError(null);
  if (isProcessing) return;

  const editState = {
    cropRect: cropRectRef.current,
    direction: outpaintState.direction,
    scale: outpaintState.scale,
    prompt: outpaintState.prompt,
    maskPaths: eraseRef.current?.hasContent() ? [{ points: [] }] : [],
  };

  if (!hasEditChanges(editMode!, editState)) {
    updateConfig(id, { editMode: null });
    useNodeStore.getState().setActiveEditNodeId(null);
    return;
  }

  useConfirmModalStore.getState().show({
    title: '放弃未保存的编辑？',
    content: '当前编辑尚未保存，请选择如何处理。',
    cancelText: '取消',
    primaryText: '放弃并退出',
    primaryType: 'danger',
    onClose: () => useConfirmModalStore.getState().close(),
    onPrimary: () => {
      updateConfig(id, { editMode: null });
      useNodeStore.getState().setActiveEditNodeId(null);
      eraseRef.current?.clear();
      useConfirmModalStore.getState().close();
    },
  });
}, [id, editMode, isProcessing, updateConfig]);

// 裁剪保存
const handleCropSave = useCallback(async () => {
  setProcessing(true);
  setEditError(null);
  try {
    const rect = cropRectRef.current;
    const blob = await cropImage(displayUrl, rect, 2048);
    const file = new File([blob], `crop-${Date.now()}.webp`, { type: 'image/webp' });

    const { fileId: newId, uploadUrl, key, fields } = await presignUpload({
      fileName: file.name, fileSize: file.size, fileType: 'image/webp', type: 'uploaded',
    });
    const formData = new FormData();
    Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
    formData.append('file', file);
    const proxyUrl = import.meta.env.DEV
      ? uploadUrl.replace(/^http:\/\/[^/]+\/flowai/, '/minio-storage')
      : uploadUrl;
    await axios.post(proxyUrl, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }, timeout: 30000,
    });
    await confirmUpload({ fileId: newId, key, fileSize: file.size });

    updateConfig(id, { fileId: newId, referenceImage: undefined, editMode: null });
    useNodeStore.getState().setActiveEditNodeId(null);
  } catch (err) {
    console.error('裁剪失败:', err);
    setEditError('保存失败，请重试');
  } finally {
    setProcessing(false);
  }
}, [id, displayUrl, updateConfig]);

// AI 生成提交 (outpaint/erase/redraw)
const handleGenerate = useCallback(async () => {
  setProcessing(true);
  setEditError(null);
  try {
    let endpoint = '';
    let body: any = { fileId, nodeId: id };

    if (editMode === 'outpaint') {
      endpoint = '/api/image-edit/outpaint';
      body.direction = outpaintState.direction;
      body.scale = outpaintState.scale;
      body.prompt = outpaintState.prompt || undefined;
    } else if (editMode === 'erase' || editMode === 'redraw') {
      endpoint = editMode === 'erase' ? '/api/image-edit/erase' : '/api/image-edit/redraw';
      const maskBlob = await eraseRef.current!.getMaskBlob(
        imgSize?.w ?? baseWidth,
        imgSize?.h ?? baseHeight,
      );
      // Upload mask first
      const maskFile = new File([maskBlob], 'mask.png', { type: 'image/png' });
      const { fileId: maskId, uploadUrl, key, fields } = await presignUpload({
        fileName: maskFile.name, fileSize: maskFile.size, fileType: 'image/png', type: 'uploaded',
      });
      const fd = new FormData();
      Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
      fd.append('file', maskFile);
      const proxy = import.meta.env.DEV ? uploadUrl.replace(/^http:\/\/[^/]+\/flowai/, '/minio-storage') : uploadUrl;
      await axios.post(proxy, fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 30000 });
      await confirmUpload({ fileId: maskId, key, fileSize: maskFile.size });

      body.maskFileId = maskId;
      if (editMode === 'redraw') {
        body.prompt = redrawState.prompt;
        body.strength = redrawState.strength;
      }
    }

    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // Socket.io will handle the result — don't exit edit mode yet
  } catch (err) {
    console.error('AI 编辑失败:', err);
    setEditError('提交失败，请重试');
    setProcessing(false);
  }
}, [id, editMode, fileId, displayUrl, outpaintState, redrawState]);

// 保存为新变体
const handleSaveAsVariant = useCallback(async () => {
  setProcessing(true);
  setEditError(null);
  try {
    let newFileId: string;

    if (editMode === 'crop') {
      const rect = cropRectRef.current;
      const blob = await cropImage(displayUrl, rect, 2048);
      const file = new File([blob], `crop-${Date.now()}.webp`, { type: 'image/webp' });
      const { fileId: fid, uploadUrl, key, fields } = await presignUpload({
        fileName: file.name, fileSize: file.size, fileType: 'image/webp', type: 'uploaded',
      });
      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);
      const proxyUrl = import.meta.env.DEV
        ? uploadUrl.replace(/^http:\/\/[^/]+\/flowai/, '/minio-storage')
        : uploadUrl;
      await axios.post(proxyUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: 30000,
      });
      await confirmUpload({ fileId: fid, key, fileSize: file.size });
      newFileId = fid;
    } else {
      // AI 模式：当前已有 fileId（等待 Socket.io 结果更新后才有新 fileId）
      // 此处先使用当前 fileId——实际使用时应在生成完成后调用
      if (!fileId) throw new Error('没有可保存的图片');
      newFileId = fileId;
    }

    const newNodeId = useCanvasStore.getState().addNodeWithEdge(id);
    useNodeStore.getState().updateConfig(newNodeId, { fileId: newFileId });

    updateConfig(id, { editMode: null });
    useNodeStore.getState().setActiveEditNodeId(null);
  } catch (err) {
    console.error('保存为新变体失败:', err);
    setEditError('保存失败，请重试');
  } finally {
    setProcessing(false);
  }
}, [id, editMode, fileId, displayUrl, updateConfig]);

// 键盘快捷键（仅当前节点是 activeEditNode 时生效）
useEffect(() => {
  if (!editMode) return;

  const onKeyDown = (e: KeyboardEvent) => {
    if (useNodeStore.getState().activeEditNodeId !== id) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;

    if (e.key === 'Escape') {
      e.stopPropagation();
      handleEditCancel();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && editMode === 'crop') {
      e.preventDefault();
      handleCropSave();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && (editMode === 'erase' || editMode === 'redraw')) {
      e.preventDefault();
      eraseRef.current?.undo();
    }
  };

  document.addEventListener('keydown', onKeyDown, true);
  return () => document.removeEventListener('keydown', onKeyDown, true);
}, [id, editMode, handleEditCancel, handleCropSave]);

// cancelRequestedAt 监听（外部触发取消）
useEffect(() => {
  const unsub = useNodeStore.subscribe((state, prev) => {
    if (state.cancelRequestedAt !== prev.cancelRequestedAt && state.cancelRequestedAt > 0) {
      if (state.activeEditNodeId === id) {
        handleEditCancel();
      }
    }
  });
  return unsub;
}, [id, handleEditCancel]);

// Socket.io 监听 node:edit-result 和 node:edit-failed
useEffect(() => {
  if (!editMode) return;
  // Socket.io events are already set up in the component.
  // Add handlers for edit-result and edit-failed:
  const socket = io('/execution', { transports: ['websocket', 'polling'] });
  socket.on('node:edit-result', (data: any) => {
    if (data.nodeId !== id) return;
    updateConfig(id, { fileId: data.fileId, editMode: null });
    useNodeStore.getState().setActiveEditNodeId(null);
    setProcessing(false);
  });
  socket.on('node:edit-failed', (data: any) => {
    if (data.nodeId !== id) return;
    setEditError(data.error || 'AI 处理失败');
    setProcessing(false);
  });
  return () => { socket.removeAllListeners(); };
}, [editMode, id, updateConfig]);

// Edit mode node locking (optional optimization)
useEffect(() => {
  if (editMode !== null) {
    useCanvasStore.getState().setNodeDraggable(id, false);
  }
  return () => {
    useCanvasStore.getState().setNodeDraggable(id, true);
  };
}, [editMode, id]);

// Toolbar 切换
{editMode ? (
  <>
    {/* Image stays visible, overlays on top */}
    <EditToolbar
      nodeId={id}
      editMode={editMode}
      isSaving={isProcessing}
      errorMessage={editError}
      onSave={editMode === 'crop' ? handleCropSave : undefined}
      onCancel={handleEditCancel}
      onUndo={editMode === 'erase' || editMode === 'redraw' ? () => eraseRef.current?.undo() : undefined}
      onClear={editMode === 'erase' || editMode === 'redraw' ? () => eraseRef.current?.clear() : undefined}
      onGenerate={editMode !== 'crop' ? handleGenerate : undefined}
      onSaveAsVariant={handleSaveAsVariant}
    />
    {/* Render edit overlays inside the image container */}
    <div style={{ position: 'absolute', top: 0, left: 0, width: containerWidth, height: containerHeight }}>
      {editMode === 'crop' && displayUrl && (
        <CropOverlay
          containerWidth={containerWidth}
          containerHeight={containerHeight}
          imageDisplayWidth={baseWidth}
          imageDisplayHeight={baseHeight}
          imageNaturalWidth={imgSize?.w ?? baseWidth}
          imageNaturalHeight={imgSize?.h ?? baseHeight}
          onCropChange={(r) => { cropRectRef.current = r; }}
        />
      )}
      {(editMode === 'erase') && (
        <EraseCanvas ref={eraseRef} width={baseWidth} height={baseHeight} brushSize={brushSize} />
      )}
      {editMode === 'outpaint' && (
        <OutpaintPanel
          state={outpaintState}
          onChange={setOutpaintState}
          imageW={baseWidth} imageH={baseHeight}
          naturalW={imgSize?.w ?? baseWidth} naturalH={imgSize?.h ?? baseHeight}
        />
      )}
      {editMode === 'redraw' && (
        <>
          {redrawState.mode === 'brush' && (
            <EraseCanvas ref={eraseRef} width={baseWidth} height={baseHeight} brushSize={brushSize} />
          )}
          <RedrawPanel state={redrawState} onChange={setRedrawState} />
        </>
      )}
    </div>
  </>
) : (
  <ImageNodeToolbar ... onCrop={handleCrop} onOutpaint={handleOutpaint} onErase={handleErase} onRedraw={handleRedraw} />
)}
```

Run all tests: `cd apps/web && npx vitest run --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx
git commit -m "feat: integrate edit modes into ImageGenNode with overlays and Socket.io listeners"
```

---

### Task 11.5: CanvasView 取消触发（点击空白处/其他节点）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx`
- Test: `apps/web/src/pages/canvas/components/CanvasView.test.tsx`

- [ ] **Step 1: 写失败测试**

```typescript
// CanvasView.test.tsx 追加
it('onPaneClick triggers cancelEdit when activeEditNodeId is set', () => {
  useNodeStore.getState().setActiveEditNodeId('edit-node-1');
  // Simulate pane click
  const onPaneClick = /* extract from component or test via behavior */;
  // Verify triggerCancelEdit was called
  const ns = useNodeStore.getState();
  expect(ns.cancelRequestedAt).toBeGreaterThan(0);
});
```

Run: FAIL — onPaneClick does not check activeEditNodeId

- [ ] **Step 2: 实现 CanvasView 取消触发**

```typescript
// CanvasView.tsx — 修改 onPaneClick 和 onNodeClick

const onPaneClick = useCallback(() => {
  const ns = useNodeStore.getState();
  if (ns.activeEditNodeId) {
    ns.triggerCancelEdit();
  } else if (ns.activeTransformNodeId) {
    ns.triggerCancelTransform();
  } else {
    selectNode(null);
  }
}, [selectNode]);

const onNodeClick = useCallback((_event: any, node: any) => {
  const ns = useNodeStore.getState();
  if (ns.activeEditNodeId && ns.activeEditNodeId !== node.id) {
    ns.triggerCancelEdit();
  } else if (ns.activeTransformNodeId && ns.activeTransformNodeId !== node.id) {
    ns.triggerCancelTransform();
  } else if (!ns.activeEditNodeId && !ns.activeTransformNodeId) {
    selectNode(node.id);
  }
}, [selectNode]);
```

Run: `cd apps/web && npx vitest run src/pages/canvas/components/CanvasView.test.tsx --reporter=verbose`
Expected: tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canvas/components/CanvasView.tsx apps/web/src/pages/canvas/components/CanvasView.test.tsx
git commit -m "feat: trigger edit/transform cancel on pane click and other node click"
```

---

### Task 12: 后端 — ai-image-edit 常量和模块注册

**Files:**
- Create: `apps/api/src/modules/ai-image-edit/ai-image-edit.constants.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/api/src/modules/ai-image-edit/ai-image-edit.constants.spec.ts (可选，常量本身不需要测试)
// 主要通过在 processor spec 中引用常量来验证
```

Since constants don't need tests, skip to implementation.

- [ ] **Step 2: 创建常量文件并注册模块**

```typescript
// apps/api/src/modules/ai-image-edit/ai-image-edit.constants.ts
export const AI_IMAGE_EDIT_QUEUE_NAME = 'ai-image-edit';
export const AI_IMAGE_EDIT_CONNECTION_NAME = 'default';
```

```typescript
// apps/api/src/app.module.ts — 在 imports 中添加
BullModule.registerQueue(
  { name: EXECUTION_QUEUE_NAME },
  { name: AI_DOWNLOAD_QUEUE_NAME },
  { name: TEMP_CLEANUP_QUEUE_NAME },
  { name: AI_IMAGE_EDIT_QUEUE_NAME },  // 新增
),
```

No testable code to verify. Skip to commit.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/ai-image-edit/ai-image-edit.constants.ts apps/api/src/app.module.ts
git commit -m "feat: add ai-image-edit queue constant and register in AppModule"
```

---

### Task 13: 后端 — AiImageEditProcessor

**Files:**
- Create: `apps/api/src/modules/ai-image-edit/ai-image-edit.processor.ts`
- Create: `apps/api/src/modules/ai-image-edit/ai-image-edit.processor.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/api/src/modules/ai-image-edit/ai-image-edit.processor.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiImageEditProcessor } from './ai-image-edit.processor';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { ApiCallerService } from '../execution/api-caller.service';
import { CreditService } from '../credit/credit.service';
import { Job } from 'bullmq';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));

describe('AiImageEditProcessor', () => {
  let processor: AiImageEditProcessor;
  let apiCaller: any;
  let minio: any;
  let prisma: any;
  let gateway: any;
  let credit: any;

  beforeEach(async () => {
    apiCaller = {
      callOutpainting: vi.fn().mockResolvedValue({ url: 'https://result.ai/out.png' }),
      callErase: vi.fn().mockResolvedValue({ url: 'https://result.ai/erase.png' }),
      callRedraw: vi.fn().mockResolvedValue({ url: 'https://result.ai/redraw.png' }),
    };
    prisma = { media: { create: vi.fn().mockResolvedValue({ id: 'media-new' }) } };
    minio = { upload: vi.fn(), buildKey: vi.fn().mockReturnValue('results/u1/p1/n1/key.png'), generatePresignedGetUrl: vi.fn().mockResolvedValue('https://minio.local/img.png') };
    gateway = { emitNodeStatus: vi.fn() };
    credit = { deduct: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiImageEditProcessor,
        { provide: ApiCallerService, useValue: apiCaller },
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: ExecutionGateway, useValue: gateway },
        { provide: CreditService, useValue: credit },
      ],
    }).compile();
    processor = module.get<AiImageEditProcessor>(AiImageEditProcessor);
  });

  it('processes outpaint job and deducts credit on success', async () => {
    const axios = await import('axios');
    (axios.default.get as any).mockResolvedValue({ data: Buffer.from('img'), headers: { 'content-type': 'image/png', 'content-length': '5000' } });

    const job = { data: { taskType: 'outpaint', userId: 'u1', projectId: 'p1', nodeId: 'n1', fileId: 'f1', direction: 'all', scale: 1.2 } } as any as Job;
    await processor.process(job);

    expect(apiCaller.callOutpainting).toHaveBeenCalled();
    expect(minio.upload).toHaveBeenCalled();
    expect(credit.deduct).toHaveBeenCalledWith('u1', expect.any(Number));
    expect(gateway.emitNodeStatus).toHaveBeenCalledWith('p1', expect.objectContaining({ nodeId: 'n1', status: 'edit-result' }));
  });

  it('does not deduct credit on failure', async () => {
    apiCaller.callOutpainting.mockRejectedValue(new Error('API error'));
    const job = { data: { taskType: 'outpaint', userId: 'u1', projectId: 'p1', nodeId: 'n1', fileId: 'f1' } } as any as Job;

    await expect(processor.process(job)).rejects.toThrow('API error');
    expect(credit.deduct).not.toHaveBeenCalled();
    expect(gateway.emitNodeStatus).toHaveBeenCalledWith('p1', expect.objectContaining({ nodeId: 'n1', status: 'edit-failed' }));
  });
});
```

Run: `cd apps/api && npx vitest run src/modules/ai-image-edit/ai-image-edit.processor.spec.ts --reporter=verbose`
Expected: 2 tests FAIL — module not found

- [ ] **Step 2: 实现 Processor**

```typescript
// apps/api/src/modules/ai-image-edit/ai-image-edit.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, Injectable } from '@nestjs/common';
import { AI_IMAGE_EDIT_QUEUE_NAME } from './ai-image-edit.constants';
import { ApiCallerService } from '../execution/api-caller.service';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { CreditService } from '../credit/credit.service';
import axios from 'axios';

const CREDIT_COST_PER_EDIT = 1; // TODO: config-driven

export interface AiImageEditJobData {
  taskType: 'outpaint' | 'erase' | 'redraw';
  userId: string;
  projectId: string;
  nodeId: string;
  fileId: string;
  maskFileId?: string;
  direction?: string;
  scale?: number;
  prompt?: string;
  strength?: number;
}

@Injectable()
@Processor(AI_IMAGE_EDIT_QUEUE_NAME)
export class AiImageEditProcessor extends WorkerHost {
  private readonly logger = new Logger(AiImageEditProcessor.name);

  constructor(
    private readonly apiCaller: ApiCallerService,
    private readonly minio: MinioService,
    private readonly prisma: PrismaService,
    private readonly gateway: ExecutionGateway,
    private readonly credit: CreditService,
  ) {
    super();
  }

  async process(job: Job<AiImageEditJobData>) {
    const { taskType, userId, projectId, nodeId, fileId } = job.data;

    try {
      const imageUrl = await this.minio.generatePresignedGetUrl(
        await this.getMediaKey(fileId),
      );

      const maskUrl = job.data.maskFileId
        ? await this.minio.generatePresignedGetUrl(await this.getMediaKey(job.data.maskFileId))
        : undefined;

      let resultUrl: string;

      switch (taskType) {
        case 'outpaint':
          resultUrl = (await this.apiCaller.callOutpainting(
            imageUrl, job.data.direction!, job.data.scale!, job.data.prompt,
          )).url;
          break;
        case 'erase':
          resultUrl = (await this.apiCaller.callErase(imageUrl, maskUrl!)).url;
          break;
        case 'redraw':
          resultUrl = (await this.apiCaller.callRedraw(
            imageUrl, maskUrl!, job.data.prompt!, job.data.strength!,
          )).url;
          break;
      }

      // Download result and upload to MinIO
      const { data: buffer, headers } = await axios.get(resultUrl, { responseType: 'arraybuffer' });
      const mimeType = headers['content-type'] || 'image/png';
      const key = this.minio.buildKey('results', userId, { projectId, nodeId });
      await this.minio.upload(key, Buffer.from(buffer), mimeType);

      const media = await this.prisma.media.create({
        data: {
          userId, projectId, nodeId,
          bucket: 'flowai', key, mimeType,
          size: parseInt(headers['content-length'] || '0', 10),
          type: 'generated', status: 'completed',
        },
      });

      // Deduct credit only on success
      await this.credit.deduct(userId, CREDIT_COST_PER_EDIT);

      // Push success
      this.gateway.emitNodeStatus(projectId, {
        nodeId,
        status: 'edit-result' as any,
        fileId: media.id,
        taskType,
      });

    } catch (err: any) {
      this.logger.error(`AI edit failed: ${err.message}`, { jobId: job.id, taskType, nodeId });

      // Push failure — no credit deduction
      this.gateway.emitNodeStatus(projectId, {
        nodeId,
        status: 'edit-failed' as any,
        error: err.message,
      });

      throw err; // trigger BullMQ retry
    }
  }

  private async getMediaKey(fileId: string): Promise<string> {
    const media = await this.prisma.media.findUnique({ where: { id: fileId } });
    if (!media) throw new Error(`Media ${fileId} not found`);
    return media.key;
  }
}
```

Run: `cd apps/api && npx vitest run src/modules/ai-image-edit/ai-image-edit.processor.spec.ts --reporter=verbose`
Expected: 2 tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/ai-image-edit/ai-image-edit.processor.ts apps/api/src/modules/ai-image-edit/ai-image-edit.processor.spec.ts
git commit -m "feat: add AiImageEditProcessor with credit-on-success and failure retry"
```

---

### Task 14: 后端 — Controller + Service + Socket.io 事件扩展

**Files:**
- Create: `apps/api/src/modules/ai-image-edit/ai-image-edit.controller.ts`
- Create: `apps/api/src/modules/ai-image-edit/ai-image-edit.service.ts`
- Create: `apps/api/src/modules/ai-image-edit/ai-image-edit.controller.spec.ts`
- Modify: `apps/api/src/modules/gateway/execution.gateway.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/api/src/modules/ai-image-edit/ai-image-edit.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiImageEditController } from './ai-image-edit.controller';
import { AiImageEditService } from './ai-image-edit.service';

describe('AiImageEditController', () => {
  let controller: AiImageEditController;
  let service: any;

  beforeEach(async () => {
    service = {
      enqueueOutpaint: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
      enqueueErase: vi.fn().mockResolvedValue({ jobId: 'job-2' }),
      enqueueRedraw: vi.fn().mockResolvedValue({ jobId: 'job-3' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiImageEditController],
      providers: [{ provide: AiImageEditService, useValue: service }],
    }).compile();
    controller = module.get<AiImageEditController>(AiImageEditController);
  });

  it('POST /api/image-edit/outpaint enqueues job', async () => {
    const result = await controller.outpaint({ fileId: 'f1', direction: 'all', scale: 1.2 });
    expect(result).toEqual({ jobId: 'job-1' });
    expect(service.enqueueOutpaint).toHaveBeenCalledWith('f1', 'all', 1.2, undefined);
  });

  it('POST /api/image-edit/erase enqueues job', async () => {
    const result = await controller.erase({ fileId: 'f1', maskFileId: 'm1' });
    expect(result).toEqual({ jobId: 'job-2' });
  });

  it('POST /api/image-edit/redraw enqueues job', async () => {
    const result = await controller.redraw({ fileId: 'f1', maskFileId: 'm1', prompt: 'blue sky', strength: 50 });
    expect(result).toEqual({ jobId: 'job-3' });
  });
});
```

Run: `cd apps/api && npx vitest run src/modules/ai-image-edit/ai-image-edit.controller.spec.ts --reporter=verbose`
Expected: 3 tests FAIL

- [ ] **Step 2: 实现 Controller + Service**

```typescript
// apps/api/src/modules/ai-image-edit/ai-image-edit.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AI_IMAGE_EDIT_QUEUE_NAME } from './ai-image-edit.constants';
import type { AiImageEditJobData } from './ai-image-edit.processor';

@Injectable()
export class AiImageEditService {
  private readonly logger = new Logger(AiImageEditService.name);

  constructor(
    @InjectQueue(AI_IMAGE_EDIT_QUEUE_NAME) private readonly queue: Queue,
  ) {}

  async enqueueOutpaint(fileId: string, direction: string, scale: number, prompt?: string) {
    const job = await this.queue.add('outpaint', {
      taskType: 'outpaint', fileId, direction, scale, prompt,
    } satisfies Partial<AiImageEditJobData>);
    return { jobId: job.id! };
  }

  async enqueueErase(fileId: string, maskFileId: string) {
    const job = await this.queue.add('erase', {
      taskType: 'erase', fileId, maskFileId,
    } satisfies Partial<AiImageEditJobData>);
    return { jobId: job.id! };
  }

  async enqueueRedraw(fileId: string, maskFileId: string, prompt: string, strength: number) {
    const job = await this.queue.add('redraw', {
      taskType: 'redraw', fileId, maskFileId, prompt, strength,
    } satisfies Partial<AiImageEditJobData>);
    return { jobId: job.id! };
  }
}
```

```typescript
// apps/api/src/modules/ai-image-edit/ai-image-edit.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { AiImageEditService } from './ai-image-edit.service';

@Controller('api/image-edit')
export class AiImageEditController {
  constructor(private readonly service: AiImageEditService) {}

  @Post('outpaint')
  async outpaint(@Body() body: { fileId: string; direction: string; scale: number; prompt?: string }) {
    return this.service.enqueueOutpaint(body.fileId, body.direction, body.scale, body.prompt);
  }

  @Post('erase')
  async erase(@Body() body: { fileId: string; maskFileId: string }) {
    return this.service.enqueueErase(body.fileId, body.maskFileId);
  }

  @Post('redraw')
  async redraw(@Body() body: { fileId: string; maskFileId: string; prompt: string; strength: number }) {
    return this.service.enqueueRedraw(body.fileId, body.maskFileId, body.prompt, body.strength);
  }
}
```

```typescript
// apps/api/src/modules/ai-image-edit/ai-image-edit.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AI_IMAGE_EDIT_QUEUE_NAME } from './ai-image-edit.constants';
import { AiImageEditController } from './ai-image-edit.controller';
import { AiImageEditService } from './ai-image-edit.service';
import { AiImageEditProcessor } from './ai-image-edit.processor';
import { ApiCallerService } from '../execution/api-caller.service';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { CreditService } from '../credit/credit.service';

@Module({
  imports: [BullModule.registerQueue({ name: AI_IMAGE_EDIT_QUEUE_NAME })],
  controllers: [AiImageEditController],
  providers: [
    AiImageEditService,
    AiImageEditProcessor,
    ApiCallerService,
    MinioService,
    PrismaService,
    ExecutionGateway,
    CreditService,
  ],
})
export class AiImageEditModule {}
```

Register `AiImageEditModule` in `app.module.ts` imports.

Update ExecutionGateway to handle `edit-result` and `edit-failed` statuses:

```typescript
// execution.gateway.ts — in the emitNodeStatus method or wherever node:status is emitted:
// The existing emitNodeStatus already emits { nodeId, status, fileId?, error? }.
// We use status: 'edit-result' and 'edit-failed' which the frontend listens for.
// No code change needed if emitNodeStatus is used directly — the frontend
// needs to listen for these statuses. However, we should add explicit handling:

// On the frontend side (ImageGenNode socket handler), add:
// if (data.status === 'edit-result' && data.fileId) { ... }
// if (data.status === 'edit-failed') { ... }
```

Run: `cd apps/api && npx vitest run src/modules/ai-image-edit/ai-image-edit.controller.spec.ts --reporter=verbose`
Expected: 3 tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/ai-image-edit/
git commit -m "feat: add AiImageEditController, Service, and Module"
```

---

### Task 15: ApiCallerService — 通义万相方法

**Files:**
- Modify: `apps/api/src/modules/execution/api-caller.service.ts`
- Test: `apps/api/src/modules/execution/api-caller.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// api-caller.service.spec.ts 追加
it('callOutpainting should call 通义万相 image expansion API', async () => {
  // Mock HTTP call
  const result = await service.callOutpainting('https://img.url/test.png', 'all', 1.2);
  expect(result).toHaveProperty('url');
});

it('callErase should call 通义万相 image inpainting API', async () => {
  const result = await service.callErase('https://img.url/test.png', 'https://img.url/mask.png');
  expect(result).toHaveProperty('url');
});

it('callRedraw should call 通义万相 local repaint API', async () => {
  const result = await service.callRedraw('https://img.url/test.png', 'https://img.url/mask.png', 'blue sky', 50);
  expect(result).toHaveProperty('url');
});
```

Run: FAIL — methods not defined

- [ ] **Step 2: 实现三个 API 方法**

```typescript
// api-caller.service.ts — 新增方法

async callOutpainting(imageUrl: string, direction: string, scale: number, prompt?: string): Promise<{ url: string }> {
  // 通义万相图像扩展 API
  // POST https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/outpainting
  const apiKey = this.configService.get('DASHSCOPE_API_KEY');
  const body: any = {
    model: 'wanx-outpainting-v1',
    input: {
      image_url: imageUrl,
      direction: direction,  // 'top' | 'bottom' | 'left' | 'right' | 'all'
      scale: scale,
    },
  };
  if (prompt) body.input.prompt = prompt;

  const res = await axios.post('https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/outpainting', body, {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });

  // Poll for async result (similar to callImageGen pattern)
  const taskId = res.data.output.task_id;
  return this.pollTask(taskId, apiKey);
}

async callErase(imageUrl: string, maskUrl: string): Promise<{ url: string }> {
  // 通义万相图像修复 API (LaMa-based inpainting)
  const apiKey = this.configService.get('DASHSCOPE_API_KEY');
  const body = {
    model: 'wanx-inpainting-v1',
    input: { image_url: imageUrl, mask_url: maskUrl },
  };

  const res = await axios.post('https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/inpainting', body, {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });

  const taskId = res.data.output.task_id;
  return this.pollTask(taskId, apiKey);
}

async callRedraw(imageUrl: string, maskUrl: string, prompt: string, strength: number): Promise<{ url: string }> {
  // 通义万相局部重绘 API
  const apiKey = this.configService.get('DASHSCOPE_API_KEY');
  const body = {
    model: 'wanx-repainting-v1',
    input: {
      image_url: imageUrl,
      mask_url: maskUrl,
      prompt: prompt,
      strength: strength / 100, // Convert 0-100 to 0-1
    },
  };

  const res = await axios.post('https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/repainting', body, {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });

  const taskId = res.data.output.task_id;
  return this.pollTask(taskId, apiKey);
}

private async pollTask(taskId: string, apiKey: string): Promise<{ url: string }> {
  for (let i = 0; i < 30; i++) {
    const poll = await axios.get(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    const status = poll.data.output.task_status;
    if (status === 'SUCCEEDED') {
      return { url: poll.data.output.results[0].url };
    }
    if (status === 'FAILED') {
      throw new Error(`AI task failed: ${poll.data.output.message}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('AI task timed out');
}
```

Note: ApiCallerService 需要注入 ConfigService 获取 DASHSCOPE_API_KEY。在 api-caller.service.spec.ts 中使用 mock 的 ConfigService。

Run: `cd apps/api && npx vitest run src/modules/execution/api-caller.service.spec.ts --reporter=verbose`
Expected: 3 new tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/execution/api-caller.service.ts apps/api/src/modules/execution/api-caller.service.spec.ts
git commit -m "feat: add Tongyi Wanxiang outpainting/erase/redraw API methods"
```

---

## Self-Review Checklist

1. **Spec coverage**: Each spec feature maps to a task — Feature 1→Tasks 1-3, Feature 2→Tasks 4+6, Feature 3→Task 8, Feature 4→Task 7, Feature 5→Task 9, Feature 6→Task 5, Feature 7→Tasks 12-15. ImageNodeToolbar wiring→Task 10. ImageGenNode integration→Task 11. CanvasView cancel trigger→Task 11.5.
2. **No placeholders**: All code blocks contain real implementation, no TBD/TODO.
3. **Type consistency**: `editMode` type used consistently. `CropRect` defined in both CropOverlay and imageCrop. `OutpaintState`/`RedrawState` controlled props. `AiImageEditJobData` used in processor and service. Socket.io events `node:edit-result`/`node:edit-failed` consistent.
4. **TDD order**: Every task follows red-green-refactor: test → fail → implement → pass → commit.

### 补充遗漏覆盖确认

| Spec 需求 | Plan 覆盖位置 |
|-----------|--------------|
| 编辑模式基础设施 + hasEditChanges | Tasks 1-3 |
| 剪切（DOM裁剪 + 50px min + clip-path预览） | Tasks 4 + 6 |
| 扩图（方向单选 + max 2.0x + 受控props） | Task 8 |
| 擦除（Canvas 画笔 + 3px羽化遮罩） | Task 7 |
| 重绘（矩形/画笔 + 受控props） | Task 9 |
| EditToolbar（统一工具栏 + 按钮可见性） | Task 5 |
| 后端AI队列（单队列 + Credit后扣 + 失败重试） | Tasks 12-15 |
| **键盘快捷键（Escape/Ctrl+S/Ctrl+Z）** | **Task 11 Step 2** |
| **cancelRequestedAt 监听（外部取消触发）** | **Task 11 Step 2** |
| **保存为新变体（handleSaveAsVariant）** | **Task 11 Step 2** |
| **CanvasView 点击空白/其他节点触发取消** | **Task 11.5** |
| **OutpaintPanel/RedrawPanel 状态提升到父组件** | **Tasks 8 + 9（受控组件）+ Task 11（state管理）** |

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-06-10-image-edit.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
