# 画布打组与分镜组 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画布节点打组（普通组）与图片宫格分镜组，含类型互转、局部撤销、BullMQ+sharp 拼接大图流水线。

**Architecture:** 方案 A——组是 `type:'group'` 的 xyflow 节点，子节点 `parentId` 挂靠（CanvasNode 表新增 parentId 列持久化），hidden 纯前端推导；后端拼接服务不理解组（fileIds+布局参数），BullMQ 队列 + sharp 合成 + Socket 推送。

**Tech Stack:** @xyflow/react 12 / Zustand 4 / React 18 / NestJS 10 / Prisma 5 / BullMQ / sharp 0.34 / Socket.io 4 / Vitest

**Spec:** `docs/superpowers/specs/2026-08-23-canvas-groups-design.md`（视觉规格见 spec 4.4/5.6，本文不重复）

**测试命令:** 前端 `cd apps/web && npx vitest run <file>`；后端 `cd apps/api && npx vitest run <file>`；TypeScript 严格检查 `cd apps/web && npx tsc --noEmit`

**约定:** 所有 canvasStore 组 actions 须双写 `useNodeStore.getState().addNode/deleteNode`（与现有 `addNode`/`deleteNode` 模式一致，见 canvasStore.ts:110-141/144-153）

---

## Phase 1：类型、纯函数与 parentId 持久化

### Task 1: groupLayout 纯函数与类型

**Files:**
- Create: `apps/web/src/types/group.ts`
- Create: `apps/web/src/utils/groupLayout.ts`
- Test: `apps/web/src/utils/groupLayout.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/utils/groupLayout.test.ts
import { describe, it, expect } from 'vitest';
import {
  calcDefaultGrid, calcStoryboardSize, calcStitchSize,
  sortNodesByPosition, calcGroupBounds, ASPECT_RATIO_MAP,
} from './groupLayout';

describe('calcDefaultGrid', () => {
  it.each([
    [1, { rows: 1, cols: 1 }], [2, { rows: 1, cols: 2 }],
    [4, { rows: 2, cols: 2 }], [5, { rows: 3, cols: 3 }],
    [9, { rows: 3, cols: 3 }], [10, { rows: 4, cols: 4 }],
    [16, { rows: 4, cols: 4 }], [17, { rows: 5, cols: 5 }],
    [25, { rows: 5, cols: 5 }], [26, { rows: 6, cols: 5 }],
  ])('count=%i → %o', (count, expected) => {
    expect(calcDefaultGrid(count)).toEqual(expected);
  });
});

describe('calcStoryboardSize', () => {
  it('2x2 16:9 → 642x362', () => {
    expect(calcStoryboardSize(2, 2, '16:9')).toEqual({
      width: 2 * 320 + 2, height: 2 * (320 / (16 / 9)) + 2,
      cellWidth: 320, cellHeight: 320 / (16 / 9),
    });
  });
  it('9:16 单格高 ≈568.9', () => {
    const { cellHeight } = calcStoryboardSize(1, 1, '9:16');
    expect(cellHeight).toBeCloseTo(568.89, 1);
  });
});

describe('calcStitchSize', () => {
  it('2K 2x2 16:9', () => {
    const cellWidth = (2048 - 2) / 2;
    expect(calcStitchSize(2, 2, '16:9', 2048)).toEqual({
      width: 2048, height: Math.round(2 * (cellWidth / (16 / 9)) + 2),
      cellWidth: Math.round(cellWidth), cellHeight: Math.round(cellWidth / (16 / 9)),
    });
  });
});

describe('sortNodesByPosition', () => {
  it('按 (x,y) 字典序（严格弱序）', () => {
    const nodes = [
      { id: 'a', positionX: 100, positionY: 50 },
      { id: 'b', positionX: 50, positionY: 999 },
      { id: 'c', positionX: 100, positionY: 10 },
    ];
    expect(sortNodesByPosition(nodes).map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('calcGroupBounds', () => {
  it('包围盒外扩 20px', () => {
    const bounds = calcGroupBounds([
      { x: 100, y: 200, width: 300, height: 150 },
      { x: 500, y: 100, width: 300, height: 150 },
    ]);
    expect(bounds).toEqual({ x: 80, y: 80, width: 740, height: 290 });
  });
});

describe('ASPECT_RATIO_MAP', () => {
  it('六比例齐全', () => {
    expect(Object.keys(ASPECT_RATIO_MAP)).toHaveLength(6);
    expect(ASPECT_RATIO_MAP['1:1']).toBe(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx vitest run src/utils/groupLayout.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```ts
// apps/web/src/types/group.ts
export type GroupType = 'normal' | 'storyboard';
export type AspectRatio = '21:9' | '16:9' | '9:16' | '3:4' | '4:3' | '1:1';
export type StitchResolution = '2K' | '4K';

export interface StoryboardConfig {
  aspectRatio: AspectRatio;
  gridRows: number;
  gridCols: number;
  showIndex: boolean;
  stitchResolution: StitchResolution;
}

export interface GroupNodeData extends Record<string, unknown> {
  groupType: GroupType;
  name?: string;
  collapsed?: boolean;
  cells?: (string | null)[]; // null = 空宫格占位
  storyboard?: StoryboardConfig;
}
```

```ts
// apps/web/src/utils/groupLayout.ts
import type { AspectRatio } from '@/types/group';

export const CELL_WIDTH = 320;
export const CELL_GAP = 2;
export const CONVERT_GAP = 40;
export const GROUP_PADDING = 20;

export const ASPECT_RATIO_MAP: Record<AspectRatio, number> = {
  '21:9': 21 / 9, '16:9': 16 / 9, '9:16': 9 / 16,
  '3:4': 3 / 4, '4:3': 4 / 3, '1:1': 1,
};

export const STITCH_WIDTH_MAP = { '2K': 2048, '4K': 3840 } as const;

export function calcDefaultGrid(count: number): { rows: number; cols: number } {
  if (count <= 1) return { rows: 1, cols: 1 };
  if (count === 2) return { rows: 1, cols: 2 };
  if (count <= 4) return { rows: 2, cols: 2 };
  if (count <= 9) return { rows: 3, cols: 3 };
  if (count <= 16) return { rows: 4, cols: 4 };
  if (count <= 25) return { rows: 5, cols: 5 };
  const rows = Math.ceil(Math.sqrt(count));
  return { rows, cols: Math.ceil(count / rows) };
}

export function calcStoryboardSize(rows: number, cols: number, ratio: AspectRatio) {
  const cellWidth = CELL_WIDTH;
  const cellHeight = cellWidth / ASPECT_RATIO_MAP[ratio];
  return {
    width: cols * cellWidth + (cols - 1) * CELL_GAP,
    height: rows * cellHeight + (rows - 1) * CELL_GAP,
    cellWidth, cellHeight,
  };
}

export function calcStitchSize(rows: number, cols: number, ratio: AspectRatio, targetWidth: number) {
  const cellWidth = (targetWidth - (cols - 1) * CELL_GAP) / cols;
  const cellHeight = cellWidth / ASPECT_RATIO_MAP[ratio];
  return {
    width: targetWidth,
    height: Math.round(rows * cellHeight + (rows - 1) * CELL_GAP),
    cellWidth: Math.round(cellWidth), cellHeight: Math.round(cellHeight),
  };
}

export function sortNodesByPosition<T extends { positionX: number; positionY: number }>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) =>
    a.positionX - b.positionX || a.positionY - b.positionY);
}

export function calcGroupBounds(items: { x: number; y: number; width: number; height: number }[]) {
  const minX = Math.min(...items.map((i) => i.x)) - GROUP_PADDING;
  const minY = Math.min(...items.map((i) => i.y)) - GROUP_PADDING;
  const maxX = Math.max(...items.map((i) => i.x + i.width)) + GROUP_PADDING;
  const maxY = Math.max(...items.map((i) => i.y + i.height)) + GROUP_PADDING;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && npx vitest run src/utils/groupLayout.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/types/group.ts apps/web/src/utils/groupLayout.ts apps/web/src/utils/groupLayout.test.ts
git commit -m "feat(web): add group layout pure functions (TD-Group step 1)"
```

---

### Task 2: CanvasNode.parentId 列 + syncNodes 透传（后端）

**Files:**
- Modify: `apps/api/prisma/schema.prisma:173-186`（CanvasNode 模型）
- Modify: `apps/api/src/modules/project/project.service.ts:83-98`（syncNodes）
- Test: `apps/api/src/modules/project/project.service.spec.ts`（扩展）

- [ ] **Step 1: 写失败测试**

在 `project.service.spec.ts` 的 `describe('syncNodes', ...)` 内追加：

```ts
it('persists parentId; parentless nodes written first (self-FK insert order)', async () => {
  await service.syncNodes('p1', [
    // 故意乱序：子节点在前 —— 实现须排序（无 parentId 先写）
    { id: 'n1', type: 'imageGen', position: { x: 10, y: 10 }, data: {}, parentId: 'g1' },
    { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: {} },
  ]);
  expect(prisma.canvasNode.createMany).toHaveBeenCalledWith({
    data: [
      expect.objectContaining({ id: 'g1', parentId: null }),
      expect.objectContaining({ id: 'n1', parentId: 'g1' }),
    ],
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/api && npx vitest run src/modules/project/project.service.spec.ts`
Expected: FAIL（parentId 未存）

- [ ] **Step 3: 写实现**

schema.prisma CanvasNode 模型追加（对齐项目 Folder/MaterialFolder 自引用惯例，schema.prisma:159-170/339-355；`SetNull` = 删组节点时子节点保留为独立节点，与 ungroup 语义一致）：

```prisma
  parentId    String?
  parent      CanvasNode?  @relation("CanvasNodeChildren", fields: [parentId], references: [id], onDelete: SetNull)
  children    CanvasNode[] @relation("CanvasNodeChildren")

  @@index([parentId])
```

（`@@index([projectId])` 已存在，`@@index([parentId])` 追加其后。不加 `@db.VarChar`——项目自引用惯例 Folder.parentId 无长度约束，cuid 为 25 字符，加长度约束反而不符现有风格。）

project.service.ts `syncNodes`：映射加 `parentId`，且 createMany 前排序——无 parentId 的节点先写（自引用外键下，若 Prisma 把 createMany 拆成多条 INSERT，子先于父插入会触发外键错误；排序是廉价保险）：

```ts
    const sorted = [...nodes].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
    await this.prisma.canvasNode.createMany({
      data: sorted.map((n: any) => ({
        id: n.id,
        projectId,
        type: n.type,
        position: n.position,
        data: n.data,
        width: n.width ?? 280,
        height: n.height ?? 120,
        parentId: n.parentId ?? null,
      })),
    });
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/api && npx vitest run src/modules/project/project.service.spec.ts`
Expected: PASS

- [ ] **Step 5: 执行迁移**

Run: `cd apps/api && npx prisma migrate dev --name add-canvas-node-parent-id`
Expected: 迁移成功，`prisma/migrations/` 新目录生成。（注意：migrate dev 需要一次性 CREATEDB 授权的数据库用户，见项目记忆 prisma_migrate_history_broken）

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma apps/api/src/modules/project
git commit -m "feat(api): persist CanvasNode.parentId (TD-Group step 2)"
```

---

### Task 3: 前端 hidden 推导 + hydrate 接入

**Files:**
- Create: `apps/web/src/utils/groupDerive.ts`
- Test: `apps/web/src/utils/groupDerive.test.ts`
- Modify: `apps/web/src/stores/canvasStore.ts`（新增 applyGroupDerivations action）

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/utils/groupDerive.test.ts
import { describe, it, expect } from 'vitest';
import { deriveHidden, repairStoryboardCells } from './groupDerive';

const group = (over: Record<string, unknown> = {}) => ({
  id: 'g1', type: 'group',
  data: { groupType: 'storyboard', ...over },
});

describe('deriveHidden', () => {
  it('parentId 指向分镜组 → 节点 hidden', () => {
    const { nodes } = deriveHidden(
      [group() as any, { id: 'n1', parentId: 'g1' } as any],
      [] as any,
    );
    expect(nodes.find((n) => n.id === 'n1')?.hidden).toBe(true);
  });

  it('parentId 指向 collapsed 普通组 → 节点 hidden', () => {
    const { nodes } = deriveHidden(
      [group({ groupType: 'normal', collapsed: true }) as any, { id: 'n1', parentId: 'g1' } as any],
      [] as any,
    );
    expect(nodes.find((n) => n.id === 'n1')?.hidden).toBe(true);
  });

  it('展开的普通组子节点不 hidden', () => {
    const { nodes } = deriveHidden(
      [group({ groupType: 'normal', collapsed: false }) as any, { id: 'n1', parentId: 'g1' } as any],
      [] as any,
    );
    expect(nodes.find((n) => n.id === 'n1')?.hidden).toBe(false);
  });

  it('任一端 hidden 的边 → 边 hidden', () => {
    const { edges } = deriveHidden(
      [group() as any, { id: 'n1', parentId: 'g1' } as any, { id: 'n2' } as any],
      [{ id: 'e1', source: 'n1', target: 'n2' }, { id: 'e2', source: 'n2', target: 'n2' }],
    );
    expect(edges.find((e) => e.id === 'e1')?.hidden).toBe(true);
    expect(edges.find((e) => e.id === 'e2')?.hidden).toBe(false);
  });
});

describe('repairStoryboardCells（cells/parentId 一致性守卫）', () => {
  it('子节点不在 cells 中 → 移出组并给绝对坐标（不堆叠原点）', () => {
    const g = { id: 'g1', type: 'group', position: { x: 500, y: 500 }, width: 642, height: 182,
      data: { groupType: 'storyboard', cells: ['a'] } };
    const stray = { id: 'stray', parentId: 'g1', extent: 'parent', position: { x: 0, y: 0 } };
    const { nodes } = repairStoryboardCells([
      g as any, { id: 'a', parentId: 'g1' } as any, stray as any,
    ] as any) as any;
    const s = nodes.find((n: any) => n.id === 'stray')!;
    expect(s.parentId).toBeUndefined();
    expect(s.extent).toBeUndefined();
    expect(s.position.x).toBeGreaterThanOrEqual(500); // 绝对坐标 = 组位置 + 偏移
    expect(s.position.y).toBeGreaterThanOrEqual(500 + 182); // 排在组下方
  });

  it('cells 与子节点一致 → 原样返回', () => {
    const input = [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 },
        data: { groupType: 'storyboard', cells: ['a'] } },
      { id: 'a', parentId: 'g1', position: { x: 0, y: 0 } },
    ] as any;
    expect(repairStoryboardCells(input)).toEqual(input);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx vitest run src/utils/groupDerive.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```ts
// apps/web/src/utils/groupDerive.ts
import type { Node, Edge } from '@xyflow/react';

/** hidden 推导规则单一来源（spec 3.3）：不持久化，每次全量推导 */
export function deriveHidden(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const groupHidden = new Map<string, boolean>();
  for (const n of nodes) {
    if (n.type === 'group') {
      const d = n.data as { groupType?: string; collapsed?: boolean };
      groupHidden.set(n.id, d?.groupType === 'storyboard' || d?.collapsed === true);
    }
  }
  const nextNodes = nodes.map((n) => ({
    ...n,
    hidden: n.parentId ? (groupHidden.get(n.parentId) ?? false) : false,
  }));
  const nodeHidden = new Map(nextNodes.map((n) => [n.id, n.hidden]));
  const nextEdges = edges.map((e) => ({
    ...e,
    hidden: (nodeHidden.get(e.source) ?? false) || (nodeHidden.get(e.target) ?? false),
  }));
  return { nodes: nextNodes, edges: nextEdges };
}
```

groupDerive.ts 追加一致性守卫（分镜组子节点纯 DOM 宫格渲染、position 无意义——若因 bug 脱离 cells 须移出组并给绝对坐标，否则堆叠画布原点不可见）：

```ts
/** 一致性守卫：分镜组 children 必须同时在 cells 中；多余子节点移出组（绝对坐标排在组下方） */
export function repairStoryboardCells(nodes: Node[]): Node[] {
  const storyboardGroups = new Map<string, Node>();
  for (const n of nodes) {
    if (n.type === 'group' && (n.data as any)?.groupType === 'storyboard') storyboardGroups.set(n.id, n);
  }
  let overflow = 0;
  return nodes.map((n) => {
    const g = n.parentId ? storyboardGroups.get(n.parentId) : undefined;
    if (!g) return n;
    const cells = ((g.data as any).cells ?? []) as string[];
    if (cells.includes(n.id)) return n;
    const i = overflow++;
    return { ...n, parentId: undefined, extent: undefined,
      position: { x: g.position.x + i * 360, y: g.position.y + (g.height ?? 0) + 20 } };
  });
}
```

canvasStore 新增 action（接口与实现）：

```ts
// CanvasState 接口追加：
applyGroupDerivations: () => void;

// create() 实现追加（守卫先行，再推导 hidden）：
applyGroupDerivations: () => {
  set((s) => {
    const repaired = repairStoryboardCells(s.nodes as any);
    return deriveHidden(repaired, s.edges as any);
  });
},
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && npx vitest run src/utils/groupDerive.test.ts`
Expected: PASS

- [ ] **Step 5: hydrate 接入**

在项目加载 hydrate 完成处（`apps/web/src/pages/canvas/page.tsx` 中 `getProject` 返回后 `setNodes`/`setEdges` 的 effect 末尾，以及 `canvasStore.ts` 所有修改 nodes 结构的组 actions 内部末尾）调用 `get().applyGroupDerivations()`。定位方式：`grep -n "getProject" apps/web/src/pages/canvas/page.tsx`。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/utils/groupDerive.ts apps/web/src/utils/groupDerive.test.ts apps/web/src/stores/canvasStore.ts apps/web/src/pages/canvas/page.tsx
git commit -m "feat(web): hidden derivation for group children (TD-Group step 3)"
```

---

## Phase 2：普通组

### Task 4: canvasStore 组核心 actions（groupNodes / ungroup / addToGroup / removeNodeFromGroup）

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts`（接口 + 实现）
- Test: `apps/web/src/stores/canvasStore.groups.test.ts`

- [ ] **Step 1: 写失败测试（真实 Zustand store）**

```ts
// apps/web/src/stores/canvasStore.groups.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';

const seedNodes = () => [
  { id: 'n1', type: 'imageGen', position: { x: 100, y: 100 }, width: 300, height: 200, data: {} },
  { id: 'n2', type: 'textInput', position: { x: 500, y: 50 }, width: 300, height: 300, data: {} },
  { id: 'free', type: 'imageGen', position: { x: 2000, y: 2000 }, width: 300, height: 200, data: {} },
];

beforeEach(() => {
  useCanvasStore.setState({ nodes: seedNodes() as any, edges: [], selectedId: null });
});

describe('groupNodes', () => {
  it('创建组节点并挂靠子节点（相对坐标 + extent）', () => {
    const groupId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    const s = useCanvasStore.getState();
    const group = s.nodes.find((n) => n.id === groupId)!;
    expect(group.type).toBe('group');
    expect(group.data.groupType).toBe('normal');
    // 包围盒 = (80,30) ~ (820,370)（外扩20px）
    expect(group.position).toEqual({ x: 80, y: 30 });
    expect(group.width).toBe(740);
    expect(group.height).toBe(340);
    const child1 = s.nodes.find((n) => n.id === 'n1')!;
    expect(child1.parentId).toBe(groupId);
    expect(child1.extent).toBe('parent');
    expect(child1.position).toEqual({ x: 20, y: 70 }); // 相对组左上角
  });

  it('选中含 group 节点时抛错（禁止嵌套）', () => {
    const g1 = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    expect(() => useCanvasStore.getState().groupNodes(['free', g1])).toThrow(/嵌套/);
  });

  it('少于 2 个节点抛错', () => {
    expect(() => useCanvasStore.getState().groupNodes(['n1'])).toThrow(/至少/);
  });
});

describe('ungroup', () => {
  it('坐标转绝对、组节点删除', () => {
    const groupId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().ungroup(groupId);
    const s = useCanvasStore.getState();
    expect(s.nodes.find((n) => n.id === groupId)).toBeUndefined();
    const child1 = s.nodes.find((n) => n.id === 'n1')!;
    expect(child1.parentId).toBeUndefined();
    expect(child1.position).toEqual({ x: 100, y: 100 }); // 回到原始绝对坐标
  });

  it('分镜组解组：按 cells 网格重排，{0,0} 子节点不堆叠（spec 5.3 解组=转普通组布局+删组节点）', () => {
    // 手工播种分镜组（mergeStoryboard 在 Task 10 才实现）：子节点坐标 {0,0}（纯 DOM 宫格）
    useCanvasStore.setState({
      nodes: [
        { id: 'sg', type: 'group', position: { x: 500, y: 500 }, width: 642, height: 182, data: {
          groupType: 'storyboard', cells: ['c1', 'c2'],
          storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' },
        } },
        { id: 'c1', type: 'imageGen', parentId: 'sg', extent: 'parent', position: { x: 0, y: 0 }, width: 320, height: 180, data: { status: 'done', fileId: 'f1' } },
        { id: 'c2', type: 'imageGen', parentId: 'sg', extent: 'parent', position: { x: 0, y: 0 }, width: 320, height: 180, data: { status: 'done', fileId: 'f2' } },
      ] as any,
      edges: [], selectedId: null,
    });
    useCanvasStore.getState().ungroup('sg');
    const s = useCanvasStore.getState();
    expect(s.nodes.find((n) => n.id === 'sg')).toBeUndefined();
    const c1 = s.nodes.find((n) => n.id === 'c1')!;
    const c2 = s.nodes.find((n) => n.id === 'c2')!;
    expect(c1.position).toEqual({ x: 500, y: 500 }); // 组位置 + 网格相对坐标（第 1 列 = 0）
    expect(c2.position.x).toBe(500 + 320 + 40); // 第 2 列 = 组位置 + (320+40)
    expect(c2.position.y).toBe(500);
    expect(c1.parentId).toBeUndefined();
  });
});

describe('addToGroup / removeNodeFromGroup', () => {
  it('addToGroup 后子节点相对坐标正确、组框扩展', () => {
    const groupId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().addToGroup(groupId, 'free');
    const s = useCanvasStore.getState();
    const free = s.nodes.find((n) => n.id === 'free')!;
    expect(free.parentId).toBe(groupId);
    expect(free.position.x).toBe(2000 - 80); // 绝对 - 组左上角
    expect(s.nodes.find((n) => n.id === groupId)!.width).toBeGreaterThan(740); // 扩展
  });

  it('removeNodeFromGroup 坐标转绝对', () => {
    const groupId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().removeNodeFromGroup(groupId, 'n1');
    const s = useCanvasStore.getState();
    const n1 = s.nodes.find((n) => n.id === 'n1')!;
    expect(n1.parentId).toBeUndefined();
    expect(n1.position).toEqual({ x: 100, y: 100 });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx vitest run src/stores/canvasStore.groups.test.ts`
Expected: FAIL（groupNodes 不存在）

- [ ] **Step 3: 写实现（canvasStore 接口 + 实现）**

```ts
// CanvasState 接口追加：
groupNodes: (nodeIds: string[]) => string;
ungroup: (groupId: string) => void;
addToGroup: (groupId: string, nodeId: string) => void;
removeNodeFromGroup: (groupId: string, nodeId: string) => void;
toggleCollapse: (groupId: string) => void;
```

```ts
// create() 实现追加：
groupNodes: (nodeIds) => {
  const s = get();
  const picked = s.nodes.filter((n) => nodeIds.includes(n.id));
  if (picked.length < 2) throw new Error('打组至少需要 2 个节点');
  if (picked.some((n) => n.type === 'group')) throw new Error('组不支持嵌套');
  const id = getId('node'); // 提前生成（P1-新5）：T15 撤销接入需在 action 入口 capture 时即纳入新 id
  const bounds = calcGroupBounds(picked.map((n) => ({
    x: n.position.x, y: n.position.y,
    width: n.width ?? 280, height: n.height ?? 120,
  })));
  const groupNode: Node = {
    id, type: 'group',
    position: { x: bounds.x, y: bounds.y },
    width: bounds.width, height: bounds.height,
    data: { groupType: 'normal', name: `分组 ${picked.length} 个节点` },
    selected: true,
  };
  set((st) => ({
    nodes: [
      ...st.nodes.map((n) => nodeIds.includes(n.id)
        ? { ...n, selected: false, parentId: id, extent: 'parent' as const,
            position: { x: n.position.x - bounds.x, y: n.position.y - bounds.y } }
        : { ...n, selected: false }),
      groupNode,
    ],
    selectedId: id,
  }));
  useNodeStore.getState().addNode({ id, type: 'group', position: groupNode.position, data: groupNode.data });
  get().applyGroupDerivations();
  return id;
},

ungroup: (groupId) => {
  const s = get();
  const group = s.nodes.find((n) => n.id === groupId);
  if (!group) return;
  const gd = group.data as any;
  const gp = group.position;
  if (gd.groupType === 'storyboard') {
    // 分镜组解组 = 转普通组布局 + 删组节点（spec 5.3）：先按 cells 网格重排相对坐标，
    // 再走下方通用解组转绝对——否则 {0,0} 子节点全部堆叠在组左上角
    const cfg = gd.storyboard;
    const cellH = CELL_WIDTH / ASPECT_RATIO_MAP[cfg.aspectRatio];
    set((st) => ({
      nodes: st.nodes.map((n) => {
        const idx = (gd.cells ?? []).indexOf(n.id);
        if (idx === -1 || n.parentId !== groupId) return n;
        const row = Math.floor(idx / cfg.gridCols), col = idx % cfg.gridCols;
        return { ...n, width: CELL_WIDTH, height: Math.round(cellH),
          position: { x: col * (CELL_WIDTH + CONVERT_GAP), y: row * (Math.round(cellH) + CONVERT_GAP) } };
      }),
    }));
  }
  set((st) => ({
    nodes: st.nodes
      .filter((n) => n.id !== groupId)
      .map((n) => n.parentId === groupId
        ? { ...n, parentId: undefined, extent: undefined,
            position: { x: n.position.x + gp.x, y: n.position.y + gp.y } }
        : n),
    selectedId: st.selectedId === groupId ? null : st.selectedId,
  }));
  useNodeStore.getState().deleteNode(groupId);
  get().applyGroupDerivations();
},

addToGroup: (groupId, nodeId) => {
  const s = get();
  const group = s.nodes.find((n) => n.id === groupId);
  const node = s.nodes.find((n) => n.id === nodeId);
  if (!group || !node || node.type === 'group') return;
  const gp = group.position;
  set((st) => {
    const child = {
      ...node, parentId: groupId, extent: 'parent' as const,
      position: { x: node.position.x - gp.x, y: node.position.y - gp.y },
    };
    const siblings = st.nodes.filter((n) => n.parentId === groupId || n.id === nodeId);
    const bounds = calcGroupBounds(siblings.map((n) => ({
      x: (n.id === nodeId ? child.position.x : n.position.x) + gp.x,
      y: (n.id === nodeId ? child.position.y : n.position.y) + gp.y,
      width: n.width ?? 280, height: n.height ?? 120,
    })));
    return {
      nodes: st.nodes.map((n) => {
        if (n.id === nodeId) return child;
        if (n.id === groupId) return { ...n, position: { x: bounds.x, y: bounds.y }, width: bounds.width, height: bounds.height };
        return n;
      }),
    };
  });
  get().applyGroupDerivations();
},

removeNodeFromGroup: (groupId, nodeId) => {
  const s = get();
  const group = s.nodes.find((n) => n.id === groupId);
  if (!group) return;
  const gp = group.position;
  set((st) => ({
    nodes: st.nodes.map((n) => n.parentId === groupId && n.id === nodeId
      ? { ...n, parentId: undefined, extent: undefined,
          position: { x: n.position.x + gp.x, y: n.position.y + gp.y } }
      : n),
  }));
  get().applyGroupDerivations();
},

toggleCollapse: (groupId) => {
  set((st) => ({
    nodes: st.nodes.map((n) => n.id === groupId
      ? { ...n, data: { ...n.data, collapsed: !(n.data as any).collapsed },
          // 折叠→紧凑卡片；展开尺寸不存节点顶层（刷新丢失），展开后 refitGroupBounds 按子节点包围盒重算
          ...(!(n.data as any).collapsed ? { width: 200, height: 64 } : {}) }
      : n),
  }));
  if (get().nodes.find((n) => n.id === groupId && !(n.data as any).collapsed)) {
    get().refitGroupBounds(groupId); // 展开态恢复尺寸
  }
  get().applyGroupDerivations();
},

// 接口追加：refitGroupBounds: (groupId: string) => void;
refitGroupBounds: (groupId) => {
  const s = get();
  const group = s.nodes.find((n) => n.id === groupId);
  if (!group) return;
  const gp = group.position;
  const children = s.nodes.filter((n) => n.parentId === groupId);
  if (children.length === 0) return;
  const bounds = calcGroupBounds(children.map((n) => ({
    x: n.position.x + gp.x, y: n.position.y + gp.y,
    width: n.width ?? 280, height: n.height ?? 120,
  })));
  set((st) => ({
    nodes: st.nodes.map((n) => n.id === groupId
      ? { ...n, position: { x: bounds.x, y: bounds.y }, width: bounds.width, height: bounds.height }
      : n),
  }));
},
```

头部补导入：`import { calcGroupBounds, CELL_WIDTH, CONVERT_GAP, ASPECT_RATIO_MAP } from '@/utils/groupLayout';`

**hydrate 尺寸修复（P0-4）**：折叠时组节点 width/height（200x64）会随 syncNodes 持久化；若用户展开后、下一次 sync 前刷新页面，库中仍是 200x64，展开的组会渲染成小框。在 Task 3 Step 5 定位的 hydrate effect 中，`applyGroupDerivations()` 之后追加：

```ts
    // 折叠尺寸可能被持久化污染：展开态普通组按子节点包围盒重算（P0-4）
    for (const g of useCanvasStore.getState().nodes.filter(
      (n) => n.type === 'group' && (n.data as any).groupType === 'normal' && !(n.data as any).collapsed,
    )) {
      useCanvasStore.getState().refitGroupBounds(g.id);
    }
```

（`collapsed:true` 持久化的 200x64 即折叠卡片正确尺寸，不处理；分镜组尺寸由公式在每次变更时重算，持久化值可信。）

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && npx vitest run src/stores/canvasStore.groups.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.groups.test.ts
git commit -m "feat(web): group/ungroup/addToGroup/removeNode canvasStore actions (TD-Group step 4)"
```

---

### Task 5: GroupNode 组件注册 + NormalGroupRenderer

**Files:**
- Create: `apps/web/src/pages/canvas/components/groups/GroupNode.tsx`
- Create: `apps/web/src/pages/canvas/components/groups/NormalGroupRenderer.tsx`
- Test: `apps/web/src/pages/canvas/components/groups/NormalGroupRenderer.test.tsx`
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx:24-31`（nodeTypes）

- [ ] **Step 1: 写失败测试**

```tsx
// NormalGroupRenderer.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NormalGroupRenderer } from './NormalGroupRenderer';

const baseData = { groupType: 'normal', name: '分组 2 个节点' };

describe('NormalGroupRenderer', () => {
  it('渲染组名标签', () => {
    render(<NormalGroupRenderer data={baseData as any} />);
    expect(screen.getByText('分组 2 个节点')).toBeTruthy();
  });

  it('折叠态渲染紧凑卡片（200x64 + 节点数）', () => {
    render(<NormalGroupRenderer data={{ ...baseData, collapsed: true } as any} />);
    expect(screen.getByText(/2 个节点/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/groups/NormalGroupRenderer.test.tsx`
Expected: FAIL

- [ ] **Step 3: 写实现**

```tsx
// GroupNode.tsx
import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { NormalGroupRenderer } from './NormalGroupRenderer';
import { StoryboardGroupRenderer } from './StoryboardGroupRenderer';

function GroupNodeComponent({ id, data, selected }: NodeProps) {
  if ((data as any).groupType === 'storyboard') {
    return <StoryboardGroupRenderer id={id} data={data as any} selected={!!selected} />;
  }
  return <NormalGroupRenderer data={data as any} selected={!!selected} />;
}
export const GroupNode = memo(GroupNodeComponent);
```

```tsx
// NormalGroupRenderer.tsx
import { memo } from 'react';
import type { GroupNodeData } from '@/types/group';

interface Props { data: GroupNodeData; selected: boolean }

function NormalGroupRendererComponent({ data, selected }: Props) {
  if (data.collapsed) {
    return (
      <div
        style={{
          width: 200, height: 64, borderRadius: 8,
          border: `1px solid ${selected ? '#4ade80' : '#4a4a4a'}`,
          background: 'rgba(26,26,26,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#999999', fontSize: 13,
        }}
      >
        {data.name ?? '分组'}
      </div>
    );
  }
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        style={{
          position: 'absolute', inset: 0, borderRadius: 8,
          border: `1px solid ${selected ? '#4ade80' : '#4a4a4a'}`,
          background: 'rgba(26,26,26,0.6)', pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute', top: -10, left: 8, padding: '0 6px',
          background: '#0a0a0a', color: '#999999', fontSize: 12, whiteSpace: 'nowrap',
        }}
      >
        {data.name ?? '分组'}
      </div>
    </div>
  );
}
export const NormalGroupRenderer = memo(NormalGroupRendererComponent);
```

CanvasView.tsx nodeTypes 追加 `group: GroupNode`，并补 import。

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/groups/NormalGroupRenderer.test.tsx && npx vitest run src/pages/canvas/components/CanvasView.test.tsx`
Expected: PASS（注意 StoryboardGroupRenderer 尚未创建，GroupNode.tsx 顶层 import 会失败——本任务先在 GroupNode 中用条件懒引入或先创建占位文件并在 Task 10 替换为完整实现；选择：本任务直接创建最小占位 StoryboardGroupRenderer（返回 null 的 div），Task 10 重写）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/groups apps/web/src/pages/canvas/components/CanvasView.tsx
git commit -m "feat(web): group node registration + normal group renderer (TD-Group step 5)"
```

---

### Task 6: MultiSelectToolbar（打组入口 + 置灰）

**Files:**
- Create: `apps/web/src/pages/canvas/components/groups/MultiSelectToolbar.tsx`
- Test: `apps/web/src/pages/canvas/components/groups/MultiSelectToolbar.test.tsx`
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx`（ReactFlow 内渲染）

- [ ] **Step 1: 写失败测试**

```tsx
// MultiSelectToolbar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MultiSelectToolbar } from './MultiSelectToolbar';

const mk = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, data, selected: true }) as any;

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (sel: any) => sel({
    nodes: [
      mk('n1', 'imageGen', { status: 'done', fileId: 'f1' }),
      mk('n2', 'textInput'),
    ],
  }),
}));

describe('MultiSelectToolbar', () => {
  it('多选 ≥2 时显示打组按钮', () => {
    render(<MultiSelectToolbar />);
    expect(screen.getByText(/打组/)).toBeTruthy();
  });

  it('点击打组调用 groupNodes', () => {
    const spy = vi.fn();
    render(<MultiSelectToolbar onGroup={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /打组/ }));
    expect(spy).toHaveBeenCalledWith(['n1', 'n2']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/groups/MultiSelectToolbar.test.tsx`
Expected: FAIL

- [ ] **Step 3: 写实现**

```tsx
// MultiSelectToolbar.tsx
import { memo, useState, useCallback } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { isImageCompletedNode } from '@/utils/imageNodeGuards';
import { Tooltip } from 'antd';

interface Props { onGroup?: (ids: string[]) => void; onMergeStoryboard?: (ids: string[]) => void }

function MultiSelectToolbarComponent({ onGroup, onMergeStoryboard }: Props) {
  const [open, setOpen] = useState(false);
  const selected = useCanvasStore((s) => s.nodes.filter((n) => n.selected));
  const groupNodes = useCanvasStore((s) => s.groupNodes);
  const mergeStoryboard = useCanvasStore((s) => s.mergeStoryboard);

  const handleGroup = useCallback(() => {
    const ids = selected.map((n) => n.id);
    (onGroup ?? groupNodes)(ids);
    setOpen(false);
  }, [selected, onGroup, groupNodes]);

  const handleMerge = useCallback(() => {
    const ids = selected.map((n) => n.id);
    (onMergeStoryboard ?? mergeStoryboard)(ids);
    setOpen(false);
  }, [selected, onMergeStoryboard, mergeStoryboard]);

  if (selected.length < 2) return null;
  const hasGroup = selected.some((n) => n.type === 'group');
  const allImage = selected.every((n) => isImageCompletedNode(n));

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20"
      style={{ background: 'rgba(0,0,0,0.85)', borderRadius: 20, padding: '8px 16px', height: 40,
               display: 'flex', alignItems: 'center', gap: 12, color: '#fff', fontSize: 13 }}>
      <span>已选 {selected.length} 个节点</span>
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
            <Tooltip title={allImage ? '' : '分镜组仅支持含完成图片的节点'}>
              <button disabled={!allImage} onClick={handleMerge}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                         background: 'none', border: 'none', color: allImage ? '#fff' : '#666', cursor: allImage ? 'pointer' : 'not-allowed' }}>
                合并分镜组（Ctrl+Alt+G）
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}
export const MultiSelectToolbar = memo(MultiSelectToolbarComponent);
```

CanvasView.tsx 在 `<CanvasToolbar ...>` 旁渲染 `<MultiSelectToolbar />`（ReactFlow 组件内）。

依赖：`isImageCompletedNode` 在本任务先创建（Task 10 复用）：

```ts
// apps/web/src/utils/imageNodeGuards.ts
import type { Node } from '@xyflow/react';

/** spec 5.1：含完成图片节点判定（imageGen/imageExtGen: done+fileId；multiImageGen: images 有 success） */
export function isImageCompletedNode(node: Node): boolean {
  const d = node.data as any;
  if (node.type === 'imageGen' || node.type === 'imageExtGen') {
    return d?.status === 'done' && !!d?.fileId;
  }
  if (node.type === 'multiImageGen') {
    return Array.isArray(d?.images) && d.images.some((i: any) => i?.status === 'success');
  }
  return false;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/groups/MultiSelectToolbar.test.tsx`
Expected: PASS（注意 antd Tooltip 在 jsdom 的问题参考记忆 antd5_testing_quirks；若崩溃用 title 属性替代 Tooltip）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/groups apps/web/src/utils/imageNodeGuards.ts apps/web/src/pages/canvas/components/CanvasView.tsx
git commit -m "feat(web): multi-select toolbar with group dropdown (TD-Group step 6)"
```

---

### Task 7: GroupToolbar（普通组 4 按钮 + 折叠）

**Files:**
- Create: `apps/web/src/pages/canvas/components/groups/GroupToolbar.tsx`
- Test: `apps/web/src/pages/canvas/components/groups/GroupToolbar.test.tsx`
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// GroupToolbar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GroupToolbar } from './GroupToolbar';

const baseProps = {
  groupId: 'g1',
  groupType: 'normal' as const,
  collapsed: false,
  executing: false,
  onCollapse: vi.fn(), onExecute: vi.fn(), onUngroup: vi.fn(), onConvert: vi.fn(),
};

describe('GroupToolbar（普通组）', () => {
  it('渲染 4 按钮', () => {
    render(<GroupToolbar {...baseProps} />);
    expect(screen.getByRole('button', { name: /折叠/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /整组执行/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /转分镜组/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /解组/ })).toBeTruthy();
  });

  it('执行中禁用结构变更按钮', () => {
    render(<GroupToolbar {...baseProps} executing />);
    expect((screen.getByRole('button', { name: /解组/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /转分镜组/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /折叠/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('点击折叠触发 onCollapse', () => {
    render(<GroupToolbar {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /折叠/ }));
    expect(baseProps.onCollapse).toHaveBeenCalledWith('g1');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/groups/GroupToolbar.test.tsx`
Expected: FAIL

- [ ] **Step 3: 写实现**

```tsx
// GroupToolbar.tsx — 普通组与分镜组共用容器；分镜组工具栏内容在 Task 11 扩展本组件（switch 渲染）
import { memo } from 'react';

interface Props {
  groupId: string;
  groupType: 'normal' | 'storyboard';
  collapsed: boolean;
  executing: boolean;
  onCollapse: (id: string) => void;
  onExecute: (id: string) => void;
  onUngroup: (id: string) => void;
  onConvert: (id: string, target: 'normal' | 'storyboard') => void;
  children?: React.ReactNode; // 分镜组专属按钮插槽（Task 11）
}

const btn = (disabled?: boolean): React.CSSProperties => ({
  background: 'none', border: 'none', color: disabled ? '#666' : '#fff',
  padding: '6px 10px', borderRadius: 6, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
});

function GroupToolbarComponent(p: Props) {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20"
      style={{ background: 'rgba(0,0,0,0.85)', borderRadius: 20, padding: '8px 16px', height: 40,
               display: 'flex', alignItems: 'center', gap: 2, color: '#fff' }}>
      {p.groupType === 'normal' && (
        <>
          <button style={btn()} onClick={() => p.onCollapse(p.groupId)}>{p.collapsed ? '展开' : '折叠'}</button>
          <Sep />
          <button style={btn(p.executing)} onClick={() => !p.executing && p.onExecute(p.groupId)}>▶ 整组执行</button>
          <Sep />
          <ConvertButton p={p} />
          <Sep />
          <button style={btn(p.executing)} onClick={() => !p.executing && p.onUngroup(p.groupId)}>⧉ 解组</button>
        </>
      )}
      {p.groupType === 'storyboard' && p.children}
    </div>
  );
}

function ConvertButton({ p }: { p: Props }) {
  return <button style={btn(p.executing)} onClick={() => !p.executing && p.onConvert(p.groupId, 'storyboard')}>▦ 转分镜组</button>;
}

const Sep = () => <span style={{ color: 'rgba(255,255,255,0.1)', padding: '0 4px' }}>│</span>;

export const GroupToolbar = memo(GroupToolbarComponent);
```

CanvasView.tsx 渲染：选中的 `type:'group'` 节点存在时渲染 `<GroupToolbar>`，props 从 canvasStore 取该组节点（collapsed、组类型）+ `hasActiveProcessInGroup(groupId)`（Task 17 实现，本任务先以 `false` 接线）。折叠/解组/转换分别接 `toggleCollapse`/`ungroup`/`convertGroup`（convertGroup 在 Task 10 实现前先接线为 no-op 断言不报错——**本任务把转分镜组按钮 disabled 直到 Task 10 完成后再启用**，避免悬空调用）。

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/groups/GroupToolbar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/groups apps/web/src/pages/canvas/components/CanvasView.tsx
git commit -m "feat(web): group toolbar with collapse/execute/convert/ungroup (TD-Group step 7)"
```

---

### Task 8: 拖入组（onNodeDragStop）+ 移出组

**Files:**
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx`（onNodeDragStop）
- Modify: `apps/web/src/stores/canvasStore.ts`（addToGroup 已在 Task 4 实现，此处复用）
- Test: `apps/web/src/stores/canvasStore.dropIntoGroup.test.ts`

- [ ] **Step 1: 写失败测试（拖入判定纯函数 + store 行为）**

拖入判定做成纯函数便于测试：

```ts
// apps/web/src/utils/groupDrop.ts（新建）
import type { Node } from '@xyflow/react';

/** 节点中心是否落入组包围盒（组节点不可被拖入） */
export function findDropGroup(node: Node, groups: Node[]): Node | null {
  if (node.type === 'group' || node.parentId) return null;
  const nw = node.width ?? 280, nh = node.height ?? 120;
  const cx = node.position.x + nw / 2, cy = node.position.y + nh / 2;
  for (const g of groups) {
    const gw = g.width ?? 0, gh = g.height ?? 0;
    if (cx >= g.position.x && cx <= g.position.x + gw && cy >= g.position.y && cy <= g.position.y + gh) {
      return g;
    }
  }
  return null;
}
```

```ts
// apps/web/src/stores/canvasStore.dropIntoGroup.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';

beforeEach(() => {
  useCanvasStore.setState({
    nodes: [
      { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, width: 300, height: 200, data: {} },
      { id: 'n2', type: 'textInput', position: { x: 400, y: 0 }, width: 300, height: 200, data: {} },
      { id: 'free', type: 'imageGen', position: { x: 2000, y: 2000 }, width: 300, height: 200, data: {} },
    ] as any,
    edges: [], selectedId: null,
  });
});

describe('dropIntoGroup', () => {
  it('落点在组内 → 加入组', () => {
    const gid = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().dropIntoGroup('free', gid);
    const free = useCanvasStore.getState().nodes.find((n) => n.id === 'free')!;
    expect(free.parentId).toBe(gid);
  });

  it('拖入折叠组 → 先展开再加入', () => {
    const gid = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().toggleCollapse(gid);
    useCanvasStore.getState().dropIntoGroup('free', gid);
    const s = useCanvasStore.getState();
    const group = s.nodes.find((n) => n.id === gid)!;
    expect((group.data as any).collapsed).toBe(false);
    expect(s.nodes.find((n) => n.id === 'free')!.parentId).toBe(gid);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx vitest run src/stores/canvasStore.dropIntoGroup.test.ts`
Expected: FAIL（dropIntoGroup 不存在）

- [ ] **Step 3: 写实现**

canvasStore 接口 + 实现：

```ts
dropIntoGroup: (nodeId: string, groupId: string) => void;

// 实现：
dropIntoGroup: (nodeId, groupId) => {
  const s = get();
  const group = s.nodes.find((n) => n.id === groupId);
  if (!group) return;
  if ((group.data as any).collapsed) get().toggleCollapse(groupId); // 折叠态先展开
  get().addToGroup(groupId, nodeId);
},
```

CanvasView.tsx 给 `<ReactFlow>` 加：

```tsx
onNodeDragStop={onNodeDragStopIntoGroup}
```

```tsx
// CanvasView.tsx 内
const onNodeDragStopIntoGroup = useCallback(
  (_e: any, draggedNode: any) => {
    const s = useCanvasStore.getState();
    const groups = s.nodes.filter((n) => n.type === 'group' && n.id !== draggedNode.id);
    const target = findDropGroup(draggedNode, groups);
    if (target) {
      if ((target.data as any).groupType === 'storyboard') {
        s.dropImageIntoStoryboard(target.id, draggedNode.id); // Task 11 实现；本任务先创建 store 占位 no-op
      } else {
        s.dropIntoGroup(draggedNode.id, target.id);
      }
    }
  },
  [],
);
```

补导入 `import { findDropGroup } from '@/utils/groupDrop';` 与 `apps/web/src/utils/groupDrop.ts`。

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && npx vitest run src/stores/canvasStore.dropIntoGroup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.dropIntoGroup.test.ts apps/web/src/utils/groupDrop.ts apps/web/src/pages/canvas/components/CanvasView.tsx
git commit -m "feat(web): drop node into group with collapse auto-expand (TD-Group step 8)"
```

---

### Task 9: 执行引擎 nodeIds 支持 + 整组执行

**Files:**
- Modify: `apps/api/src/modules/execution/execution.service.ts:25-60`
- Modify: `apps/api/src/modules/execution/execution.controller.ts:15-18`
- Test: `apps/api/src/modules/execution/execution.service.nodeIds.spec.ts`
- Modify: `apps/web/src/api/executionApi.ts`（无则新建）

- [ ] **Step 1: 写失败测试（后端）**

```ts
// execution.service.nodeIds.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prisma = {
  canvasProject: { findUnique: vi.fn() },
  canvasNode: { update: vi.fn() },
  pricingRule: { findFirst: vi.fn().mockResolvedValue(null) },
};
const topology = {
  getScope: vi.fn(),
  sort: vi.fn((nodes: any[]) => nodes),
  collectUpstreamData: vi.fn().mockReturnValue({ textContents: [] }),
};
const validation = { validateAll: vi.fn().mockResolvedValue({ valid: true }) };
const apiCaller = { callTextGen: vi.fn(), callImageGen: vi.fn(), callVideoGen: vi.fn(), callAudioGen: vi.fn() };
const credit = { deduct: vi.fn().mockResolvedValue(true) };
const gateway = { emitNodeStatus: vi.fn() };
const downloadQueue = { add: vi.fn() };

const { ExecutionService } = await import('./execution.service');
const service = new ExecutionService(
  prisma as any, topology as any, validation as any, apiCaller as any,
  credit as any, gateway as any, downloadQueue as any,
);

describe('execute with nodeIds（整组执行）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validation.validateAll.mockResolvedValue({ valid: true });
  });

  it('nodeIds 限定执行范围（仅组内节点）', async () => {
    const nodes = [
      { id: 'outside', type: 'textInput', data: { content: 'x' } },
      { id: 'in1', type: 'textInput', data: { content: 'a', model: 'seed-model-kimi' } },
      { id: 'in2', type: 'textInput', data: { content: 'b', model: 'seed-model-kimi' } },
    ];
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', nodes, edges: [] });
    apiCaller.callTextGen.mockResolvedValue({ content: 'ok' });

    await service.execute('p1', undefined, 'u1', ['in1', 'in2']);

    const sorted = topology.sort.mock.calls[0][0] as any[];
    expect(sorted.map((n) => n.id)).not.toContain('outside');
    expect(gateway.emitNodeStatus).toHaveBeenCalledTimes(2);
  });

  it('collectUpstreamData 收到全量节点（组外上游可读）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({
      id: 'p1',
      nodes: [
        { id: 'outside', type: 'textInput', data: { content: 'up' } },
        { id: 'in1', type: 'textInput', data: { model: 'seed-model-kimi' } },
      ],
      edges: [{ sourceId: 'outside', targetId: 'in1' }],
    });
    apiCaller.callTextGen.mockResolvedValue({ content: 'ok' });
    await service.execute('p1', undefined, 'u1', ['in1']);
    const nodesPassed = topology.collectUpstreamData.mock.calls[0][1] as any[];
    expect(nodesPassed.map((n) => n.id)).toContain('outside');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/api && npx vitest run src/modules/execution/execution.service.nodeIds.spec.ts`
Expected: FAIL（execute 不接受第 4 参 / collectUpstreamData 收到 scopeNodes）

- [ ] **Step 3: 写实现**

`execution.service.ts` execute 签名与 scope 段：

```ts
async execute(projectId: string, nodeId: string | undefined, userId: string, nodeIds?: string[]) {
  // ...加载 project 后：
  const scopeNodes = nodeIds
    ? allNodes.filter((n) => nodeIds.includes(n.id))
    : nodeId
      ? this.topology.getScope(allNodes, allEdges, nodeId)
      : allNodes;
```

执行循环内上游收集改为传全量（仅 nodeIds 模式）：

```ts
const upstreamSource = nodeIds ? allNodes : scopeNodes;
const upstream = this.topology.collectUpstreamData(node.id, upstreamSource, allEdges);
```

controller：

```ts
@Post('execute')
execute(@Body() body: { projectId: string; nodeId?: string; nodeIds?: string[]; userId?: string }) {
  return this.service.execute(body.projectId, body.nodeId, body.userId || 'default-user', body.nodeIds);
}
```

前端（`apps/web/src/api/executionApi.ts`，已有则在其中追加）：

```ts
export async function executeGroupNodes(projectId: string, nodeIds: string[]) {
  return apiFetch('/execution/execute', {
    method: 'POST',
    body: JSON.stringify({ projectId, nodeIds }),
  });
}
```

GroupToolbar 的 onExecute 落到 CanvasView 接线：收集组内节点 id（`nodes.filter(n => n.parentId === groupId)`）调 `executeGroupNodes`。

- [ ] **Step 4: 运行确认通过 + 回归现有执行测试**

Run: `cd apps/api && npx vitest run src/modules/execution/`
Expected: PASS（含原有 execution 测试，验证 nodeIds 未破坏单节点/全画布路径）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/execution apps/web/src/api
git commit -m "feat(api,web): group execution via nodeIds scope (TD-Group step 9)"
```

---

## Phase 3：分镜组

### Task 10: mergeStoryboard / convertGroup actions（含 multiImageGen 展开）

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts`
- Test: `apps/web/src/stores/canvasStore.storyboard.test.ts`

- [ ] **Step 1: 写失败测试（真实 store）**

```ts
// canvasStore.storyboard.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';

const doneImage = (id: string, x: number, y: number) =>
  ({ id, type: 'imageGen', position: { x, y }, width: 320, height: 180,
     data: { status: 'done', fileId: `file-${id}` } });

beforeEach(() => {
  useCanvasStore.setState({
    nodes: [
      doneImage('a', 100, 100), doneImage('b', 500, 100),
      doneImage('c', 100, 400), doneImage('d', 500, 400),
      { id: 'text', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '' } },
      { id: 'multi', type: 'multiImageGen', position: { x: 1000, y: 100 }, width: 320, height: 200,
        data: { images: [
          { id: 'm1', url: 'u1', name: 'n', status: 'success' },
          { id: 'm2', url: 'u2', name: 'n', status: 'success' },
        ], mainImageIndex: 0, expanded: false, nodeStatus: 'done' } },
    ] as any,
    edges: [], selectedId: null,
  });
});

describe('mergeStoryboard', () => {
  it('4 张完成图 → 2x2 分镜组，cells 按字典序，组尺寸 642x362', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']);
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    expect(g.data.groupType).toBe('storyboard');
    expect(g.data.cells).toEqual(['a', 'c', 'b', 'd']); // x: 100(a,c) < 500(b,d)；a.y<c.y
    expect(g.width).toBeCloseTo(642);
    expect(g.data.storyboard).toMatchObject({ aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false });
    expect(s.nodes.find((n) => n.id === 'a')!.hidden).toBe(true);
  });

  it('multiImageGen 展开为独立隐藏 imageGen 节点', () => {
    const before = useCanvasStore.getState().nodes.length;
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'multi']);
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    expect(g.data.cells).toHaveLength(3); // a + 2 张展开图
    expect(g.data.cells![0]).toBe('a'); // a.x=100 < multi.x=1000 → 展开图不插队（P1-新1）
    const expanded = s.nodes.filter((n) => (n.data as any).__fromMulti === 'multi');
    expect(expanded).toHaveLength(2);
    expect(expanded.every((n) => n.type === 'imageGen' && (n.data as any).status === 'done')).toBe(true);
    expect(s.nodes.find((n) => n.id === 'multi')).toBeUndefined(); // 原节点移除
    expect(s.nodes.length).toBe(before + 2 - 1 + 1); // +2 展开 -1 原节点 +1 组
    // 展开节点必须挂组（parentId + hidden），否则游离在画布上不隐藏也不入格
    expect(expanded.every((n) => n.parentId === gid && n.hidden === true)).toBe(true);
  });

  it('含非完成图节点抛错', () => {
    expect(() => useCanvasStore.getState().mergeStoryboard(['a', 'text'])).toThrow(/完成图片/);
  });
});

describe('convertGroup', () => {
  it('分镜组 → 普通组：取消 hidden、cells 顺序网格重排（40px 间距、320 单格）', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']);
    useCanvasStore.getState().convertGroup(gid, 'normal');
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    expect(g.data.groupType).toBe('normal');
    expect(g.data.cells).toBeUndefined();
    const a = s.nodes.find((n) => n.id === 'a')!;
    expect(a.hidden).toBe(false);
    // cells 顺序 [a,c,b,d]，cols=2：a=(0,0) c=第二列(360,0) b=第二行(0,220) d=(360,220)（相对组）
    const c = s.nodes.find((n) => n.id === 'c')!;
    const b = s.nodes.find((n) => n.id === 'b')!;
    expect(a.position).toEqual({ x: 0, y: 0 });
    expect(c.position.x - a.position.x).toBeCloseTo(320 + 40); // c 在第二列
    expect(b.position.y - a.position.y).toBeCloseTo(180 + 40); // b 在第二行
    expect(a.width).toBe(320);
  });

  it('普通组（全完成图）→ 分镜组', () => {
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.getState().convertGroup(gid, 'storyboard');
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gid)!;
    expect(g.data.groupType).toBe('storyboard');
    expect(g.data.cells).toHaveLength(2);
  });

  it('普通组含非完成图 → 抛错', () => {
    const gid = useCanvasStore.getState().groupNodes(['a', 'text']);
    expect(() => useCanvasStore.getState().convertGroup(gid, 'storyboard')).toThrow(/仅包含.*图片/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx vitest run src/stores/canvasStore.storyboard.test.ts`
Expected: FAIL

- [ ] **Step 3: 写实现**

canvasStore 接口追加：`mergeStoryboard: (nodeIds: string[]) => string; convertGroup: (groupId: string, target: 'normal' | 'storyboard') => void;`

实现（要点：展开 multiImageGen → 判定 → 智能宫格 → 字典序 cells → 组节点定位"组中心对齐选中区域中心"）：

```ts
mergeStoryboard: (nodeIds) => {
  const s = get();
  const picked = s.nodes.filter((n) => nodeIds.includes(n.id));
  if (picked.length < 2) throw new Error('合并分镜组至少需要 2 个节点');
  if (picked.some((n) => !isImageCompletedNode(n))) {
    throw new Error('分镜组仅支持含完成图片的节点');
  }
  // 0. 先生成组 id：展开节点构造时即挂组（若构造后再追加，map 分支覆盖不到新增节点 → parentId 永远缺失）
  const gid = getId('node');
  // 1. 展开 multiImageGen → 独立隐藏 imageGen 节点
  const expanded: Node[] = [];
  const kept: Node[] = [];
  for (const n of picked) {
    const d = n.data as any;
    if (n.type === 'multiImageGen') {
      for (const img of d.images.filter((i: any) => i.status === 'success')) {
        const id = getId('node');
        expanded.push({
          id, type: 'imageGen', parentId: gid, extent: 'parent' as const,
          // 暂留原 multi 位置：字典序排序依据（P1-新1——若归零则展开图永远插队排最前）；
          // 追加进 nodes 时统一归零（分镜组子节点坐标无意义）
          position: { x: n.position.x, y: n.position.y }, width: 320, height: 180,
          data: { status: 'done', fileId: img.id, mediaUrl: img.url, __fromMulti: n.id },
          selected: false,
        } as Node);
      }
    } else {
      kept.push(n);
    }
  }
  const images = [...kept, ...expanded];
  // 2. 字典序排序 + 智能宫格
  const sorted = sortNodesByPosition(images.map((n) => ({ ...n, positionX: n.position.x, positionY: n.position.y })))
    .map((n) => (n as any).id);
  const { rows, cols } = calcDefaultGrid(sorted.length);
  // 3. 组中心对齐选中区域中心
  const cx = images.reduce((sum, n) => sum + n.position.x + (n.width ?? 320) / 2, 0) / images.length;
  const cy = images.reduce((sum, n) => sum + n.position.y + (n.height ?? 180) / 2, 0) / images.length;
  const size = calcStoryboardSize(rows, cols, '16:9');
  const groupNode: Node = {
    id: gid, type: 'group',
    position: { x: cx - size.width / 2, y: cy - size.height / 2 },
    width: size.width, height: size.height, selected: true,
    data: {
      groupType: 'storyboard', name: `分镜组 ${sorted.length} 个节点`, cells: sorted,
      storyboard: { aspectRatio: '16:9', gridRows: rows, gridCols: cols, showIndex: false, stitchResolution: '2K' },
    },
  };
  set((st) => ({
    nodes: [
      ...st.nodes
        .filter((n) => !(n.type === 'multiImageGen' && nodeIds.includes(n.id)))
        .map((n) => images.some((i) => i.id === n.id)
          ? { ...n, selected: false, parentId: gid, extent: 'parent' as const,
              position: { x: 0, y: 0 } } // 分镜组子节点坐标无意义（纯 DOM 宫格渲染），归零
          : { ...n, selected: false }),
      ...expanded.map((e) => ({ ...e, position: { x: 0, y: 0 } })), // 排序已完成，入组归零
      groupNode,
    ],
    selectedId: gid,
  }));
  useNodeStore.getState().addNode({ id: gid, type: 'group', position: groupNode.position, data: groupNode.data });
  // 双写补全：展开的新节点写入 nodeStore；被移除的 multiImageGen 原节点同步删除（双 store 一致）
  const ns = useNodeStore.getState();
  for (const e of expanded) {
    ns.addNode({ id: e.id, type: 'imageGen', position: e.position, data: e.data as any });
  }
  for (const n of picked) {
    if (n.type === 'multiImageGen') ns.deleteNode(n.id);
  }
  get().applyGroupDerivations();
  return gid;
},

convertGroup: (groupId, target) => {
  const s = get();
  const group = s.nodes.find((n) => n.id === groupId);
  if (!group) return;
  const gd = group.data as any;

  if (target === 'storyboard') {
    const children = s.nodes.filter((n) => n.parentId === groupId);
    if (children.some((n) => !isImageCompletedNode(n))) {
      throw new Error('仅包含图片节点的组可转为分镜组');
    }
    // 复用 mergeStoryboard 的宫格逻辑，但保留原组 id 与位置
    const sorted = sortNodesByPosition(children.map((n) => ({ ...n, positionX: n.position.x + group.position.x, positionY: n.position.y + group.position.y })))
      .map((n) => (n as any).id);
    const { rows, cols } = calcDefaultGrid(sorted.length);
    const size = calcStoryboardSize(rows, cols, '16:9');
    const cx = group.position.x + (group.width ?? 0) / 2;
    const cy = group.position.y + (group.height ?? 0) / 2;
    set((st) => ({
      nodes: st.nodes.map((n) => {
        if (n.id === groupId) return { ...n, type: 'group', position: { x: cx - size.width / 2, y: cy - size.height / 2 },
          width: size.width, height: size.height,
          data: { groupType: 'storyboard', name: `分镜组 ${sorted.length} 个节点`, cells: sorted,
                  storyboard: { aspectRatio: '16:9', gridRows: rows, gridCols: cols, showIndex: false, stitchResolution: '2K' } } };
        if (n.parentId === groupId) return { ...n, position: { x: 0, y: 0 } };
        return n;
      }),
    }));
  } else {
    // 分镜组 → 普通组：cells 顺序网格重排
    const cfg = gd.storyboard;
    const cellW = CELL_WIDTH;
    const cellH = CELL_WIDTH / ASPECT_RATIO_MAP[cfg.aspectRatio];
    set((st) => ({
      nodes: st.nodes.map((n) => {
        if (n.id === groupId) return { ...n, data: { groupType: 'normal', name: `分组 ${gd.cells.length} 个节点` } };
        const idx = gd.cells.indexOf(n.id);
        if (idx === -1 || n.parentId !== groupId) return n;
        const row = Math.floor(idx / cfg.gridCols), col = idx % cfg.gridCols;
        return { ...n, position: { x: col * (cellW + CONVERT_GAP), y: row * (cellH + CONVERT_GAP) },
                 width: cellW, height: Math.round(cellH) };
      }),
    }));
    // 组框重算
    get().refitGroupBounds(groupId);
  }
  get().applyGroupDerivations();
},
```

配套：`refitGroupBounds(groupId)` action（按子节点包围盒+padding 重设组框，普通组转换/移出后复用）与 imports（`isImageCompletedNode`/`sortNodesByPosition`/`calcDefaultGrid`/`calcStoryboardSize`/`CELL_WIDTH`/`CONVERT_GAP`/`ASPECT_RATIO_MAP`）。同时实现 Task 8 预留的 `dropImageIntoStoryboard` 正式逻辑（见 Task 12 空格填充复用同一 action `addImageToStoryboardCell`）。

本任务完成后，启用 Task 7 中暂 disabled 的「转分镜组」按钮并补置灰规则：`convertible = 组内子节点全部 isImageCompletedNode`；不满足时 disabled + Tooltip「仅包含图片节点的组可转为分镜组」（spec 4.2）。

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && npx vitest run src/stores/canvasStore.storyboard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.storyboard.test.ts
git commit -m "feat(web): mergeStoryboard/convertGroup with multiImage expansion (TD-Group step 10)"
```

---

### Task 11: StoryboardGroupRenderer + StoryboardCell（宫格/序号/空占位/loading）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/groups/StoryboardGroupRenderer.tsx`（重写 Task 5 占位）
- Create: `apps/web/src/pages/canvas/components/groups/StoryboardCell.tsx`
- Test: `apps/web/src/pages/canvas/components/groups/StoryboardGroupRenderer.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// StoryboardGroupRenderer.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StoryboardGroupRenderer } from './StoryboardGroupRenderer';

// P0-2：mock useMediaUrl —— 宫格取图经 fileId → 预签名 URL 解析（JSON API 不能直接作 src）
vi.mock('@/hooks/useMediaUrl', () => ({
  useMediaUrl: (fileId: string | null) => ({
    url: fileId ? `/flowai/${fileId}` : null, loading: false, error: null,
  }),
}));

// P2-新2 注记：useMediaUrl 无缓存（每次 effect 直接 fetch）。大宫格（如 10x10）首渲染会并发
// 解析请求——浏览器同源并发排队不会失败，且 data.mediaUrl 短路覆盖常见场景；T22 浏览器走查时
// 若大宫格卡顿明显，再给 useMediaUrl 加模块级 fileId→Promise 去重缓存（勿提前优化）。

const cells = [
  { id: 'a', fileId: 'f1', status: 'done' },
  { id: 'b', fileId: 'f2', status: 'done' },
];

const props = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  data: {
    groupType: 'storyboard',
    cells: ['a', 'b'],
    storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' as const },
    ...over,
  },
  selected: false,
  cellNodes: cells,
});

describe('StoryboardGroupRenderer', () => {
  it('渲染宫格图与两位补零序号（img src 为解析后的 URL）', () => {
    render(<StoryboardGroupRenderer {...(props() as any)} />);
    expect(screen.getByText('01')).toBeTruthy();
    expect(screen.getByText('02')).toBeTruthy();
    expect((screen.getByRole('img') as HTMLImageElement).getAttribute('src')).toBe('/flowai/f1');
  });

  it('空宫格显示 + 占位（2x2 只有 2 图 → 2 个空位）', () => {
    render(<StoryboardGroupRenderer {...(props() as any)} />);
    expect(screen.getAllByText('+')).toHaveLength(2);
  });

  it('loading 态宫格显示占位', () => {
    render(<StoryboardGroupRenderer {...(props({
      cellNodes: [{ id: 'a', fileId: 'f1', status: 'loading' }, cells[1]],
    }) as any)} />);
    expect(screen.getByText(/生成中/)).toBeTruthy();
  });

  it('showIndex=false 无序号', () => {
    render(<StoryboardGroupRenderer {...(props({
      storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false, stitchResolution: '2K' },
    }) as any)} />);
    expect(screen.queryByText('01')).toBeNull();
  });

  it('空宫格 + 按钮 dispatch fill-cell 事件携带 groupId（P0-新2）', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    render(<StoryboardGroupRenderer {...(props() as any)} />);
    fireEvent.click(screen.getAllByText('+')[0]);
    const evt = dispatchSpy.mock.calls.map((c) => c[0]).find((e) => (e as Event).type === 'storyboard:fill-cell');
    expect(evt).toBeTruthy();
    expect((evt as CustomEvent).detail.groupId).toBe('g1'); // 来自 NodeProps.id，非 data.groupId
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/groups/StoryboardGroupRenderer.test.tsx`
Expected: FAIL

- [ ] **Step 3: 写实现**

```tsx
// StoryboardCell.tsx
import { memo } from 'react';
import { useMediaUrl } from '@/hooks/useMediaUrl';

export interface CellNodeInfo { id: string; fileId?: string; status?: string; url?: string }

interface Props {
  index: number;
  cellWidth: number; cellHeight: number;
  info?: CellNodeInfo;
  showIndex: boolean;
  selectedCell: number | null;
  onSelectCell: (index: number | null) => void;
  onFillEmpty: (index: number) => void;
}

function StoryboardCellComponent(p: Props) {
  // 取图走项目现有 useMediaUrl 模式（P0-2）：GET /media/:fileId/url 返回 JSON { url }（预签名地址经
  // /flowai 代理改写），不是图片流，不能直接作 img src；data.mediaUrl（展开/填充时已写入）优先短路请求
  const { url: resolvedUrl } = useMediaUrl(p.info?.fileId ?? null);
  const imgSrc = p.info?.url ?? resolvedUrl;
  const style: React.CSSProperties = {
    width: p.cellWidth, height: p.cellHeight, position: 'relative',
    border: p.selectedCell === p.index ? '2px solid #4ade80' : 'none',
    overflow: 'hidden',
  };
  if (!p.info) {
    return (
      <div style={{ ...style, border: '1px dashed #444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button onClick={() => p.onFillEmpty(p.index)}
          style={{ background: 'none', border: 'none', color: '#666', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>+</button>
      </div>
    );
  }
  if (p.info.status === 'loading') {
    return (
      <div style={{ ...style, background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 12 }}>
        生成中…
      </div>
    );
  }
  return (
    <div style={style} onClick={(e) => { e.stopPropagation(); p.onSelectCell(p.index); }}>
      <img src={imgSrc} alt="" loading="lazy" decoding="async"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      {p.showIndex && (
        <span style={{ position: 'absolute', left: 12, bottom: 10, color: '#fff',
          fontSize: 16, fontWeight: 600, textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
          {String(p.index + 1).padStart(2, '0')}
        </span>
      )}
    </div>
  );
}

export const StoryboardCell = memo(StoryboardCellComponent);
```

```tsx
// StoryboardGroupRenderer.tsx — 完整重写（替换 Task 5 占位）
import { memo, useState } from 'react';
import { calcStoryboardSize } from '@/utils/groupLayout';
import type { GroupNodeData } from '@/types/group';
import { StoryboardCell, type CellNodeInfo } from './StoryboardCell';

interface Props { id: string; data: GroupNodeData; selected: boolean; cellNodes: CellNodeInfo[] }

function StoryboardGroupRendererComponent({ id, data, selected, cellNodes }: Props) {
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const cfg = data.storyboard!;
  const { cellWidth, cellHeight } = calcStoryboardSize(cfg.gridRows, cfg.gridCols, cfg.aspectRatio);
  const total = cfg.gridRows * cfg.gridCols;
  const byId = new Map(cellNodes.map((c) => [c.id, c]));
  return (
    <div style={{
      width: '100%', height: '100%',
      border: `1px solid ${selected ? '#4ade80' : '#333333'}`, borderRadius: 8,
      background: '#1a1a1a', position: 'relative',
      display: 'grid',
      gridTemplateColumns: `repeat(${cfg.gridCols}, 1fr)`,
      gridTemplateRows: `repeat(${cfg.gridRows}, 1fr)`,
      gap: 2,
    }}>
      {Array.from({ length: total }, (_, i) => {
        const nodeId = data.cells?.[i];
        const info = nodeId ? byId.get(nodeId) : undefined;
        return (
          <StoryboardCell key={i} index={i} cellWidth={cellWidth} cellHeight={cellHeight}
            info={info} showIndex={cfg.showIndex}
            selectedCell={selectedCell} onSelectCell={setSelectedCell}
            onFillEmpty={(idx) => window.dispatchEvent(new CustomEvent('storyboard:fill-cell', { detail: { groupId: id, index: idx } }))} />
        );
      })}
      <div style={{ position: 'absolute', top: -10, left: 8, background: '#0a0a0a', color: '#999', fontSize: 12, padding: '0 6px', whiteSpace: 'nowrap' }}>
        {data.name ?? '分镜组'}
      </div>
    </div>
  );
}
export const StoryboardGroupRenderer = memo(StoryboardGroupRendererComponent);
```

GroupNode.tsx 中从 canvasStore 订阅 `cellNodes`（`nodes.filter(n => data.cells?.includes(n.id)).map(n => ({ id: n.id, fileId: (n.data as any).fileId, status: (n.data as any).status, url: (n.data as any).mediaUrl }))`）并注入。取图统一走 useMediaUrl（P0-2：`GET /media/:id/url` 返回 JSON `{url}` 而非图片流，不能直接作 img src；`data.mediaUrl` 优先短路重复请求）。

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/groups/StoryboardGroupRenderer.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/groups
git commit -m "feat(web): storyboard grid renderer with index/empty/loading cells (TD-Group step 11)"
```

---

### Task 12: 分镜组工具栏（比例/宫格/序号/清空/转换/解组）+ 溢出机制

**Files:**
- Modify: `apps/web/src/pages/canvas/components/groups/GroupToolbar.tsx`（storyboard 分支按钮组）
- Create: `apps/web/src/pages/canvas/components/groups/GridSizeDropdown.tsx`、`AspectRatioDropdown.tsx`、`StitchButton.tsx`（Task 21 完成行为，本任务仅渲染下拉壳）
- Modify: `apps/web/src/stores/canvasStore.ts`（updateStoryboardConfig / resizeStoryboardGrid / clearStoryboard）
- Test: `apps/web/src/stores/canvasStore.storyboardConfig.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// canvasStore.storyboardConfig.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';

const doneImage = (id: string, x = 100, y = 100) =>
  ({ id, type: 'imageGen', position: { x, y }, width: 320, height: 180, data: { status: 'done', fileId: `f-${id}` } });

beforeEach(() => {
  useCanvasStore.setState({
    nodes: [doneImage('a'), doneImage('b', 500, 100), doneImage('c', 100, 400), doneImage('d', 500, 400)] as any,
    edges: [], selectedId: null,
  });
});

describe('updateStoryboardConfig', () => {
  it('切换比例 → 组尺寸重算', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']);
    useCanvasStore.getState().updateStoryboardConfig(gid, { aspectRatio: '1:1' });
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gid)!;
    expect(g.height).toBeCloseTo(2 * 320 + 2); // 1:1 → 单格 320 高
  });

  it('showIndex 切换', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    useCanvasStore.getState().updateStoryboardConfig(gid, { showIndex: true });
    expect(useCanvasStore.getState().nodes.find((n) => n.id === gid)!.data.storyboard!.showIndex).toBe(true);
  });
});

describe('resizeStoryboardGrid（减格溢出）', () => {
  it('4 图组减为 2x2→1x2：超出的 2 张移出排右侧 + cells 截断', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']);
    const before = useCanvasStore.getState().nodes.find((n) => n.id === gid)!;
    useCanvasStore.getState().resizeStoryboardGrid(gid, 1, 2);
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    expect(g.data.cells).toEqual(['a', 'c']); // 字典序前 2
    const overflowed = s.nodes.find((n) => n.id === 'b')!;
    expect(overflowed.parentId).toBeUndefined();
    expect(overflowed.position.x).toBeGreaterThan(before.position.x + (before.width ?? 0)); // 组右侧
    expect(overflowed.hidden).toBe(false);
    // P0-新1 回归：溢出节点必须存活（而非被删除），nodeStore 双写一致
    expect(s.nodes.find((n) => n.id === 'd')).toBeTruthy();
    expect(useNodeStore.getState().nodes['b']).toBeTruthy();
  });

  it('增格 → cells 不变（空位由渲染器显示）', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    useCanvasStore.getState().resizeStoryboardGrid(gid, 2, 2);
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gid)!;
    expect(g.data.cells).toHaveLength(2);
    expect(g.data.storyboard!.gridRows).toBe(2);
  });
});

describe('clearStoryboard', () => {
  it('删除全部子节点，组保留为空宫格', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']);
    useCanvasStore.getState().clearStoryboard(gid);
    const s = useCanvasStore.getState();
    expect(s.nodes.find((n) => n.id === gid)).toBeTruthy();
    expect(s.nodes.find((n) => n.id === gid)!.data.cells).toEqual([]);
    expect(s.nodes.find((n) => n.id === 'a')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx vitest run src/stores/canvasStore.storyboardConfig.test.ts`
Expected: FAIL

- [ ] **Step 3: 写实现**

canvasStore 接口追加：

```ts
updateStoryboardConfig: (groupId: string, patch: Partial<StoryboardConfig>) => void;
resizeStoryboardGrid: (groupId: string, rows: number, cols: number) => void;
clearStoryboard: (groupId: string) => void;
addImageToStoryboardCell: (groupId: string, cellIndex: number, fileId: string, url?: string) => void;
```

实现：

```ts
updateStoryboardConfig: (groupId, patch) => {
  set((st) => ({
    nodes: st.nodes.map((n) => {
      if (n.id !== groupId) return n;
      const cfg = { ...(n.data as any).storyboard, ...patch };
      const size = calcStoryboardSize(cfg.gridRows, cfg.gridCols, cfg.aspectRatio);
      return { ...n, width: size.width, height: size.height, data: { ...n.data, storyboard: cfg } };
    }),
  }));
},

resizeStoryboardGrid: (groupId, rows, cols) => {
  const s = get();
  const group = s.nodes.find((n) => n.id === groupId);
  if (!group) return;
  const gd = group.data as any;
  const capacity = rows * cols;
  const keep = (gd.cells ?? []).slice(0, capacity);
  const overflowIds = (gd.cells ?? []).slice(capacity);
  const gp = group.position;
  const gw = group.width ?? 0;
  set((st) => ({
    nodes: st.nodes.map((n) => {
      // P0-新1：绝不能 filter 掉溢出节点——那是删除数据；只做 map 改写（移出组排右侧）
      if (n.id === groupId) {
        const cfg = { ...gd.storyboard, gridRows: rows, gridCols: cols };
        const size = calcStoryboardSize(rows, cols, cfg.aspectRatio);
        return { ...n, width: size.width, height: size.height, data: { ...gd, cells: keep, storyboard: cfg } };
      }
      if (overflowIds.includes(n.id) && n.parentId === groupId) {
        const idx = overflowIds.indexOf(n.id);
        return { ...n, parentId: undefined, extent: undefined, hidden: false,
          position: { x: gp.x + gw + 20, y: gp.y + idx * 200 } };
      }
      return n;
    }),
    edges: st.edges, // 溢出节点若有连线已在组内隐藏；解出后 hidden 推导恢复显示
  }));
  get().applyGroupDerivations();
  if (overflowIds.length > 0) {
    message.info(`${overflowIds.length} 张图片已移出分镜组`); // antd message，import { message } from 'antd'
  }
},

clearStoryboard: (groupId) => {
  const s = get();
  const cellIds = (s.nodes.find((n) => n.id === groupId)?.data as any)?.cells ?? [];
  set((st) => ({
    nodes: st.nodes
      .filter((n) => !(cellIds.includes(n.id) && n.parentId === groupId))
      .map((n) => n.id === groupId ? { ...n, data: { ...n.data, cells: [] } } : n),
    edges: st.edges.filter((e) => !cellIds.includes(e.source) && !cellIds.includes(e.target)),
  }));
  cellIds.forEach((id: string) => useNodeStore.getState().deleteNode(id));
},

addImageToStoryboardCell: (groupId, cellIndex, fileId, url) => {
  const id = getId('node');
  set((st) => ({
    nodes: st.nodes.map((n) => {
      if (n.id !== groupId) return n;
      // 空位用 null 占位（cells: (string | null)[]），语义明确且 filter(Boolean) 安全
      const cells: (string | null)[] = [...((n.data as any).cells ?? [])];
      while (cells.length < cellIndex) cells.push(null);
      cells[cellIndex] = id;
      return { ...n, data: { ...n.data, cells } };
    }).concat([{
      id, type: 'imageGen', parentId: groupId, extent: 'parent',
      position: { x: 0, y: 0 }, width: 320, height: 180,
      data: { status: 'done', fileId, mediaUrl: url }, selected: false,
    } as Node]),
  }));
  useNodeStore.getState().addNode({ id, type: 'imageGen', position: { x: 0, y: 0 }, data: { status: 'done', fileId, mediaUrl: url } });
  get().applyGroupDerivations();
},
```

GroupToolbar storyboard 分支（children 插槽在 CanvasView 注入）：

```tsx
// CanvasView.tsx 组装（storyboard 时）：
<GroupToolbar groupId={gid} groupType="storyboard" collapsed={false} executing={executing}
  onCollapse={noOp} onExecute={noOp} onUngroup={handleUngroup} onConvert={(id) => convertGroup(id, 'normal')}>
  <AspectRatioDropdown value={cfg.aspectRatio} onChange={(v) => updateStoryboardConfig(gid, { aspectRatio: v })} executing={executing} />
  <GridSizeDropdown rows={cfg.gridRows} cols={cfg.gridCols}
    onChange={(r, c) => resizeStoryboardGrid(gid, r, c)} executing={executing} />
  <StitchButton groupId={gid} resolution={cfg.stitchResolution}
    onResolutionChange={(v) => updateStoryboardConfig(gid, { stitchResolution: v })} />
  <button style={indexBtn(cfg.showIndex)} onClick={() => updateStoryboardConfig(gid, { showIndex: !cfg.showIndex })}>№ 序号</button>
  <button style={btn(executing)} onClick={confirmClear}>🗑 清空</button>
</GroupToolbar>
```

`confirmClear` 用 antd `Modal.confirm`（红色 okButtonProps danger，文案见 spec 5.3）；`indexBtn` 启用态 `background: 'rgba(74,222,128,0.15)', color: '#4ade80', fontWeight: 600`。三个下拉组件为受控下拉（div 弹层模式，同 MultiSelectToolbar），预设项与自定义弹窗（GridSizeDropdown 自定义 = 行/列输入 1~10）按 spec 5.3。

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && npx vitest run src/stores/canvasStore.storyboardConfig.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.storyboardConfig.test.ts apps/web/src/pages/canvas/components/groups apps/web/src/pages/canvas/components/CanvasView.tsx
git commit -m "feat(web): storyboard config toolbar + grid overflow mechanism (TD-Group step 12)"
```

---

### Task 13: GroupContextMenu + 组副本/复制粘贴

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts`（duplicateGroup / copyGroupToClipboard / pasteGroupClipboard）
- Create: `apps/web/src/pages/canvas/components/groups/GroupContextMenu.tsx`
- Test: `apps/web/src/stores/canvasStore.duplicate.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// canvasStore.duplicate.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';

const doneImage = (id: string, x = 100, y = 100) =>
  ({ id, type: 'imageGen', position: { x, y }, width: 320, height: 180, data: { status: 'done', fileId: `f-${id}` } });

beforeEach(() => {
  useCanvasStore.setState({
    nodes: [doneImage('a'), doneImage('b', 500, 100)] as any,
    edges: [{ id: 'e1', source: 'a', target: 'b' }] as any,
    selectedId: null,
  });
});

describe('duplicateGroup', () => {
  it('深拷贝新 ID + fileId 复用 + 组内边复制 + 跨组边不复制', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    const newGid = useCanvasStore.getState().duplicateGroup(gid);
    const s = useCanvasStore.getState();
    const orig = s.nodes.find((n) => n.id === gid)!;
    const copy = s.nodes.find((n) => n.id === newGid)!;
    expect(copy.position.x).toBeCloseTo(orig.position.x + 40);
    expect(copy.data.cells).toHaveLength(2);
    expect(copy.data.cells!.every((id) => id !== 'a' && id !== 'b')).toBe(true); // 新 ID
    const copyChildren = s.nodes.filter((n) => n.parentId === newGid);
    expect(copyChildren).toHaveLength(2);
    expect((copyChildren[0].data as any).fileId).toMatch(/^f-/); // fileId 复用
    // 分镜组组内边（a→b 原有边保留原节点；复制边存在于新节点之间）
    const copyIds = copyChildren.map((n) => n.id);
    expect(s.edges.filter((e) => copyIds.includes(e.source) && copyIds.includes(e.target))).toHaveLength(1);
    expect(s.edges.filter((e) => e.id === 'e1')).toHaveLength(1); // 原边不动
  });
});

describe('copy/paste clipboard', () => {
  it('粘贴副本到指定位置', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    useCanvasStore.getState().copyGroupToClipboard(gid);
    const newGid = useCanvasStore.getState().pasteGroupClipboard({ x: 0, y: 0 });
    expect(useCanvasStore.getState().nodes.find((n) => n.id === newGid)).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx vitest run src/stores/canvasStore.duplicate.test.ts`
Expected: FAIL

- [ ] **Step 3: 写实现**

```ts
duplicateGroup: (groupId) => {
  const s = get();
  return buildGroupCopy(get, set, groupId, { x: 40, y: 0 });
},
copyGroupToClipboard: (groupId) => {
  const s = get();
  const group = s.nodes.find((n) => n.id === groupId);
  if (!group) return;
  const children = s.nodes.filter((n) => n.parentId === groupId);
  const childIds = new Set(children.map((n) => n.id));
  groupClipboard = {
    group: structuredClone(group),
    children: structuredClone(children),
    innerEdges: structuredClone(s.edges.filter((e) => childIds.has(e.source) && childIds.has(e.target))),
  };
},
pasteGroupClipboard: (position) => {
  if (!groupClipboard) return null;
  // 与 duplicate 相同的重建流程，组 position = 给定位置
  return rebuildFromClipboard(get, set, position);
},
```

共享构建函数 `buildGroupCopy`/`rebuildFromClipboard`（模块级私有函数，生成新 ID 映射：组、每个子节点（fileId/data 原样）、组内边按映射重建；`parentId` 指向新组；分镜组子节点 `position` 归零、普通组子节点保留相对位置 + 偏移；双写 nodeStore）。**新 id（组+全部子节点）须在函数入口统一生成后再执行 store 写入**——与 T4 groupNodes/T10 mergeStoryboard 同一约定，供 T15 撤销 capture 在写入前纳入全部新增 id（P1-新5）。

GroupContextMenu：组节点 `onContextMenu` 阻止默认、渲染菜单（创建副本/删除(二次确认 Modal.confirm)/复制/粘贴(剪贴板空则置灰)），删除走"删除组及全部子节点"逻辑（组节点 + parentId=组的子节点 + 相关边全删，双写 nodeStore）。

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && npx vitest run src/stores/canvasStore.duplicate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.duplicate.test.ts apps/web/src/pages/canvas/components/groups
git commit -m "feat(web): group duplicate/copy/paste + context menu (TD-Group step 13)"
```

---

### Task 14: 空宫格填充（素材库选图 + 拖图入组 + 删单格）

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts`（removeStoryboardCell）
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx`（监听 storyboard:fill-cell 事件开素材库、Delete 键删选中宫格）
- Test: `apps/web/src/stores/canvasStore.cellOps.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// canvasStore.cellOps.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';

const doneImage = (id: string, x = 100, y = 100) =>
  ({ id, type: 'imageGen', position: { x, y }, width: 320, height: 180, data: { status: 'done', fileId: `f-${id}` } });

beforeEach(() => {
  useCanvasStore.setState({
    nodes: [doneImage('a'), doneImage('b', 500, 100), doneImage('c', 100, 400), doneImage('d', 500, 400)] as any,
    edges: [], selectedId: null,
  });
});

describe('addImageToStoryboardCell', () => {
  it('填充空格：cells 补位 + 新隐藏子节点', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']); // 1x2 → [a,b]
    useCanvasStore.getState().resizeStoryboardGrid(gid, 2, 2); // 扩为 2x2，两个空位
    useCanvasStore.getState().addImageToStoryboardCell(gid, 3, 'f-new', 'http://x');
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    expect(g.data.cells![3]).toBeTruthy();
    const cell3 = s.nodes.find((n) => n.id === g.data.cells![3])!;
    expect(cell3.parentId).toBe(gid);
    expect((cell3.data as any).fileId).toBe('f-new');
  });
});

describe('removeStoryboardCell（删单格：不收缩宫格，序号重排）', () => {
  it('删除 cells[1] → 该格变空、后续前移补位', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']); // 2x2 [a,c,b,d]
    useCanvasStore.getState().removeStoryboardCell(gid, 1); // 删 c
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    expect(g.data.cells).toEqual(['a', 'b', 'd']); // 前移补位（紧凑）
    expect(s.nodes.find((n) => n.id === 'c')).toBeUndefined();
    expect(g.data.storyboard!.gridRows).toBe(2); // 不收缩
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx vitest run src/stores/canvasStore.cellOps.test.ts`
Expected: FAIL

- [ ] **Step 3: 写实现**

```ts
removeStoryboardCell: (groupId, cellIndex) => {
  const s = get();
  const group = s.nodes.find((n) => n.id === groupId);
  if (!group) return;
  const cells = [...((group.data as any).cells ?? [])];
  const [removedId] = cells.splice(cellIndex, 1); // 紧凑前移
  set((st) => ({
    nodes: st.nodes
      .filter((n) => n.id !== removedId)
      .map((n) => n.id === groupId ? { ...n, data: { ...n.data, cells } } : n),
    edges: st.edges.filter((e) => e.source !== removedId && e.target !== removedId),
  }));
  if (removedId) useNodeStore.getState().deleteNode(removedId);
},
```

CanvasView：监听 `storyboard:fill-cell` CustomEvent → 打开 `MaterialLibraryModal`（复用，选定回调走 `addImageToStoryboardCell(gid, index, file.id, file.url)`）；`dropImageIntoStoryboard(groupId, nodeId)`（Task 8 预留）正式实现：imageGen 完成节点 → `addToGroup` + cells 追加到首个空位；multiImageGen → 展开为多个 cell（超出容量部分走 Task 12 溢出排右侧同一逻辑）；宫格选中态 `selectedCell` 时拦截 Delete（CanvasView keydown 或删除前检查）调 `removeStoryboardCell`。

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && npx vitest run src/stores/canvasStore.cellOps.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.cellOps.test.ts apps/web/src/pages/canvas/components
git commit -m "feat(web): storyboard cell fill/remove via material library (TD-Group step 14)"
```

---

## Phase 4：局部撤销栈、快捷键与边界

### Task 15: groupHistory（数据快照 + tombstone）

**Files:**
- Create: `apps/web/src/stores/groupHistory.ts`
- Test: `apps/web/src/stores/groupHistory.test.ts`
- Modify: `apps/web/src/stores/canvasStore.ts`（组 actions 接入 record）

- [ ] **Step 1: 写失败测试**

```ts
// groupHistory.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useGroupHistory } from './groupHistory';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';

beforeEach(() => {
  useGroupHistory.getState().clear();
  useCanvasStore.setState({ nodes: [], edges: [], selectedId: null });
});

describe('groupHistory 快照往返', () => {
  it('undo/redo 打组操作：状态完全还原', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} },
        { id: 'n2', type: 'imageGen', position: { x: 500, y: 0 }, data: {} },
      ] as any, edges: [] as any,
    });
    const gid = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    expect(useGroupHistory.getState().canUndo()).toBe(true); // action 自动注册撤销项（集成点）
    expect(useCanvasStore.getState().nodes).toHaveLength(3); // 组+2子

    useGroupHistory.getState().undo();
    let s = useCanvasStore.getState();
    expect(s.nodes).toHaveLength(2); // 组消失
    expect(s.nodes.find((n) => n.id === 'n1')!.parentId).toBeUndefined();
    expect(s.nodes.find((n) => n.id === 'n1')!.position).toEqual({ x: 0, y: 0 }); // 绝对坐标还原

    useGroupHistory.getState().redo();
    s = useCanvasStore.getState();
    expect(s.nodes.find((n) => n.id === gid)).toBeTruthy();
    expect(s.nodes.find((n) => n.id === 'n1')!.parentId).toBe(gid);
  });

  it('tombstone：undo 新增对象（组节点）时从 store 删除', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} },
        { id: 'n2', type: 'imageGen', position: { x: 500, y: 0 }, data: {} },
      ] as any, edges: [] as any,
    });
    const gid = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useGroupHistory.getState().undo();
    expect(useCanvasStore.getState().nodes.find((n) => n.id === gid)).toBeUndefined();
  });

  it('新操作清空 future', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} },
        { id: 'n2', type: 'imageGen', position: { x: 500, y: 0 }, data: {} },
        { id: 'n3', type: 'imageGen', position: { x: 1000, y: 0 }, data: {} },
      ] as any, edges: [] as any,
    });
    useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useGroupHistory.getState().undo();
    useCanvasStore.getState().groupNodes(['n1', 'n3']); // 新操作
    expect(useGroupHistory.getState().canRedo()).toBe(false);
  });

  it('栈上限 50 条', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} },
        { id: 'n2', type: 'imageGen', position: { x: 500, y: 0 }, data: {} },
      ] as any, edges: [] as any,
    });
    for (let i = 0; i < 55; i++) {
      useGroupHistory.getState().record({
        label: `op${i}`, nodeIds: [], edgeIds: [],
        before: { nodes: [], edges: [] }, after: { nodes: [], edges: [] },
      });
    }
    expect(useGroupHistory.getState().pastLength()).toBe(50);
  });
});

describe('undo/redo 与 nodeStore 双写 + 执行中禁令', () => {
  const seed = (ids: string[]) => useCanvasStore.setState({
    nodes: ids.map((id) => ({ id, type: 'imageGen', position: { x: 0, y: 0 }, width: 320, height: 180,
      data: { status: 'done', fileId: `f-${id}` } } as any)),
    edges: [], selectedId: null,
  });

  it('undo 打组 → 组节点从 nodeStore 同步移除（P0-1 双写约定）', () => {
    seed(['a', 'b']);
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    expect(useNodeStore.getState().nodes[gid]).toBeTruthy(); // groupNodes 双写
    useGroupHistory.getState().undo();
    expect(useCanvasStore.getState().nodes.find((x) => x.id === gid)).toBeUndefined();
    expect(useNodeStore.getState().nodes[gid]).toBeUndefined(); // applySnapshot 同步删除
  });

  it('受影响节点执行中 → undo 阻止（P1-7）', () => {
    seed(['a', 'b']);
    useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.setState({
      nodeProcessMap: { a: { processType: 'generating', status: 'processing' } },
    } as any);
    useGroupHistory.getState().undo();
    expect(useCanvasStore.getState().nodes.filter((n) => n.type === 'group')).toHaveLength(1); // 未撤销
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx vitest run src/stores/groupHistory.test.ts`
Expected: FAIL

- [ ] **Step 3: 写实现**

```ts
// groupHistory.ts
import { create } from 'zustand';
import { message } from 'antd';
import type { Node, Edge } from '@xyflow/react';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';

export type Snapshot<T> = T | null; // null = tombstone（该对象此时间点不存在）

export interface HistoryEntry {
  label: string;
  nodeIds: string[];
  edgeIds: string[];
  before: { nodes: Snapshot<Node>[]; edges: Snapshot<Edge>[] };
  after: { nodes: Snapshot<Node>[]; edges: Snapshot<Edge>[] };
}

const MAX_HISTORY = 50;

interface GroupHistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  record: (entry: HistoryEntry) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  pastLength: () => number;
  clear: () => void;
}

/** 把快照应用到 store：非 null 覆盖/写入，null（tombstone）删除 */
function applySnapshot(side: 'before' | 'after', entry: HistoryEntry) {
  const nodes = entry[side].nodes;
  const edges = entry[side].edges;
  useCanvasStore.setState((s) => {
    let nextNodes = [...s.nodes];
    nodes.forEach((snap, i) => {
      const id = entry.nodeIds[i];
      nextNodes = snap
        ? nextNodes.some((n) => n.id === id)
          ? nextNodes.map((n) => (n.id === id ? snap : n))
          : [...nextNodes, snap]
        : nextNodes.filter((n) => n.id !== id);
    });
    let nextEdges = [...s.edges];
    edges.forEach((snap, i) => {
      const id = entry.edgeIds[i];
      nextEdges = snap
        ? nextEdges.some((e) => e.id === id)
          ? nextEdges.map((e) => (e.id === id ? snap : e))
          : [...nextEdges, snap]
        : nextEdges.filter((e) => e.id !== id);
    });
    return { nodes: nextNodes, edges: nextEdges };
  });
  // 双写 nodeStore（P0-1）：canvasStore.addNode/deleteNode 均同步 nodeStore，撤销/重做的逆操作
  // 必须遵守同一约定，否则两 store 节点集合漂移（幽灵节点/缺失节点）。
  // addNode 按 id 覆盖写 → 同时刷新 data/position；组节点与普通节点统一镜像（groupNodes 亦双写）。
  // 注（P1-新3）：nodeStore.nodes 是 Record<string, AppNode>（nodeStore.ts:281，键=节点 id），
  // 与 canvasStore.nodes（数组）结构不同——ns.nodes[id] 是 Record 访问，非数组索引。
  const ns = useNodeStore.getState();
  nodes.forEach((snap, i) => {
    const id = entry.nodeIds[i];
    if (snap) {
      ns.addNode({ id, type: snap.type!, position: snap.position, data: snap.data as any });
    } else if (ns.nodes[id]) {
      ns.deleteNode(id);
    }
  });
}

/** P1-7：撤销/重做受执行中禁令约束——结构变更的逆操作同样是结构变更（spec 8） */
function isEntryExecuting(entry: HistoryEntry): boolean {
  const processes = useCanvasStore.getState().nodeProcessMap;
  return entry.nodeIds.some((id) => id in processes);
}

export const useGroupHistory = create<GroupHistoryState>((set, get) => ({
  past: [], future: [],
  record: (entry) => set((s) => ({
    past: [...s.past, entry].slice(-MAX_HISTORY),
    future: [],
  })),
  undo: () => {
    const entry = get().past[get().past.length - 1];
    if (!entry) return;
    if (isEntryExecuting(entry)) {
      message.warning('组内有节点正在执行，请等待完成后再撤销');
      return;
    }
    applySnapshot('before', entry);
    set((s) => ({ past: s.past.slice(0, -1), future: [entry, ...s.future] }));
  },
  redo: () => {
    const entry = get().future[0];
    if (!entry) return;
    if (isEntryExecuting(entry)) {
      message.warning('组内有节点正在执行，请等待完成后再重做');
      return;
    }
    applySnapshot('after', entry);
    set((s) => ({ past: [...s.past, entry], future: s.future.slice(1) }));
  },
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
  pastLength: () => get().past.length,
  clear: () => set({ past: [], future: [] }),
}));

/** 操作前抓取受影响对象当前快照（供 canvasStore 组 actions 使用） */
export function captureBefore(nodeIds: string[], edgeIds: string[]) {
  const s = useCanvasStore.getState();
  return {
    nodes: nodeIds.map((id) => (s.nodes.find((n) => n.id === id) ?? null) as Snapshot<Node>),
    edges: edgeIds.map((id) => (s.edges.find((e) => e.id === id) ?? null) as Snapshot<Edge>),
  };
}

export function captureAfter(nodeIds: string[], edgeIds: string[]) {
  const s = useCanvasStore.getState();
  return {
    nodes: nodeIds.map((id) => (s.nodes.find((n) => n.id === id) ?? null) as Snapshot<Node>),
    edges: edgeIds.map((id) => (s.edges.find((e) => e.id === id) ?? null) as Snapshot<Edge>),
  };
}
```

canvasStore 每个结构变更 action（groupNodes/ungroup/mergeStoryboard/convertGroup/clearStoryboard/resizeStoryboardGrid/removeStoryboardCell/addToGroup/removeNodeFromGroup/dropIntoGroup/duplicateGroup/pasteGroupClipboard）在 set() 前后各调一次 capture（nodeIds 需预先包含"操作后将新增的 id"——新增 id 在操作前生成即可提前纳入；before 时不存在 → tombstone 天然成立），操作末尾 `useGroupHistory.getState().record({ label, nodeIds, edgeIds, before, after })`。

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && npx vitest run src/stores/groupHistory.test.ts src/stores/`
Expected: PASS（全部 store 测试回归）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/groupHistory.ts apps/web/src/stores/groupHistory.test.ts apps/web/src/stores/canvasStore.ts
git commit -m "feat(web): group history with snapshot undo/redo (TD-Group step 15)"
```

---

### Task 16: useGroupKeyboard（5 快捷键 + 编辑态让位）

**Files:**
- Create: `apps/web/src/hooks/useGroupKeyboard.ts`
- Test: `apps/web/src/hooks/useGroupKeyboard.test.ts`
- Modify: `apps/web/src/pages/canvas/page.tsx:310-345`（CanvasKeyboardHandler 内接线或同级挂载）

- [ ] **Step 1: 写失败测试**

```ts
// useGroupKeyboard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isGroupEditContext, resolveGroupShortcut } from '@/hooks/useGroupKeyboard';

describe('isGroupEditContext（编辑态判定 spec 6.3）', () => {
  it('INPUT 聚焦 → true', () => {
    expect(isGroupEditContext(document.createElement('input'))).toBe(true);
  });
  it('普通 div → false', () => {
    expect(isGroupEditContext(document.createElement('div'))).toBe(false);
  });
});

describe('resolveGroupShortcut', () => {
  it.each([
    [{ ctrlKey: true, key: 'g', altKey: false, shiftKey: false }, 'group'],
    [{ ctrlKey: true, key: 'g', altKey: true, shiftKey: false }, 'merge-storyboard'],
    [{ ctrlKey: true, key: 'G', altKey: false, shiftKey: true }, 'ungroup'],
    [{ shiftKey: true, key: 'G', ctrlKey: false, altKey: false }, 'remove-from-group'],
    [{ ctrlKey: true, key: 'z', shiftKey: false }, 'undo'],
    [{ ctrlKey: true, key: 'Z', shiftKey: true }, 'redo'],
    [{ ctrlKey: false, key: 'x' }, null],
  ])('%j → %s', (ev, expected) => {
    expect(resolveGroupShortcut(ev as KeyboardEvent)).toBe(expected);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx vitest run src/hooks/useGroupKeyboard.test.ts`
Expected: FAIL

- [ ] **Step 3: 写实现**

```ts
// useGroupKeyboard.ts
import { useEffect } from 'react';
import { message } from 'antd'; // Vite ESM：静态导入（require 不可用）
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';
import { useGroupHistory } from '@/stores/groupHistory';

export function isGroupEditContext(target: HTMLElement | null): boolean {
  const ns = useNodeStore.getState();
  if (ns.activeEditNodeId !== null || ns.activeTransformNodeId !== null) return true;
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export type GroupShortcut =
  | 'group' | 'merge-storyboard' | 'ungroup' | 'remove-from-group' | 'undo' | 'redo';

export function resolveGroupShortcut(e: {
  ctrlKey: boolean; metaKey?: boolean; altKey: boolean; shiftKey: boolean; key: string;
}): GroupShortcut | null {
  const ctrl = e.ctrlKey || !!e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && !e.altKey && !e.shiftKey && k === 'g') return 'group';
  if (ctrl && e.altKey && !e.shiftKey && k === 'g') return 'merge-storyboard';
  if (ctrl && !e.altKey && e.shiftKey && k === 'g') return 'ungroup';
  if (!ctrl && e.shiftKey && !e.altKey && k === 'g') return 'remove-from-group';
  if (ctrl && !e.shiftKey && k === 'z') return 'undo';
  if (ctrl && e.shiftKey && k === 'z') return 'redo';
  return null;
}

export function useGroupKeyboard() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const s = useCanvasStore.getState();
      if (s.isHydrating) return;
      if (isGroupEditContext(e.target as HTMLElement)) return;

      const action = resolveGroupShortcut(e);
      if (!action) return;

      const selected = s.nodes.filter((n) => n.selected);
      try {
        switch (action) {
          case 'group':
            if (selected.length >= 2) { e.preventDefault(); s.groupNodes(selected.map((n) => n.id)); }
            break;
          case 'merge-storyboard':
            if (selected.length >= 2) { e.preventDefault(); s.mergeStoryboard(selected.map((n) => n.id)); }
            break;
          case 'ungroup': {
            const g = selected.find((n) => n.type === 'group');
            if (g) { e.preventDefault(); s.ungroup(g.id); }
            break;
          }
          case 'remove-from-group': {
            const child = selected.find((n) => n.parentId && n.type !== 'group');
            if (child?.parentId) { e.preventDefault(); s.removeNodeFromGroup(child.parentId, child.id); }
            break;
          }
          case 'undo': e.preventDefault(); useGroupHistory.getState().undo(); break;
          case 'redo': e.preventDefault(); useGroupHistory.getState().redo(); break;
        }
      } catch (err) {
        // 置灰条件的快捷键触发（如嵌套/非图片），Toast 提示错误信息
        message.warning((err as Error).message);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
}
```

page.tsx 在 `CanvasKeyboardHandler` 组件内调用 `useGroupKeyboard()`（注意其 handler 无匹配时不得 preventDefault，避免影响 Tab/Ctrl+0 等既有键）。

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && npx vitest run src/hooks/useGroupKeyboard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useGroupKeyboard.ts apps/web/src/hooks/useGroupKeyboard.test.ts apps/web/src/pages/canvas/page.tsx
git commit -m "feat(web): group keyboard shortcuts with edit-context guard (TD-Group step 16)"
```

---

### Task 17: 边界处理（删节点清理/空组行为/执行中禁令）

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts`（deleteNode 增强 + hasActiveProcessInGroup）
- Test: `apps/web/src/stores/canvasStore.boundary.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// canvasStore.boundary.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';

const doneImage = (id: string, x = 100, y = 100) =>
  ({ id, type: 'imageGen', position: { x, y }, width: 320, height: 180, data: { status: 'done', fileId: `f-${id}` } });

beforeEach(() => {
  useCanvasStore.setState({
    nodes: [doneImage('a'), doneImage('b', 500, 100), doneImage('c', 100, 400)] as any,
    edges: [], selectedId: null, nodeProcessMap: {},
  });
});

describe('deleteNode 组清理', () => {
  it('分镜组：删子节点 → cells 移除、组保留', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c']);
    useCanvasStore.getState().deleteNode('a');
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gid)!;
    expect(g.data.cells).not.toContain('a');
    expect(useCanvasStore.getState().nodes.find((n) => n.id === gid)).toBeTruthy();
  });

  it('普通组：删空后自动解组', () => {
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.getState().deleteNode('a');
    expect(useCanvasStore.getState().nodes.find((n) => n.id === gid)).toBeTruthy(); // 还剩 b
    useCanvasStore.getState().deleteNode('b');
    expect(useCanvasStore.getState().nodes.find((n) => n.id === gid)).toBeUndefined(); // 空组自动解组
  });
});

describe('hasActiveProcessInGroup（执行中禁令）', () => {
  it('组内节点有活跃进程 → true', () => {
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.setState({ nodeProcessMap: { a: { processType: 'generating', status: 'processing' } } } as any);
    expect(useCanvasStore.getState().hasActiveProcessInGroup(gid)).toBe(true);
  });

  it('无进程 → false', () => {
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    expect(useCanvasStore.getState().hasActiveProcessInGroup(gid)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx vitest run src/stores/canvasStore.boundary.test.ts`
Expected: FAIL

- [ ] **Step 3: 写实现**

deleteNode（canvasStore.ts:144-153）增强——父组判定必须在 filter **之前**取被删节点的 parentId（filter 后父子关系丢失），且"删空自动解组"只检查被删节点的父组（不做全局扫描）：

```ts
deleteNode: (id) => {
  // 组清理需在删除前捕获父子关系
  const prevParentId = get().nodes.find((n) => n.id === id)?.parentId;
  // ...现有实现（cancelNodeProcess + filter nodes/edges + selectedId）...
  const after = get();
  const parent = prevParentId ? after.nodes.find((n) => n.id === prevParentId) : undefined;
  if (!parent || parent.type !== 'group') return;
  if ((parent.data as any)?.cells) {
    // 分镜组：cells 移除该 id（宫格不收缩）
    set((s) => ({
      nodes: s.nodes.map((n) => n.id === parent.id
        ? { ...n, data: { ...n.data, cells: (n.data as any).cells.filter((c: string) => c !== id) } }
        : n),
    }));
  } else if ((parent.data as any).groupType === 'normal'
    && !after.nodes.some((c) => c.parentId === parent.id)) {
    // 普通组：删空自动解组
    get().ungroup(parent.id);
  }
},
```

`hasActiveProcessInGroup` 接口+实现：

```ts
hasActiveProcessInGroup: (groupId: string) => {
  const s = get();
  const childIds = new Set(s.nodes.filter((n) => n.parentId === groupId).map((n) => n.id));
  return Object.keys(s.nodeProcessMap ?? {}).some((id) => childIds.has(id));
},
```

（字段名已核对：canvasStore 实际进程映射为 `nodeProcessMap`，见 canvasStore.ts:71。）GroupToolbar/右键菜单/快捷键的结构变更入口统一加 `executing` guard：`hasActiveProcessInGroup(gid)` 为 true 时按钮 disabled + Toast「组内有节点正在执行，请等待完成后再操作」。

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && npx vitest run src/stores/canvasStore.boundary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.boundary.test.ts
git commit -m "feat(web): group boundary handling — node deletion cleanup, executing guard (TD-Group step 17)"
```

---

## Phase 5：拼接流水线

### Task 18: storyboard module（controller + service + 队列注册）

**Files:**
- Create: `apps/api/src/modules/storyboard/storyboard.module.ts`、`storyboard.controller.ts`、`storyboard.service.ts`、`storyboard.constants.ts`
- Test: `apps/api/src/modules/storyboard/storyboard.service.spec.ts`、`storyboard.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts`（注册模块）

- [ ] **Step 1: 写失败测试（service）**

```ts
// storyboard.service.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';

const stitchQueue = { add: vi.fn().mockResolvedValue({ id: 'job1' }), getJob: vi.fn() };
const prisma = { canvasProject: { findUnique: vi.fn() }, media: { findMany: vi.fn() } };

const { StoryboardService } = await import('./storyboard.service');
const service = new StoryboardService(stitchQueue as any, prisma as any);

const validBody = {
  fileIds: ['f1', 'f2', 'f3', 'f4'], gridRows: 2, gridCols: 2,
  aspectRatio: '16:9', showIndex: false, resolution: '2K',
};

describe('StoryboardService.createStitchTask', () => {
  beforeEach(() => vi.clearAllMocks());

  it('合法参数 → 202 taskId', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.media.findMany.mockResolvedValue([{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }, { id: 'f4' }]);
    const result = await service.createStitchTask('p1', validBody, 'u1');
    expect(result.taskId).toBe('job1');
    expect(prisma.media.findMany).toHaveBeenCalledWith({
      where: { id: { in: validBody.fileIds }, projectId: 'p1' }, // P2-新3：项目归属过滤
      select: { id: true },
    });
    expect(stitchQueue.add).toHaveBeenCalledWith('stitch', expect.objectContaining({
      projectId: 'p1', userId: 'u1', fileIds: validBody.fileIds, resolution: '2K',
    }));
  });

  it('fileIds 含不存在或不属于本项目的图片 → 400', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.media.findMany.mockResolvedValue([{ id: 'f1' }]); // 只命中 1/4
    await expect(service.createStitchTask('p1', validBody, 'u1')).rejects.toThrow(/无效或不属于/);
    expect(stitchQueue.add).not.toHaveBeenCalled();
  });

  it.each([
    ['fileIds 为空', { ...validBody, fileIds: [] }],
    ['行列超界', { ...validBody, gridRows: 11 }],
    ['非法比例', { ...validBody, aspectRatio: '4:5' }],
    ['非法分辨率', { ...validBody, resolution: '8K' }],
    ['图片数超过容量', { ...validBody, gridRows: 1, gridCols: 2 }],
  ])('%s → 400', async (_label, body) => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1' }); // 否则先抛 404，格式校验分支未被测到
    await expect(service.createStitchTask('p1', body as any, 'u1')).rejects.toThrow(BadRequestException);
  });

  it('项目不存在 → 404', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    await expect(service.createStitchTask('nope', validBody, 'u1')).rejects.toThrow(/不存在/);
  });
});

describe('StoryboardService.getTaskStatus', () => {
  it('COMPLETED job → 返回产物字段', async () => {
    stitchQueue.getJob.mockResolvedValue({
      id: 'job1',
      getState: vi.fn().mockResolvedValue('completed'),
      returnvalue: { fileId: 'out1', width: 2048, height: 1026, failedCount: 0 }, // 无 url：前端经 useMediaUrl(fileId) 解析
    });
    const r = await service.getTaskStatus('p1', 'job1');
    expect(r).toMatchObject({ taskId: 'job1', status: 'COMPLETED', fileId: 'out1' });
  });

  it('job 不存在 → 404', async () => {
    stitchQueue.getJob.mockResolvedValue(null);
    await expect(service.getTaskStatus('p1', 'nope')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/api && npx vitest run src/modules/storyboard/storyboard.service.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```ts
// storyboard.constants.ts
export const STORYBOARD_STITCH_QUEUE = 'stitch';
export const VALID_ASPECT_RATIOS = ['21:9', '16:9', '9:16', '3:4', '4:3', '1:1'] as const;
export const VALID_RESOLUTIONS = ['2K', '4K'] as const;

// storyboard.service.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { VALID_ASPECT_RATIOS, VALID_RESOLUTIONS, STORYBOARD_STITCH_QUEUE } from './storyboard.constants';

export interface StitchTaskDto {
  fileIds: string[]; gridRows: number; gridCols: number;
  aspectRatio: string; showIndex: boolean; resolution: string;
}

@Injectable()
export class StoryboardService {
  constructor(
    @InjectQueue(STORYBOARD_STITCH_QUEUE) private readonly stitchQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async createStitchTask(projectId: string, dto: StitchTaskDto, userId: string) {
    const project = await this.prisma.canvasProject.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');

    if (!Array.isArray(dto.fileIds) || dto.fileIds.length === 0) {
      throw new BadRequestException('fileIds 不能为空');
    }
    if (dto.gridRows < 1 || dto.gridRows > 10 || dto.gridCols < 1 || dto.gridCols > 10) {
      throw new BadRequestException('行列数为 1~10');
    }
    if (dto.fileIds.length > dto.gridRows * dto.gridCols) {
      throw new BadRequestException('图片数超过宫格容量');
    }
    if (!VALID_ASPECT_RATIOS.includes(dto.aspectRatio as any)) {
      throw new BadRequestException('非法比例');
    }
    if (!VALID_RESOLUTIONS.includes(dto.resolution as any)) {
      throw new BadRequestException('非法分辨率');
    }
    // P2-新3：fileIds 存在性 + 项目归属校验（防跨项目越权取图；重复提交时 fail-fast 而非让 consumer 全失败）
    const medias = await this.prisma.media.findMany({
      where: { id: { in: dto.fileIds }, projectId },
      select: { id: true },
    });
    const found = new Set(medias.map((m) => m.id));
    if (dto.fileIds.some((f) => !found.has(f))) {
      throw new BadRequestException('存在无效或不属于该项目的图片');
    }
    const job = await this.stitchQueue.add('stitch', { projectId, userId, ...dto });
    return { taskId: job.id!, status: 'PENDING' };
  }

  async getTaskStatus(_projectId: string, taskId: string) {
    const job = await this.stitchQueue.getJob(taskId);
    if (!job) throw new NotFoundException('任务不存在');
    const state = await job.getState();
    const status = state === 'completed' ? 'COMPLETED' : state === 'failed' ? 'FAILED' : 'PENDING';
    const rv = job.returnvalue as any;
    return {
      taskId,
      status,
      ...(status === 'COMPLETED' ? rv : {}),
      ...(status === 'FAILED' ? { error: job.failedReason } : {}),
    };
  }
}
```

```ts
// storyboard.controller.ts — 风格对齐 project.controller（全局前缀无 /api，controller 路径带 api/ 前缀，见 execution.controller.ts:8）
import { Controller, Post, Get, Body, Param, Req, HttpCode } from '@nestjs/common';
import { Request } from 'express';
import { StoryboardService } from './storyboard.service';

@Controller('api/projects/:projectId/storyboard')
export class StoryboardController {
  constructor(private readonly service: StoryboardService) {}

  @Post('stitch')
  @HttpCode(202)
  stitch(@Param('projectId') projectId: string, @Body() body: any, @Req() req: Request) {
    return this.service.createStitchTask(projectId, body, (req as any).user?.id ?? 'default-user');
  }

  @Get('stitch/:taskId')
  status(@Param('projectId') projectId: string, @Param('taskId') taskId: string) {
    return this.service.getTaskStatus(projectId, taskId);
  }
}
```

```ts
// storyboard.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StoryboardController } from './storyboard.controller';
import { StoryboardService } from './storyboard.service';
import { StitchConsumer } from './stitch.consumer';
import { STORYBOARD_STITCH_QUEUE } from './storyboard.constants';

@Module({
  imports: [BullModule.registerQueue({
    name: STORYBOARD_STITCH_QUEUE,
    // P1-4：job 级超时 + 指数退避重试，防 MinIO/网络异常导致 worker 永久挂起
    defaultJobOptions: { timeout: 120_000, attempts: 2, backoff: { type: 'exponential', delay: 5000 } },
  })],
  controllers: [StoryboardController],
  providers: [StoryboardService, StitchConsumer],
  exports: [StoryboardService],
})
export class StoryboardModule {}
```

app.module.ts imports 注册 `StoryboardModule`。StitchConsumer 先创建编译通过的最小占位（Task 19 完整实现）。controller.spec.ts 覆盖 202/400/404 路由转发（mock service，参照项目现有 controller 测试模式）。

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/api && npx vitest run src/modules/storyboard/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/storyboard apps/api/src/app.module.ts
git commit -m "feat(api): storyboard stitch task API + queue registration (TD-Group step 18)"
```

---

### Task 19: stitch.consumer（sharp 合成）

**Files:**
- Create: `apps/api/src/modules/storyboard/stitch.consumer.ts`、`stitch.composer.ts`（纯合成函数，便于分层测试）
- Create: `apps/api/test/fixtures/`（2×2 小图 fixture）
- Test: `apps/api/src/modules/storyboard/stitch.composer.spec.ts`（mock sharp）、`stitch.composer.integration.spec.ts`（真实 sharp）

- [ ] **Step 1: 写失败测试（单元：mock sharp 验证调用参数）**

```ts
// stitch.composer.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('sharp', () => {
  const chain = {
    resize: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('cell')),
  };
  const create = vi.fn().mockReturnThis();
  const composite = vi.fn().mockReturnThis();
  const jpeg = vi.fn().mockReturnThis();
  const mod = vi.fn(() => ({ resize: chain.resize, toBuffer: chain.toBuffer }));
  (mod as any).create = vi.fn(() => ({ composite, jpeg, toBuffer: vi.fn().mockResolvedValue(Buffer.from('out')) }));
  return { default: mod };
});

const { composeStoryboard } = await import('./stitch.composer');

describe('composeStoryboard 调用参数（spec 7.2）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('每格 cover 裁剪到单格尺寸、图片按序、缝隙 2px', async () => {
    const sharp = (await import('sharp')).default as any;
    sharp.mockClear();
    await composeStoryboard({
      images: [Buffer.from('a'), Buffer.from('b')], cellWidth: 1000, cellHeight: 562,
      rows: 1, cols: 2, gap: 2, showIndex: false,
    });
    expect(sharp).toHaveBeenCalledTimes(2);
    // resize(cover) 每格一次
    expect(sharp.mock.results[0].value.resize).toHaveBeenCalledWith(1000, 562, { fit: 'cover' });
  });

  it('主画布 composite 布局坐标正确（2px 缝）', async () => {
    const sharp = (await import('sharp')).default as any;
    await composeStoryboard({
      images: [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')], cellWidth: 100, cellHeight: 50,
      rows: 2, cols: 2, gap: 2, showIndex: false, emptyCount: 1, // 4 格 3 图 1 空
    });
    const compositeCall = sharp.create.mock.calls[0][0];
    expect(compositeCall.width).toBe(2 * 100 + 2);
    expect(compositeCall.height).toBe(2 * 50 + 2);
    expect(compositeCall.background).toBe('#1a1a1a');
    const positions = (sharp.create as any)().composite.mock.calls[0][0].map((c: any) => [c.left, c.top]);
    expect(positions).toContainEqual([102, 0]); // 第二列 x = 100+2
  });

  it('showIndex → 序号 SVG composite 左下角', async () => {
    const sharp = (await import('sharp')).default as any;
    await composeStoryboard({
      images: [Buffer.from('a')], cellWidth: 100, cellHeight: 50,
      rows: 1, cols: 1, gap: 2, showIndex: true, indexFontSize: 16,
    });
    const layer = (sharp.create as any)().composite.mock.calls[0][0].find((c: any) => String(c.input).includes('01'));
    expect(layer).toBeTruthy();
  });

  it('空格 → #333 占位格', async () => {
    const sharp = (await import('sharp')).default as any;
    await composeStoryboard({
      images: [], cellWidth: 100, cellHeight: 50,
      rows: 1, cols: 1, gap: 2, showIndex: false, emptyCount: 1,
    });
    const layer = (sharp.create as any)().composite.mock.calls[0][0].find((c: any) => String(c.input).includes('#333333'));
    expect(layer).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/api && npx vitest run src/modules/storyboard/stitch.composer.spec.ts`
Expected: FAIL

- [ ] **Step 3: 写实现（composer + consumer + 集成测试）**

```ts
// stitch.composer.ts — 纯合成函数（sharp 注入行为由调用方决定）
import sharp from 'sharp';

export interface ComposeParams {
  images: (Buffer | null)[]; // 有序；null = 空格/失败格
  cellWidth: number; cellHeight: number;
  rows: number; cols: number; gap: number;
  showIndex: boolean; indexFontSize?: number;
}

export async function composeStoryboard(p: ComposeParams): Promise<Buffer> {
  const { rows, cols, gap, cellWidth, cellHeight } = p;
  const width = cols * cellWidth + (cols - 1) * gap;
  const height = rows * cellHeight + (rows - 1) * gap;

  const layers: { input: Buffer; left: number; top: number }[] = [];
  for (let i = 0; i < rows * cols; i++) {
    const row = Math.floor(i / cols), col = i % cols;
    const left = col * (cellWidth + gap), top = row * (cellHeight + gap);
    const img = p.images[i];
    if (img) {
      layers.push({
        input: await sharp(img).resize(cellWidth, cellHeight, { fit: 'cover' }).toBuffer(),
        left, top,
      });
    } else {
      layers.push({
        input: Buffer.from(
          `<svg width="${cellWidth}" height="${cellHeight}"><rect width="100%" height="100%" fill="#333333"/></svg>`),
        left, top,
      });
    }
    if (p.showIndex && img) {
      const fs = p.indexFontSize ?? Math.round(cellWidth * 0.05);
      const pad = Math.round(cellWidth * 0.037);
      layers.push({
        input: Buffer.from(
          `<svg width="${cellWidth}" height="${cellHeight}"><text x="${pad}" y="${cellHeight - Math.round(pad * 0.8)}" fill="#ffffff" font-size="${fs}" font-weight="600" font-family="sans-serif">${String(i + 1).padStart(2, '0')}</text></svg>`),
        left, top,
      });
    }
  }
  return sharp
    .create({ width, height, channels: 3, background: '#1a1a1a' })
    .composite(layers)
    .jpeg({ quality: 92 })
    .toBuffer();
}
```

```ts
// stitch.consumer.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { composeStoryboard } from './stitch.composer';
import { STORYBOARD_STITCH_QUEUE } from './storyboard.constants';
import { STITCH_WIDTH_MAP, RATIO_MAP } from './stitch.size';

interface StitchJobData {
  projectId: string; userId: string; fileIds: string[];
  gridRows: number; gridCols: number; aspectRatio: string;
  showIndex: boolean; resolution: '2K' | '4K';
}

const CONCURRENCY = 3;

@Processor(STORYBOARD_STITCH_QUEUE, { concurrency: 2 }) // P1-4/P1-新2：第二参数是 NestWorkerOptions 对象
// （@nestjs/bullmq@10.2.1 processor.decorator.d.ts：Processor(queueName, workerOptions)），
// 传数字是 TS 编译错误且并发不生效；4K 合成内存峰值高，限制 worker 并发
export class StitchConsumer extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private minioService: MinioService,
    private gateway: ExecutionGateway,
  ) { super(); }

  async process(job: Job<StitchJobData>) {
    const d = job.data;
    const cellW = Math.round((STITCH_WIDTH_MAP[d.resolution] - (d.gridCols - 1) * 2) / d.gridCols);
    const cellH = Math.round(cellW / RATIO_MAP[d.aspectRatio]);
    const width = STITCH_WIDTH_MAP[d.resolution];

    // 并发 3 取图（简单分批）
    const buffers: (Buffer | null)[] = new Array(d.fileIds.length).fill(null);
    for (let i = 0; i < d.fileIds.length; i += CONCURRENCY) {
      const batch = d.fileIds.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (fileId, j) => {
        try {
          const media = await this.prisma.media.findUnique({ where: { id: fileId } });
          if (!media) return; // Media 记录缺失 → 留 null（灰占位）
          const stream = await this.minioService.getObject(media.key);
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(chunk as Buffer); // 流错误经 for-await 抛出，被此处捕获
          buffers[i + j] = Buffer.concat(chunks);
        } catch {
          // 单图失败 → 该格灰占位继续拼（spec 7.3），不让整个 job 失败
        }
      }));
    }
    const failedCount = buffers.filter((b) => b === null).length;
    if (failedCount === d.fileIds.length) throw new Error('全部图片获取失败');

    // 宫格对齐：buffers 按 fileIds 顺序 = cells 顺序（前端保证 cells 先于空位）
    const capacity = d.gridRows * d.gridCols;
    const cells: (Buffer | null)[] = [...buffers, ...new Array(capacity - buffers.length).fill(null)];

    const out = await composeStoryboard({
      images: cells, cellWidth: cellW, cellHeight: cellH,
      rows: d.gridRows, cols: d.gridCols, gap: 2, showIndex: d.showIndex,
    });
    const height = Math.round(d.gridRows * cellH + (d.gridRows - 1) * 2);

    const key = `stitch/${job.id}.jpg`;
    await this.minioService.upload(key, out, 'image/jpeg');
    const media = await this.prisma.media.create({
      data: {
        userId: d.userId, bucket: 'flowai', key, originalName: `storyboard-stitch-${job.id}.jpg`,
        mimeType: 'image/jpeg', size: out.length, projectId: d.projectId,
        status: 'completed', type: 'generated',
      },
    });

    const result = {
      taskId: job.id!, fileId: media.id,
      // 不返回 url：项目无 /media/:id/content 直链端点（media.controller 仅 :id/url 与 by-key），
      // 前端经 useMediaUrl(fileId) 解析预签名 URL
      width, height,
      cellCount: d.fileIds.length, failedCount,
    };
    this.gateway.emitStitchStatus(d.projectId, { ...result, status: 'COMPLETED' });
    return result;
  }
}

// stitch.size.ts（共享常量，避免前后端重复定义漂移）
export const STITCH_WIDTH_MAP = { '2K': 2048, '4K': 3840 } as const;
export const RATIO_MAP: Record<string, number> = {
  '21:9': 21 / 9, '16:9': 16 / 9, '9:16': 9 / 16, '3:4': 3 / 4, '4:3': 4 / 3, '1:1': 1,
};
```

execution.gateway.ts 追加：

```ts
emitStitchStatus(projectId: string, data: {
  taskId: string; status: 'COMPLETED' | 'FAILED';
  fileId?: string; url?: string; width?: number; height?: number;
  cellCount?: number; failedCount?: number; error?: string;
}) {
  this.server.to(`project:${projectId}`).emit('storyboard:stitch:completed', data);
}
```

集成测试（真实 sharp）：

```ts
// stitch.composer.integration.spec.ts — 2×2 真实小图
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { composeStoryboard } from './stitch.composer';
import * as fs from 'fs';
import * as path from 'path';

async function fixture(color: string) {
  return sharp.create({ width: 60, height: 40, channels: 3, background: color })
    .jpeg().toBuffer();
}

describe('composeStoryboard 集成（真实 sharp）', () => {
  it('2x2 三图一空 → 输出 JPEG 尺寸正确', async () => {
    const images = [await fixture('#ff0000'), await fixture('#00ff00'), await fixture('#0000ff'), null];
    const out = await composeStoryboard({
      images, cellWidth: 120, cellHeight: 68, rows: 2, cols: 2, gap: 2, showIndex: true,
    });
    expect(out.length).toBeGreaterThan(0);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(2 * 120 + 2);
    expect(meta.height).toBe(2 * 68 + 2);
    expect(meta.format).toBe('jpeg');
    // 需人工核对输出时，临时将 buffer 写入 os.tmpdir()（勿写入仓库路径，避免污染 git 状态）
  });
});
```

- [ ] **Step 4: 运行确认通过（单元 + 集成）**

Run: `cd apps/api && npx vitest run src/modules/storyboard/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/storyboard apps/api/src/modules/gateway apps/api/test
git commit -m "feat(api): stitch consumer with sharp composer, unit+integration tests (TD-Group step 19)"
```

---

### Task 20: 前端拼接集成（API + Socket/轮询 + 产物节点 + 撤销项）

**Files:**
- Create: `apps/web/src/api/stitchApi.ts`、`apps/web/src/hooks/useStitchTask.ts`
- Test: `apps/web/src/hooks/useStitchTask.test.ts`
- Modify: `apps/web/src/pages/canvas/components/groups/StitchButton.tsx`（完整实现，替换 Task 12 壳）

- [ ] **Step 1: 写失败测试**

```ts
// useStitchTask.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStitchTask } from './useStitchTask';
import { useCanvasStore } from '@/stores/canvasStore';
import { useGroupHistory } from '@/stores/groupHistory';

vi.mock('@/api/client', () => ({ apiFetch: vi.fn() }));
// P2-1：useSocket 返回 ref 形态；组件外直接调 hook 会抛 Invalid hook call，须 mock + renderHook
vi.mock('@/hooks/useSocket', () => ({ useSocket: () => ({ current: null }) }));

describe('useStitchTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null });
    useGroupHistory.getState().clear();
  });

  it('轮询兜底：Socket 未达时 GET 状态完成后生成产物节点 + 注册撤销项', async () => {
    const { apiFetch } = await import('@/api/client');
    (apiFetch as any)
      .mockResolvedValueOnce({ taskId: 't1' })                       // POST stitch
      .mockResolvedValueOnce({ status: 'PENDING' })                   // poll 1（t=5s）
      .mockResolvedValueOnce({ status: 'COMPLETED', fileId: 'out1', width: 2048, height: 1026 }); // poll 2（t=10s）
    // P2-新6：真实等待第二次轮询 ≥10s > Vitest 默认 5s 超时——必须 fake timers
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useStitchTask('p1'));
      let promise: Promise<string> | undefined;
      act(() => { promise = result.current.start({ fileIds: ['f1', 'f2', 'f3', 'f4'], gridRows: 2, gridCols: 2,
        aspectRatio: '16:9', showIndex: false, resolution: '2K' }); });
      await vi.advanceTimersByTimeAsync(10_500); // 触发两次轮询并 flush 异步回调（65s 超时不会触发）
      const outcome = await promise!;
      expect(outcome).toBe('COMPLETED');
      expect(useCanvasStore.getState().nodes.some((n) => (n.data as any).fileId === 'out1')).toBe(true);
      expect(useGroupHistory.getState().canUndo()).toBe(true); // 撤销项已注册

      // P1-新4 回归：undo 必须删除产物节点（before 为 tombstone，非覆盖恢复）
      act(() => { useGroupHistory.getState().undo(); });
      expect(useCanvasStore.getState().nodes.some((n) => (n.data as any).fileId === 'out1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx vitest run src/hooks/useStitchTask.test.ts`
Expected: FAIL

- [ ] **Step 3: 写实现**

```ts
// stitchApi.ts
import { apiFetch } from './client';
import type { AspectRatio, StitchResolution } from '@/types/group';

export interface StitchParams {
  fileIds: string[]; gridRows: number; gridCols: number;
  aspectRatio: AspectRatio; showIndex: boolean; resolution: StitchResolution;
  sourceGroupId?: string; // 产物节点定位用（组右侧），不发给后端
}
export interface StitchResult {
  taskId: string; status: 'PENDING' | 'COMPLETED' | 'FAILED';
  fileId?: string; url?: string; width?: number; height?: number;
  failedCount?: number; error?: string;
}

export const createStitchTask = (projectId: string, params: StitchParams) =>
  apiFetch<StitchResult>(`/projects/${projectId}/storyboard/stitch`, {
    method: 'POST', body: JSON.stringify(params),
  });

export const getStitchTask = (projectId: string, taskId: string) =>
  apiFetch<StitchResult>(`/projects/${projectId}/storyboard/stitch/${taskId}`);
```

```ts
// useStitchTask.ts — Socket 优先 + 5s 轮询兜底；产物节点生成 + 撤销注册（redo 复用 fileId 不重拼，spec 6.3）
import { useCallback, useRef } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { createStitchTask, getStitchTask, type StitchParams } from '@/api/stitchApi';
import { useCanvasStore } from '@/stores/canvasStore';
import { useGroupHistory } from '@/stores/groupHistory';

export function useStitchTask(projectId: string) {
  const running = useRef(false);
  const socket = useSocket(projectId); // Hooks 规则：顶层调用一次，start 闭包引用（方案 A）

  const spawnResultNode = useCallback((r: { fileId: string; url?: string; width?: number; height?: number }, sourceGroupId?: string) => {
    const add = useCanvasStore.getState().addNode;
    const nodes = useCanvasStore.getState().nodes;
    const group = sourceGroupId
      ? nodes.find((n) => n.id === sourceGroupId)
      : undefined;
    const gx = group ? group.position.x + (group.width ?? 0) + 40 : 100;
    const gy = group?.position.y ?? 100;
    const nodeId = add('image', { x: gx, y: gy }, {
      fileId: r.fileId, status: 'done',
      customSize: r.width && r.height ? { width: r.width, height: r.height } : undefined,
      // 不写 mediaUrl：后端无直链端点，ImageGenNode 按 fileId 自行解析（getMediaUrl 模式）
    });
    // 撤销项：undo=删产物节点 / redo=复用 fileId 重建（不重新拼接）
    const nodeIds = [nodeId];
    // before 必须是 tombstone（P1-新4）：此刻节点已 add 进 store，captureBefore 会取到快照
    // 而非 null → undo 走「覆盖恢复」而非「删除」→ 撤销无效。手动构造 null 占位。
    const before = { nodes: [null] as any, edges: [] };
    const after = {
      nodes: [useCanvasStore.getState().nodes.find((n) => n.id === nodeId) ?? null] as any,
      edges: [],
    };
    useGroupHistory.getState().record({ label: '拼接产物', nodeIds, edgeIds: [], before, after });
  }, []);

  const start = useCallback(async (params: StitchParams): Promise<'COMPLETED' | 'FAILED' | 'TIMEOUT'> => {
    if (running.current) return 'FAILED'; // 防重（spec 7.3）
    running.current = true;
    let outcome: 'COMPLETED' | 'FAILED' | 'TIMEOUT' = 'TIMEOUT';
    try {
      const { taskId } = await createStitchTask(projectId, params);
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = (r: typeof outcome) => { if (!done) { done = true; outcome = r; resolve(); } };
        // Socket 快路径：useSocket 返回 MutableRefObject<Socket|null>（useSocket.ts:4），
        // 必须经 .current 取实例——直接对 ref 调 .once 会静默短路，快路径变死代码
        socket.current?.once('storyboard:stitch:completed', (evt: any) => {
          if (evt.taskId !== taskId) return;
          if (evt.status === 'COMPLETED') { spawnResultNode(evt, params.sourceGroupId); finish('COMPLETED'); }
          else finish('FAILED');
        });
        // 5s 轮询兜底（Socket 断线/事件未达）
        const timer = setInterval(async () => {
          try {
            const r = await getStitchTask(projectId, taskId);
            if (r.status === 'COMPLETED') { clearInterval(timer); spawnResultNode(r, params.sourceGroupId); finish('COMPLETED'); }
            if (r.status === 'FAILED') { clearInterval(timer); finish('FAILED'); }
          } catch { /* 单次轮询失败（网络抖动）→ 等待下一轮 */ }
        }, 5000);
        setTimeout(() => { clearInterval(timer); finish('TIMEOUT'); }, 65_000); // >60s 超时（spec 7.3）
      });
    } finally {
      running.current = false;
    }
    return outcome;
  }, [projectId, spawnResultNode, socket]);

  return { start };
}
```

`useSocket` 已核实（apps/web/src/hooks/useSocket.ts:4）：签名 `useSocket(projectId): MutableRefObject<Socket|null>`，内部连接 `/execution` 命名空间并在 connect 后 `emit('join', projectId)`；T19 的 `emitStitchStatus` 加在 ExecutionGateway（同命名空间）→ 房间与事件自洽。取实例必须经 `socket.current`（P2-1）。

StitchButton 完整实现：点击 → `useStitchTask(projectId).start(params)`（params 从组 data.cells 节点收集 fileId，cells 顺序）+ 按钮 loading + 按 `start` 返回值 Toast（COMPLETED→「拼接完成」，failedCount>0 时附「N 张图片加载失败，已用占位图替代」；FAILED/TIMEOUT→失败/超时 Toast 含重试按钮）+ 首用提示（`localStorage.getItem('stitch-upscale-tip-shown')` 为空时 Toast 一次并写入）。

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && npx vitest run src/hooks/useStitchTask.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/stitchApi.ts apps/web/src/hooks/useStitchTask.ts apps/web/src/hooks/useStitchTask.test.ts apps/web/src/pages/canvas/components/groups/StitchButton.tsx
git commit -m "feat(web): stitch integration — task lifecycle, result node, undo entry (TD-Group step 20)"
```

---

### Task 21: 拼接 UI 细节（防重/首用提示/重试/参数快照）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/groups/StitchButton.tsx`
- Test: `apps/web/src/pages/canvas/components/groups/StitchButton.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// StitchButton.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StitchButton } from './StitchButton';

vi.mock('@/hooks/useStitchTask', () => ({
  useStitchTask: () => ({ start: vi.fn().mockResolvedValue(undefined) }),
}));

describe('StitchButton', () => {
  it('显示当前档位并可切换', () => {
    const onResolutionChange = vi.fn();
    render(<StitchButton groupId="g1" resolution="2K" onResolutionChange={onResolutionChange} />);
    expect(screen.getByText(/拼接\(2K\)/)).toBeTruthy();
  });

  it('执行中禁用（防重）', () => {
    render(<StitchButton groupId="g1" resolution="2K" onResolutionChange={vi.fn()} running />);
    expect((screen.getByRole('button', { name: /拼接/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/groups/StitchButton.test.tsx`
Expected: FAIL

- [ ] **Step 3: 写实现**

StitchButton 组合：档位下拉（2K/4K，切换写回 `updateStoryboardConfig`）+ 触发按钮（running 态 disabled + loading 文案）+ 首用放大提示（localStorage key `flowweb.stitch-upscale-tip`，Toast「图片分辨率不足时将被强制放大，可能影响清晰度」仅首次）+ 失败重试（Toast actionButton「重试」重新 start，参数取触发时刻快照——组件闭包持有 params 对象，宫格调整不影响进行中任务，spec 8）。

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/groups/StitchButton.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/groups/StitchButton.tsx apps/web/src/pages/canvas/components/groups/StitchButton.test.tsx
git commit -m "feat(web): stitch button — resolution dropdown, dedupe, first-use tip, retry (TD-Group step 21)"
```

---

### Task 22: 收尾 — 全量验证与浏览器走查

**Files:** 无新增（验证任务）

- [ ] **Step 1: TypeScript 严格检查**

Run: `cd apps/web && npx tsc --noEmit && cd ../api && npx tsc --noEmit`
Expected: 0 errors（strict: true）

- [ ] **Step 2: 全量测试**

Run: `cd apps/web && npx vitest run && cd ../api && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 3: 浏览器手动走查（spec 10 节清单，dev server）**

启动（按项目记忆 project_startup）：验证 MinIO/PG/Redis → `preview_start "api"` / `preview_start "web"` → 打开 `http://localhost:5173/canvas`，逐项验证：

1. 框选 2+ 节点 → Ctrl+G 打组 → 组边框/标签显示，整体拖动，子节点独立可编辑
2. 组工具栏：折叠→紧凑卡片→展开；解组→节点恢复原位
3. 拖节点入组（含折叠组自动展开）；Shift+G 移出
4. 多选 4 张完成图 → Ctrl+Alt+G → 2×2 分镜组，序号开关、比例切换（9:16 高度变化）、宫格 3×3（空占位）
5. 减宫格 → 溢出图排右侧 + Toast；删单格 → 不收缩
6. 拖 multiImageGen 入组 → 每图成格；超出容量 → 溢出右侧
7. 转普通组（40px 网格 320 宽）→ 转回分镜组
8. 拼接 2K → 按钮 loading → Socket/轮询收结果 → 画布生成节点 + Toast；Ctrl+Z 撤销删节点 → Ctrl+Shift+Z 重做（fileId 复用）
9. 右键副本（40px 偏移、fileId 复用）；清空二次确认 → 空宫格
10. 刷新页面 → 组/宫格/序号状态完整恢复（parentId 列 + hidden 推导）；旧项目（无组）正常打开

Expected: 全部通过；发现问题回到对应 Task 修复并补测试。

- [ ] **Step 4: Commit（如有修复）**

```bash
git add -A && git commit -m "fix: manual walkthrough fixes for canvas groups (TD-Group step 22)"
```

---

## 任务依赖图

```
Phase 1: T1 → T2 → T3（纯函数/后端列/推导）
Phase 2: T4 → T5 → T6 → T7 → T8 → T9（普通组全链路）
Phase 3: T10 → T11 → T12 → T13 → T14（分镜组全链路）
Phase 4: T15（撤销接入 T4-T14 全部 actions）→ T16 → T17
Phase 5: T18 → T19（后端拼接）‖ T20 → T21（前端拼接，与 T18/T19 并行依赖 API 契约）
收尾: T22
```

## 修订记录 v2（架构审查 18 项裁定）

**采纳（P0 全部 5 项）**：P0-1 撤销栈双写 nodeStore（T15 applySnapshot 镜像）；P0-2 取图改 useMediaUrl（T11，`/media/:id/url` 返回 JSON 非图片流）；P0-3 Prisma 自引用 relation+SetNull+index 对齐 Folder 惯例（T2；**驳回 @db.VarChar**——Folder.parentId 无长度约束，非项目惯例）；P0-4 hydrate 对展开态普通组 refitGroupBounds（T4）；P0-5 syncNodes 排序 parents-first（T2）。

**采纳（P1 五项，两项部分）**：P1-2 cells 一致性守卫 repairStoryboardCells（T3）；P1-3 分镜组 ungroup 按 cells 网格重排——实际比审查所述更严重，{0,0} 子节点会全部堆叠（T4）；P1-4 部分采纳——队列 timeout/attempts + worker 并发 2（T18/T19），驳回 per-request AbortController（job 级超时已覆盖，for-await 流错误由新增单图 try/catch 捕获）；P1-6 部分采纳——img 加 loading="lazy" decoding="async"（T11），驳回 IntersectionObserver 方案（过度工程）；P1-7 undo/redo 执行中禁令（T15 isEntryExecuting）。

**驳回（P1 两项）**：P1-1 不做 slice 重构——spec 定案 actions 驻 canvasStore，布局/尺寸/排序逻辑已下沉 groupLayout 纯函数，action 体保持薄；无既有 slice 先例，遵循精准修改。P1-5 跨组拖拽本期不做——spec 未含，两步操作（Shift+G 移出→拖入）可用，YAGNI，列后续增强。

**P2 六项全部核实**：P2-1 揪出真 bug——useSocket 返回 ref 被 T20 当实例调用（`socket?.once?.` 静默短路，快路径死代码），已改 `.current`；P2-2 非矛盾——T4 用 nodeStore.addNode(AppNode)、T20 用 canvasStore.addNode(type,pos,data)，两 store 两 API 各自正确；P2-3 customSize 已确认存在且 ImageGenNode mount 恢复尺寸（nodeStore.ts:111/ImageGenNode.tsx:723）；P2-4 syncNodes=deleteMany+createMany（P0-5 修复据此落地）；P2-5 MinioService getObject(key)/upload(key,body,contentType) 与 T19 用法一致；P2-6 useSocket 连 /execution+join，T19 复用 ExecutionGateway 同命名空间，自洽。

**自查新发现（审查之外，均已修复）**：N1 T10 mergeStoryboard 展开节点构造时 parentId 未设、追加未经 map → 永不挂组（gid 提前生成+构造即挂组）；N2 `/media/:id/content` 端点不存在（media.controller 仅 :id/url 与 by-key）→ 产物不返回 url，前端统一 useMediaUrl(fileId) 解析（T18/T19/T20）；N3 T15 测试导入不存在的 snapshotNodesEdges（改 useGroupHistory）；N4 T17 字段名 nodeProcesses/processType:'generate'（改 nodeProcessMap/'generating'）+ 删空自动解组全局扫描改按被删节点父组；N5 T20 测试组件外调 hook（renderHook+mock useSocket）；N6 T20 轮询无 try/catch + start 无返回值（补 catch + 返回 COMPLETED/FAILED/TIMEOUT 驱动 Toast）。

## 修订记录 v3（第三轮深度走读 9 项裁定）

**P0×2 全部成立、全部修复**：P0-新1 T12 resizeStoryboardGrid 的 `.filter` 把溢出节点直接删除（map 中的 overflow 分支成死代码，测试 `find('b')!` 必 TypeError）→ 去 filter 纯 map 改写 + 补存活/nodeStore 双写回归断言；P0-新2 T11 空宫格填充事件 `(data as any).groupId` 恒 undefined（GroupNodeData 无此字段）→ GroupNode 从 NodeProps 取 id 透传，detail 改用 props.id + 补 dispatchEvent detail 断言。

**P1×2 成立、1 驳回**：P1-新1 成立（系 v2 修复 N1 引入的回归——expanded 归零 {0,0} 使字典序排序永远插队最前）→ 构造时暂留 multi 原位置排序、追加时统一归零 + 补 cells[0] 顺序断言；P1-新2 成立（已对照安装版 `@nestjs/bullmq@10.2.1` processor.decorator.d.ts：第二参数为 `NestWorkerOptions` 对象）→ 改 `@Processor(name, { concurrency: 2 })`；P1-新3 驳回——nodeStore.nodes 就是 `Record<string, AppNode>`（nodeStore.ts:281，`ns.nodes[id]` 是 Record 键访问），审查者把它与 canvasStore.nodes（数组）混淆；已在 T15 加结构说明注避免执行时误判。

**P2×2 采纳、2 驳回**：P2-新2 采纳为验证注记（useMediaUrl 确无缓存；data.mediaUrl 短路覆盖常见场景，T22 走查大宫格卡顿再优化，勿提前优化）；P2-新3 采纳——T18 service 增 `media.findMany({ id in fileIds, projectId })` 归属校验（防跨项目越权 + fail-fast），测试补断言与 400 用例；P2-新1 驳回——AppNode 无 parentId 字段（nodeStore 不存父子关系），position 本就允许陈旧（拖动 onNodesChange 只同步 dimensions 不同步 position，既有惯例）；P2-新4 驳回——main.ts 无 `setGlobalPrefix`（grep 0 命中），project.controller.ts:6 即 `@Controller('api/projects')`，T18 前缀写法正确（二次核实）。

**顺带修正**：T18 it.each 400 用例未 mock findUnique，实际走 404 分支、`toThrow()` 无模式为安慰剂测试 → 补 mock + `toThrow(BadRequestException)` 精确断言。

## 修订记录 v4（第四轮最终审核 5 项裁定）

**P0×1 成立、修复**：P0-新4 T19 consumer 使用 `RATIO_MAP` 但 import 段只导入 `STITCH_WIDTH_MAP`——tsc 严格模式 `TS2304` 硬阻断 + 运行时 ReferenceError，且 composer 单测（mock sharp）不实例化 consumer 掩盖此错 → import 补 `RATIO_MAP`。

**P1×2 成立、修复**：P1-新4 T20 spawnResultNode 中 `captureBefore` 在 `add()` 之后调用——节点已存在，before 返回快照而非 tombstone → undo 走覆盖恢复而非删除，撤销无效 → 手动构造 `{ nodes: [null] }`（方案 A），测试补「undo 后产物节点消失」回归断言；P1-新5 T4 groupNodes 组 id 在 bounds 计算后生成，与 T15「新增 id 提前纳入 capture」矛盾 → id 生成提前至校验后（T10 已提前✅、T12 addImageToStoryboardCell 本就在函数首行✅、T13 buildGroupCopy 补「入口统一生成新 id」约定）。

**P2×1 采纳、1 驳回**：P2-新6 采纳且比审查所述更严重——PENDING→COMPLETED 需第二次轮询，真实等待 ≥10s 超过 Vitest 默认 5s 超时，**必挂**而非 flaky → `vi.useFakeTimers()` + `advanceTimersByTimeAsync(10_500)` + act 包裹；P2-新5 驳回——nodeStore.nodes 为 `Record<string, AppNode>` 并非假设而是第二轮已实际 Read 验证的事实（nodeStore.ts:281 接口声明 + addNode 实现 `nodes: { ...s.nodes, [node.id]: ... }` 均为 Record 键值展开，工具输出在案），T15 注释已引用行号。

四轮累计 40 项裁定闭环（v1 8 + v2 18 + v3 9 + v4 5）。






