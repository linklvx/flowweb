# 打组功能视觉与交互优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落实 spec `docs/superpowers/specs/2026-08-23-group-visual-redesign.md`——修复多选工具条残留 Bug、多选虚线框 + 工具条重定位、组块虚线深色样式 + 可编辑标题 + 四角手柄、组工具条重定位与互斥。

**Architecture:** 工具条定位复用项目已验证的 `useViewport` + `createPortal(node-toolbar-portal)` 模式（ImageNodeToolbar 同款）；多选框为新 overlay 组件（RF 内置 selection rect 仅保留拖拽交互层、CSS 去视觉）；组块样式与标题编辑在 NormalGroupRenderer 内实现，尺寸标记/改名走 canvasStore（组 data 变更双写 nodeStore——localStorage 快照数据源）。

**Tech Stack:** React 18 + @xyflow/react v12.10.2 + zustand + vitest + @testing-library/react。测试统一在 `apps/web` 下运行：`cd /d/flowweb/apps/web && pnpm exec vitest run <path>`。

**关键背景（执行者必读）：**
- 双 store：`canvasStore`（画布节点/组）、`nodeStore`（内容 AppNode，Record 结构）。localStorage 快照从 **nodeStore** 取（`useCanvasPersistence.ts:83`），故 canvasStore 侧组 data 变更必须双写 nodeStore；undo/redo 由 `groupHistory.applySnapshot` 自带双写（`groupHistory.ts:46-58`），无需重复处理。
- DB 路径 payload（SaveAsTemplateDialog/ConfigPanel/canvasStore:513）传 canvasStore 节点全量（含 data），Prisma Json 列无字段白名单——新 data 字段自动随行。
- RF v12 `useStore(selector, equalityFn?)` 支持相等函数；`getNodesBounds`、`useInternalNode`、`useViewport`、`NodeResizer` 均从 `@xyflow/react` 导入。
- `node-toolbar-portal` 容器（CanvasView.tsx:506）本身 `pointer-events:none`，portal 子元素需显式 `pointerEvents:'auto'` 才可交互。

---

### Task 1: useIsSingleSelected hook（Fix 1，Bug A 残留）

**Files:**
- Create: `apps/web/src/hooks/useIsSingleSelected.ts`
- Test: `apps/web/src/hooks/useIsSingleSelected.test.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx:75-77`
- Modify: `apps/web/src/pages/canvas/components/nodes/MultiImageNode.tsx:74-78`
- Modify: `apps/web/src/pages/canvas/components/nodes/TextInputNode.tsx:29-30`
- Modify: `apps/web/src/pages/canvas/components/nodes/AudioGenNode.tsx:19-21`
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx:60-64`

- [ ] **Step 1: 写失败测试（时序用例是核心）**

```tsx
// apps/web/src/hooks/useIsSingleSelected.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import * as react from 'react';

const rf = vi.hoisted(() => {
  let nodes: any[] = [];
  const listeners = new Set<() => void>();
  return {
    setNodes: (n: any[]) => { nodes = n; listeners.forEach((l) => l()); },
    useStore: (selector: any) =>
      react.useSyncExternalStore(
        (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); },
        () => selector({ nodes }),
      ),
  };
});

vi.mock('@xyflow/react', () => ({ useStore: rf.useStore }));

import { useIsSingleSelected } from './useIsSingleSelected';

function Probe({ selected }: { selected: boolean }) {
  const single = useIsSingleSelected(selected);
  return <div data-testid="probe">{single ? 'single' : 'multi'}</div>;
}

describe('useIsSingleSelected', () => {
  it('单选时为 true', () => {
    rf.setNodes([{ id: 'a', selected: true }]);
    render(<Probe selected />);
    expect(screen.getByTestId('probe').textContent).toBe('single');
  });

  it('Bug A 残留时序：先选中 A（count=1）再加选 B → A 的单选态消失', () => {
    rf.setNodes([{ id: 'a', selected: true }]);
    render(<Probe selected />); // 此时 A 渲染，count=1
    expect(screen.getByTestId('probe').textContent).toBe('single');
    act(() => { rf.setNodes([{ id: 'a', selected: true }, { id: 'b', selected: true }]); });
    expect(screen.getByTestId('probe').textContent).toBe('multi');
  });

  it('减选回单选恢复 true', () => {
    rf.setNodes([{ id: 'a', selected: true }, { id: 'b', selected: true }]);
    render(<Probe selected />);
    act(() => { rf.setNodes([{ id: 'a', selected: true }, { id: 'b', selected: false }]); });
    expect(screen.getByTestId('probe').textContent).toBe('single');
  });

  it('节点自身未选中恒为 false', () => {
    rf.setNodes([{ id: 'a', selected: false }]);
    render(<Probe selected={false} />);
    expect(screen.getByTestId('probe').textContent).toBe('multi');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run src/hooks/useIsSingleSelected.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 hook**

```ts
// apps/web/src/hooks/useIsSingleSelected.ts
import { useStore } from '@xyflow/react';

/**
 * 响应式单选判定。命令式 getNodes() 计数在"先选 A 再加选 B"时，
 * A 的 selected prop true→true 不触发重渲染，工具条残留（Bug A 残留根源）。
 * selector 返回 number，天然相等比较；for 循环避免拖拽每帧的中间数组分配。
 */
export function useIsSingleSelected(selected: boolean | undefined): boolean {
  const selectedCount = useStore((s) => {
    let count = 0;
    for (let i = 0; i < s.nodes.length; i++) if (s.nodes[i].selected) count++;
    return count;
  });
  return !!selected && selectedCount === 1;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run src/hooks/useIsSingleSelected.test.tsx`
Expected: PASS（4 用例）

- [ ] **Step 5: 替换 5 个组件的命令式计算**

每个文件：顶部加 `import { useIsSingleSelected } from '@/hooks/useIsSingleSelected';`，替换原行。

ImageGenNode.tsx（getNodes 在 728/744/966 有其他用途，**保留解构**）：
```tsx
// 原 76-77：
// // Perf note: getNodes().filter() is O(n) per render. Acceptable for <500 nodes.
// const isSingleSelected = selected && getNodes().filter((n) => n.selected).length === 1;
const isSingleSelected = useIsSingleSelected(selected);
```

VideoGenNode.tsx（getNodes 在 548/602/618 有其他用途，**保留解构**）：
```tsx
// 原 61-64 的 useMemo 整段删除，替换为：
const isSingleSelected = useIsSingleSelected(selected);
```
（若 `useMemo` import 因此孤立，删除该 import。）

MultiImageNode.tsx / TextInputNode.tsx / AudioGenNode.tsx（getNodes 仅此一处使用）：
```tsx
const isSingleSelected = useIsSingleSelected(selected);
```
并删除孤立的 `const { getNodes } = useReactFlow();` 行；若 `useReactFlow` 在该文件无其他使用，一并删除 import。

- [ ] **Step 6: 回归 5 个组件既有测试**

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run src/pages/canvas/components/nodes/`
Expected: PASS（既有用例中 mock `getNodes` 的部分可能不再被调用，若有用例因 mock 冗余报警/失败，删除该 mock 而非改断言语义）

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/hooks/useIsSingleSelected.ts apps/web/src/hooks/useIsSingleSelected.test.tsx apps/web/src/pages/canvas/components/nodes/
git commit -m "fix(web): isSingleSelected 响应式化修复多选工具条残留（组视觉优化 Fix 1）"
```

---

### Task 2: 共享视觉 token（Fix 5）

**Files:**
- Create: `apps/web/src/pages/canvas/components/groups/selectionTokens.ts`

纯常量无行为，不单独写测试（由 Task 3/7 消费方测试覆盖）。

- [ ] **Step 1: 创建 token 文件**

```ts
// apps/web/src/pages/canvas/components/groups/selectionTokens.ts
import type { CSSProperties } from 'react';

/** 多选容器框（viewport 外 overlay，屏幕坐标）——mockup 亲选参数 */
export const SELECTION_BOX = {
  borderColor: 'rgba(255,255,255,0.65)',
  borderStyle: 'dashed' as const,
  borderWidth: 2,
  borderRadius: 8,
  background: 'rgba(0,0,0,0.35)',
  padding: 16,
};

/** 组块容器（RF 节点内，流坐标）——单层虚线深色 */
export const GROUP_BOX = {
  border: 'rgba(255,255,255,0.45)',
  selectedBorder: 'rgba(255,255,255,0.85)',
  borderWidth: 2,
  borderRadius: 10,
  background: 'rgba(26,26,26,0.6)',
};

/** 数量徽标（多选框左上角 / 组标题旁共用） */
export const BADGE: CSSProperties = {
  background: '#3f3f3f', color: '#fff', borderRadius: 999,
  padding: '2px 8px', fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap',
};

/** 四角 resize 手柄 */
export const HANDLE: CSSProperties = {
  width: 8, height: 8, background: '#fff', border: '1px solid #666', borderRadius: 1,
};

/** 工具条几何常量（高固定单行，不 ref 测量） */
export const TOOLBAR = { height: 40, offset: 12 };
```

- [ ] **Step 2: 类型检查**

Run: `cd /d/flowweb/apps/web && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canvas/components/groups/selectionTokens.ts
git commit -m "feat(web): 多选/组块共享视觉 token（组视觉优化 Fix 5）"
```

---

### Task 3: SelectionBoxOverlay——多选虚线框 + 工具条重定位（Fix 2）

**Files:**
- Create: `apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.tsx`
- Test: `apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.test.tsx`
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx:393`（`<MultiSelectToolbar />` → `<SelectionBoxOverlay />`，import 同步替换）
- Modify: `apps/web/src/index.css`（107 行 `.react-flow__node.selected` 附近追加规则）
- Delete: `apps/web/src/pages/canvas/components/groups/MultiSelectToolbar.tsx` 与 `MultiSelectToolbar.test.tsx`（用例迁移进新测试）

- [ ] **Step 1: 写失败测试（迁移原 2 用例 + 新增 5 用例）**

```tsx
// apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const rf = vi.hoisted(() => {
  const state = { nodes: [] as any[], vp: { x: 0, y: 0, zoom: 1 } };
  return { state };
});

// getNodesBounds mock：node.positionAbsolute 存在时取 min/max，否则固定 bounds
vi.mock('@xyflow/react', () => ({
  useStore: (sel: any) => sel({ nodeLookup: new Map(rf.state.nodes.map((n) => [n.id, n])) }),
  useViewport: () => rf.state.vp,
  getNodesBounds: (ns: any[]) => {
    const xs = ns.map((n) => (n.positionAbsolute ?? { x: 100, y: 200 }).x);
    const ys = ns.map((n) => (n.positionAbsolute ?? { x: 100, y: 200 }).y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: 50, height: 40 };
  },
}));

const storeApi: any = {};
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (sel: any) => sel({ nodes: rf.state.nodes.filter((n) => n.selected), groupNodes: storeApi.groupNodes }),
}));

import { SelectionBoxOverlay } from './SelectionBoxOverlay';

describe('SelectionBoxOverlay', () => {
  let portal: HTMLDivElement;
  beforeEach(() => {
    portal = document.createElement('div');
    portal.id = 'node-toolbar-portal';
    document.body.appendChild(portal);
  });
  afterEach(() => portal.remove());

  const mk = (id: string, type: string, data: Record<string, unknown> = {}, pos?: any) =>
    ({ id, type, data, selected: true, ...(pos ?? {}) });

  it('选中 <2 不渲染', () => {
    rf.state.nodes = [mk('n1', 'imageGen')];
    rf.state.vp = { x: 0, y: 0, zoom: 1 };
    const { container } = render(<SelectionBoxOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it('坐标：bounds 变换 + padding 屏幕常量外加（zoom=2 时 padding 不缩放）', () => {
    rf.state.nodes = [mk('n1', 'imageGen', {}, { positionAbsolute: { x: 100, y: 200 } }), mk('n2', 'imageGen', {}, { positionAbsolute: { x: 110, y: 210 } })];
    rf.state.vp = { x: 10, y: 20, zoom: 2 };
    render(<SelectionBoxOverlay />);
    const box = portal.firstElementChild as HTMLElement;
    expect(box.style.left).toBe('194px');  // 100*2+10-16
    expect(box.style.top).toBe('404px');   // 200*2+20-16
    expect(box.style.width).toBe('132px'); // 50*2+32
    expect(box.style.height).toBe('112px');// 40*2+32
  });

  it('框本体 pointerEvents none；徽标显示「N 项」', () => {
    rf.state.nodes = [mk('n1', 'imageGen', {}, { positionAbsolute: { x: 0, y: 300 } }), mk('n2', 'imageGen', {}, { positionAbsolute: { x: 10, y: 310 } })];
    rf.state.vp = { x: 0, y: 0, zoom: 1 };
    render(<SelectionBoxOverlay />);
    const box = portal.firstElementChild as HTMLElement;
    expect(box.style.pointerEvents).toBe('none');
    expect(screen.getByText('2 项')).toBeTruthy();
  });

  it('顶部边界：框贴顶时工具条翻转到下方', () => {
    rf.state.nodes = [mk('n1', 'imageGen', {}, { positionAbsolute: { x: 0, y: 0 } }), mk('n2', 'imageGen', {}, { positionAbsolute: { x: 10, y: 10 } })];
    rf.state.vp = { x: 0, y: 0, zoom: 1 };
    render(<SelectionBoxOverlay />);
    const toolbar = portal.children[1] as HTMLElement;
    expect(toolbar.style.top).toBe('68px'); // -16 + 72 + 12（height = 40×1 + 32 = 72）
  });

  it('原 MultiSelectToolbar 用例迁移：点击打组调用回调（onGroup）', () => {
    rf.state.nodes = [
      mk('n1', 'imageGen', { status: 'done', fileId: 'f1' }, { positionAbsolute: { x: 0, y: 300 } }),
      mk('n2', 'textInput', {}, { positionAbsolute: { x: 10, y: 310 } }),
    ];
    rf.state.vp = { x: 0, y: 0, zoom: 1 };
    const spy = vi.fn();
    render(<SelectionBoxOverlay onGroup={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /打组/ }));
    fireEvent.click(screen.getByText('打组（Ctrl+G）'));
    expect(spy).toHaveBeenCalledWith(['n1', 'n2']);
  });
});
```

**断言说明**：翻转公式 `isAbove = top - 12 - 40 > 0`；`top' = isAbove ? top - 12 : top + height + 12`。zoom=1 用例：top=-16、height=40+32=72 → toolbarTop=68。zoom=2 坐标用例（width/height 断言）为 132/112，两用例数值已按公式核对。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run src/pages/canvas/components/groups/SelectionBoxOverlay.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现组件**

```tsx
// apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.tsx
import { memo, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useStore, useViewport, getNodesBounds, type InternalNode } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { isImageCompletedNode } from '@/utils/imageNodeGuards';
import { SELECTION_BOX, BADGE, TOOLBAR } from './selectionTokens';

interface Props { onGroup?: (ids: string[]) => void; onMergeStoryboard?: (ids: string[]) => void }

const shallowArrEq = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function SelectionBoxOverlayComponent({ onGroup, onMergeStoryboard }: Props) {
  const selectedInternal = useStore((s) => {
    const arr: InternalNode[] = [];
    s.nodeLookup.forEach((n) => { if (n.selected) arr.push(n); });
    return arr;
  }, shallowArrEq);
  const { x: vpX, y: vpY, zoom } = useViewport();
  const groupNodesAction = useCanvasStore((s) => s.groupNodes);
  const mergeStoryboard = useCanvasStore((s) => (s as any).mergeStoryboard);
  const [open, setOpen] = useState(false);

  const geo = useMemo(() => {
    if (selectedInternal.length < 2) return null;
    const b = getNodesBounds(selectedInternal);
    // padding/offset 为屏幕像素常量：流→屏幕变换后外加，不乘 zoom
    const left = b.x * zoom + vpX - SELECTION_BOX.padding;
    const top = b.y * zoom + vpY - SELECTION_BOX.padding;
    const width = b.width * zoom + SELECTION_BOX.padding * 2;
    const height = b.height * zoom + SELECTION_BOX.padding * 2;
    const centerX = left + width / 2;
    const isAbove = top - TOOLBAR.offset - TOOLBAR.height > 0;
    return {
      left, top, width, height, centerX,
      toolbarTop: isAbove ? top - TOOLBAR.offset : top + height + TOOLBAR.offset,
      toolbarTransform: isAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
    };
  }, [selectedInternal, vpX, vpY, zoom]);

  const handleGroup = useCallback(() => {
    const ids = selectedInternal.map((n) => n.id);
    (onGroup ?? groupNodesAction)(ids);
    setOpen(false);
  }, [selectedInternal, onGroup, groupNodesAction]);

  const handleMerge = useCallback(() => {
    const ids = selectedInternal.map((n) => n.id);
    (onMergeStoryboard ?? mergeStoryboard)(ids);
    setOpen(false);
  }, [selectedInternal, onMergeStoryboard, mergeStoryboard]);

  if (!geo) return null;
  const portalRoot = document.getElementById('node-toolbar-portal');
  if (!portalRoot) return null;

  const selected = selectedInternal as any[];
  const hasGroup = selected.some((n) => n.type === 'group');
  const allImage = selected.every((n) => isImageCompletedNode(n));

  return createPortal(
    <>
      <div
        data-testid="selection-box"
        style={{
          position: 'absolute', left: geo.left, top: geo.top, width: geo.width, height: geo.height,
          border: `${SELECTION_BOX.borderWidth}px ${SELECTION_BOX.borderStyle} ${SELECTION_BOX.borderColor}`,
          borderRadius: SELECTION_BOX.borderRadius, background: SELECTION_BOX.background,
          pointerEvents: 'none', zIndex: 30,
        }}
      >
        <span style={{ ...BADGE, position: 'absolute', top: -11, left: -1 }}>{selectedInternal.length} 项</span>
      </div>
      <div
        role="toolbar"
        style={{
          position: 'absolute', left: geo.centerX, top: geo.toolbarTop, transform: geo.toolbarTransform,
          pointerEvents: 'auto', zIndex: 31,
          background: 'rgba(0,0,0,0.85)', borderRadius: 20, padding: '8px 16px', height: TOOLBAR.height,
          display: 'flex', alignItems: 'center', gap: 12, color: '#fff', fontSize: 13,
        }}
      >
        <span>已选 {selectedInternal.length} 个节点</span>
        <div className="relative">
          <button disabled={hasGroup} onClick={() => setOpen((v) => !v)}
            style={{ background: 'rgba(255,255,255,0.08)', border: 'none', color: hasGroup ? '#666' : '#fff',
                     padding: '6px 12px', borderRadius: 6, cursor: hasGroup ? 'not-allowed' : 'pointer' }}>
            ⊞ 打组 ▾
          </button>
          {open && (
            <div className="absolute top-full mt-1 left-0" style={{ background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, minWidth: 140 }}>
              <button disabled={hasGroup} onClick={handleGroup}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                         background: 'none', border: 'none', color: hasGroup ? '#666' : '#fff', cursor: hasGroup ? 'not-allowed' : 'pointer' }}>
                打组（Ctrl+G）
              </button>
              <button disabled={!allImage} onClick={handleMerge}
                title={!allImage ? '分镜组仅支持含完成图片的节点' : undefined}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                         background: 'none', border: 'none', color: allImage ? '#fff' : '#666', cursor: allImage ? 'pointer' : 'not-allowed' }}>
                合并分镜组（Ctrl+Alt+G）
              </button>
            </div>
          )}
        </div>
      </div>
    </>,
    portalRoot,
  );
}
export const SelectionBoxOverlay = memo(SelectionBoxOverlayComponent);
```

- [ ] **Step 4: 跑测试确认通过（按 Step 1 断言说明核对翻转数值）**

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run src/pages/canvas/components/groups/SelectionBoxOverlay.test.tsx`
Expected: PASS

- [ ] **Step 5: 接线 CanvasView + 全局 CSS + 删除旧文件**

CanvasView.tsx：import 处 `MultiSelectToolbar` → `SelectionBoxOverlay`；393 行 `<MultiSelectToolbar />` → `<SelectionBoxOverlay />`。

index.css（`.react-flow__node.selected` 规则附近追加）：
```css
/* 多选视觉由自定义 SelectionBoxOverlay 渲染；内置 selection rect 仅保留拖拽交互层 */
.react-flow__nodesselection-rect { fill: transparent; stroke: transparent; }
```

删除：`MultiSelectToolbar.tsx`、`MultiSelectToolbar.test.tsx`。

- [ ] **Step 6: 全量回归**

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run src/pages/canvas/`
Expected: PASS（若有测试引用 MultiSelectToolbar 报模块不存在，改 import 为 SelectionBoxOverlay）

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src/pages/canvas apps/web/src/index.css
git commit -m "feat(web): 多选虚线框+徽标+工具条包围盒定位（组视觉优化 Fix 2）"
```

---

### Task 4: GroupToolbar 重定位 + 多选互斥（Fix 4）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/groups/GroupToolbar.tsx`（全量替换组件壳，按钮 JSX 原样保留）
- Test: `apps/web/src/pages/canvas/components/groups/GroupToolbar.test.tsx`（增 mock 与新用例）
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx:310-313`（selectedGroup 互斥）

- [ ] **Step 1: 更新测试（现有 3 用例保留，mock RF hooks + portal DOM，新增定位与翻转用例）**

```tsx
// GroupToolbar.test.tsx 顶部（保留原 baseProps 与 3 个用例，新增以下内容）
import { useIsSingleSelected } from '@/hooks/useIsSingleSelected'; // 不需要，删除此行

const rf = vi.hoisted(() => ({ vp: { x: 0, y: 0, zoom: 1 }, node: null as any }));
vi.mock('@xyflow/react', () => ({
  useViewport: () => rf.vp,
  useInternalNode: () => rf.node,
}));

// describe 追加：
describe('GroupToolbar 定位', () => {
  beforeEach(() => {
    const portal = document.createElement('div');
    portal.id = 'node-toolbar-portal';
    document.body.appendChild(portal);
  });
  afterEach(() => document.getElementById('node-toolbar-portal')?.remove());

  it('定位在组 bounds 上方居中（偏移 12 屏幕常量）', () => {
    rf.vp = { x: 0, y: 0, zoom: 1 };
    rf.node = { id: 'g1', measured: { width: 400, height: 300 }, internals: { positionAbsolute: { x: 100, y: 200 } } };
    render(<GroupToolbar {...baseProps} />);
    const toolbar = document.getElementById('node-toolbar-portal')!.firstElementChild as HTMLElement;
    expect(toolbar.style.left).toBe('300px'); // 100 + 400/2
    expect(toolbar.style.top).toBe('188px');  // 200 - 12，translate(-50%,-100%)
  });

  it('组贴顶时翻转到下方', () => {
    rf.vp = { x: 0, y: 0, zoom: 1 };
    rf.node = { id: 'g1', measured: { width: 400, height: 300 }, internals: { positionAbsolute: { x: 100, y: 0 } } };
    render(<GroupToolbar {...baseProps} />);
    const toolbar = document.getElementById('node-toolbar-portal')!.firstElementChild as HTMLElement;
    expect(toolbar.style.top).toBe('312px'); // 0 + 300 + 12，translate(-50%,0)
  });

  it('internalNode 不可用时不渲染', () => {
    rf.node = null;
    const { container } = render(<GroupToolbar {...baseProps} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

注意：现有 3 个用例在 portal mock 下也需通过（beforeEach 对全部 describe 生效——把 portal setup 放全局 beforeEach 或复制进原 describe）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run src/pages/canvas/components/groups/GroupToolbar.test.tsx`
Expected: FAIL（现有用例因无 RF context 崩溃或定位用例失败）

- [ ] **Step 3: 改造组件（壳替换，4 个按钮 JSX 与 ConvertButton/Sep 原样不动）**

```tsx
// GroupToolbar.tsx 顶部 import 增加：
import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useViewport, useInternalNode } from '@xyflow/react';
import { TOOLBAR } from './selectionTokens';

// GroupToolbarComponent 全量替换为：
function GroupToolbarComponent(p: Props) {
  const { x: vpX, y: vpY, zoom } = useViewport();
  const internalNode = useInternalNode(p.groupId);

  const geo = useMemo(() => {
    const w = internalNode?.measured?.width ?? internalNode?.width ?? 0;
    const h = (internalNode?.measured?.height ?? internalNode?.height ?? 0) * zoom;
    if (!internalNode || w === 0) return null;
    const abs = internalNode.internals.positionAbsolute;
    const left = (abs.x + w / 2) * zoom + vpX;
    const topAbs = abs.y * zoom + vpY;
    // 偏移 12 为屏幕常量，变换后外加不乘 zoom
    const isAbove = topAbs - TOOLBAR.offset - TOOLBAR.height > 0;
    return {
      left,
      top: isAbove ? topAbs - TOOLBAR.offset : topAbs + h + TOOLBAR.offset,
      transform: isAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
    };
  }, [internalNode, vpX, vpY, zoom]);

  if (!geo) return null;
  const portalRoot = document.getElementById('node-toolbar-portal');
  if (!portalRoot) return null;

  return createPortal(
    <div
      style={{
        position: 'absolute', left: geo.left, top: geo.top, transform: geo.transform,
        pointerEvents: 'auto', zIndex: 40,
        background: 'rgba(0,0,0,0.85)', borderRadius: 20, padding: '8px 16px', height: TOOLBAR.height,
        display: 'flex', alignItems: 'center', gap: 2, color: '#fff',
      }}
    >
      {/* ↓↓↓ 从现有 GroupToolbar.tsx（git diff 前）原样逐字搬入以下两个分支的全部按钮 JSX，
          含 btn 样式函数调用、Sep、ConvertButton 及所有 disabled/title/事件绑定，禁止重写 ↓↓↓ */}
      {/* {p.groupType === 'normal' && ( ...现有完整按钮树... )} */}
      {/* {p.groupType === 'storyboard' && p.children} */}
      {/* ↑↑↑ 原样搬入结束 ↑↑↑ */}
    </div>,
    portalRoot,
  );
}
```

- [ ] **Step 4: CanvasView 互斥（310-313 行替换）**

```tsx
// 选中组节点时显示 GroupToolbar；多选（≥2）时与 SelectionBoxOverlay 互斥，仅单独选中该组时显示
const selectedGroup = useMemo(() => {
  let count = 0;
  for (const n of nodes) {
    if (!n.selected) continue;
    count++;
    if (count > 1) return undefined;
  }
  return count === 1 ? nodes.find((n) => n.type === 'group' && n.selected) : undefined;
}, [nodes]);
```

- [ ] **Step 5: 跑测试 + 回归**

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run src/pages/canvas/components/groups/GroupToolbar.test.tsx src/pages/canvas/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/canvas/components/groups/GroupToolbar.tsx apps/web/src/pages/canvas/components/groups/GroupToolbar.test.tsx apps/web/src/pages/canvas/components/CanvasView.tsx
git commit -m "feat(web): 组工具条锚定组块上方+多选互斥（组视觉优化 Fix 4）"
```

---

### Task 5: canvasStore——renameGroup / markManuallyResized / 组 data 双写（Fix 3 store 层一）

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts`（接口声明 114-116 附近 + 实现；模块底部辅助函数）
- Test: `apps/web/src/stores/canvasStore.groups.test.ts`（既有文件增补；若文件名不同以实际为准——`ls apps/web/src/stores/` 确认）

- [ ] **Step 1: 写失败测试**

在既有组 store 测试文件中追加（沿用该文件现有的 store 初始化与 mock 模式；若无现成模式，参考 `GroupNode.test.tsx` 的 `vi.mock('@/stores/nodeStore')` 方式 mock nodeStore 为可读 state）：

```tsx
describe('renameGroup / markManuallyResized / 组 data 双写 nodeStore', () => {
  it('groupNodes 创建不设初始 name（默认名由渲染层兜底「分组」，数量由徽标动态显示）', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gId);
    expect((g!.data as any).name).toBeUndefined();
  });

  it('renameGroup 更新 canvasStore data.name 并入组历史（可 Ctrl+Z）', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().renameGroup(gId, '我的分组');
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gId);
    expect((g!.data as any).name).toBe('我的分组');
    // nodeStore 双写（localStorage 快照数据源）
    expect(mockNodeStore.nodes[gId].data.name).toBe('我的分组');
    // 历史：undo 恢复改名前（创建时无 name）
    expect(useGroupHistory.getState().canUndo()).toBe(true);
    useGroupHistory.getState().undo();
    expect((useCanvasStore.getState().nodes.find((n) => n.id === gId)!.data as any).name).toBeUndefined();
  });

  it('renameGroup 空串/同名 no-op 不产生历史', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    const before = useGroupHistory.getState().pastLength();
    useCanvasStore.getState().renameGroup(gId, '');
    // '' 回退由渲染层做，store 层收到 '' 时存 '分组'
    expect((useCanvasStore.getState().nodes.find((n) => n.id === gId)!.data as any).name).toBe('分组');
    useCanvasStore.getState().renameGroup(gId, '分组');
    expect(useGroupHistory.getState().pastLength()).toBe(before + 1); // 仅第一次生效
  });

  it('markManuallyResized 设标记并双写 nodeStore', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().markManuallyResized(gId);
    expect((useCanvasStore.getState().nodes.find((n) => n.id === gId)!.data as any).manuallyResized).toBe(true);
    expect((mockNodeStore.nodes[gId].data as any).manuallyResized).toBe(true);
  });
});
```

（`mockNodeStore` 为该测试文件的 nodeStore mock state 容器；`act` 从 '@testing-library/react' 导入或用 `vi.useFakeTimers` 外的直接调用——groupHistory record 是同步的，undo 后 zustand setState 同步，无需 act，直接断言即可，删除 act 包裹。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run src/stores/canvasStore.groups.test.ts`
Expected: FAIL（renameGroup 不存在，TS 报错可用 `(s as any).renameGroup` 或先补接口声明）

- [ ] **Step 3: 实现**

接口声明（`toggleCollapse` 声明附近追加）：
```ts
renameGroup: (groupId: string, name: string) => void;
markManuallyResized: (groupId: string) => void;
```

模块级辅助函数（`canvasStore.ts` 内，create 之前）：
```ts
/** 组 data 变更双写 nodeStore（localStorage 快照数据源是 nodeStore，undo/redo 由 groupHistory 自带双写） */
function syncGroupDataToNodeStore(groupId: string) {
  const ns = useNodeStore.getState();
  const appNode = ns.nodes[groupId];
  const group = useCanvasStore.getState().nodes.find((n) => n.id === groupId);
  if (!appNode || !group) return;
  useNodeStore.setState({ nodes: { ...ns.nodes, [groupId]: { ...appNode, data: group.data as any } } });
}
```

实现（`toggleCollapse` 实现之前插入；另改 groupNodes 初始 data）：

groupNodes 创建处（canvasStore.ts:748）data 改为不设 name：
```ts
// 原：data: { groupType: 'normal', name: `分组 ${picked.length} 个节点` },
data: { groupType: 'normal' },
```
（spec 决策：默认名固定「分组」由渲染层 `?? '分组'` 兜底，数量由徽标动态显示；初始持久名会让旧文案残留。既有断言初始名的测试同步更新。）

```ts
renameGroup: (groupId, name) => {
  const final = name.trim() || '分组';
  const s = get();
  const group = s.nodes.find((n) => n.id === groupId);
  if (!group || (group.data as any).name === final) return;
  const before = captureBefore([groupId], []);
  set((st) => ({
    nodes: st.nodes.map((n) => (n.id === groupId ? { ...n, data: { ...n.data, name: final } } : n)),
  }));
  syncGroupDataToNodeStore(groupId);
  const after = captureAfter([groupId], []);
  useGroupHistory.getState().record({ label: '重命名组', nodeIds: [groupId], edgeIds: [], before, after });
},

markManuallyResized: (groupId) => {
  set((st) => ({
    nodes: st.nodes.map((n) => (n.id === groupId ? { ...n, data: { ...n.data, manuallyResized: true } } : n)),
  }));
  syncGroupDataToNodeStore(groupId);
},
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run src/stores/canvasStore.groups.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.groups.test.ts
git commit -m "feat(web): renameGroup 入组历史+组 data 双写 nodeStore（组视觉优化 Fix 3）"
```

---

### Task 6: toggleCollapse/convertGroup/calcGroupBounds/恢复路径（Fix 3a 序列化 + 3b store 层二）

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts:1195-1206`（toggleCollapse）、`:1180-1187`（convertGroup normal 分支 data 与 refit）
- Modify: `apps/web/src/utils/groupLayout.ts:7,52-58`（GROUP_TOP_PADDING）
- Modify: `apps/web/src/pages/canvas/page.tsx:75-81`（P0-4 refit 跳过手动尺寸组）
- Modify: `apps/web/src/pages/canvas/hooks/useCanvasPersistence.ts:38-58`（恢复后组尺寸恢复）
- Test: `apps/web/src/stores/canvasStore.groups.test.ts` 增补 + `apps/web/src/utils/groupLayout.test.ts`（若存在，`ls` 确认）增补

- [ ] **Step 1: 写失败测试（toggleCollapse 往返 + convertGroup 清标记 + bounds 顶部预留）**

```tsx
describe('组尺寸持久化行为', () => {
  it('折叠保存 savedSize；无手动标记展开 refit 重算', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    const before = useCanvasStore.getState().nodes.find((n) => n.id === gId)!.width;
    useCanvasStore.getState().toggleCollapse(gId); // 折叠
    const collapsed = useCanvasStore.getState().nodes.find((n) => n.id === gId)!;
    expect((collapsed.data as any).collapsed).toBe(true);
    expect(collapsed.width).toBe(200);
    expect((collapsed.data as any).savedSize).toEqual({ width: before, height: collapsed.data.savedSize.height });
    useCanvasStore.getState().toggleCollapse(gId); // 展开 → refit
    const expanded = useCanvasStore.getState().nodes.find((n) => n.id === gId)!;
    expect((expanded.data as any).collapsed).toBe(false);
    expect(expanded.width).toBeGreaterThan(200);
  });

  it('manuallyResized 组展开恢复 savedSize（不 refit）', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().toggleCollapse(gId); // 折叠（savedSize 已存）
    useCanvasStore.getState().markManuallyResized(gId);
    // 模拟用户在折叠前手动 resize 过：直接改 savedSize 为自定义值
    useCanvasStore.setState({ nodes: useCanvasStore.getState().nodes.map((n) =>
      n.id === gId ? { ...n, data: { ...n.data, savedSize: { width: 777, height: 555 } } } : n) });
    useCanvasStore.getState().toggleCollapse(gId); // 展开
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gId)!;
    expect(g.width).toBe(777);
    expect(g.height).toBe(555);
  });

  it('convertGroup 清除 manuallyResized/savedSize，默认名「分组」', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().markManuallyResized(gId);
    useCanvasStore.getState().convertGroup(gId, 'storyboard');
    useCanvasStore.getState().convertGroup(gId, 'normal');
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gId)!;
    expect((g.data as any).manuallyResized).toBeUndefined();
    expect((g.data as any).savedSize).toBeUndefined();
    expect((g.data as any).name).toBe('分组');
  });
});
```

groupLayout 测试增补（顶部预留断言）：
```tsx
it('calcGroupBounds 顶部预留 GROUP_TOP_PADDING=44（标题行空间），其余 20', () => {
  const b = calcGroupBounds([{ x: 100, y: 100, width: 200, height: 100 }]);
  expect(b.x).toBe(80);   // 100 - 20
  expect(b.y).toBe(56);   // 100 - 44
  expect(b.width).toBe(240);
  expect(b.height).toBe(164); // 100 + 20 + 44
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run src/stores/canvasStore.groups.test.ts src/utils/groupLayout.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

groupLayout.ts：
```ts
export const GROUP_PADDING = 20;
/** 顶部额外预留 = 标题行空间（标题浮层在容器内左上，子节点相对坐标渲染推不开，必须靠 bounds 预留） */
export const GROUP_TOP_PADDING = 44;

export function calcGroupBounds(items: { x: number; y: number; width: number; height: number }[]) {
  const minX = Math.min(...items.map((i) => i.x)) - GROUP_PADDING;
  const minY = Math.min(...items.map((i) => i.y)) - GROUP_TOP_PADDING;
  const maxX = Math.max(...items.map((i) => i.x + i.width)) + GROUP_PADDING;
  const maxY = Math.max(...items.map((i) => i.y + i.height)) + GROUP_PADDING;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
```

toggleCollapse 替换（canvasStore.ts:1195-1206）：
```ts
toggleCollapse: (groupId) => {
  set((st) => ({
    nodes: st.nodes.map((n) => {
      if (n.id !== groupId) return n;
      const collapsing = !(n.data as any).collapsed;
      if (collapsing) {
        return {
          ...n,
          data: { ...n.data, collapsed: true, savedSize: { width: n.width ?? 0, height: n.height ?? 0 } },
          width: 200, height: 64,
        };
      }
      return { ...n, data: { ...n.data, collapsed: false } };
    }),
  }));
  const g = get().nodes.find((n) => n.id === groupId);
  if (g && !(g.data as any).collapsed) {
    const d = g.data as any;
    if (d.manuallyResized && d.savedSize) {
      // 手动 resize 过的组：展开恢复用户尺寸，不按子节点重算
      set((st) => ({
        nodes: st.nodes.map((n) => (n.id === groupId
          ? { ...n, width: d.savedSize.width, height: d.savedSize.height }
          : n)),
      }));
    } else {
      get().refitGroupBounds(groupId);
    }
  }
  syncGroupDataToNodeStore(groupId);
  get().applyGroupDerivations();
},
```

convertGroup normal 分支（`分组 ${gd.cells.length} 个节点` 处）：
```ts
if (n.id === groupId) return { ...n, data: { groupType: 'normal', name: '分组' } };
```
（data 整体重建，天然清除 manuallyResized/savedSize/storyboard；其后 `refitGroupBounds` 保持现状。）

page.tsx P0-4 循环（75-81）加跳过条件：
```ts
for (const g of useCanvasStore.getState().nodes.filter(
  (n) => n.type === 'group' && (n.data as any).groupType === 'normal'
    && !(n.data as any).collapsed && !(n.data as any).manuallyResized,
)) {
  useCanvasStore.getState().refitGroupBounds(g.id);
}
```

useCanvasPersistence.ts 恢复 effect（`applyGroupDerivations()` 调用之后、`finally` 之前追加）：
```ts
// 对齐 DB 加载路径 P0-4：快照 AppNode 不含组宽高，展开普通组按子节点重算；
// 手动 resize 过的组恢复用户保存的尺寸
for (const g of useCanvasStore.getState().nodes.filter(
  (n) => n.type === 'group' && (n.data as any).groupType === 'normal' && !(n.data as any).collapsed,
)) {
  const d = g.data as any;
  if (d.manuallyResized && d.savedSize) {
    useCanvasStore.setState({
      nodes: useCanvasStore.getState().nodes.map((n) =>
        n.id === g.id ? { ...n, width: d.savedSize.width, height: d.savedSize.height } : n),
    });
  } else {
    useCanvasStore.getState().refitGroupBounds(g.id);
  }
}
```

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run src/stores/ src/utils/groupLayout.test.ts src/pages/canvas/`
Expected: PASS（注意：既有依赖 `calcGroupBounds` 数值的测试可能需按新 TOP_PADDING 修正期望值——只改数值，不改断言语义）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/utils/groupLayout.ts apps/web/src/pages/canvas/page.tsx apps/web/src/pages/canvas/hooks/useCanvasPersistence.ts
git commit -m "feat(web): 组尺寸 savedSize/manuallyResized 全链路+顶部标题预留（组视觉优化 Fix 3）"
```

---

### Task 7: NormalGroupRenderer 重做 + GroupNode NodeResizer（Fix 3 渲染层）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/groups/NormalGroupRenderer.tsx`（全量重写）
- Modify: `apps/web/src/pages/canvas/components/groups/GroupNode.tsx:12-13`（普通组分支加 NodeResizer + 传 groupId）
- Modify: `apps/web/src/index.css`（追加 resize 边把手隐藏）
- Test: `apps/web/src/pages/canvas/components/groups/NormalGroupRenderer.test.tsx`（重写）、`GroupNode.test.tsx`（增补）

- [ ] **Step 1: 重写 NormalGroupRenderer 测试**

```tsx
// NormalGroupRenderer.test.tsx（全量替换）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NormalGroupRenderer } from './NormalGroupRenderer';

const renameGroup = vi.fn();
const mockStore = { nodes: [] as any[] };
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (sel: any) => sel({ nodes: mockStore.nodes, renameGroup }),
}));

describe('NormalGroupRenderer 展开态', () => {
  beforeEach(() => { mockStore.nodes = [{ id: 'c1', parentId: 'g1' }, { id: 'c2', parentId: 'g1' }, { id: 'x', parentId: null }]; });

  it('默认名「分组」+ 徽标「2 项」（for 循环计数）', () => {
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal' } as any} selected={false} />);
    expect(screen.getByText('分组')).toBeTruthy();
    expect(screen.getByText('2 项')).toBeTruthy();
  });

  it('自定义名显示 data.name', () => {
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '我的分组' } as any} selected={false} />);
    expect(screen.getByText('我的分组')).toBeTruthy();
  });

  it('常态/选中虚线色切换（token）', () => {
    const { rerender } = render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal' } as any} selected={false} />);
    const box = screen.getByTestId('group-box');
    expect(box.style.border).toContain('rgba(255, 255, 255, 0.45)');
    rerender(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal' } as any} selected={true} />);
    expect(screen.getByTestId('group-box').style.border).toContain('rgba(255, 255, 255, 0.85)');
  });

  it('双击进入编辑；Enter 提交非空名', () => {
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '旧名' } as any} selected={false} />);
    fireEvent.doubleClick(screen.getByText('旧名'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '新名' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(renameGroup).toHaveBeenCalledWith('g1', '新名');
  });

  it('空输入提交回退默认「分组」', () => {
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '旧名' } as any} selected={false} />);
    fireEvent.doubleClick(screen.getByText('旧名'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(renameGroup).toHaveBeenCalledWith('g1', '分组');
  });

  it('Esc 取消不提交', () => {
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '旧名' } as any} selected={false} />);
    fireEvent.doubleClick(screen.getByText('旧名'));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(renameGroup).not.toHaveBeenCalled();
    expect(screen.getByText('旧名')).toBeTruthy();
  });

  it('Enter 触发 blur 后不重复提交（committedRef guard）', () => {
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '旧名' } as any} selected={false} />);
    fireEvent.doubleClick(screen.getByText('旧名'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '新名' } });
    fireEvent.keyDown(input, { key: 'Enter' }); // Enter 提交 → setEditing(false) → input 卸载（无 blur 双触发路径）
    expect(renameGroup).toHaveBeenCalledTimes(1);
  });

  it('IME 组合期 Enter 不提交（isComposing）', () => {
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '旧名' } as any} selected={false} />);
    fireEvent.doubleClick(screen.getByText('旧名'));
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true } as any);
    expect(renameGroup).not.toHaveBeenCalled();
    // 若 fireEvent 不支持 isComposing 字段导致用例失败，改用：
    // input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true } as any));
  });
});

describe('NormalGroupRenderer 折叠态', () => {
  it('小卡片：名称 + 徽标 + 虚线深色', () => {
    mockStore.nodes = [{ id: 'c1', parentId: 'g1' }];
    render(<NormalGroupRenderer groupId="g1" data={{ groupType: 'normal', name: '我的分组', collapsed: true } as any} selected={false} />);
    expect(screen.getByText('我的分组')).toBeTruthy();
    expect(screen.getByText('1 项')).toBeTruthy();
  });
});
```

GroupNode.test.tsx 增补（NodeResizer 仅选中渲染）：
```tsx
vi.mock('@xyflow/react', async (orig) => ({
  ...(await orig<typeof import('@xyflow/react')>()),
  NodeResizer: (p: any) => <div data-testid="node-resizer" data-visible={String(p.isVisible)} />,
}));

it('普通组：选中时渲染 NodeResizer，未选中不渲染', () => {
  setMockNodes([]);
  const { rerender } = render(<GroupNode id="g1" data={{ groupType: 'normal' }} selected={false} {...{} as any} />);
  expect(screen.queryByTestId('node-resizer')).toBeNull();
  rerender(<GroupNode id="g1" data={{ groupType: 'normal' }} selected={true} {...{} as any} />);
  expect(screen.getByTestId('node-resizer')).toBeTruthy();
});
```
（若 `vi.mock('@xyflow/react')` 与该文件现有其他 mock 冲突，保持原 mock 并仅添加 NodeResizer key。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run src/pages/canvas/components/groups/NormalGroupRenderer.test.tsx src/pages/canvas/components/groups/GroupNode.test.tsx`
Expected: FAIL

- [ ] **Step 3: 重写 NormalGroupRenderer**

```tsx
// apps/web/src/pages/canvas/components/groups/NormalGroupRenderer.tsx
import { memo, useEffect, useRef, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import type { GroupNodeData } from '@/types/group';
import { GROUP_BOX, BADGE } from './selectionTokens';

interface Props { groupId: string; data: GroupNodeData; selected: boolean }

function NormalGroupRendererComponent({ groupId, data, selected }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);
  const renameGroup = useCanvasStore((s) => s.renameGroup);
  const childCount = useCanvasStore((s) => {
    let count = 0;
    for (let i = 0; i < s.nodes.length; i++) if (s.nodes[i].parentId === groupId) count++;
    return count;
  });
  const name = data.name ?? '分组';

  useEffect(() => {
    if (editing) {
      committedRef.current = false;
      inputRef.current?.focus();
    }
  }, [editing]);

  const submit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    renameGroup(groupId, draft.trim() || '分组');
    setEditing(false);
  };
  const cancel = () => {
    committedRef.current = true;
    setEditing(false);
  };

  if (data.collapsed) {
    return (
      <div
        style={{
          width: 200, height: 64, borderRadius: GROUP_BOX.borderRadius,
          border: `${GROUP_BOX.borderWidth}px dashed ${selected ? GROUP_BOX.selectedBorder : GROUP_BOX.border}`,
          background: 'rgba(26,26,26,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          color: '#cccccc', fontSize: 13,
        }}
      >
        <span>{name}</span>
        <span style={BADGE}>{childCount} 项</span>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        data-testid="group-box"
        style={{
          position: 'absolute', inset: 0, borderRadius: GROUP_BOX.borderRadius,
          border: `${GROUP_BOX.borderWidth}px dashed ${selected ? GROUP_BOX.selectedBorder : GROUP_BOX.border}`,
          background: GROUP_BOX.background, pointerEvents: 'none',
        }}
      />
      {editing ? (
        <input
          ref={inputRef}
          className="nodrag nopan"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => {
            if ((e.nativeEvent as KeyboardEvent).isComposing) return;
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') cancel();
          }}
          style={{
            position: 'absolute', top: 8, left: 12, width: 140, zIndex: 2,
            fontSize: 12, color: '#fff', background: '#1a1a1a',
            border: '1px solid #555', borderRadius: 4, padding: '2px 6px', outline: 'none',
          }}
        />
      ) : (
        <div
          onDoubleClick={() => { setDraft(name); setEditing(true); }}
          style={{
            position: 'absolute', top: 8, left: 12, zIndex: 2,
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#0a0a0a', padding: '0 6px',
            fontSize: 12, color: '#cccccc', whiteSpace: 'nowrap',
          }}
        >
          <span>{name}</span>
          <span style={BADGE}>{childCount} 项</span>
        </div>
      )}
    </div>
  );
}
export const NormalGroupRenderer = memo(NormalGroupRendererComponent);
```

GroupNode.tsx 普通组分支替换（12-13 行）：
```tsx
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { HANDLE } from './selectionTokens';

// GroupNodeComponent 内普通组分支：
return (
  <>
    {selected && (
      <NodeResizer
        isVisible={!!selected}
        minWidth={200}
        minHeight={120}
        handleStyle={HANDLE}
        onResizeEnd={() => useCanvasStore.getState().markManuallyResized(id)}
      />
    )}
    <NormalGroupRenderer groupId={id} data={data as any} selected={!!selected} />
  </>
);
```

index.css 追加：
```css
/* 组块四角手柄：隐藏边把手（.line），仅保留四角——低特异性便于覆盖 */
.react-flow__resize-control:where(.line) { display: none; }
```

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run src/pages/canvas/`
Expected: PASS（GroupNode.test 现有 NormalGroupRenderer stub mock 仍兼容——新 prop `groupId` 为多余 prop 不报错；若 TS 严格报错则在 stub 签名加 `groupId?: string`）

- [ ] **Step 5: 类型检查**

Run: `cd /d/flowweb/apps/web && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/canvas/components/groups/ apps/web/src/index.css
git commit -m "feat(web): 组块虚线深色样式+可编辑标题+四角手柄（组视觉优化 Fix 3 渲染层）"
```

---

### Task 8: 浏览器端到端验证（spec 验证标准 1-9）

**Files:** 无代码改动（发现问题回改对应 Task 并补测试）

前置：项目已启动（API 3000 / Web 5173）。打开 `http://localhost:5173/canvas`。

- [ ] **Step 1: 框选路径（验证 1）**：框选 2+ 图片节点 → 无任何单节点工具条残留；虚线框（白虚线+深色填充+16px padding）+ 左上徽标「N 项」+ 框上方工具条出现。
- [ ] **Step 2: Shift 加选路径（验证 2，Bug A 残留核心）**：先单击选中 1 节点（单节点工具条显示）→ Shift 加选第 2 个 → 单节点工具条消失、多选框出现。
- [ ] **Step 3: 跟随（验证 3）**：拖动选中集合 / 缩放（ctrl+滚轮）/ 平移 → 框与工具条实时跟随；zoom 0.5 时 padding 仍约 16px。
- [ ] **Step 4: 顶部翻转（验证 4）**：选区移到画布顶部 → 工具条翻转到框下方不被裁切。
- [ ] **Step 5: 组块（验证 5）**：打组 → 虚线深色、左上「分组 · N 项」、双击改名（Enter/Esc/失焦/清空回退/中文 IME 选词 Enter 不提交）；徽标随拖入/移出子节点实时更新；选中显示四角手柄；**拖角过程容器实时跟随（非松手跳变）**——若跳变，启用后备：NodeResizer 加 onResize 手动同步尺寸（并回改 spec 注记）。
- [ ] **Step 6: 互斥（验证 5a）**：选中组 + Shift 选其他节点 → 组工具条隐藏、多选框正常；单独选中组 → 组工具条在组上方、无多选框。
- [ ] **Step 7: 尺寸往返（验证 6）**：手动 resize → 折叠 → 展开 → 恢复用户尺寸；转分镜组再转回 → 尺寸重算、默认名「分组」。
- [ ] **Step 8: 两种组工具条（验证 7）**：普通组/分镜组工具条均在组块上方居中；折叠/展开后跟随；贴顶翻转。
- [ ] **Step 9: 刷新持久化（验证 8）**：改名+手动 resize 后刷新（DB 路径）；另测 localStorage 兜底路径（断网/无项目时）——组名/尺寸/标记均恢复。
- [ ] **Step 10: Ctrl+Z（验证 9）**：改名后撤销 → 名字回退；重做 → 恢复。
- [ ] **Step 11: 全量测试 + 类型检查收尾**

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: 全 PASS、无类型错误

- [ ] **Step 12: Commit（如有回改）**

```bash
git add -A apps/web/src
git commit -m "fix(web): 组视觉优化端到端验证回改"
```

---

## Self-Review 结论

- **Spec 覆盖**：Fix 1→Task 1；Fix 5→Task 2；Fix 2→Task 3；Fix 4→Task 4；Fix 3 store 层→Task 5/6；Fix 3a 序列化→Task 6（page.tsx/useCanvasPersistence/双写在 Task 5）；Fix 3 渲染层→Task 7；验证 1-9→Task 8。调研新发现（DB 加载 P0-4 refit 会覆盖手动尺寸）已在 Task 6 覆盖并需回写 spec 一句。
- **类型一致性**：`useIsSingleSelected(selected)`、`SELECTION_BOX/GROUP_BOX/BADGE/HANDLE/TOOLBAR`、`renameGroup/markManuallyResized/syncGroupDataToNodeStore`、NormalGroupRenderer 新 prop `groupId` 各任务间一致。
- **占位符**：Task 3 Step 1 的翻转断言数值已给出公式与计算说明（非 TBD）；Task 5/6 测试文件名标注"以实际为准"并给出确认方法。
