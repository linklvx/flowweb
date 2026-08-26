# 画布自动保存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除画布手动保存，实现"脏标志收敛 + 2s debounce 全量 PUT + 关键时机 flush + 乐观锁 + 三态指示器"的自动保存。

**Architecture:** 新建 `canvasSyncRuntime.ts` 统一同步运行时（订阅双 store 判脏 → debounce → `PUT /projects/:id/canvas` 原子更新带乐观锁），关键时机（生成前/路由切走/pagehide）立即 flush；后端合并 nodes/edges 双端点为单事务端点，version 不匹配返回 409，前端 409 时按 hydrate 模式重载；`CanvasTopBar` 保存按钮替换为三态指示器，模板入口移至用户下拉菜单。

**Tech Stack:** React 18.3.1 + @xyflow/react + Zustand/zundo + vitest（web）；NestJS + Prisma + PostgreSQL + vitest（api）。

**Spec:** `docs/superpowers/specs/canvas-autosave-design.md`（已确认 2026-08-26）

**关键既有事实（实现者必读）：**
- 循环依赖裁定模式：runtime 模块顶层只允许 import 声明/函数定义/纯常量，严禁顶层访问 store 值（参照 canvasHistoryRuntime.ts 头注）
- `historyPartialize`（createPartialize）只返回 `{ nodes, edges, __nodeDataSnap }`——新增 store 字段自动不进 undo 历史
- `useCanvasPersistence` 订阅 canvasStore 任意 set（500ms debounce 写 localStorage）——`saveStatus` 变更会触发快照写，无害（写的是最终态）
- 测试命令：web `pnpm --filter @flowweb/web test`；api `pnpm --filter @flowweb/api test`（含 `tsc -p tsconfig.spec.json --noEmit`）
- Prisma 迁移规则（memory）：只用 `migrate dev --name`，禁 `db push`；需一次性 CREATEDB 授权

---

### Task 1: Prisma schema 加 version 字段 + 迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma:136-150`（CanvasProject model）

- [ ] **Step 1: 修改 schema**

在 `apps/api/prisma/schema.prisma` 的 CanvasProject model 中，`viewport` 行后加：

```prisma
model CanvasProject {
  id        String       @id @default(cuid())
  name      String
  userId    String?
  viewport  Json         @default("{ \"x\": 0, \"y\": 0, \"zoom\": 1 }")
  version   Int          @default(0)
  nodes     CanvasNode[]
  edges     CanvasEdge[]
  templates Template[]
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  user      User?        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

- [ ] **Step 2: 生成迁移**

```bash
cd apps/api && npx prisma migrate dev --name canvas-autosave-version
```

Expected: `Migration "canvas-autosave-version" applied`，无已有迁移冲突（若提示 CREATEDB 权限，按 memory 先授权再重跑）。

- [ ] **Step 3: 验证**

```bash
cd apps/api && npx prisma migrate status
```

Expected: `Database schema is up to date!`

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): CanvasProject 加 version 字段——自动保存乐观锁基座"
```

---

### Task 2: 后端 syncCanvas 服务方法（TDD）

**Files:**
- Modify: `apps/api/src/modules/project/project.service.ts`
- Test: `apps/api/src/modules/project/project.service.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `project.service.spec.ts` 末尾追加（自包含 mock，不依赖文件既有 setup）：

```typescript
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('ProjectService.syncCanvas', () => {
  const mkTx = () => ({
    canvasProject: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    canvasNode: { deleteMany: vi.fn(), createMany: vi.fn() },
    canvasEdge: { deleteMany: vi.fn(), createMany: vi.fn() },
  });

  const mkService = (tx: ReturnType<typeof mkTx>) => {
    const prisma = {
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    };
    return { service: new ProjectService(prisma as any), prisma };
  };

  const nodes = [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }];
  const edges = [{ id: 'e1', source: 'n1', target: 'n2' }];

  it('version 匹配：事务内更新 nodes+edges，version+1 并返回', async () => {
    const tx = mkTx();
    tx.canvasProject.updateMany.mockResolvedValue({ count: 1 });
    const { service } = mkService(tx);
    const result = await service.syncCanvas('p1', nodes, edges, 3);
    expect(tx.canvasProject.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', version: 3 },
      data: { version: 4 },
    });
    expect(tx.canvasNode.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(tx.canvasEdge.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(tx.canvasNode.createMany).toHaveBeenCalled();
    expect(tx.canvasEdge.createMany).toHaveBeenCalled();
    expect(result).toEqual({ version: 4 });
  });

  it('保留客户端 node ID + parentId 父先子后排序', async () => {
    const tx = mkTx();
    tx.canvasProject.updateMany.mockResolvedValue({ count: 1 });
    const { service } = mkService(tx);
    const mixed = [
      { id: 'child', type: 'textInput', position: { x: 0, y: 0 }, data: {}, parentId: 'parent' },
      { id: 'parent', type: 'group', position: { x: 0, y: 0 }, data: {} },
    ];
    await service.syncCanvas('p1', mixed, [], 0);
    const arg = tx.canvasNode.createMany.mock.calls[0][0].data as any[];
    expect(arg[0].id).toBe('parent');
    expect(arg[1].id).toBe('child');
  });

  it('空 nodes/edges：deleteMany 后不 createMany', async () => {
    const tx = mkTx();
    tx.canvasProject.updateMany.mockResolvedValue({ count: 1 });
    const { service } = mkService(tx);
    await service.syncCanvas('p1', [], [], 0);
    expect(tx.canvasNode.createMany).not.toHaveBeenCalled();
    expect(tx.canvasEdge.createMany).not.toHaveBeenCalled();
  });

  it('version 不匹配：抛 ConflictException', async () => {
    const tx = mkTx();
    tx.canvasProject.updateMany.mockResolvedValue({ count: 0 });
    tx.canvasProject.findUnique.mockResolvedValue({ version: 9 });
    const { service } = mkService(tx);
    await expect(service.syncCanvas('p1', nodes, edges, 3)).rejects.toThrow(ConflictException);
    expect(tx.canvasNode.deleteMany).not.toHaveBeenCalled();
  });

  it('项目不存在：抛 NotFoundException', async () => {
    const tx = mkTx();
    tx.canvasProject.updateMany.mockResolvedValue({ count: 0 });
    tx.canvasProject.findUnique.mockResolvedValue(null);
    const { service } = mkService(tx);
    await expect(service.syncCanvas('p1', nodes, edges, 3)).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/api && npx vitest run src/modules/project/project.service.spec.ts
```

Expected: FAIL——`service.syncCanvas is not a function`

- [ ] **Step 3: 实现**

在 `project.service.ts` 顶部 import 改为：

```typescript
import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
```

在 `syncEdges` 方法后新增（沿用 syncNodes 的排序与 ID 保留逻辑，事务原子化）：

```typescript
  /** 画布整体原子同步（自动保存）：乐观锁 version 校验 + nodes/edges 同事务重写 */
  async syncCanvas(projectId: string, nodes: NodeInput[], edges: EdgeInput[], version: number) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.canvasProject.updateMany({
        where: { id: projectId, version },
        data: { version: version + 1 },
      });
      if (updated.count === 0) {
        const exists = await tx.canvasProject.findUnique({
          where: { id: projectId },
          select: { version: true },
        });
        if (!exists) throw new NotFoundException('Project not found');
        throw new ConflictException('画布已被他人修改');
      }
      await tx.canvasNode.deleteMany({ where: { projectId } });
      if (nodes.length > 0) {
        const sorted = [...nodes].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
        await tx.canvasNode.createMany({
          data: sorted.map((n) => ({
            id: n.id,
            projectId,
            type: n.type,
            position: n.position,
            data: n.data,
            width: n.width ?? null,
            height: n.height ?? null,
            parentId: n.parentId ?? null,
          })),
        });
      }
      await tx.canvasEdge.deleteMany({ where: { projectId } });
      if (edges.length > 0) {
        await tx.canvasEdge.createMany({
          data: edges.map((e) => ({
            id: e.id,
            projectId,
            sourceId: e.sourceId || e.source || '',
            targetId: e.targetId || e.target || '',
          })),
        });
      }
      return { version: version + 1 };
    });
  }
```

- [ ] **Step 4: 运行确认通过**

```bash
cd apps/api && npx vitest run src/modules/project/project.service.spec.ts
```

Expected: PASS（新增 5 用例全绿，既有用例不回归）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/project/project.service.ts apps/api/src/modules/project/project.service.spec.ts
git commit -m "feat(api): syncCanvas 服务——事务原子更新 nodes/edges + 乐观锁 409"
```

---

### Task 3: 后端 PUT /canvas 路由（TDD）

**Files:**
- Modify: `apps/api/src/modules/project/project.controller.ts:31-39`
- Test: `apps/api/src/modules/project/project.controller.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `project.controller.spec.ts` 追加（自包含）：

```typescript
describe('PUT :id/canvas', () => {
  it('透传 nodes/edges/version 到 service.syncCanvas', async () => {
    const syncCanvas = vi.fn().mockResolvedValue({ version: 4 });
    const controller = new ProjectController({ syncCanvas } as any);
    const body = { nodes: [{ id: 'n1' }], edges: [], version: 3 };
    await controller.syncCanvas('p1', body);
    expect(syncCanvas).toHaveBeenCalledWith('p1', body.nodes, body.edges, 3);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/api && npx vitest run src/modules/project/project.controller.spec.ts
```

Expected: FAIL——`controller.syncCanvas is not a function`

- [ ] **Step 3: 实现**

`project.controller.ts` 在 `syncEdges` 路由后新增（旧路由暂保留，Task 13 清理）：

```typescript
  @Put(':id/canvas')
  syncCanvas(
    @Param('id') id: string,
    @Body() body: { nodes: any[]; edges: any[]; version: number },
  ) {
    return this.projectService.syncCanvas(id, body.nodes, body.edges, body.version);
  }
```

- [ ] **Step 4: 运行确认通过**

```bash
cd apps/api && npx vitest run src/modules/project/project.controller.spec.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/project/project.controller.ts apps/api/src/modules/project/project.controller.spec.ts
git commit -m "feat(api): PUT /projects/:id/canvas 路由——单端点原子保存"
```

---

### Task 4: 前端 projectApi.syncCanvas

**Files:**
- Modify: `apps/web/src/api/projectApi.ts`

- [ ] **Step 1: 添加 API 函数**（薄封装无独立测试，runtime 测试将 mock 本模块；syncNodes/syncEdges 暂保留供未迁移调用方使用）

在 `projectApi.ts` 的 `syncEdges` 后新增：

```typescript
export interface SyncCanvasPayload {
  nodes: any[];
  edges: any[];
  version: number;
}

export async function syncCanvas(projectId: string, payload: SyncCanvasPayload) {
  return apiFetch<{ version: number }>(`/projects/${projectId}/canvas`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
```

- [ ] **Step 2: 类型检查**

```bash
cd apps/web && npx tsc -b --pretty false
```

Expected: 无新错误

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api/projectApi.ts
git commit -m "feat(web): projectApi 增加 syncCanvas 封装"
```

---

### Task 5: canvasStore 增加 saveStatus / serverVersion（TDD）

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts`（CanvasState 接口 + 初始 state）
- Test: `apps/web/src/stores/canvasStore.test.ts`

- [ ] **Step 1: 写失败测试**

在 `canvasStore.test.ts` 适当 describe 中追加：

```typescript
describe('自动保存状态字段', () => {
  it('初始 saveStatus=saved、serverVersion=0', () => {
    const s = useCanvasStore.getState();
    expect(s.saveStatus).toBe('saved');
    expect(s.serverVersion).toBe(0);
  });

  it('saveStatus/serverVersion 变更不进 undo 历史', () => {
    useCanvasStore.setState({ saveStatus: 'saving' });
    useCanvasStore.setState({ serverVersion: 5, saveStatus: 'saved' });
    const t = useCanvasStore.temporal.getState() as any;
    expect(t.pastStates.length).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/web && npx vitest run src/stores/canvasStore.test.ts
```

Expected: FAIL——`saveStatus` undefined

- [ ] **Step 3: 实现**

`canvasStore.ts` CanvasState 接口中 `isHydrating: boolean;` 后加：

```typescript
  /** 自动保存状态（spec canvas-autosave-design.md D1）——不进 history partialize（createPartialize 显式字段） */
  saveStatus: 'saved' | 'dirty' | 'saving' | 'error';
  /** 服务端画布版本号（乐观锁）——PUT /canvas 成功后由 runtime 更新 */
  serverVersion: number;
```

store 创建初始 state 对象中（找 `isHydrating: false` 所在的初始 state 处，如无显式字段则在 create 首个 set 返回对象里）加：

```typescript
  saveStatus: 'saved',
  serverVersion: 0,
```

若初始 state 为 actions + 字段混合对象，直接在同对象补两字段（zustand create 初始 state 即该对象字面量）。

- [ ] **Step 4: 运行确认通过**

```bash
cd apps/web && npx vitest run src/stores/canvasStore.test.ts
```

Expected: PASS（含既有用例）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/stores/canvasStore.test.ts
git commit -m "feat(web): canvasStore 增加 saveStatus/serverVersion 字段"
```

---

### Task 6: canvasSyncRuntime 核心（TDD，本 plan 最大任务）

**Files:**
- Create: `apps/web/src/stores/canvasSyncRuntime.ts`
- Test: Create: `apps/web/src/stores/canvasSyncRuntime.test.ts`

- [ ] **Step 1: 写失败测试（完整测试文件）**

```typescript
// apps/web/src/stores/canvasSyncRuntime.test.ts
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('antd', () => ({ message: { warning: vi.fn(), error: vi.fn() } }));
vi.mock('@/api/projectApi', () => ({
  syncCanvas: vi.fn(),
}));
vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
}));

import { message } from 'antd';
import { syncCanvas } from '@/api/projectApi';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import {
  AUTO_SAVE_DELAY_MS,
  bindCanvasSync,
  buildSyncPayload,
  flushCanvasSync,
  flushOnUnload,
  scheduleSync,
} from './canvasSyncRuntime';

const syncCanvasMock = vi.mocked(syncCanvas);

function seedStore() {
  useCanvasStore.setState({
    projectId: 'p1',
    nodes: [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any],
    edges: [],
    serverVersion: 3,
    saveStatus: 'saved',
    isHydrating: false,
  });
  useNodeStore.setState({ nodes: { n1: { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: 'hi' } } as any } });
}

describe('canvasSyncRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seedStore();
    syncCanvasMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('scheduleSync 默认 2s debounce：连续 3 次仅 1 次 PUT', async () => {
    syncCanvasMock.mockResolvedValue({ version: 4 });
    void scheduleSync();
    void scheduleSync();
    void scheduleSync();
    expect(useCanvasStore.getState().saveStatus).toBe('dirty');
    expect(syncCanvasMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    expect(syncCanvasMock).toHaveBeenCalledTimes(1);
    expect(useCanvasStore.getState().saveStatus).toBe('saved');
    expect(useCanvasStore.getState().serverVersion).toBe(4);
  });

  it('PUT 载荷：nodes 合并 nodeStore data + 携带 version', async () => {
    syncCanvasMock.mockResolvedValue({ version: 4 });
    void scheduleSync();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    const arg = syncCanvasMock.mock.calls[0][1];
    expect(arg.version).toBe(3);
    expect(arg.nodes[0].data).toEqual({ content: 'hi' });
    expect(arg.edges).toEqual([]);
  });

  it('H-1：窗口内切换项目不写旧项目', async () => {
    syncCanvasMock.mockResolvedValue({ version: 4 });
    void scheduleSync();
    useCanvasStore.setState({ projectId: 'p2' });
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    expect(syncCanvasMock).not.toHaveBeenCalled();
  });

  it('isHydrating 窗口内定时器触发不保存', async () => {
    syncCanvasMock.mockResolvedValue({ version: 4 });
    void scheduleSync();
    useCanvasStore.setState({ isHydrating: true });
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    expect(syncCanvasMock).not.toHaveBeenCalled();
  });

  it('保存期间再变更（epoch 竞争）：完成后保持 dirty 并重调度', async () => {
    let resolveFirst!: (v: { version: number }) => void;
    syncCanvasMock.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    void scheduleSync();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS); // 首次 doSave in flight
    void scheduleSync(); // flight 中新变更
    resolveFirst({ version: 4 });
    await vi.advanceTimersByTimeAsync(0);
    expect(useCanvasStore.getState().saveStatus).toBe('dirty');
    syncCanvasMock.mockResolvedValue({ version: 5 });
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    expect(useCanvasStore.getState().saveStatus).toBe('saved');
    expect(useCanvasStore.getState().serverVersion).toBe(5);
  });

  it('网络失败：saveStatus=error', async () => {
    syncCanvasMock.mockRejectedValue(new Error('network'));
    void scheduleSync();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    expect(useCanvasStore.getState().saveStatus).toBe('error');
  });

  it('409：按 hydrate 模式重载——withHistoryPaused + 清历史 + serverVersion 取服务端 + 组尺寸重算 + toast', async () => {
    const err = Object.assign(new Error('conflict'), { status: 409 });
    syncCanvasMock.mockRejectedValueOnce(err);
    const { apiFetch } = await import('@/api/client');
    vi.mocked(apiFetch).mockResolvedValueOnce({
      version: 9,
      nodes: [
        { id: 'n1', type: 'textInput', position: { x: 1, y: 1 }, data: { content: 'server' } },
        { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal' } },
      ],
      edges: [],
    });
    const refit = vi.fn();
    useCanvasStore.setState({ refitGroupBounds: refit } as any);
    void scheduleSync();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    expect(useCanvasStore.getState().serverVersion).toBe(9);
    expect(useCanvasStore.getState().saveStatus).toBe('saved');
    expect((useNodeStore.getState().nodes.n1 as any).data.content).toBe('server');
    expect(refit).toHaveBeenCalledWith('g1');
    const t = useCanvasStore.temporal.getState() as any;
    expect(t.pastStates.length).toBe(0);
    expect(message.warning).toHaveBeenCalledWith('画布已被他人修改，已加载最新版本');
  });

  describe('flushCanvasSync', () => {
    // ⚠️ execute 含 500ms 真实 setTimeout 等待——fake timers 下不可直接 await 整个 flush
    // （会死锁），须先持有 promise 再 advanceTimersByTimeAsync 推进重试定时器（评审 P0-3）
    it('execute：失败重试 1 次（500ms 间隔），仍失败 toast 放行', async () => {
      syncCanvasMock.mockRejectedValue(new Error('x'));
      void scheduleSync();
      const p = flushCanvasSync('execute');
      await vi.advanceTimersByTimeAsync(500);
      await p;
      expect(syncCanvasMock).toHaveBeenCalledTimes(2);
      expect(message.warning).toHaveBeenCalledWith('保存失败，生成将使用上次保存的参数');
      expect(useCanvasStore.getState().saveStatus).toBe('error');
    });

    it('execute：首次失败重试成功则无 toast', async () => {
      syncCanvasMock.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ version: 4 });
      void scheduleSync();
      const p = flushCanvasSync('execute');
      await vi.advanceTimersByTimeAsync(500);
      await p;
      expect(message.warning).not.toHaveBeenCalled();
      expect(useCanvasStore.getState().saveStatus).toBe('saved');
    });

    it('error 态 flush(retry) 直接再保存——重试按钮路径（评审 P0-2）', async () => {
      useCanvasStore.setState({ saveStatus: 'error' });
      syncCanvasMock.mockResolvedValue({ version: 4 });
      await flushCanvasSync('retry');
      expect(syncCanvasMock).toHaveBeenCalledTimes(1);
      expect(useCanvasStore.getState().saveStatus).toBe('saved');
    });

    it('template：失败返回 false（由调用方阻断模板提交），无 toast', async () => {
      syncCanvasMock.mockRejectedValue(new Error('x'));
      void scheduleSync();
      const ok = await flushCanvasSync('template');
      expect(ok).toBe(false);
      expect(message.warning).not.toHaveBeenCalled();
      expect(useCanvasStore.getState().saveStatus).toBe('error');
    });

    it('无 dirty/error 时直接返回不发请求', async () => {
      await flushCanvasSync('execute');
      expect(syncCanvasMock).not.toHaveBeenCalled();
    });
  });

  it('flushOnUnload：keepalive fetch 携带完整载荷', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    void scheduleSync();
    flushOnUnload();
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/p1/canvas', expect.objectContaining({
      method: 'PUT',
      keepalive: true,
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.version).toBe(3);
    vi.unstubAllGlobals();
  });

  describe('bindCanvasSync 订阅判脏', () => {
    it('nodes 结构变更 → dirty', async () => {
      syncCanvasMock.mockResolvedValue({ version: 4 });
      const unbind = bindCanvasSync();
      useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'n2', type: 'textInput', position: { x: 5, y: 5 }, data: {} } as any] }));
      expect(useCanvasStore.getState().saveStatus).toBe('dirty');
      unbind();
    });

    it('nodeProcessMap / selected 变更 → 不 dirty', () => {
      const unbind = bindCanvasSync();
      useCanvasStore.setState({ nodeProcessMap: { n1: { processType: 'generating', status: 'processing' } as any } });
      useCanvasStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
      expect(useCanvasStore.getState().saveStatus).toBe('saved');
      unbind();
    });

    it('isHydrating 窗口内变更 → 不 dirty', () => {
      const unbind = bindCanvasSync();
      useCanvasStore.setState({ isHydrating: true });
      useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'n3', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any] }));
      useCanvasStore.setState({ isHydrating: false });
      expect(useCanvasStore.getState().saveStatus).toBe('saved');
      unbind();
    });

    it('nodeStore.nodes 引用变更（data 写入）→ dirty', () => {
      const unbind = bindCanvasSync();
      const ns = useNodeStore.getState();
      useNodeStore.setState({ nodes: { ...ns.nodes } });
      expect(useCanvasStore.getState().saveStatus).toBe('dirty');
      unbind();
    });
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/web && npx vitest run src/stores/canvasSyncRuntime.test.ts
```

Expected: FAIL——模块不存在

- [ ] **Step 3: 实现 canvasSyncRuntime.ts（完整文件）**

```typescript
// apps/web/src/stores/canvasSyncRuntime.ts
// 画布自动保存运行时（spec: canvas-autosave-design.md D1/D2/D3）。
// ⚠️ 循环依赖裁定（同 canvasHistoryRuntime.ts）：本模块顶层 import canvasStore/canvasHistoryRuntime
//    仅限 import 声明与函数定义，严禁顶层访问其值。canvasHistoryRuntime 反向 import 本模块
//    scheduleSync——双向均为调用点求值，ESM 安全。
import isEqual from 'fast-deep-equal';
import { message } from 'antd';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { pickStructNodes, pickStructEdges } from './canvasHistory';
import { withHistoryPaused, hydrateLoaded } from './canvasHistoryRuntime';
import { syncCanvas } from '@/api/projectApi';
import { apiFetch } from '@/api/client';
import { hydrateNodes } from '@/utils/nodeOrder';

export const AUTO_SAVE_DELAY_MS = 2000;
export const UNDO_SYNC_DELAY_MS = 300;
const FLUSH_RETRY_DELAY_MS = 500;
/** keepalive fetch body 上限约 64KB，超限退化依赖 localStorage 快照兜底 */
const KEEPALIVE_BODY_LIMIT = 60000;

let autoTimer: ReturnType<typeof setTimeout> | null = null;
let dirtyEpoch = 0;

/** 同步载荷：canvasStore 结构为基准 + nodeStore data（原 canvasHistoryRuntime.buildSyncPayload 迁入） */
export function buildSyncPayload() {
  const cs = useCanvasStore.getState();
  const ns = useNodeStore.getState();
  return cs.nodes.map((nd) => ({
    id: nd.id,
    type: nd.type || 'videoGen',
    parentId: nd.parentId ?? null,
    position: nd.position,
    data: ns.nodes[nd.id]?.data ?? nd.data,
    width: nd.width,
    height: nd.height,
  }));
}

function clearTimer() {
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
}

/** 调度自动保存：窗口内重复调用合并（trailing debounce），dirty 即时置位供指示器显示 */
export function scheduleSync(delayMs = AUTO_SAVE_DELAY_MS): Promise<void> {
  const pid = useCanvasStore.getState().projectId;
  if (!pid) return Promise.resolve();
  dirtyEpoch++;
  useCanvasStore.setState({ saveStatus: 'dirty' });
  clearTimer();
  return new Promise((resolve) => {
    autoTimer = setTimeout(() => {
      autoTimer = null;
      // H-1：窗口内可能已切换项目——重读校验，防旧 timer 用新状态写旧项目
      const cur = useCanvasStore.getState();
      if (cur.projectId !== pid || cur.isHydrating) { resolve(); return; }
      doSave().then(() => resolve());
    }, delayMs);
  });
}

function reschedule() {
  clearTimer();
  autoTimer = setTimeout(() => { autoTimer = null; void doSave(); }, AUTO_SAVE_DELAY_MS);
}

async function doSave(): Promise<boolean> {
  const cs = useCanvasStore.getState();
  const pid = cs.projectId;
  // 'error' 放行：flush 重试路径需要（debounce 路径不经过此处）
  if (!pid || (cs.saveStatus !== 'dirty' && cs.saveStatus !== 'error')) return true;
  const epoch = dirtyEpoch;
  useCanvasStore.setState({ saveStatus: 'saving' });
  try {
    const latest = useCanvasStore.getState();
    const res = await syncCanvas(pid, {
      nodes: buildSyncPayload(),
      edges: latest.edges as any,
      version: latest.serverVersion,
    });
    if (dirtyEpoch !== epoch) {
      // 保存期间又有变更：version 已推进，保持 dirty 重新调度
      useCanvasStore.setState({ serverVersion: res.version, saveStatus: 'dirty' });
      reschedule();
    } else {
      useCanvasStore.setState({ serverVersion: res.version, saveStatus: 'saved' });
    }
    return true;
  } catch (err: any) {
    if (err?.status === 409) {
      await reloadFromServer(pid);
      return true;
    }
    console.error('[canvasSync] save failed', err);
    useCanvasStore.setState({ saveStatus: 'error' });
    return false;
  }
}

/** 409 冲突重载：复用 loadProjectIntoStore 的 hydrate 模式（withHistoryPaused + 清历史，防 undo 栈污染） */
async function reloadFromServer(pid: string) {
  try {
    const project = await apiFetch<any>(`/projects/${pid}`);
    useCanvasStore.getState().setHydrating(true);
    withHistoryPaused(() => {
      useCanvasStore.setState({
        nodes: hydrateNodes((project.nodes || []).map((n: any) => ({
          ...n, width: n.width ?? undefined, height: n.height ?? undefined,
        }))) as any,
        edges: (project.edges || []).map((e: any) => ({
          id: e.id, source: e.sourceId || e.source, target: e.targetId || e.target,
        })),
        serverVersion: project.version ?? 0,
        saveStatus: 'saved',
      });
      useCanvasStore.getState().applyGroupDerivations();
      refitExpandedGroups();
      const content: Record<string, any> = {};
      for (const n of project.nodes || []) {
        content[n.id] = {
          id: n.id, type: n.type, position: n.position || { x: 0, y: 0 },
          data: n.data || {}, width: n.width ?? undefined, height: n.height ?? undefined,
        };
      }
      useNodeStore.setState({ nodes: content });
    });
    hydrateLoaded();
    useCanvasStore.getState().setHydrating(false);
    message.warning('画布已被他人修改，已加载最新版本');
  } catch (err) {
    console.error('[canvasSync] 409 reload failed', err);
    useCanvasStore.setState({ saveStatus: 'error' });
  }
}

/** P0-4：展开态普通组按子节点包围盒重算（page.tsx loadProjectIntoStore 同语义，提取共用——评审 P1-6） */
export function refitExpandedGroups() {
  for (const g of useCanvasStore.getState().nodes.filter(
    (n) => n.type === 'group' && (n.data as any).groupType === 'normal'
      && !(n.data as any).collapsed && !(n.data as any).manuallyResized,
  )) {
    useCanvasStore.getState().refitGroupBounds(g.id);
  }
}

/** 立即 flush（跳过 debounce）。守卫放行 dirty 与 error（error 是重试按钮路径，评审 P0-2）。
 *  execute：失败 500ms 后重试 1 次，仍失败 toast 放行（spec D-a）
 *  retry：error 态指示器点击，单次尝试无 toast（失败保持 error 由指示器反馈）
 *  template：模板保存前，单次尝试，失败返回 false 由调用方阻断提交
 *  返回 true = 已保存/无需保存，false = 失败 */
export async function flushCanvasSync(reason: 'execute' | 'retry' | 'template'): Promise<boolean> {
  clearTimer();
  const cs = useCanvasStore.getState();
  if (!cs.projectId || (cs.saveStatus !== 'dirty' && cs.saveStatus !== 'error')) return true;
  if (reason === 'retry' || reason === 'template') return doSave();
  const ok = await doSave();
  if (ok) return true;
  await new Promise((r) => setTimeout(r, FLUSH_RETRY_DELAY_MS));
  const ok2 = await doSave();
  if (!ok2 && useCanvasStore.getState().saveStatus === 'error') {
    message.warning('保存失败，生成将使用上次保存的参数');
  }
  return ok2;
}

/** pagehide 兜底：keepalive fetch（同源 cookie 自动携带；无法感知结果，接受 localStorage 快照兜底） */
export function flushOnUnload(): void {
  const cs = useCanvasStore.getState();
  if (!cs.projectId || cs.saveStatus !== 'dirty') return;
  const body = JSON.stringify({
    nodes: buildSyncPayload(),
    edges: cs.edges,
    version: cs.serverVersion,
  });
  if (body.length > KEEPALIVE_BODY_LIMIT) {
    console.warn('[canvasSync] unload payload 超过 keepalive 限制，跳过（依赖 localStorage 快照兜底）');
    return;
  }
  fetch(`/api/projects/${cs.projectId}/canvas`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body,
  }).catch(() => {});
}

/** 订阅双 store 判脏（spec D1 矩阵：结构/data→dirty；nodeProcessMap/瞬态/isHydrating→不 dirty） */
export function bindCanvasSync(): () => void {
  const unsubCs = useCanvasStore.subscribe((state, prev) => {
    if (state.isHydrating || prev.isHydrating) return;
    if (state.projectId !== prev.projectId) return;
    const changed = !isEqual(pickStructNodes(state.nodes), pickStructNodes(prev.nodes))
      || !isEqual(pickStructEdges(state.edges), pickStructEdges(prev.edges));
    if (changed) void scheduleSync();
  });
  const unsubNs = useNodeStore.subscribe((state, prev) => {
    if (useCanvasStore.getState().isHydrating) return;
    if (state.nodes !== prev.nodes) void scheduleSync();
  });
  return () => { unsubCs(); unsubNs(); };
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd apps/web && npx vitest run src/stores/canvasSyncRuntime.test.ts
```

Expected: PASS 全绿。若个别用例因 store 初始字段缺省报错，检查 Task 5 字段是否已加。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasSyncRuntime.ts apps/web/src/stores/canvasSyncRuntime.test.ts
git commit -m "feat(web): canvasSyncRuntime——统一判脏/2s debounce/乐观锁保存/409 重载/flush"
```

---

### Task 7: useCanvasAutoSave hook + page.tsx 接线（TDD）

**Files:**
- Create: `apps/web/src/pages/canvas/hooks/useCanvasAutoSave.ts`
- Test: Create: `apps/web/src/pages/canvas/hooks/useCanvasAutoSave.test.ts`
- Modify: `apps/web/src/pages/canvas/page.tsx`（loadProjectIntoStore + CanvasPage 挂 hook）
- Test: `apps/web/src/pages/canvas/page.test.tsx`（追加 hydrate 写 serverVersion 断言）

- [ ] **Step 1: 写失败测试（hook 测试文件）**

```typescript
// apps/web/src/pages/canvas/hooks/useCanvasAutoSave.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/stores/canvasSyncRuntime', () => ({
  bindCanvasSync: vi.fn(() => vi.fn()),
  flushOnUnload: vi.fn(),
  flushCanvasSync: vi.fn().mockResolvedValue(undefined),
}));

import { bindCanvasSync, flushOnUnload, flushCanvasSync } from '@/stores/canvasSyncRuntime';
import { useCanvasAutoSave } from './useCanvasAutoSave';

describe('useCanvasAutoSave', () => {
  beforeEach(() => {
    vi.mocked(bindCanvasSync).mockClear().mockReturnValue(vi.fn());
    vi.clearAllMocks();
  });

  it('projectId 非空时绑定订阅 + pagehide 监听', () => {
    const { unmount } = renderHook(() => useCanvasAutoSave('p1'));
    expect(bindCanvasSync).toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
    expect(flushOnUnload).toHaveBeenCalled();
    unmount();
  });

  it('projectId 为 null 不绑定', () => {
    const { unmount } = renderHook(() => useCanvasAutoSave(null));
    expect(bindCanvasSync).not.toHaveBeenCalled();
    unmount();
  });

  it('卸载：解绑订阅与监听，不触发 flush（项目切换 cleanup 时 store 已被新项目数据污染，flush 会跨项目脏写——评审 P0-1）', () => {
    const unbind = vi.fn();
    vi.mocked(bindCanvasSync).mockReturnValue(unbind);
    const { unmount } = renderHook(() => useCanvasAutoSave('p1'));
    unmount();
    expect(unbind).toHaveBeenCalled();
    expect(flushCanvasSync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/web && npx vitest run src/pages/canvas/hooks/useCanvasAutoSave.test.ts
```

Expected: FAIL——文件不存在

- [ ] **Step 3: 实现 hook（完整文件）**

```typescript
// apps/web/src/pages/canvas/hooks/useCanvasAutoSave.ts
import { useEffect } from 'react';
import { bindCanvasSync, flushOnUnload } from '@/stores/canvasSyncRuntime';

/** 自动保存生命周期：projectId 就绪后绑定判脏订阅 + pagehide 兜底。
 *  ⚠️ cleanup 不做 unmount flush：项目切换时 cleanup 执行晚于 store 清空/新数据写入、
 *  早于 canvasStore.projectId 更新——此刻 flush 会把空画布/新项目数据写到旧项目（评审 P0-1）。
 *  路由切走丢改窗口 ≤2s，由 localStorage 快照与下次进入兜底 */
export function useCanvasAutoSave(projectId: string | null) {
  useEffect(() => {
    if (!projectId) return;
    const unbind = bindCanvasSync();
    const onPageHide = () => flushOnUnload();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      unbind();
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [projectId]);
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd apps/web && npx vitest run src/pages/canvas/hooks/useCanvasAutoSave.test.ts
```

Expected: PASS

- [ ] **Step 5: page.tsx 接线**

1. `loadProjectIntoStore` 的 `withHistoryPaused` 内 `useCanvasStore.setState({...})` 增加 `serverVersion: project.version ?? 0,` 与 `saveStatus: 'saved',`
2. `loadProjectIntoStore` 中 P0-4 组尺寸重算 for 循环（`:79-84` 附近，过滤 `groupType === 'normal'` 且非 collapsed 非 manuallyResized 后调 `refitGroupBounds`）替换为调用共享函数：import 区加 `import { refitExpandedGroups } from '@/stores/canvasSyncRuntime';`，循环体替换为 `refitExpandedGroups();`
3. import 区加 `import { useCanvasAutoSave } from './hooks/useCanvasAutoSave';`
4. **CanvasPageInner 组件**（`useCanvasPersistence(projectId)` 调用处并列——评审 P1-5，非外层 CanvasPage）加：

```typescript
  useCanvasAutoSave(projectId);
```

- [ ] **Step 6: page.test.tsx 追加断言**

在既有「DB 加载」相关用例（如 `'DB 节点带 parentId（乱序）...'`）附近追加：

```typescript
    it('DB 加载写入 serverVersion/saveStatus（乐观锁基座）', async () => {
      // 复用该用例的 fetch mock 设置方式，project 响应加 version: 7
      // （按既有 mock 工厂调整，核心断言如下）
      await act(async () => {});
      expect(useCanvasStore.getState().serverVersion).toBe(7);
      expect(useCanvasStore.getState().saveStatus).toBe('saved');
    });
```

（按本文件既有 mock 结构补全 fetch 响应 `version: 7`；若既有 mock 工厂不便内联，可复制最近一个 DB 加载用例改造。）

- [ ] **Step 7: 运行 page 测试**

```bash
cd apps/web && npx vitest run src/pages/canvas/page.test.tsx
```

Expected: PASS（既有用例不受影响——serverVersion 默认 0，`?? 0` 兜底旧 mock）

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/canvas/hooks/useCanvasAutoSave.ts apps/web/src/pages/canvas/hooks/useCanvasAutoSave.test.ts apps/web/src/pages/canvas/page.tsx apps/web/src/pages/canvas/page.test.tsx
git commit -m "feat(web): useCanvasAutoSave 接线——订阅绑定/pagehide/卸载 flush + hydrate 写 version"
```

---

### Task 8: 散点同步收敛——scheduleSync 委托 + store 内立即同步移除（TDD）

**Files:**
- Modify: `apps/web/src/stores/canvasHistoryRuntime.ts:13-56`（buildSyncPayload 删除 + scheduleSync 委托）
- Modify: `apps/web/src/stores/canvasStore.ts:249-268`（deleteNode 同步块删除）
- Modify: `apps/web/src/stores/canvasStore.ts:598-615`（onNodesChange remove 同步块删除）
- Test: 既有断言更新（见 Step 4）

- [ ] **Step 1: 写失败测试**

在 `canvasSyncRuntime.test.ts` 追加（验证 undo/redo 300ms 路径）：

```typescript
import { undoCanvas } from './canvasHistoryRuntime';

describe('undo → 300ms flush（scheduleSync 收编）', () => {
  it('undo 后 300ms 触发 syncCanvas（非 2s）', async () => {
    syncCanvasMock.mockResolvedValue({ version: 4 });
    // 先制造一条可 undo 的历史：结构变更两轮
    useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'n2', type: 'textInput', position: { x: 1, y: 1 }, data: {} } as any] }));
    await undoCanvas();
    expect(syncCanvasMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(syncCanvasMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    expect(syncCanvasMock).toHaveBeenCalledTimes(1); // 不再叠加 2s 双发
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/web && npx vitest run src/stores/canvasSyncRuntime.test.ts
```

Expected: FAIL——undo 后无 syncCanvas 调用（旧 scheduleSync 调 syncNodes）

- [ ] **Step 3: 实现**

**canvasHistoryRuntime.ts**：
1. 删除 `buildSyncPayload` 函数（:13-26）与 `import { syncNodes, syncEdges } from '@/api/projectApi';`、`import { message } from 'antd';`（若 message 仅 scheduleSync 使用；其他处仍用则保留）
2. 删除原 `scheduleSync` 实现（:28-56 整段含 syncTimer）
3. import 区加：

```typescript
import { scheduleSync as canvasAutoScheduleSync, UNDO_SYNC_DELAY_MS } from './canvasSyncRuntime';
```

4. 原位置新增薄委托：

```typescript
/** undo/redo 后自动保存：委托统一 runtime，保留 300ms 快节奏窗口（I-2 行为不变） */
export function scheduleSync(): Promise<void> {
  return canvasAutoScheduleSync(UNDO_SYNC_DELAY_MS);
}
```

**canvasStore.ts deleteNode**（:249-268）：保留

```typescript
    const ns = useNodeStore.getState();
    ns.deleteNode(id);
    ns.unregisterSaveHandler(id);
```

删除其后整段（`// 对齐 onNodesChange remove 路径：全量同步 DB...` 至 `}).catch(...);` 与 `}`），即 mergedNodes 构建与 `Promise.all([syncNodes, syncEdges])` 块。删除后若 `import { syncNodes, syncEdges }` 仅剩 onNodesChange 使用，暂保留 import（Step 3 一并删）。

**canvasStore.ts onNodesChange remove 分支**（:598-615）：保留 removes 清理循环（cancelNodeProcess/deleteNode/unregisterSaveHandler），删除其后 `// view 基准载荷...` 至 `}).catch(...)` 整段。此时删除文件顶部 `import { syncNodes, syncEdges } from '@/api/projectApi';`。

- [ ] **Step 4: 更新受影响既有断言**

```bash
cd apps/web && grep -rn "syncNodes" src --include="*.test.ts" --include="*.test.tsx"
```

对命中的测试：deleteNode/onNodesChange 场景原断言「调用 syncNodes」改为断言「saveStatus 变为 dirty」（删除路径经 bindCanvasSync 订阅判脏）。逐文件改写，改完运行对应文件。

- [ ] **Step 5: 运行全量 store 层测试**

```bash
cd apps/web && npx vitest run src/stores
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A apps/web/src/stores apps/web/src/pages/canvas
git commit -m "refactor(web): 散点同步收敛——scheduleSync 委托 runtime、deleteNode/onNodesChange 移除立即同步"
```

---

### Task 9: 5 个 ConfigPanel 生成前 flush 替换（TDD）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoConfigPanel.tsx:183-203`
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.tsx:78-94`
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageExtConfigPanel.tsx`（`await Promise.all([syncNodes` 锚点）
- Modify: `apps/web/src/pages/canvas/components/nodes/AudioConfigPanel.tsx`（同锚点，:161 附近）
- Modify: `apps/web/src/pages/canvas/components/nodes/TextConfigPanel.tsx`（同锚点，:162 附近）

- [ ] **Step 1: 写失败测试**

各面板既有测试文件（如 `VideoConfigPanel.test.tsx`，无则新建）追加通用用例（以 Video 为例，其余面板同构替换组件名与触发方式）：

```typescript
vi.mock('@/stores/canvasSyncRuntime', () => ({
  flushCanvasSync: vi.fn().mockResolvedValue(undefined),
}));

it('生成前先 flush 再 enqueue', async () => {
  // 按既有测试的渲染与触发方式填 prompt 并点击生成按钮
  await userEvent.click(screen.getByRole('button', { name: /生成/ }));
  await waitFor(() => {
    expect(flushCanvasSync).toHaveBeenCalledWith('execute');
    expect(enqueueWorkflow).toHaveBeenCalled();
  });
  const order: string[] = [];
  vi.mocked(flushCanvasSync).mockImplementationOnce(async () => { order.push('flush'); });
  // enqueue mock 内 push('enqueue')
  expect(order).toEqual(['flush', 'enqueue']);
});
```

（若某面板无既有测试文件，仅新建含上述用例的最小文件：mock `@/api/projectApi`、`@/api/executionApi`、antd 后渲染面板。）

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes
```

Expected: FAIL——flushCanvasSync 未被调用

- [ ] **Step 3: 实现（5 个面板统一替换）**

每个面板 handleGenerate 中定位 `await Promise.all([` + `syncNodes` 的块，整段替换。以 Video 为例（:183-203）：

替换前（删除）：

```typescript
      const canvasState = useCanvasStore.getState();
      const nodeState = useNodeStore.getState();
      const existing = nodeState.nodes[nodeId] as any;
      const currentPrompt = existing?.data?.prompt ?? { text: '', html: '', allImages: [], referencedImageIds: [] };
      useNodeStore.setState({
        nodes: { ...nodeState.nodes, [nodeId]: { ...existing, data: { ...existing?.data, prompt: { ...currentPrompt, text: latestText } } } },
      });
      const latestState = useNodeStore.getState();
      const mergedNodes = canvasState.nodes.map((n) => ({
        id: n.id, type: n.type || 'videoGen',
        parentId: n.parentId ?? null,
        position: n.position,
        data: latestState.nodes[n.id]?.data || (n.data as any) || {},
        width: n.width, height: n.height,
      }));
      const projectId = canvasState.projectId ?? 'default';
      await Promise.all([
        syncNodes(projectId, mergedNodes),
        syncEdges(projectId, canvasState.edges),
      ]);
      const { jobId } = await enqueueWorkflow({ projectId, nodeId });
```

替换后：

```typescript
      const nodeState = useNodeStore.getState();
      const existing = nodeState.nodes[nodeId] as any;
      const currentPrompt = existing?.data?.prompt ?? { text: '', html: '', allImages: [], referencedImageIds: [] };
      useNodeStore.setState({
        nodes: { ...nodeState.nodes, [nodeId]: { ...existing, data: { ...existing?.data, prompt: { ...currentPrompt, text: latestText } } } },
      });
      const projectId = useCanvasStore.getState().projectId;
      if (!projectId) return;
      await flushCanvasSync('execute');
      const { jobId } = await enqueueWorkflow({ projectId, nodeId });
```

（prompt 写 store 保留——写完即 dirty，flush 会带走；`projectId ?? 'default'` fallback 清理。）

ImageConfigPanel（:78-94）替换后：

```typescript
      const projectId = useCanvasStore.getState().projectId;
      if (!projectId) return;
      await flushCanvasSync('execute');
      await imageNodeApi.submitGeneration(nodeId, { projectId });
```

ImageExtConfigPanel / AudioConfigPanel / TextConfigPanel：定位各自 `await Promise.all([syncNodes(...), syncEdges(...)]);` 块（Audio :161、Text :162、ImageExt :138 附近），同样删除 mergedNodes 构建与 Promise.all，替换为：

```typescript
      const projectId = useCanvasStore.getState().projectId;
      if (!projectId) return;
      await flushCanvasSync('execute');
```

后接各自原有的 enqueue/submit 调用（Audio/Text 为 `enqueueWorkflow({ projectId, nodeId })`，ImageExt 为 submit 包装）。各面板删除不再使用的 `syncNodes/syncEdges` import，新增 `import { flushCanvasSync } from '@/stores/canvasSyncRuntime';`。

- [ ] **Step 4: 运行确认通过**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/nodes
```

Expected: PASS（含面板既有测试；原断言 syncNodes 的用例同步改写为断言 flushCanvasSync）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes
git commit -m "feat(web): 五面板生成前 flush 替换散点同步——修复改参不保存生成旧参数隐患"
```

---

### Task 10: CanvasView 尺寸链路移除 + viewport 自动同步 + 组执行前 flush（TDD）

**Files:**
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx:163-208`（尺寸 debounce 链路删除）与 `:367` 附近（onMoveEnd 接线）
- Create: `apps/web/src/pages/canvas/hooks/useViewportAutoSync.ts`
- Test: Create: `apps/web/src/pages/canvas/hooks/useViewportAutoSync.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// useViewportAutoSync.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/api/projectApi', () => ({
  updateViewport: vi.fn().mockResolvedValue(undefined),
}));

import { updateViewport } from '@/api/projectApi';
import { useCanvasStore } from '@/stores/canvasStore';
import { useViewportAutoSync } from './useViewportAutoSync';

describe('useViewportAutoSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useCanvasStore.setState({ projectId: 'p1', viewport: { x: 10, y: 20, zoom: 1.5 } });
    vi.mocked(updateViewport).mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('onMoveEnd 1s debounce 后 PUT viewport', async () => {
    const { result } = renderHook(() => useViewportAutoSync());
    act(() => { result.current.onMoveEnd(); });
    act(() => { result.current.onMoveEnd(); });
    expect(updateViewport).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(updateViewport).toHaveBeenCalledTimes(1);
    expect(updateViewport).toHaveBeenCalledWith('p1', { x: 10, y: 20, zoom: 1.5 });
  });

  it('无 projectId 不发', async () => {
    useCanvasStore.setState({ projectId: null });
    const { result } = renderHook(() => useViewportAutoSync());
    act(() => { result.current.onMoveEnd(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(updateViewport).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/web && npx vitest run src/pages/canvas/hooks/useViewportAutoSync.test.ts
```

Expected: FAIL——文件不存在

- [ ] **Step 3: 实现 hook（完整文件）**

```typescript
// apps/web/src/pages/canvas/hooks/useViewportAutoSync.ts
import { useCallback, useEffect, useRef } from 'react';
import { updateViewport } from '@/api/projectApi';
import { useCanvasStore } from '@/stores/canvasStore';

/** viewport 独立同步通道（spec D7）：onMoveEnd 低频触发 + 1s debounce，不参与结构 dirty/乐观锁 */
export function useViewportAutoSync() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onMoveEnd = useCallback(() => {
    const pid = useCanvasStore.getState().projectId;
    if (!pid) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const cs = useCanvasStore.getState();
      if (!cs.projectId) return;
      updateViewport(cs.projectId, cs.viewport)
        .catch((e) => console.error('[canvasSync] viewport sync failed', e));
    }, 1000);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { onMoveEnd };
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd apps/web && npx vitest run src/pages/canvas/hooks/useViewportAutoSync.test.ts
```

Expected: PASS

- [ ] **Step 5: CanvasView 接线与尺寸链路移除**

1. 删除 `syncNodeDimensions` useMemo 整块（:163-193）、其 cleanup effect（:195-197）、`wrappedOnNodesChange`（:205-208），原 `wrappedOnNodesChange` 消费点直接改用 `onNodesChange`；删除随之孤立的 `debounce` / `NodeDimensionChange` import 与 `_projectId`（若仍被其他处使用则保留）
2. import 加 `import { useViewportAutoSync } from '../hooks/useViewportAutoSync';` 与 `import { flushCanvasSync } from '@/stores/canvasSyncRuntime';`
3. 组件体内加 `const { onMoveEnd: viewportMoveEnd } = useViewportAutoSync();`
4. ReactFlow 组件（:367 `onViewportChange={updateViewport}` 附近）加 prop：`onMoveEnd={viewportMoveEnd}`
5. **组执行前 flush（第 6 个生成触发点，plan 二审补充）**：`:519-522` 附近 GroupToolbar/组工具栏的 `onExecute` 回调改为：

```typescript
          onExecute={async (groupId) => {
            const childIds = nodes.filter((n) => n.parentId === groupId).map((n) => n.id);
            if (childIds.length > 0 && projectId) {
              await flushCanvasSync('execute');
              void executeGroupNodes(projectId, childIds);
            }
          }}
```

（`executeGroupNodes` 走 `/execution/execute` 同步端点，后端同样从 DB 读节点配置——与 5 面板同构隐患。测试：`grep -rn "executeGroupNodes" src --include="*.test.*"`，若既有组执行测试存在则补断言 flush 先于 executeGroupNodes 调用；无则由 Task 14 验收第 2 项覆盖。）

- [ ] **Step 6: 类型检查 + 相关测试**

```bash
cd apps/web && npx tsc -b --pretty false && npx vitest run src/pages/canvas
```

Expected: 无新错误、PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/canvas
git commit -m "feat(web): viewport onMoveEnd 自动同步接线 + 移除尺寸 PATCH 独立链路"
```

---

### Task 11: 三态指示器 + TopBar/模板弹窗改造（TDD）

**Files:**
- Create: `apps/web/src/pages/canvas/components/SaveStatusIndicator.tsx`
- Test: Create: `apps/web/src/pages/canvas/components/__tests__/SaveStatusIndicator.test.tsx`
- Modify: `apps/web/src/pages/canvas/components/CanvasTopBar.tsx:91-101`（按钮替换 + 菜单项）
- Modify: `apps/web/src/pages/canvas/components/SaveAsTemplateDialog.tsx:19-33`

- [ ] **Step 1: 写失败测试（指示器）**

```typescript
// SaveStatusIndicator.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/stores/canvasSyncRuntime', () => ({
  flushCanvasSync: vi.fn().mockResolvedValue(undefined),
}));

import { flushCanvasSync } from '@/stores/canvasSyncRuntime';
import { useCanvasStore } from '@/stores/canvasStore';
import { SaveStatusIndicator } from '../SaveStatusIndicator';

describe('SaveStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saved → 已保存', () => {
    useCanvasStore.setState({ saveStatus: 'saved' });
    render(<SaveStatusIndicator />);
    expect(screen.getByText('已保存')).toBeInTheDocument();
  });

  it('dirty/saving → 保存中…', () => {
    useCanvasStore.setState({ saveStatus: 'saving' });
    const { rerender } = render(<SaveStatusIndicator />);
    expect(screen.getByText('保存中…')).toBeInTheDocument();
    useCanvasStore.setState({ saveStatus: 'dirty' });
    rerender(<SaveStatusIndicator />);
    expect(screen.getByText('保存中…')).toBeInTheDocument();
  });

  it('error → 保存失败，点击重试触发 flush(retry)（非 execute——避免生成场景 toast 文案，评审 P1-4）', async () => {
    useCanvasStore.setState({ saveStatus: 'error' });
    render(<SaveStatusIndicator />);
    fireEvent.click(screen.getByText('保存失败，点击重试'));
    expect(flushCanvasSync).toHaveBeenCalledWith('retry');
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/__tests__/SaveStatusIndicator.test.tsx
```

Expected: FAIL——组件不存在

- [ ] **Step 3: 实现指示器（完整文件）**

```typescript
// apps/web/src/pages/canvas/components/SaveStatusIndicator.tsx
import { useCanvasStore } from '@/stores/canvasStore';
import { flushCanvasSync } from '@/stores/canvasSyncRuntime';

/** 自动保存三态指示器（spec D4）：dirty/saving→保存中、saved→已保存、error→点击重试 */
export function SaveStatusIndicator() {
  const status = useCanvasStore((s) => s.saveStatus);
  if (status === 'error') {
    return (
      <button
        onClick={() => void flushCanvasSync('retry')}
        className="text-xs bg-transparent border-none cursor-pointer text-[#ef4444] hover:text-[#ff6b6b] transition-colors px-0 py-0"
      >
        保存失败，点击重试
      </button>
    );
  }
  if (status === 'saved') {
    return <span className="text-xs text-[#4ade80] px-1">已保存</span>;
  }
  return <span className="text-xs text-[#888] px-1">保存中…</span>;
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd apps/web && npx vitest run src/pages/canvas/components/__tests__/SaveStatusIndicator.test.tsx
```

Expected: PASS

- [ ] **Step 5: CanvasTopBar 改造**

1. `:91-101` 原"保存画布"按钮块（含 `{user && (...)}` 外壳）替换为：

```typescript
        {user && (
          <div className="bg-[#1A1A1A]/90 backdrop-blur px-3 py-1.5 rounded-full border border-[#333] shadow-lg">
            <SaveStatusIndicator />
          </div>
        )}
```

2. import 加 `import { SaveStatusIndicator } from './SaveStatusIndicator';` 与图标 `SaveOutlined`（加入既有 @ant-design/icons import 列表）
3. `userMenuItems` 中 `settings` 项后（logout divider 前）插入：

```typescript
    {
      key: 'save-template',
      icon: <SaveOutlined />,
      label: '保存为模板',
      onClick: () => setShowSaveDialog(true),
    },
    { type: 'divider' as const },
```

（`showSaveDialog` state 与既有对话框渲染保留不动。）

- [ ] **Step 6: SaveAsTemplateDialog 改造（TDD）**

更新 `SaveAsTemplateDialog.test.tsx`：原断言 syncNodes/syncEdges 调用改为——

```typescript
vi.mock('@/stores/canvasSyncRuntime', () => ({
  flushCanvasSync: vi.fn(),
}));

    it('保存：先 flush 再提交模板元数据（不再直接同步 nodes/edges）', async () => {
      vi.mocked(flushCanvasSync).mockResolvedValue(true);
      // 既有渲染/点击保存流程后：
      expect(flushCanvasSync).toHaveBeenCalledWith('template');
      expect(saveCanvas).toHaveBeenCalled();
      expect(syncNodes).not.toHaveBeenCalled();
    });

    it('flush 失败：显示错误且不提交模板（防旧数据建模板——评审 P2-9）', async () => {
      vi.mocked(flushCanvasSync).mockResolvedValue(false);
      // 既有渲染/点击保存流程后：
      expect(saveCanvas).not.toHaveBeenCalled();
      expect(screen.getByText(/画布保存失败/)).toBeInTheDocument();
    });
```

实现：`SaveAsTemplateDialog.tsx` handleSave（:19-33）改为：

```typescript
  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      const ok = await flushCanvasSync('template');
      if (!ok) {
        setError('画布保存失败，请检查网络后重试');
        return;
      }
      await saveCanvas(projectId, { name: projectName, description: description.trim(), isPublic });
      onSaved();
    } catch (e: any) {
      setError(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };
```

import 区删除 `syncNodes/syncEdges`，加 `import { flushCanvasSync } from '@/stores/canvasSyncRuntime';`。标题 `保存画布` 改为 `保存为模板`。

- [ ] **Step 7: 运行相关测试**

```bash
cd apps/web && npx vitest run src/pages/canvas/components
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/canvas/components
git commit -m "feat(web): 三态保存指示器替代手动保存按钮 + 保存为模板入口移至用户菜单"
```

---

### Task 12: localStorage 快照携带 serverVersion（TDD）

**Files:**
- Modify: `apps/web/src/pages/canvas/hooks/canvasSnapshot.ts:9-16`（接口 + 校验）
- Modify: `apps/web/src/pages/canvas/hooks/useCanvasPersistence.ts:105-115`（写入）
- Test: `apps/web/src/pages/canvas/hooks/useCanvasPersistence.test.ts`

- [ ] **Step 1: 写失败测试**

在 `useCanvasPersistence.test.ts` 既有写快照用例附近追加（复用其 store 变更触发方式）：

```typescript
  it('快照写入 serverVersion', async () => {
    useCanvasStore.setState({ serverVersion: 7 });
    // 触发一次 store 变更（按既有用例方式修改 nodes/edges）
    await vi.advanceTimersByTimeAsync(500);
    const raw = localStorage.getItem(`flowweb_canvas_v2_p1`);
    expect(JSON.parse(raw!).serverVersion).toBe(7);
  });
```

（key/项目 id 按既有 fixture 调整；若既有用例非 fake timers 驱动，按其模式等待写完成。）

**与 spec D6 的实现偏差（显式登记）**：spec 写"两层共享同一 dirty 投影判定（useCanvasPersistence 复用 syncPartialize）"，本 plan **不做**——useCanvasPersistence 保持订阅任意 store 变更（含 saveStatus 变化触发的快照写，为无害最终态覆盖），本地持久化本应比服务端更激进。共享投影会引入跨层耦合无净收益。

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/web && npx vitest run src/pages/canvas/hooks/useCanvasPersistence.test.ts
```

Expected: FAIL——serverVersion undefined

- [ ] **Step 3: 实现**

`canvasSnapshot.ts` CanvasSnapshot 接口 `parentMap` 后加：

```typescript
  /** 可选：服务端乐观锁版本（冲突取证/兜底判断用；旧快照无此字段仍有效） */
  serverVersion?: number;
```

`isValidPayload` 末段（parentMap 校验后、return true 前）加：

```typescript
  if (s.serverVersion !== undefined && typeof s.serverVersion !== 'number') return false;
```

（放在 parentMap 判定逻辑中：parentMap 为空时提前 return true 的分支改为先做 serverVersion 校验再 return。）

`useCanvasPersistence.ts` 写入 payload（:105-115 JSON.stringify 对象）加：

```typescript
            serverVersion: cs.serverVersion,
```

（`cs` 为该回调已读取的 `useCanvasStore.getState()`。）

- [ ] **Step 4: 运行确认通过**

```bash
cd apps/web && npx vitest run src/pages/canvas/hooks
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/hooks
git commit -m "feat(web): localStorage 快照携带 serverVersion"
```

---

### Task 13: 清理旧端点/旧 API/旧测试（破坏性收尾）

**Files:**
- Modify: `apps/web/src/api/projectApi.ts`（删 syncNodes/syncEdges）
- Modify: `apps/api/src/modules/project/project.controller.ts`（删 PUT :id/nodes、PUT :id/edges、PATCH :id/nodes/dimensions 及 UpdateNodeDimensionsDto import）
- Modify: `apps/api/src/modules/project/project.service.ts`（删 syncNodes/syncEdges/updateDimensions）
- Delete: `apps/api/src/modules/project/dto/update-node-dimensions.dto.ts`（若仅 dimensions 使用）

- [ ] **Step 1: 残留引用排查**

```bash
grep -rn "syncNodes\|syncEdges\|nodes/dimensions" apps/web/src apps/api/src --include="*.ts" --include="*.tsx" | grep -v ".test."
```

Expected: 仅剩 projectApi.ts 定义与 controller/service 待删方法。若有其他生产调用残留，先补迁移（按 Task 8/9 模式改 flush/dirty）再继续。

- [ ] **Step 2: 删除前端旧 API + 旧测试断言**

`projectApi.ts` 删除 `syncNodes`、`syncEdges` 函数。测试文件中残留的 syncNodes mock（vi.mock projectApi 的条目）同步清理为仅 `syncCanvas`。

- [ ] **Step 3: 删除后端旧路由/方法/测试**

controller 删除三条路由；service 删除三方法；对应 spec 文件中旧 describe（syncNodes/syncEdges/updateDimensions）删除；`update-node-dimensions.dto.ts` 无引用则删除文件。

- [ ] **Step 4: 全量验证**

```bash
cd apps/api && pnpm test
cd ../web && pnpm test && npx tsc -b --pretty false
```

Expected: 两端全绿、无类型错误

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src apps/api/src
git commit -m "refactor: 移除旧双端点与 dimensions PATCH——自动保存单端点收尾"
```

---

### Task 14: 全量回归 + 浏览器验收

- [ ] **Step 1: 全量测试**

```bash
cd apps/api && pnpm test
cd ../web && pnpm test && npx tsc -b --pretty false
```

Expected: 全绿

- [ ] **Step 2: 启动并浏览器验收（preview 工具）**

按 memory 启动流程起服务，验收清单（spec 验证标准 5）：

1. 编辑画布（加节点/拖动/改参数）→ 顶栏出现"保存中…"→ 2s 后"已保存"→ Prisma 查库（`npx prisma studio` 或 query）确认 nodes 落库
2. 改 prompt 立即点生成（单节点与整组执行两种入口）→ 生成请求前 DB 已是新参数（查库验证）
3. 关闭标签页重开 → 数据完整（localStorage + DB 双路径）
4. 双开同一画布（两窗口）先后编辑 → 后保存方收到"画布已被他人修改，已加载最新版本"
5. Ctrl+Z 撤销 → 300ms 后落库
6. 平移/缩放画布停顿 1s → viewport 表字段更新（查库）
7. 手动保存按钮已消失；用户菜单含"保存为模板"；指示器三态正常

- [ ] **Step 3: 修复验收发现的问题（如有），复验**

- [ ] **Step 4: Commit（如有修复）+ 汇报**

---

## Self-Review 记录

- **Spec 覆盖**：D1→Task 5/6/7；D2→Task 1/2/3/13；D3→Task 6(flush)/7(pagehide)/9(生成前)；D4→Task 11；D5→Task 11；D6→Task 12（含显式偏差登记）；D7→Task 10；D8→Task 8/9/10；验证标准→各 Task 测试 + Task 14。无缺口。
- **评审修订（2026-08-26，用户 plan 审核）**：P0-1 unmount flush 移除（项目切换 cleanup 时 store 已污染，flush 跨项目脏写）→ Task 7 hook 与测试、Task 6 flush 签名（去 'unmount' reason）；P0-2 flush 守卫放行 error 态 → Task 6 守卫/测试；P0-3 重试测试 fake timers 死锁 → 持有 promise + advanceTimersByTimeAsync 模式；P1-4 指示器改 'retry' reason（无生成 toast）；P1-5 hook 挂 CanvasPageInner；P1-6 refitExpandedGroups 提取共用（409 重载含组尺寸重算）；P2-7 React 18.3.1；P2-8 D6 偏差登记；P2-9 模板 flush 失败阻断提交；P2-10 Task 8 commit 路径修正。
- **二审补充（2026-08-26）**：组执行按钮（CanvasView.tsx:519-522 onExecute → executeGroupNodes → /execution/execute 同步读 DB）为第 6 个生成触发点，纳入 Task 10 Step 5.5 加生成前 flush；Task 14 验收第 2 项扩展覆盖整组执行入口。
- **占位符扫描**：Task 9 中 Audio/Text/ImageExt 三面板以"锚点定位 + 统一替换代码"给出（代码块完整给出，仅 mergedNodes 原文以既有文件为准删除），符合可执行标准。
- **类型一致性**：`scheduleSync(delayMs)`/`flushCanvasSync(reason): Promise<boolean>`（reason: 'execute'|'retry'|'template'）/`bindCanvasSync()`/`flushOnUnload()`/`buildSyncPayload()`/`refitExpandedGroups()`/`syncCanvas(pid, payload)` 签名在 Task 4/6/7/8/9/11 间一致；`saveStatus`/`serverVersion` 字段名全局统一。
