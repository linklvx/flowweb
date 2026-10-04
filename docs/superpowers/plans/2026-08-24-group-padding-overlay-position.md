<!-- doc-status: historical | verified_at: n/a -->
# 组框非对称内边距 + 悬浮层绝对坐标修复 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 组框按 上50/左右下20 硬保留区包住子节点并约束拖拽；7 处 portal 悬浮层改用 `internals.positionAbsolute` 定位，修复打组后错位。

**Architecture:** 纯函数 `calcGroupBounds`/`clampPositionToPadding` 放 `groupLayout.ts`；夹取在 `canvasStore.onNodesChange` 的 `applyNodeChanges` 之后集中执行（只处理本批 position/dimensions 变更节点，按父组 `groupType !== 'storyboard'` 门控）；7 处悬浮层两行式替换为绝对坐标。

**Tech Stack:** React Flow v12.10.2（`useInternalNode().internals.positionAbsolute`）、zustand、vitest + @testing-library/react。

**Spec:** `docs/superpowers/specs/2026-08-24-group-padding-and-overlay-position-design.md`

**测试命令：** `pnpm --filter @flowweb/web test <文件路径>`（= `vitest run`，非 watch）。类型检查：`pnpm --filter @flowweb/web exec tsc -b`。

**背景事实（执行者必读）：**
- 打组时子节点坐标被改为**相对组原点**（`canvasStore.ts:768-769`），悬浮层组件把 `node.position` 当绝对坐标乘 zoom 加 viewport，组不在画布原点时错位到左上角。
- `GroupToolbar.tsx:33` 是正确写法先例：`internalNode.internals.positionAbsolute`。
- 分镜组（storyboard）子节点也从 `{0,0}` 起排且带 `extent: 'parent'`，夹取必须按父组 `groupType` 门控，不能用 extent 判别。
- `canvasStore.groups.test.ts` 种子：n1(100,100,300×200)、n2(500,50,300×300)、free(2000,2000,300×200)；`beforeEach` 重置。
- 工具条常量：ImageNodeToolbar 84/32；TextNodeToolbar 46/28；AnnotationToolbar 48/16；EditToolbar 56/16；TransformToolbar 56/16。

---

### Task 1: calcGroupBounds 非对称内边距（红→绿）

**Files:**
- Modify: `apps/web/src/utils/groupLayout.test.ts:54-71`
- Modify: `apps/web/src/stores/canvasStore.groups.test.ts:30-44`
- Modify: `apps/web/src/utils/groupLayout.ts:7,52-58`

- [ ] **Step 1: 更新 groupLayout.test.ts 两处既有断言（见红）**

替换 `describe('calcGroupBounds', ...)` 整块为：

```ts
describe('calcGroupBounds', () => {
  it('包围盒上外扩 50px、左右下外扩 20px（顶部为硬保留区）', () => {
    const bounds = calcGroupBounds([
      { x: 100, y: 200, width: 300, height: 150 },
      { x: 500, y: 100, width: 300, height: 150 },
    ]);
    // minY = 100 - 50 = 50, maxY = 350 + 20 = 370, height = 320
    expect(bounds).toEqual({ x: 80, y: 50, width: 740, height: 320 });
  });

  it('GROUP_PADDING_TOP=50 / GROUP_PADDING=20', () => {
    const b = calcGroupBounds([{ x: 100, y: 100, width: 200, height: 100 }]);
    expect(b.x).toBe(80);   // 100 - 20
    expect(b.y).toBe(50);   // 100 - 50
    expect(b.width).toBe(240);
    expect(b.height).toBe(170); // 100 + 50 + 20
  });
});
```

- [ ] **Step 2: 更新 canvasStore.groups.test.ts 的 groupNodes 用例断言**

替换该用例（:30-44）为：

```ts
  it('创建组节点并挂靠子节点（相对坐标 + extent）', () => {
    const groupId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    const s = useCanvasStore.getState();
    const group = s.nodes.find((n) => n.id === groupId)!;
    expect(group.type).toBe('group');
    expect(group.data.groupType).toBe('normal');
    // 包围盒 = (80,0) ~ (820,370)（上外扩 50px、左右下外扩 20px）
    expect(group.position).toEqual({ x: 80, y: 0 });
    expect(group.width).toBe(740);
    expect(group.height).toBe(370);
    const child1 = s.nodes.find((n) => n.id === 'n1')!;
    expect(child1.parentId).toBe(groupId);
    expect(child1.extent).toBe('parent');
    expect(child1.position).toEqual({ x: 20, y: 100 }); // 相对组左上角：100 - 0
    const child2 = s.nodes.find((n) => n.id === 'n2')!;
    expect(child2.position).toEqual({ x: 420, y: 50 });
  });
```

同文件 ungroup 用例（n1 回到 {100,100}）与 addToGroup 用例（free.position.x === 1920）无需改动（minX 未变，自动成立）。

- [ ] **Step 3: 跑两文件确认红**

Run: `pnpm --filter @flowweb/web test src/utils/groupLayout.test.ts src/stores/canvasStore.groups.test.ts`
Expected: FAIL — groupLayout 两用例与 groups 的 groupNodes 用例断言不匹配（y/height 差 30px）

- [ ] **Step 4: 实现 groupLayout.ts**

第 7 行后新增常量，`calcGroupBounds` 的 `minY` 改用新常量：

```ts
export const GROUP_PADDING = 20;
export const GROUP_PADDING_TOP = 50;
```

```ts
export function calcGroupBounds(items: { x: number; y: number; width: number; height: number }[]) {
  const minX = Math.min(...items.map((i) => i.x)) - GROUP_PADDING;
  const minY = Math.min(...items.map((i) => i.y)) - GROUP_PADDING_TOP;
  const maxX = Math.max(...items.map((i) => i.x + i.width)) + GROUP_PADDING;
  const maxY = Math.max(...items.map((i) => i.y + i.height)) + GROUP_PADDING;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
```

- [ ] **Step 5: 跑测试确认绿**

Run: `pnpm --filter @flowweb/web test src/utils/groupLayout.test.ts src/stores/canvasStore.groups.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/utils/groupLayout.ts apps/web/src/utils/groupLayout.test.ts apps/web/src/stores/canvasStore.groups.test.ts
git commit -m "feat(web): 组框包围盒改非对称内边距（上50/左右下20）"
```

---

### Task 2: clampPositionToPadding 纯函数（红→绿）

**Files:**
- Modify: `apps/web/src/utils/groupLayout.test.ts`（文件头 import + 新 describe）
- Modify: `apps/web/src/utils/groupLayout.ts`

- [ ] **Step 1: 写失败测试**

`groupLayout.test.ts` 第 3-6 行 import 增加 `clampPositionToPadding`：

```ts
import {
  calcDefaultGrid, calcStoryboardSize, calcStitchSize,
  sortNodesByPosition, calcGroupBounds, ASPECT_RATIO_MAP, clampPositionToPadding,
} from './groupLayout';
```

文件末尾（或 calcGroupBounds describe 之后）追加：

```ts
describe('clampPositionToPadding', () => {
  it('进入保留区的坐标被夹回边距线（左20/上50）', () => {
    expect(clampPositionToPadding(
      { x: 5, y: 10 },
      { width: 100, height: 50 },
      { width: 400, height: 300 },
    )).toEqual({ x: 20, y: 50 });
  });

  it('保留区内的坐标不动', () => {
    expect(clampPositionToPadding(
      { x: 100, y: 100 },
      { width: 100, height: 50 },
      { width: 400, height: 300 },
    )).toEqual({ x: 100, y: 100 });
  });

  it('超出右/下边距被夹回组内', () => {
    expect(clampPositionToPadding(
      { x: 350, y: 280 },
      { width: 100, height: 50 },
      { width: 400, height: 300 },
    )).toEqual({ x: 280, y: 230 }); // 400-20-100, 300-20-50
  });

  it('组小于内容+边距时区间反转，贴住上界（退化行为）', () => {
    expect(clampPositionToPadding(
      { x: 30, y: 55 },
      { width: 200, height: 50 },
      { width: 100, height: 60 },
    )).toEqual({ x: -120, y: -10 }); // hi = 100-20-200, 60-20-50
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm --filter @flowweb/web test src/utils/groupLayout.test.ts`
Expected: FAIL — `clampPositionToPadding` 未导出

- [ ] **Step 3: 实现（groupLayout.ts 的 calcGroupBounds 之后）**

```ts
export function clampPositionToPadding(
  position: { x: number; y: number },
  childSize: { width: number; height: number },
  groupSize: { width: number; height: number },
): { x: number; y: number } {
  const xMax = groupSize.width - GROUP_PADDING - childSize.width;
  const yMax = groupSize.height - GROUP_PADDING - childSize.height;
  return {
    x: Math.min(Math.max(position.x, GROUP_PADDING), xMax),
    y: Math.min(Math.max(position.y, GROUP_PADDING_TOP), yMax),
  };
}
```

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm --filter @flowweb/web test src/utils/groupLayout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/groupLayout.ts apps/web/src/utils/groupLayout.test.ts
git commit -m "feat(web): 新增 clampPositionToPadding 组内保留区夹取纯函数"
```

---

### Task 3: onNodesChange 批次夹取（红→绿）

**Files:**
- Modify: `apps/web/src/stores/canvasStore.groups.test.ts`（新增 describe）
- Modify: `apps/web/src/stores/canvasStore.ts:18,481-501`

- [ ] **Step 1: 写失败测试**

`canvasStore.groups.test.ts` 末尾追加（复用文件顶部种子与 beforeEach）：

```ts
describe('组内边距保留区夹取（onNodesChange）', () => {
  // groupNodes(['n1','n2']) 后：group(80,0,740×370)；n1 rel(20,100) 300×200；n2 rel(420,50) 300×300
  const setupGroup = () => useCanvasStore.getState().groupNodes(['n1', 'n2']);

  it('顶排子节点 y<50 的 position 变更被夹回 50', () => {
    setupGroup();
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'n2', position: { x: 420, y: 10 }, dragging: true },
    ]);
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n2')!.position)
      .toEqual({ x: 420, y: 50 });
  });

  it('x<20 夹回 20；x 超出右边距夹回 组宽-20-子宽', () => {
    setupGroup();
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'n1', position: { x: 5, y: 100 } },
    ]);
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!.position.x).toBe(20);
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'n1', position: { x: 500, y: 100 } },
    ]);
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!.position.x).toBe(420);
  });

  it('y 超出下边距夹回 组高-20-子高', () => {
    setupGroup();
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'n1', position: { x: 20, y: 300 } },
    ]);
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!.position.y).toBe(150);
  });

  it('无父节点的 position 变更不受影响', () => {
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'free', position: { x: -999, y: -999 } },
    ]);
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'free')!.position)
      .toEqual({ x: -999, y: -999 });
  });

  it('分镜组子节点不受影响（groupType 门控）', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'sg', type: 'group', position: { x: 500, y: 500 }, width: 642, height: 182, data: {
          groupType: 'storyboard', cells: ['c1'],
          storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' },
        } },
        { id: 'c1', type: 'imageGen', parentId: 'sg', extent: 'parent', position: { x: 0, y: 0 }, width: 320, height: 180, data: {} },
      ] as any,
      edges: [], selectedId: null,
    });
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'c1', position: { x: -999, y: -999 } },
    ]);
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'c1')!.position)
      .toEqual({ x: -999, y: -999 });
  });

  it('子节点 dimensions 变更（setAttributes）触发即时夹取', () => {
    setupGroup();
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'n1', position: { x: 420, y: 100 } },
    ]);
    useCanvasStore.getState().onNodesChange([
      { type: 'dimensions', id: 'n1', dimensions: { width: 500, height: 100 }, setAttributes: true },
    ]);
    const n1 = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!;
    expect(n1.width).toBe(500);
    expect(n1.position.x).toBe(220); // 740-20-500
    expect(n1.position.y).toBe(100); // yMax=370-20-100=250 > 100，不动
  });

  it('select-only 与无 position 字段的变更不夹取', () => {
    setupGroup();
    useCanvasStore.getState().onNodesChange([
      { type: 'select', id: 'n1', selected: true },
      { type: 'position', id: 'n1', dragging: false },
    ]);
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!.position)
      .toEqual({ x: 20, y: 100 });
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm --filter @flowweb/web test src/stores/canvasStore.groups.test.ts`
Expected: FAIL — 前三个用例与 dimensions 用例未被夹取（position 原样写入）

- [ ] **Step 3: 实现 canvasStore.ts**

第 18 行 import 列表增加 `clampPositionToPadding`（与既有 `calcGroupBounds` 等并列）。

`onNodesChange`（:481）的 `set` 回调改为（dimension 同步循环与 return 语句随之调整，其余逻辑不动）：

```ts
  onNodesChange: (changes) => {
    set((s) => {
      const nextNodes = applyNodeChanges(changes, s.nodes) as Node[];
      // 组内边距保留区：只夹取本批 position/dimensions 变更中、普通组的子节点
      const changedIds = new Set(
        changes
          .filter((c) => (c.type === 'position' && c.position != null) || c.type === 'dimensions')
          .map((c) => c.id),
      );
      let nodes = nextNodes;
      if (changedIds.size > 0) {
        const byId = new Map(nextNodes.map((n) => [n.id, n]));
        nodes = nextNodes.map((n) => {
          if (!changedIds.has(n.id) || !n.parentId) return n;
          const parent = byId.get(n.parentId);
          if (!parent || parent.type !== 'group' || (parent.data as any)?.groupType === 'storyboard') return n;
          const clamped = clampPositionToPadding(
            n.position,
            { width: n.width ?? n.measured?.width ?? 280, height: n.height ?? n.measured?.height ?? 120 },
            { width: parent.width ?? parent.measured?.width ?? 0, height: parent.height ?? parent.measured?.height ?? 0 },
          );
          if (clamped.x === n.position.x && clamped.y === n.position.y) return n;
          return { ...n, position: clamped };
        });
      }
      // Sync dimension changes to nodeStore so components read updated width/height
      for (const change of changes) {
        if (change.type === 'dimensions' && 'dimensions' in change && (change as any).setAttributes) {
          const nodeStore = useNodeStore.getState();
          const existing = nodeStore.nodes[change.id];
          if (existing) {
            const dc = change as any;
            useNodeStore.setState({
              nodes: {
                ...nodeStore.nodes,
                [change.id]: { ...existing, width: dc.dimensions.width, height: dc.dimensions.height },
              },
            });
          }
        }
      }
      return { nodes };
    });
```

（`set` 之后 removes 处理等代码保持原样。）

- [ ] **Step 4: 跑测试确认绿（含回归）**

Run: `pnpm --filter @flowweb/web test src/stores/canvasStore.groups.test.ts src/stores/canvasStore.test.ts`
Expected: PASS（含既有 onNodesChange 用例回归）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.groups.test.ts
git commit -m "feat(web): onNodesChange 组内保留区集中夹取（分镜组门控+批次过滤）"
```

---

### Task 4: ImageNodeToolbar 绝对坐标修复（红→绿）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx:4-10,21-24,167-170,182-185,317-320` + 新用例
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx:360-361`

- [ ] **Step 1: 为全部 mock 补 internals（保持现有用例绿）**

默认 mock（:4-10）、afterEach 重置（:21-24）、用例 #12（:167-170）、#13（:182-185）、#22（:317-320）的 `mockReturnValue` 对象统一追加一行（abs 与 position 同值，现有断言不变）：

```ts
    internals: { positionAbsolute: { x: <同 position.x>, y: <同 position.y> } },
```

例（默认 mock 与 afterEach）：

```ts
  mockUseInternalNode.mockReturnValue({
    position: { x: 100, y: 200 },
    measured: { width: 300, height: 250 },
    internals: { positionAbsolute: { x: 100, y: 200 } },
  });
```

- [ ] **Step 2: 跑全文件确认仍绿**

Run: `pnpm --filter @flowweb/web test src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx`
Expected: PASS

- [ ] **Step 3: 新增父组坐标系用例（见红）**

在用例 22（'handles zoom properly...'）之后追加：

```tsx
  // 22d (new: 父组坐标系 — 按 positionAbsolute 定位，打组后不错位)
  it('positions toolbar by positionAbsolute when node is inside a group', () => {
    setupPortalTarget();
    // 组内相对坐标 (30,60)，绝对坐标 (600,400)：必须按绝对坐标定位
    mockUseInternalNode.mockReturnValue({
      position: { x: 30, y: 60 },
      measured: { width: 300, height: 250 },
      internals: { positionAbsolute: { x: 600, y: 400 } },
    });
    render(<ImageNodeToolbar {...defaultProps} />);
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar.style.left).toBe('750px'); // (600 + 300/2) * 1 + 0
    expect(toolbar.style.top).toBe('284px');  // 400 - 84 - 32
    cleanupPortalTarget();
  });
```

- [ ] **Step 4: 跑测试确认红**

Run: `pnpm --filter @flowweb/web test src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx`
Expected: FAIL — left 为 '180px'（按相对坐标 30 计算），非 '750px'

- [ ] **Step 5: 实现（ImageNodeToolbar.tsx:360-361 替换为）**

```ts
  const abs = internalNode?.internals?.positionAbsolute;
  const nodeX = abs?.x ?? 0;
  const nodeY = abs?.y ?? 0;
```

- [ ] **Step 6: 跑测试确认绿**

Run: `pnpm --filter @flowweb/web test src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx`
Expected: PASS（新用例 + 全部既有用例）

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.tsx apps/web/src/pages/canvas/components/nodes/ImageNodeToolbar.test.tsx
git commit -m "fix(web): ImageNodeToolbar 改用 positionAbsolute 定位修复打组错位"
```

---

### Task 5: TextNodeToolbar 绝对坐标修复（红→绿）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/TextNodeToolbar.test.tsx:1,6-12` + 新用例
- Modify: `apps/web/src/pages/canvas/components/nodes/TextNodeToolbar.tsx:169`

- [ ] **Step 1: mock 改为 hoisted 可覆写 + 补 internals**

第 1 行 vitest 导入补 `afterEach`：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

替换 ：6-12 的静态 mock 块为：

```ts
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
```

- [ ] **Step 2: 跑全文件确认仍绿**

Run: `pnpm --filter @flowweb/web test src/pages/canvas/components/nodes/TextNodeToolbar.test.tsx`
Expected: PASS

- [ ] **Step 3: 新增父组坐标系用例（见红）**

```tsx
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
```

（`setupPortalTarget`/`cleanupPortalTarget`/`mockEditor` 为文件既有辅助，直接复用。）

- [ ] **Step 4: 跑测试确认红**

Run: `pnpm --filter @flowweb/web test src/pages/canvas/components/nodes/TextNodeToolbar.test.tsx`
Expected: FAIL — left 为 '230px'（按相对坐标 30 计算），非 '800px'

- [ ] **Step 5: 实现（TextNodeToolbar.tsx:169 替换为，统一可选链+兜底风格）**

```ts
    const nodeX = internalNode.internals?.positionAbsolute?.x ?? 0;
    const nodeY = internalNode.internals?.positionAbsolute?.y ?? 0;
```

- [ ] **Step 6: 跑测试确认绿**

Run: `pnpm --filter @flowweb/web test src/pages/canvas/components/nodes/TextNodeToolbar.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/TextNodeToolbar.tsx apps/web/src/pages/canvas/components/nodes/TextNodeToolbar.test.tsx
git commit -m "fix(web): TextNodeToolbar 改用 positionAbsolute 定位修复打组错位"
```

---

### Task 6: AnnotationToolbar 绝对坐标修复（新建测试，红→绿）

**Files:**
- Create: `apps/web/src/pages/canvas/components/nodes/AnnotationToolbar.test.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/AnnotationToolbar.tsx:115-116`

- [ ] **Step 1: 新建测试文件（完整内容）**

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';

const { mockUseViewport, mockUseInternalNode } = vi.hoisted(() => ({
  mockUseViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
  mockUseInternalNode: vi.fn(() => ({
    position: { x: 100, y: 200 },
    measured: { width: 300, height: 250 },
    internals: { positionAbsolute: { x: 100, y: 200 } },
  })),
}));

vi.mock('@xyflow/react', () => ({
  useViewport: mockUseViewport,
  useInternalNode: mockUseInternalNode,
}));

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: (selector: any) => selector({ annotationState: undefined }),
}));

import { AnnotationToolbar } from './AnnotationToolbar';

const defaultProps = {
  nodeId: 'node-anno',
  onToolChange: vi.fn(),
  onColorChange: vi.fn(),
  onLineWidthChange: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onSave: vi.fn(),
  onCancel: vi.fn(),
  isSaving: false,
};

function setupPortalTarget() {
  const el = document.createElement('div');
  el.id = 'node-toolbar-portal';
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  vi.clearAllMocks();
  mockUseViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 });
  mockUseInternalNode.mockReturnValue({
    position: { x: 100, y: 200 },
    measured: { width: 300, height: 250 },
    internals: { positionAbsolute: { x: 100, y: 200 } },
  });
  document.getElementById('node-toolbar-portal')?.remove();
});

describe('AnnotationToolbar 定位', () => {
  it('常规定位：工具条在节点正上方', () => {
    setupPortalTarget();
    render(<AnnotationToolbar {...defaultProps} />);
    const toolbar = document.getElementById('node-toolbar-portal')!.querySelector('.nodrag') as HTMLElement;
    expect(toolbar.style.left).toBe('250px'); // (100 + 300/2) * 1 + 0
    expect(toolbar.style.top).toBe('136px');  // 200 - 48 - 16
  });

  it('父组坐标系：按 positionAbsolute 定位（打组后不错位）', () => {
    setupPortalTarget();
    mockUseInternalNode.mockReturnValue({
      position: { x: 30, y: 60 },
      measured: { width: 300, height: 250 },
      internals: { positionAbsolute: { x: 600, y: 400 } },
    });
    render(<AnnotationToolbar {...defaultProps} />);
    const toolbar = document.getElementById('node-toolbar-portal')!.querySelector('.nodrag') as HTMLElement;
    expect(toolbar.style.left).toBe('750px'); // (600 + 300/2) * 1 + 0
    expect(toolbar.style.top).toBe('336px');  // 400 - 48 - 16
  });
});
```

- [ ] **Step 2: 跑测试确认第二个用例红（第一个应绿）**

Run: `pnpm --filter @flowweb/web test src/pages/canvas/components/nodes/AnnotationToolbar.test.tsx`
Expected: 第一个 PASS；第二个 FAIL — left 为 '180px'（按相对坐标 30 计算），非 '750px'

- [ ] **Step 3: 实现（AnnotationToolbar.tsx:115-116 替换为，统一可选链+兜底风格）**

```ts
    const nodeX = internalNode.internals?.positionAbsolute?.x ?? 0;
    const nodeY = internalNode.internals?.positionAbsolute?.y ?? 0;
```

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm --filter @flowweb/web test src/pages/canvas/components/nodes/AnnotationToolbar.test.tsx`
Expected: PASS（两个用例）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/AnnotationToolbar.tsx apps/web/src/pages/canvas/components/nodes/AnnotationToolbar.test.tsx
git commit -m "fix(web): AnnotationToolbar 改用 positionAbsolute 定位并补最小定位测试"
```

---

### Task 7: EditToolbar 绝对坐标修复（红→绿）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/EditToolbar.test.tsx:4-10,20-23` + 新用例
- Modify: `apps/web/src/pages/canvas/components/nodes/EditToolbar.tsx:298-299`

- [ ] **Step 1: 为默认 mock 与 afterEach 重置补 internals**

该文件为 hoisted mock 模式（默认 position {100,200}、measured {300,250}）。默认 mock（:4-10）与 afterEach（:20-23）的对象统一追加：

```ts
    internals: { positionAbsolute: { x: 100, y: 200 } },
```

- [ ] **Step 2: 跑全文件确认仍绿**

Run: `pnpm --filter @flowweb/web test src/pages/canvas/components/nodes/EditToolbar.test.tsx`
Expected: PASS

- [ ] **Step 3: 新增父组坐标系用例（见红）**

```tsx
it('positions toolbar by positionAbsolute when node is inside a group', () => {
  setupPortalTarget();
  mockUseInternalNode.mockReturnValue({
    position: { x: 30, y: 60 },
    measured: { width: 300, height: 250 },
    internals: { positionAbsolute: { x: 600, y: 400 } },
  });
  render(<EditToolbar {...baseProps} />);
  const toolbar = document.getElementById('node-toolbar-portal')!.querySelector('.nodrag') as HTMLElement;
  expect(toolbar.style.left).toBe('750px'); // (600 + 300/2) * 1 + 0
  expect(toolbar.style.top).toBe('328px');  // 400 - 56 - 16
  cleanupPortalTarget();
});
```

（`baseProps`、`setupPortalTarget`/`cleanupPortalTarget` 为文件既有。baseProps 默认 crop 模式 → 走普通定位分支。）

- [ ] **Step 4: 跑测试确认红**

Run: `pnpm --filter @flowweb/web test src/pages/canvas/components/nodes/EditToolbar.test.tsx`
Expected: FAIL — left 为 '180px'，非 '750px'

- [ ] **Step 5: 实现（EditToolbar.tsx:298-299 替换为）**

```ts
  const abs = internalNode?.internals?.positionAbsolute;
  const nodeX = abs?.x ?? 0;
  const nodeY = abs?.y ?? 0;
```

- [ ] **Step 6: 跑测试确认绿**

Run: `pnpm --filter @flowweb/web test src/pages/canvas/components/nodes/EditToolbar.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/EditToolbar.tsx apps/web/src/pages/canvas/components/nodes/EditToolbar.test.tsx
git commit -m "fix(web): EditToolbar 改用 positionAbsolute 定位修复打组错位"
```

---

### Task 8: TransformToolbar 绝对坐标修复（红→绿）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/TransformToolbar.test.tsx:4-10,20-23` + 新用例
- Modify: `apps/web/src/pages/canvas/components/nodes/TransformToolbar.tsx:91-92`

步骤与 Task 7 完全同模式（该文件同为 hoisted mock，默认 position {100,200}、measured {300,250}；组件常量 TOOLBAR_HEIGHT=56、GAP=16；defaultProps 含 nodeId/rotation/flipH/flipV/selected/isSaving/onRotate/onFlipH/onFlipV/onSave/onCancel）：

- [ ] **Step 1: 默认 mock 与 afterEach 补 `internals: { positionAbsolute: { x: 100, y: 200 } }`，跑全文件确认绿**

Run: `pnpm --filter @flowweb/web test src/pages/canvas/components/nodes/TransformToolbar.test.tsx`
Expected: PASS

- [ ] **Step 2: 新增用例（见红）**

```tsx
it('positions toolbar by positionAbsolute when node is inside a group', () => {
  setupPortalTarget();
  mockUseInternalNode.mockReturnValue({
    position: { x: 30, y: 60 },
    measured: { width: 300, height: 250 },
    internals: { positionAbsolute: { x: 600, y: 400 } },
  });
  render(<TransformToolbar {...defaultProps} />);
  const toolbar = document.getElementById('node-toolbar-portal')!.querySelector('.nodrag') as HTMLElement;
  expect(toolbar.style.left).toBe('750px'); // (600 + 300/2) * 1 + 0
  expect(toolbar.style.top).toBe('328px');  // 400 - 56 - 16
  cleanupPortalTarget();
});
```

Run: `pnpm --filter @flowweb/web test src/pages/canvas/components/nodes/TransformToolbar.test.tsx`
Expected: FAIL — left 为 '180px'，非 '750px'

- [ ] **Step 3: 实现（TransformToolbar.tsx:91-92 替换为）**

```ts
  const abs = internalNode?.internals?.positionAbsolute;
  const nodeX = abs?.x ?? 0;
  const nodeY = abs?.y ?? 0;
```

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm --filter @flowweb/web test src/pages/canvas/components/nodes/TransformToolbar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/TransformToolbar.tsx apps/web/src/pages/canvas/components/nodes/TransformToolbar.test.tsx
git commit -m "fix(web): TransformToolbar 改用 positionAbsolute 定位修复打组错位"
```

---

### Task 9: ImageGenNode 扩图悬浮层绝对坐标修复（红→绿）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx:8-16`（mock 重构）+ 新用例
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx:1042-1043,1220-1221`

- [ ] **Step 1: useInternalNode mock 改为 hoisted 可覆写 + 补 internals**

在 `vi.mock('@xyflow/react', ...)`（:8）之前插入：

```tsx
const { mockUseInternalNode } = vi.hoisted(() => ({
  mockUseInternalNode: vi.fn(() => ({
    position: { x: 0, y: 0 },
    measured: { width: 500, height: 500 },
    internals: { positionAbsolute: { x: 0, y: 0 } },
  })),
}));
```

mock 工厂内替换原 `useInternalNode: vi.fn(() => ({ position: { x: 0, y: 0 }, measured: { width: 500, height: 500 } })),` 为：

```tsx
    useInternalNode: mockUseInternalNode,
```

在文件既有 afterEach 重置区追加：

```tsx
  mockUseInternalNode.mockReturnValue({
    position: { x: 0, y: 0 },
    measured: { width: 500, height: 500 },
    internals: { positionAbsolute: { x: 0, y: 0 } },
  });
```

- [ ] **Step 2: 跑全文件确认仍绿**

Run: `pnpm --filter @flowweb/web test src/pages/canvas/components/nodes/ImageGenNode.test.tsx`
Expected: PASS

- [ ] **Step 3: 新增 Δ 定位用例（见红）**

在 'renders OutpaintSelectionOverlay when editMode is outpaint'（:463-470）之后追加（Δ 断言与 baseWidth 解耦，环境无关地证明绝对坐标生效）：

```tsx
  it('扩图选区悬浮层按 positionAbsolute 定位（打组后不错位）', () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id', editMode: 'outpaint' };
    const first = renderNode();
    const frame0 = document.querySelector('[data-testid="outpaint-frame"]') as HTMLElement;
    expect(frame0).toBeTruthy();
    const left0 = parseFloat(frame0.style.left);
    const top0 = parseFloat(frame0.style.top);
    first.unmount();

    mockUseInternalNode.mockReturnValue({
      position: { x: 0, y: 0 },
      measured: { width: 500, height: 500 },
      internals: { positionAbsolute: { x: 600, y: 400 } },
    });
    renderNode();
    const frame1 = document.querySelector('[data-testid="outpaint-frame"]') as HTMLElement;
    expect(parseFloat(frame1.style.left) - left0).toBe(600);
    expect(parseFloat(frame1.style.top) - top0).toBe(400);
  });
```

注：outpaint 初始化 effect（ImageGenNode.tsx:877）的 `setOutpaintRect` 值与 fallback 相同（均为 baseWidth×1.2 等），两次渲染常数抵消，Δ 稳定。若 CI 偶发偏差，在读取 style 前加一次 `await vi.waitFor(() => document.querySelector('[data-testid="outpaint-frame"]'))`。

- [ ] **Step 4: 跑测试确认红**

Run: `pnpm --filter @flowweb/web test src/pages/canvas/components/nodes/ImageGenNode.test.tsx`
Expected: FAIL — Δ 为 0（实现仍读相对坐标 position {0,0}）

- [ ] **Step 5: 实现（ImageGenNode.tsx 四处表达式替换）**

:1042-1043 替换为：

```tsx
          frameVpBottom={editMode === 'outpaint' && outpaintRect.width > 0 ? (internalNode?.internals?.positionAbsolute?.y ?? node.position.y) * zoom + vpY + (outpaintRect.y + outpaintRect.height) * zoom : undefined}
          frameVpCenterX={editMode === 'outpaint' && outpaintRect.width > 0 ? (internalNode?.internals?.positionAbsolute?.x ?? node.position.x) * zoom + vpX + (outpaintRect.x + outpaintRect.width / 2) * zoom : undefined}
```

:1220-1221 替换为：

```tsx
                  imageVpX={(internalNode?.internals?.positionAbsolute?.x ?? node.position.x) * zoom + vpX}
                  imageVpY={(internalNode?.internals?.positionAbsolute?.y ?? node.position.y) * zoom + vpY}
```

- [ ] **Step 6: 跑测试确认绿**

Run: `pnpm --filter @flowweb/web test src/pages/canvas/components/nodes/ImageGenNode.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx
git commit -m "fix(web): 扩图选区/扩图工具条坐标改用 positionAbsolute 修复打组错位"
```

---

### Task 10: 全量验证 + 浏览器验收

**Files:** 无新改动（如验收发现缺陷则修后补测）

- [ ] **Step 1: 全量单测 + 类型检查**

Run: `pnpm --filter @flowweb/web test`
Expected: PASS（全量）。若无关用例本来就红，记录并仅保证本次涉及文件全绿。

Run: `pnpm --filter @flowweb/web exec tsc -b`
Expected: 无错误（TypeScript strict）

- [ ] **Step 2: 浏览器手测（preview 工具，金路径）**

1. 启动 dev server，画布添加 2 个图片节点并加载图片
2. Shift+左键选定两节点 → 点击打组
3. `preview_inspect` 组框（`.react-flow__node-group`）与子图片节点：上边距 50px、左右下 20px
4. 拖动顶排图片向上：拖不动；向下/左右：可拖但不越过保留区
5. 打组后点击组内图片：工具条出现在图片正上方（非左上角）
6. 组内图片进扩图模式：选区悬浮层位置正确
7. 解组：工具条/选区位置正常、节点恢复原绝对位置
8. `preview_console_logs` 确认无新增报错；截图留证

- [ ] **Step 3: 如有修正，修复并补测试后提交；否则无额外 commit**

---

## Self-Review 记录

- **Spec 覆盖：** R1→Task 1；R2→Task 2+3；R3 七处→Task 4-9（ImageNodeToolbar/TextNode/Annotation/Edit/Transform/ImageGenNode×2）；验收→Task 10。无缺口。
- **占位符扫描：** 全部步骤含完整代码与期望输出，无 TBD/"适当处理"。
- **类型一致性：** `clampPositionToPadding(position, childSize, groupSize)` 在 Task 2 定义、Task 3 消费，签名一致；`GROUP_PADDING_TOP` Task 1 定义、Task 2 消费一致。
- **用户评审核验修订（2026-08-24）：** ①包名实为 `@flowweb/web`，全部测试/类型命令已改 `pnpm --filter @flowweb/web ...`；②Task 5 afterEach 追加 portal div 清理（防断言失败泄漏）；③Task 5/6 修复代码统一可选链+`?? 0` 兜底风格；④Task 9 补 Δ 稳定性备注（CI 偶发时用 vi.waitFor）。
