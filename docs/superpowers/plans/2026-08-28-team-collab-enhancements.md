# 团队+协作完善 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实施已确认 spec `docs/superpowers/specs/2026-08-28-team-collab-enhancements-design.md`——多团队管理/项目级权限/OWNER 转让/审计日志、CanvasDoc 增量日志+Redis 多实例、执行端点 SV 等待、Y.UndoManager 替换 zundo。

**Architecture:** 单 plan 分 5 阶段 18 任务按依赖推进：A 数据模型（Prisma+SEQUENCE）→ B collab 后端（增量仓库/网关改造/多实例/SV 等待/端点接线）→ C 团队管理（权限解析/ProjectMember CRUD/转让/审计）→ D 前端 undo（UndoManager/桥单向化/zundo 删除）→ E 浏览器验收。

**Tech Stack:** NestJS + Prisma + @hocuspocus/server + @hocuspocus/extension-redis + ioredis + yjs + prom-client；web: React + zustand + Y.UndoManager + antd 5。

**关键实现裁定（写死，执行时不再讨论）：**

1. **TS 严格模式**全程生效；测试框架：api 用 jest（`*.spec.ts`），web 用 vitest（`*.test.ts(x)`）。
2. **第 4 节单向数据流的实现路径**：保留 `canvasCollabRuntime.bindBridge` 的 store subscribe → `syncStoreToDoc` 自动 diff 桥作为**所有 UI mutation 的统一通道**（subscribe 即拦截点），origin 固定 `'local-user'`。依据：`storeProjection()`（canvasCollabRuntime.ts:40-55）只取 id/type/parentId/position/width/height/data 结构字段，**select/dragging 天然不进 doc**（spec 4.3 select 走 awareness 自动满足）；`syncStoreToDoc` 已是细粒度 Y 操作转译器（新增/删除按 id、position 独立子 Map、data 逐键），重写 10+ 入口为显式 transact 行为等价但风险高。undo 回放经 observeDeep → `applyDocToStore` 投影，`isHydrating` 守卫（bindBridge:147/154 已有）防回写——回环结构上消失。
3. **Prisma migrate 流程**（记忆：基线已重置，禁 db push）：`npx prisma migrate dev --create-only --name xxx` → 手动编辑 migration.sql 追加 `CREATE SEQUENCE` → `npx prisma migrate dev` 应用。migrate dev 需一次性 CREATEDB 授权（记忆 prisma_migrate_history_broken）。
4. 所有命令在 `apps/api` 或 `apps/web` 目录下执行（monorepo：`D:\flowweb\apps\api`、`D:\flowweb\apps\web`）。

---

## 阶段 A：数据模型

### Task 1: Prisma schema 变更 + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_team_collab_enhancements/migration.sql`（migrate dev --create-only 生成后编辑）

- [ ] **Step 1: schema.prisma 追加模型与枚举**

在 `enum AuditTargetType`（schema.prisma:475-480）追加 4 值：

```prisma
enum AuditTargetType {
  subscription
  subscription_plan
  point
  order
  TEAM
  TEAM_MEMBER
  PROJECT
  PROJECT_MEMBER
}
```

`model AuditLog`（:633-648）加 teamId 列与索引：

```prisma
model AuditLog {
  id           String          @id @default(cuid())
  operatorId   String
  operatorName String
  teamId       String?
  targetType   AuditTargetType
  targetId     String
  action       String
  beforeValue  Json?
  afterValue   Json?
  remark       String?
  createdAt    DateTime        @default(now())

  @@index([operatorId])
  @@index([targetType, targetId])
  @@index([createdAt])
  @@index([teamId, createdAt])
}
```

文件末尾追加两个新模型：

```prisma
enum ProjectRole {
  PROJECT_OWNER
  PROJECT_EDITOR
  PROJECT_VIEWER
}

model ProjectMember {
  id        String        @id @default(cuid())
  projectId String
  userId    String
  role      ProjectRole
  createdAt DateTime      @default(now())
  project   CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user      User          @relation(fields: [userId], references: [id])

  @@unique([projectId, userId])
  @@index([userId])
}

model CanvasDocUpdate {
  id        String        @id @default(cuid())
  projectId String
  seq       BigInt
  update    Bytes
  createdAt DateTime      @default(now())
  project   CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId, seq])
}
```

在 `model CanvasProject` 的 relations 区追加：`projectMembers ProjectMember[]` 与 `docUpdates CanvasDocUpdate[]`；在 `model User` 的 relations 区追加：`projectMembers ProjectMember[]`。

- [ ] **Step 2: 生成并编辑 migration**

```bash
cd apps/api && npx prisma migrate dev --create-only --name team_collab_enhancements
```

编辑生成的 `migration.sql`，在文件末尾追加一行：

```sql
CREATE SEQUENCE "canvas_doc_update_seq";
```

- [ ] **Step 3: 应用 migration**

```bash
cd apps/api && npx prisma migrate dev
```

Expected: `migration applied`，无报错。

- [ ] **Step 4: 验证 Prisma client 生成**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 无类型错误（新枚举/模型类型可用）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(db): ProjectMember/AuditLog.teamId/CanvasDocUpdate + 全局 SEQUENCE"
```

---

## 阶段 B：collab 后端

### Task 2: CanvasDocUpdateRepository（append/加载/compaction）

**Files:**
- Create: `apps/api/src/modules/collab/canvas-doc-update.repository.ts`
- Create: `apps/api/src/modules/collab/canvas-doc-update.repository.spec.ts`
- Modify: `apps/api/src/modules/collab/collab.module.ts`（注册 provider）

- [ ] **Step 1: 写失败测试**

`canvas-doc-update.repository.spec.ts`：

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';

describe('CanvasDocUpdateRepository', () => {
  let repo: CanvasDocUpdateRepository;
  let prisma: { $transaction: jest.Mock; $queryRaw: jest.Mock; canvasDocUpdate: any; canvasDoc: any };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ seq: 1n }]),
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      canvasDocUpdate: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn(),
      },
      canvasDoc: { findUnique: jest.fn(), upsert: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        CanvasDocUpdateRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    repo = mod.get(CanvasDocUpdateRepository);
  });

  it('append 用 nextval 取号并写入', async () => {
    await repo.append('p1', new Uint8Array([1, 2]));
    expect(prisma.canvasDocUpdate.create).toHaveBeenCalledWith({
      data: { projectId: 'p1', seq: 1n, update: Buffer.from([1, 2]) },
    });
  });

  it('compact：advisory lock + 重放构建快照 + 条件删除 + 返回 snapshotSV', async () => {
    // mock $transaction 直接执行回调（tx 即 prisma 自身）
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([{ max: 5n }]);
    const doc = new (require('yjs').Doc)();
    doc.getMap('nodes').set('n1', 'x');
    prisma.canvasDoc.findUnique.mockResolvedValue(null);
    prisma.canvasDocUpdate.findMany.mockResolvedValue([
      { seq: 1n, update: Buffer.from(require('yjs').Y.encodeStateAsUpdate(doc)) },
    ]);
    const sv = await repo.compact('p1');
    expect(sv).toBeInstanceOf(Uint8Array);
    expect(prisma.canvasDoc.upsert).toHaveBeenCalled();
    expect(prisma.canvasDocUpdate.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', seq: { lte: 5n } },
    });
  });

  it('compact：无增量行返回 null（空文档不产生快照写）', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([{ max: null }]);
    await expect(repo.compact('p1')).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd apps/api && npx jest src/modules/collab/canvas-doc-update.repository.spec.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 repository**

`canvas-doc-update.repository.ts`：

```typescript
import { Injectable } from '@nestjs/common';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CanvasDocUpdateRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 全局 Postgres SEQUENCE 取号：多实例并发下全局单调（spec 2.1） */
  async nextSeq(): Promise<bigint> {
    const rows = await this.prisma.$queryRaw<{ seq: bigint }[]>`SELECT nextval('canvas_doc_update_seq') AS seq`;
    return rows[0].seq;
  }

  async append(projectId: string, update: Uint8Array): Promise<void> {
    const seq = await this.nextSeq();
    await this.prisma.canvasDocUpdate.create({
      data: { projectId, seq, update: Buffer.from(update) },
    });
  }

  async loadUpdates(projectId: string): Promise<Buffer[]> {
    const rows = await this.prisma.canvasDocUpdate.findMany({
      where: { projectId },
      orderBy: { seq: 'asc' },
      select: { update: true },
    });
    return rows.map((r) => r.update);
  }

  async count(projectId: string): Promise<number> {
    return this.prisma.canvasDocUpdate.count({ where: { projectId } });
  }

  /**
   * flush-then-compact 的 compaction 事务（spec 2.2）：
   * 快照从 Postgres 权威数据重放构建（不信任内存）；DELETE 带 seq <= maxSeq
   * 防误删事务期间其他实例新 append 的行；返回 snapshotSV 供调用方重置 lastPersistedSV。
   * 临时 doc 用完即弃、不广播，不违反"严禁自建 Y.Doc"双轨铁律。
   */
  async compact(projectId: string): Promise<Uint8Array | null> {
    // RR 隔离：Postgres RepeatableRead 下事务内所有语句共享首语句快照，
    // 保证"删除的行 ⊆ 重放的行"（READ COMMITTED 快照不一致会丢更新）
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId})::bigint)`;
        const maxRows = await tx.$queryRaw<{ max: bigint | null }[]>`
          SELECT max(seq) AS max FROM "CanvasDocUpdate" WHERE "projectId" = ${projectId}`;
        const maxSeq = maxRows[0]?.max;
        if (maxSeq == null) return null;
        const docRow = await tx.canvasDoc.findUnique({ where: { projectId } });
        const updates = await tx.canvasDocUpdate.findMany({
          where: { projectId, seq: { lte: maxSeq } },
          orderBy: { seq: 'asc' },
          select: { update: true },
        });
        const temp = new Y.Doc();
        if (docRow) Y.applyUpdate(temp, new Uint8Array(docRow.state));
        for (const u of updates) Y.applyUpdate(temp, new Uint8Array(u.update));
        const newSnapshot = Y.encodeStateAsUpdate(temp);
        const snapshotSV = Y.encodeStateVector(temp);
        temp.destroy();
        await tx.canvasDoc.upsert({
          where: { projectId },
          update: { state: Buffer.from(newSnapshot) },
          create: { projectId, state: Buffer.from(newSnapshot) },
        });
        await tx.canvasDocUpdate.deleteMany({ where: { projectId, seq: { lte: maxSeq } } });
        return snapshotSV;
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
```

`collab.module.ts` providers 加 `CanvasDocUpdateRepository`。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd apps/api && npx jest src/modules/collab/canvas-doc-update.repository.spec.ts
```

Expected: PASS 3 个用例。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/collab
git commit -m "feat(collab): CanvasDocUpdateRepository——SEQUENCE 取号/加载重放/Postgres 权威 compaction"
```

### Task 3: SV 工具函数（svSatisfied/decodeStateVector）

**Files:**
- Create: `apps/api/src/modules/collab/sv.util.ts`
- Create: `apps/api/src/modules/collab/sv.util.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import * as Y from 'yjs';
import { svSatisfied, decodeStateVector } from './sv.util';

describe('svSatisfied', () => {
  it('server 完全覆盖 required 时 true', () => {
    const doc = new Y.Doc();
    doc.getMap('nodes').set('a', 1);
    doc.getMap('nodes').set('a', 2); // client clock 前进到 2
    const sv = Y.encodeStateVector(doc);
    expect(svSatisfied(sv, sv)).toBe(true);
  });

  it('server 落后时 false', () => {
    const doc1 = new Y.Doc();
    doc1.getMap('nodes').set('a', 1);
    const doc2 = new Y.Doc();
    doc2.getMap('nodes').set('b', 1);
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
    doc2.getMap('nodes').set('c', 1); // doc2 领先
    expect(svSatisfied(Y.encodeStateVector(doc2), Y.encodeStateVector(doc1))).toBe(true);
    expect(svSatisfied(Y.encodeStateVector(doc1), Y.encodeStateVector(doc2))).toBe(false);
  });

  it('decodeStateVector 解出 client→clock', () => {
    const doc = new Y.Doc();
    doc.getMap('nodes').set('a', 1);
    const m = decodeStateVector(Y.encodeStateVector(doc));
    expect(m.size).toBe(1);
    expect([...m.values()][0]).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd apps/api && npx jest src/modules/collab/sv.util.spec.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`sv.util.ts`：

```typescript
import * as decoding from 'lib0/decoding';
import * as Y from 'yjs';

/** 解码 state vector 为 client→clock Map */
export function decodeStateVector(sv: Uint8Array): Map<number, number> {
  const decoder = decoding.createDecoder(sv);
  const ss = decoding.readVarUint(decoder);
  const result = new Map<number, number>();
  for (let i = 0; i < ss; i++) {
    const client = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    result.set(client, clock);
  }
  return result;
}

/** serverSV 是否覆盖 requiredSV 的全部 clock（spec 3.2 等待条件） */
export function svSatisfied(serverSV: Uint8Array, requiredSV: Uint8Array): boolean {
  const server = decodeStateVector(serverSV);
  for (const [client, clock] of decodeStateVector(requiredSV)) {
    if ((server.get(client) ?? 0) < clock) return false;
  }
  return true;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd apps/api && npx jest src/modules/collab/sv.util.spec.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/collab/sv.util.ts apps/api/src/modules/collab/sv.util.spec.ts
git commit -m "feat(collab): svSatisfied/decodeStateVector——SV 覆盖判定"
```

### Task 4: gateway 增量持久化 + 加载重放 + 断连强制 compaction

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`
- Modify: `apps/api/src/modules/collab/collab.gateway.spec.ts`（既有测试对齐）
- Modify: `apps/api/src/modules/collab/collab.module.ts`（注入 repository）

- [ ] **Step 1: 写失败测试（collab.gateway.spec.ts 追加）**

在既有 spec 文件追加 describe（沿用文件里已有的 mock prisma 模式；若结构不同，按现有 mock 方式接入同等断言）：

```typescript
describe('增量持久化（spec 2.2/2.3）', () => {
  it('onStoreDocument：diff append + lastPersistedSV 前进', async () => {
    // 从 gateway.server 配置里取出 hooks（构造时传入 config 对象）——见 Step 3 实现里导出的 hooks
    const { onStoreDocument } = extractHooks();
    const doc = new Y.Doc();
    doc.getMap('nodes').set('n1', 'a');
    await onStoreDocument({ document: doc, documentName: 'project:p1' });
    expect(repo.append).toHaveBeenCalledTimes(1);
    // 再触发一次无变化：不 append
    await onStoreDocument({ document: doc, documentName: 'project:p1' });
    expect(repo.append).toHaveBeenCalledTimes(1);
  });

  it('onLoadDocument：快照 + 增量按序重放', async () => {
    const { onLoadDocument } = extractHooks();
    const snapDoc = new Y.Doc(); snapDoc.getMap('nodes').set('a', 1);
    prisma.canvasDoc.findUnique.mockResolvedValue({ state: Buffer.from(Y.encodeStateAsUpdate(snapDoc)) });
    const incDoc = new Y.Doc(); incDoc.getMap('nodes').set('b', 2);
    repo.loadUpdates.mockResolvedValue([Buffer.from(Y.encodeStateAsUpdate(incDoc))]);
    const doc = new Y.Doc();
    await onLoadDocument({ document: doc, documentName: 'project:p1' });
    expect(doc.getMap('nodes').get('a')).toBe(1);
    expect(doc.getMap('nodes').get('b')).toBe(2);
  });

  it('onDisconnect：最后连接断开触发 flush-then-compact', async () => {
    const { onDisconnect } = extractHooks();
    const doc = new Y.Doc(); doc.getMap('nodes').set('x', 1);
    await onDisconnect({
      document: doc, documentName: 'project:p1',
      instance: { getConnectionsCount: () => 0 },
    });
    expect(repo.compact).toHaveBeenCalledTimes(1);
  });
});
```

实现说明：为可测性，gateway 构造函数把 `onStoreDocument` 等钩子抽为类属性方法再传入 Server config（见 Step 3）。`extractHooks` 为 spec 内从 gateway 实例取 `(gateway as any).hooks` 的辅助。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd apps/api && npx jest src/modules/collab/collab.gateway.spec.ts
```

Expected: 新增用例 FAIL。

- [ ] **Step 3: 改造 gateway**

`collab.gateway.ts` 重写要点（保留 onAuthenticate 现状，Task 14 再改 readOnly）：

```typescript
export const COMPACT_THRESHOLD = 32;

@Injectable()
export class CollabGateway implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CollabGateway.name);
  readonly server: Server;
  /** 每文档"已持久化状态"（spec 2.2 lastPersistedSV，= Postgres maxSeq 时刻状态） */
  private readonly persistedSVs = new Map<string, Uint8Array>();
  readonly hooks: {
    onLoadDocument: (p: any) => Promise<any>;
    onStoreDocument: (p: any) => Promise<void>;
    onDisconnect: (p: any) => Promise<void>;
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly repo: CanvasDocUpdateRepository,
    @Optional() @Inject('COLLAB_PORT') port?: number,
    @Optional() @Inject('COLLAB_DEBOUNCE') debounce?: number,
  ) {
    this.hooks = {
      onLoadDocument: (p) => this.loadDocument(p),
      onStoreDocument: (p) => this.storeDocument(p),
      onDisconnect: (p) => this.disconnect(p),
    };
    this.server = new Server({
      port: port ?? (Number(process.env.COLLAB_PORT) || 3001),
      debounce: debounce ?? 5000,
      maxDebounce: 10000,
      onAuthenticate: /* 原样保留 */,
      onLoadDocument: this.hooks.onLoadDocument,
      onStoreDocument: this.hooks.onStoreDocument,
      onDisconnect: this.hooks.onDisconnect,
    });
  }

  /** spec 2.3：快照 + 增量按 (projectId, seq ASC) 重放 */
  private async loadDocument({ document, documentName }: any) {
    const projectId = parseProjectId(documentName);
    const docRow = await this.prisma.canvasDoc.findUnique({ where: { projectId } });
    if (docRow) Y.applyUpdate(document, new Uint8Array(docRow.state));
    for (const u of await this.repo.loadUpdates(projectId)) {
      Y.applyUpdate(document, new Uint8Array(u));
    }
    this.persistedSVs.set(projectId, Y.encodeStateVector(document));
    return document;
  }

  /** spec 2.2：diff append（含 flush 语义）+ 阈值触发 compaction */
  private async storeDocument({ document, documentName }: any) {
    const projectId = parseProjectId(documentName);
    const lastSV = this.persistedSVs.get(projectId);
    if (!lastSV) return;
    const currentSV = Y.encodeStateVector(document);
    if (svSatisfied(currentSV, lastSV) && svSatisfied(lastSV, currentSV)) return; // 无变化
    await this.repo.append(projectId, Y.encodeStateAsUpdate(document, lastSV));
    this.persistedSVs.set(projectId, currentSV);
    if (await this.repo.count(projectId) >= COMPACT_THRESHOLD) {
      const snapshotSV = await this.repo.compact(projectId);
      if (snapshotSV) this.persistedSVs.set(projectId, snapshotSV);
    }
  }

  /** spec 2.2：最后连接断开（含直连）强制 flush-then-compact */
  private async disconnect({ document, documentName, instance }: any) {
    if (instance.getConnectionsCount(documentName) > 0) return;
    const projectId = parseProjectId(documentName);
    try {
      await this.storeDocument({ document, documentName });
      await this.repo.compact(projectId);
    } catch (err) {
      this.logger.warn(`final compact failed for ${projectId}: ${(err as Error).message}`);
    } finally {
      this.persistedSVs.delete(projectId);
    }
  }
}
```

import 追加 `CanvasDocUpdateRepository`、`svSatisfied`。既有 spec 里 onStoreDocument 直接 upsert canvasDoc 的断言改为 repo.append 断言。

- [ ] **Step 4: 跑全部 collab 测试确认通过**

```bash
cd apps/api && npx jest src/modules/collab
```

Expected: PASS（含既有用例修正后）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/collab
git commit -m "feat(collab): 增量持久化——lastPersistedSV diff append/重放加载/断连强制 compaction"
```

### Task 5: @hocuspocus/extension-redis 多实例

**Files:**
- Modify: `apps/api/package.json`（+`@hocuspocus/extension-redis`）
- Modify: `apps/api/src/modules/collab/collab.module.ts`
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`
- Create: `apps/api/src/modules/collab/collab.gateway.multi-instance.spec.ts`

- [ ] **Step 1: 安装依赖**

```bash
cd apps/api && npm install @hocuspocus/extension-redis
```

- [ ] **Step 2: 写失败测试**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabGateway } from './collab.gateway';

describe('CollabGateway 多实例配置', () => {
  it('Redis extension 挂载（REDIS_URL 传入）', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        CollabGateway,
        { provide: PrismaService, useValue: {} },
        { provide: EventEmitter2, useValue: { on: jest.fn() } },
        { provide: CanvasDocUpdateRepository, useValue: {} },
        { provide: 'COLLAB_PORT', useValue: 3101 },
      ],
    }).compile();
    const gateway = mod.get(CollabGateway);
    const names = (gateway.server as any).configuration.extensions.map((e: any) => e.constructor.name);
    expect(names).toContain('Redis');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd apps/api && npx jest src/modules/collab/collab.gateway.multi-instance.spec.ts
```

Expected: FAIL（无 Redis extension）。

- [ ] **Step 4: 实现**

gateway 构造函数 Server config 追加：

```typescript
import { Redis as RedisExtension } from '@hocuspocus/extension-redis';
// ...
this.server = new Server({
  // ...既有配置
  extensions: [
    new RedisExtension({ url: process.env.REDIS_URL ?? 'redis://localhost:6379/0' }),
  ],
});
```

- [ ] **Step 5: 跑测试确认通过 + Commit**

```bash
cd apps/api && npx jest src/modules/collab/collab.gateway.multi-instance.spec.ts
git add apps/api/src/modules/collab apps/api/package.json apps/api/package-lock.json
git commit -m "feat(collab): 挂载 @hocuspocus/extension-redis 跨实例广播"
```

### Task 6: 跨实例 sync-request/response 初始同步

**Files:**
- Create: `apps/api/src/modules/collab/collab-redis-sync.service.ts`
- Create: `apps/api/src/modules/collab/collab-redis-sync.service.spec.ts`
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（loadDocument 接入）
- Modify: `apps/api/src/modules/collab/collab.module.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import * as Y from 'yjs';
import { CollabRedisSync } from './collab-redis-sync.service';

class MockRedis {
  channels: string[] = [];
  handlers = new Map<string, (msg: string) => void>();
  publish(ch: string, msg: string) {
    this.handlers.get(ch)?.(msg);
    return Promise.resolve(1);
  }
  subscribe(ch: string) { this.channels.push(ch); return Promise.resolve(); }
  on(_ev: string, handler: (msg: string, ch: string) => void) {
    // psubscribe 模式：注册到模式 handler
  }
}

describe('CollabRedisSync', () => {
  it('请求方：1s 内收到 response 则 apply，超时降级 resolve', async () => {
    const svc = new CollabRedisSync({ pub: new MockRedis() as any, sub: new MockRedis() as any });
    const peerDoc = new Y.Doc(); peerDoc.getMap('nodes').set('peer', 1);
    // 模拟对等实例立即回复
    setTimeout(() => svc.handleResponseForTest('p1', Y.encodeStateAsUpdate(peerDoc)), 10);
    const local = new Y.Doc();
    await svc.syncFromPeers('project:p1', local, 1000);
    expect(local.getMap('nodes').get('peer')).toBe(1);
  });

  it('请求方：超时不抛错（Postgres 为准兜底）', async () => {
    const svc = new CollabRedisSync({ pub: new MockRedis() as any, sub: new MockRedis() as any });
    const local = new Y.Doc();
    await expect(svc.syncFromPeers('project:p1', local, 50)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd apps/api && npx jest src/modules/collab/collab-redis-sync.service.spec.ts
```

- [ ] **Step 3: 实现**

```typescript
import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import * as Y from 'yjs';
import { randomUUID } from 'crypto';

export const COLLAB_REDIS = 'COLLAB_REDIS_CONNECTIONS';

interface SyncRequestMsg { requestId: string; docName: string; sv: string }
interface SyncResponseMsg { requestId: string; docName: string; update: string }

@Injectable()
export class CollabRedisSync implements OnModuleDestroy {
  private sub!: Redis;
  private pub!: Redis;
  private pending = new Map<string, (update: Uint8Array) => void>();

  constructor(@Inject(COLLAB_REDIS) private readonly deps: { pub: Redis; sub: Redis }) {
    this.pub = deps.pub;
    this.sub = deps.sub;
    // 模式订阅两类频道；独立于 BullMQ 连接
    void this.sub.psubscribe('collab-sync:req:*', 'collab-sync:res:*');
    this.sub.on('pmessageBuffer', (_pat: string, ch: Buffer, msgBuf: Buffer) => {
      const chStr = ch.toString();
      if (chStr.startsWith('collab-sync:req:')) this.onRequest(JSON.parse(msgBuf.toString()) as SyncRequestMsg);
      else if (chStr.startsWith('collab-sync:res:')) this.onResponse(chStr, JSON.parse(msgBuf.toString()) as SyncResponseMsg);
    });
  }

  /** spec 2.3：加载方先订阅再发布，1s 超时兜底 */
  syncFromPeers(docName: string, doc: Y.Doc, timeoutMs = 1000): Promise<void> {
    const requestId = randomUUID();
    const sv = Buffer.from(Y.encodeStateVector(doc)).toString('base64');
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); resolve(); }, timeoutMs);
      this.pending.set(requestId, (update) => {
        clearTimeout(timer); this.pending.delete(requestId);
        Y.applyUpdate(doc, update); // origin 缺省 null——生命周期同 localStorage 恢复，不入 undo（服务端 doc 无 UndoManager）
        resolve();
      });
      void this.pub.publish(`collab-sync:req:${docName}`, JSON.stringify({ requestId, docName, sv } satisfies SyncRequestMsg));
    });
  }

  /** 仅回复本实例已打开的文档（持有最新内存态）；getDocument 由 gateway 注入，避免直接依赖造成环 */
  private async onRequest(msg: SyncRequestMsg) {
    const doc: Y.Doc | undefined = this.getDocument?.(msg.docName);
    if (!doc) return;
    const sv = new Uint8Array(Buffer.from(msg.sv, 'base64'));
    const update = Y.encodeStateAsUpdate(doc, sv); // 差异编码
    const payload: SyncResponseMsg = { requestId: msg.requestId, docName: msg.docName, update: Buffer.from(update).toString('base64') };
    void this.pub.publish(`collab-sync:res:${msg.docName}:${msg.requestId}`, JSON.stringify(payload));
  }

  /** gateway 注入：`(sync as any).getDocument = (name) => this.server.documents.get(name)?.doc` */
  getDocument: ((docName: string) => Y.Doc | undefined) | null = null;

  private onResponse(ch: string, msg: SyncResponseMsg) {
    const requestId = ch.split(':').pop()!;
    this.pending.get(requestId)?.(new Uint8Array(Buffer.from(msg.update, 'base64')));
  }

  handleResponseForTest(projectId: string, update: Uint8Array) {
    // 测试注入：直接模拟收到 response
    for (const [rid, cb] of this.pending) cb(update);
  }

  async onModuleDestroy() {
    await Promise.all([this.sub.quit().catch(() => {}), this.pub.quit().catch(() => {})]);
  }
}
```

模块接线（collab.module.ts）：

```typescript
import Redis from 'ioredis';
// providers 追加：
{
  provide: COLLAB_REDIS,
  useFactory: () => ({
    pub: new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379/0'),
    sub: new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379/0'),
  }),
},
CollabRedisSync,
```

gateway 注入 `CollabRedisSync` 并在构造后绑定 `this.redisSync.getDocument = (name) => this.server.documents.get(name)?.doc`（Hocuspocus `instance.documents: Map<string, Document>`，Document 上有 `.doc`；绑定动作放 `onModuleInit`——`listen()` 之前）。`loadDocument` 末尾追加（**顺序钉死：先 set 再 sync**）：

```typescript
// 先固定"已持久化状态"（快照+增量重放后的 SV）——sync 从对等实例拉来的未持久化更新
// （对等 5s debounce 窗口内）落在 lastPersistedSV 之外，本实例 onStoreDocument 的 diff 会
// 冗余 append 它们（spec 2.2 冗余策略）：对等实例崩溃也不丢
this.persistedSVs.set(projectId, Y.encodeStateVector(document));
await this.redisSync.syncFromPeers(documentName, document, 1000);
```

（Task 4 实现里 loadDocument 末尾原有的 `this.persistedSVs.set(...)` 保持位置不变，sync 追加在其后。）

- [ ] **Step 4: 跑测试确认通过**

```bash
cd apps/api && npx jest src/modules/collab/collab-redis-sync.service.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/collab
git commit -m "feat(collab): 跨实例 sync-request/response 初始同步——1s 超时 Postgres 兜底"
```

### Task 7: readCanvas SV 等待 + metrics + 端点接线

**Files:**
- Modify: `apps/api/src/modules/collab/collab-document.service.ts`
- Modify: `apps/api/src/modules/collab/collab-document.service.spec.ts`（或 gateway.spec 中 readCanvas 用例所在文件）
- Modify: `apps/api/src/modules/execution/execution.controller.ts`、`execution.service.ts`
- Modify: `apps/api/src/modules/canvas/canvas.service.ts`（模板保存）
- Create: `apps/api/src/modules/collab/sv-wait.metrics.ts`
- Modify: `apps/web/src/api/client.ts`（apiFetch 支持 headers）
- Modify: `apps/web/src/api/executionApi.ts`
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（导出 getStateVector）

- [ ] **Step 1: 写失败测试（readCanvas SV 等待）**

在 collab-document.service 的既有 spec（collab.gateway.spec.ts:122 附近已有 withDoc/readCanvas 用例）追加：

```typescript
it('readCanvas 带 sv：doc 落后时等待 update 事件追上', async () => {
  const peerDoc = new Y.Doc();
  peerDoc.getMap('nodes').set('n1', new Map());
  const requiredSV = Y.encodeStateVector(peerDoc);
  const serverDoc = new Y.Doc(); // 空的，落后
  // mock withDoc 直接回调 serverDoc，并在 20ms 后模拟远端更新到达
  jest.spyOn(service, 'withDoc').mockImplementation(async (_pid: string, fn: any) => {
    setTimeout(() => { serverDoc.getMap('nodes').set('n1', new Map()); }, 20);
    return fn(serverDoc);
  });
  const t0 = Date.now();
  await service.readCanvas('p1', requiredSV);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(15);
});

it('readCanvas 带 sv：3s 超时降级不抛错', async () => {
  const peerDoc = new Y.Doc(); peerDoc.getMap('nodes').set('n1', 1);
  jest.spyOn(service, 'withDoc').mockImplementation(async (_p: string, fn: any) => fn(new Y.Doc()));
  await expect(service.readCanvas('p1', Y.encodeStateVector(peerDoc), 50)).resolves.toBeTruthy();
});

it('readCanvas 无 sv：直接读', async () => {
  jest.spyOn(service, 'withDoc').mockImplementation(async (_p: string, fn: any) => fn(new Y.Doc()));
  await expect(service.readCanvas('p1')).resolves.toBeTruthy();
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd apps/api && npx jest src/modules/collab/collab.gateway.spec.ts
```

- [ ] **Step 3: 实现**

`sv-wait.metrics.ts`：

```typescript
import { Counter } from 'prom-client';

export const svWaitTimeoutTotal = new Counter({
  name: 'yjs_sv_wait_timeout_total',
  help: 'readCanvas SV 等待超时降级次数',
});
```

（prom-client 默认全局 registry；先读 `apps/api/src/metrics/metrics.service.ts` 确认其采集来源——若用独立 registry，把该 registry 传入 `registers` 选项。）

`collab-document.service.ts` readCanvas 改造：

```typescript
async readCanvas(projectId: string, sv?: Uint8Array, timeoutMs = 3000): Promise<{ nodes: any[]; edges: any[] }> {
  return this.withDoc(projectId, async (doc) => {
    if (sv && !svSatisfied(Y.encodeStateVector(doc), sv)) {
      const ok = await this.waitForSV(doc, sv, timeoutMs);
      if (!ok) {
        this.logger.warn(`SV wait timeout projectId=${projectId}`);
        svWaitTimeoutTotal.inc();
      }
    }
    return this.readDocCanvas(doc);
  });
}

private waitForSV(doc: Y.Doc, sv: Uint8Array, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const check = () => svSatisfied(Y.encodeStateVector(doc), sv);
    const onUpdate = () => { if (check()) { cleanup(); resolve(true); } };
    const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); doc.off('update', onUpdate); };
    doc.on('update', onUpdate);
    if (check()) { cleanup(); resolve(true); } // 注册后立即检查——函数自洽，不依赖外层守卫时序
  });
}

/** 原 readCanvas 内的读取逻辑抽为纯函数（供复用） */
private readDocCanvas(doc: Y.Doc): { nodes: any[]; edges: any[] } {
  /* 原 withDoc 回调体原样搬入 */
}
```

类加 `private readonly logger = new Logger(CollabDocumentService.name);`。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd apps/api && npx jest src/modules/collab
```

- [ ] **Step 5: 端点接线（后端）**

先列全清单：

```bash
cd apps/api && grep -rn "readCanvas(" src --include="*.ts" | grep -v spec | grep -v "collab-document.service"
```

预期命中（侦查 2026-08-28）：`execution.service.ts:34`、`canvas.service.ts:67`（模板保存）。另 grep 提交执行类端点：

```bash
cd apps/api && grep -rn "Queue.add\|queue.add" src/modules --include="*.ts" | grep -v spec
```

对每个命中点改造：

`execution.controller.ts`（execute/enqueue 均加 header）：

```typescript
@Post('execute')
execute(
  @Body() body: { projectId: string; nodeId?: string; nodeIds?: string[]; userId?: string },
  @Headers('x-yjs-sv') sv?: string,
) {
  const svBin = sv ? new Uint8Array(Buffer.from(sv, 'base64')) : undefined;
  return this.service.execute(body.projectId, body.nodeId, body.userId || 'default-user', body.nodeIds, svBin);
}

@Post('enqueue')
async enqueue(
  @Body() body: { projectId: string; nodeId?: string },
  @Req() req: Request,
  @Headers('x-yjs-sv') sv?: string,
) {
  const job = await this.executionQueue.add('execution', {
    projectId: body.projectId,
    nodeId: body.nodeId,
    userId: (req as any).user?.id,
    sv: sv ?? null, // job payload 携带（base64），worker 读取前等待
  });
  return { jobId: job.id, status: 'queued' };
}
```

`execution.service.ts:34` 改 `readCanvas(projectId, sv)`（execute 签名加可选参数 `sv?: Uint8Array`；BullMQ execution processor 调 execute 处从 `job.data.sv` 解 base64 传入——processor 文件用 `grep -rn "execute(" src/modules/execution --include="*.processor.ts"` 定位）。`canvas.service.ts:67`（模板保存）同样加 `@Headers('x-yjs-sv')` 参数链路传入。

lighting/video-trim/video-separate 提交端点：`grep -rn "@Post" src/modules/ai-image-edit src/modules/execution --include="*.controller.ts"` 定位提交端点后同模式接线（头 → service → readCanvas/入队 payload）。

- [ ] **Step 6: 前端接线**

`client.ts` FetchOptions 加 `headers?: Record<string, string>`，fetch 调用改 `headers: { 'Content-Type': 'application/json', ...options?.headers }`。

`canvasCollabRuntime.ts` 导出：

```typescript
/** 执行请求附带的本端状态向量（spec 3.1） */
export function getStateVector(): string | undefined {
  return doc ? Buffer.from(Y.encodeStateVector(doc)).toString('base64') : undefined;
}
```

web 无 node Buffer——用手写 base64：

```typescript
export function getStateVector(): string | undefined {
  if (!doc) return undefined;
  const sv = Y.encodeStateVector(doc);
  let bin = '';
  for (const b of sv) bin += String.fromCharCode(b);
  return btoa(bin);
}
```

`executionApi.ts` 三个函数统一加头：

```typescript
import { getStateVector } from '@/stores/canvasCollabRuntime';

function svHeaders(): Record<string, string> {
  const sv = getStateVector();
  return sv ? { 'x-yjs-sv': sv } : {};
}
// 每个 apiFetch 调用加 options.headers: svHeaders()
```

模板保存/lighting 等其余读画布写操作的前端调用点：`grep -rn "saveAsTemplate\|lighting" apps/web/src/api --include="*.ts"` 定位后同模式加头。

- [ ] **Step 7: 跑两侧测试 + Commit**

```bash
cd apps/api && npx jest src/modules/collab src/modules/execution
cd ../web && npx vitest run src/api
git add apps/api/src apps/web/src
git commit -m "feat(collab): readCanvas SV 事件等待 + x-yjs-sv 全端点接线 + BullMQ payload"
```

---

## 阶段 C：团队管理

### Task 8: ProjectPermissionService（resolveProjectRole）

**Files:**
- Create: `apps/api/src/modules/team/project-permission.service.ts`
- Create: `apps/api/src/modules/team/project-permission.service.spec.ts`
- Modify: `apps/api/src/modules/team/team.module.ts`（注册+导出）

- [ ] **Step 1: 写失败测试**

```typescript
import { ProjectPermissionService } from './project-permission.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('resolveProjectRole（spec 1.2 三级解析链）', () => {
  let svc: ProjectPermissionService;
  const prisma = {
    projectMember: { findUnique: jest.fn() },
    canvasProject: { findUnique: jest.fn() },
    teamMember: { findUnique: jest.fn() },
  };

  beforeEach(() => {
    svc = new ProjectPermissionService(prisma as unknown as PrismaService);
    jest.resetAllMocks();
    prisma.canvasProject.findUnique.mockResolvedValue({ teamId: 't1', userId: 'creator1' });
  });

  it('一级：ProjectMember 显式记录优先', async () => {
    prisma.projectMember.findUnique.mockResolvedValue({ role: 'PROJECT_VIEWER' });
    await expect(svc.resolve('p1', 'u1')).resolves.toBe('PROJECT_VIEWER');
  });

  it('二级：项目创建者回退 PROJECT_OWNER（兜底历史数据）', async () => {
    prisma.projectMember.findUnique.mockResolvedValue(null);
    await expect(svc.resolve('p1', 'creator1')).resolves.toBe('PROJECT_OWNER');
  });

  it('三级：Team OWNER→PROJECT_OWNER，ADMIN/MEMBER→PROJECT_EDITOR', async () => {
    prisma.projectMember.findUnique.mockResolvedValue(null);
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    await expect(svc.resolve('p1', 'u2')).resolves.toBe('PROJECT_OWNER');
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'ADMIN' });
    await expect(svc.resolve('p1', 'u2')).resolves.toBe('PROJECT_EDITOR');
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    await expect(svc.resolve('p1', 'u2')).resolves.toBe('PROJECT_EDITOR');
  });

  it('非团队成员 → null', async () => {
    prisma.projectMember.findUnique.mockResolvedValue(null);
    prisma.teamMember.findUnique.mockResolvedValue(null);
    await expect(svc.resolve('p1', 'u3')).resolves.toBeNull();
  });

  it('项目不存在 → 抛 NotFoundException', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    await expect(svc.resolve('p1', 'u1')).rejects.toThrow('项目不存在');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd apps/api && npx jest src/modules/team/project-permission.service.spec.ts
```

- [ ] **Step 3: 实现**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProjectRole } from '@prisma/client';

@Injectable()
export class ProjectPermissionService {
  constructor(private readonly prisma: PrismaService) {}

  /** spec 1.2 权限解析优先级链：显式记录 > 创建者 > 团队角色回退 */
  async resolve(projectId: string, userId: string): Promise<ProjectRole | null> {
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
      select: { teamId: true, userId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    const explicit = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });
    if (explicit) return explicit.role;
    if (project.userId === userId) return 'PROJECT_OWNER';
    const teamMember = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId } },
      select: { role: true },
    });
    if (!teamMember) return null;
    return teamMember.role === 'OWNER' ? 'PROJECT_OWNER' : 'PROJECT_EDITOR';
  }

  /** ≥ EDITOR 校验（执行等写操作，spec 全局约定） */
  async assertEditor(projectId: string, userId: string): Promise<ProjectRole> {
    const role = await this.resolve(projectId, userId);
    if (!role || role === 'PROJECT_VIEWER') throw new ForbiddenException('无项目编辑权限');
    return role;
  }
}
```

（import 加 `ForbiddenException`。）

- [ ] **Step 4: 跑测试确认通过 + Commit**

```bash
cd apps/api && npx jest src/modules/team/project-permission.service.spec.ts
git add apps/api/src/modules/team
git commit -m "feat(team): resolveProjectRole 三级解析链 + assertEditor"
```

### Task 9: ProjectMember CRUD + 项目创建写 OWNER 记录

**Files:**
- Create: `apps/api/src/modules/team/project-member.controller.ts`
- Create: `apps/api/src/modules/team/project-member.service.ts`
- Create: `apps/api/src/modules/team/project-member.service.spec.ts`
- Modify: `apps/api/src/modules/team/team.module.ts`
- Modify: `apps/api/src/modules/project/project.service.ts:33-45`（create 里同步写 ProjectMember）
- Create: `apps/web/src/api/projectMemberApi.ts`
- Create: `apps/web/src/pages/canvas/components/ProjectMembersPanel.tsx`

- [ ] **Step 1: 写失败测试（service）**

```typescript
describe('ProjectMemberService', () => {
  it('list：显式记录 + 全团队成员有效角色推导（继承标注）', async () => {
    permSvc.resolve.mockResolvedValue('PROJECT_OWNER');
    prisma.canvasProject.findUnique.mockResolvedValue({ teamId: 't1', userId: 'creator1' });
    prisma.teamMember.findMany.mockResolvedValue([
      { userId: 'creator1', user: { id: 'creator1', name: 'c', email: 'c@x' }, role: 'MEMBER' },
      { userId: 'u2', user: { id: 'u2', name: 'b', email: 'b@x' }, role: 'MEMBER' },
    ]);
    prisma.projectMember.findMany.mockResolvedValue([{ userId: 'u2', role: 'PROJECT_VIEWER' }]);
    const { items } = await svc.list('p1', 'creator1');
    expect(items.find((i: any) => i.userId === 'creator1')).toMatchObject({ effectiveRole: 'PROJECT_OWNER', source: 'inherited' });
    expect(items.find((i: any) => i.userId === 'u2')).toMatchObject({ effectiveRole: 'PROJECT_VIEWER', source: 'explicit' });
  });

  it('add：非团队成员 400', async () => {
    prisma.teamMember.findUnique.mockResolvedValue(null);
    await expect(svc.add('p1', 'caller1', 'outsider', 'PROJECT_EDITOR')).rejects.toThrow('不是团队成员');
  });

  it('add：设 PROJECT_OWNER 需调用方 PROJECT_OWNER 或 Team OWNER——Team ADMIN 拒绝（防绕过）', async () => {
    permSvc.resolve.mockResolvedValue('PROJECT_EDITOR'); // caller 项目角色
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'ADMIN' }); // caller 团队角色
    await expect(svc.add('p1', 'caller1', 'u2', 'PROJECT_OWNER')).rejects.toThrow('仅项目所有者');
  });

  it('add：Team ADMIN 可授予 EDITOR', async () => {
    permSvc.resolve.mockResolvedValue('PROJECT_OWNER');
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prisma.projectMember.upsert.mockResolvedValue({});
    await expect(svc.add('p1', 'caller1', 'u2', 'PROJECT_EDITOR')).resolves.toBeTruthy();
  });

  it('remove：最后一个显式 PROJECT_OWNER 拒绝', async () => {
    prisma.projectMember.findUnique.mockResolvedValue({ id: 'm1', role: 'PROJECT_OWNER' });
    prisma.projectMember.count.mockResolvedValue(1); // 仅此一条 OWNER
    await expect(svc.remove('p1', 'caller1', 'u2')).rejects.toThrow('最后一个');
  });
});
```

（`permSvc` 为 `jest.spyOn`/mock 实例：`const permSvc = { resolve: jest.fn(), assertEditor: jest.fn() }` 注入 service 构造函数；`prisma` 各方法 `jest.fn()`。）

- [ ] **Step 2: 跑测试确认失败**

```bash
cd apps/api && npx jest src/modules/team/project-member.service.spec.ts
```

- [ ] **Step 3: 实现 service + controller**

`project-member.service.ts`：

```typescript
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from './project-permission.service';

const ROLE_RANK = { PROJECT_VIEWER: 0, PROJECT_EDITOR: 1, PROJECT_OWNER: 2 } as const;

@Injectable()
export class ProjectMemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perm: ProjectPermissionService,
  ) {}

  async list(projectId: string, userId: string) {
    const role = await this.perm.resolve(projectId, userId);
    if (!role) throw new ForbiddenException('非团队成员'); // VIEWER 及以上可看（spec 1.2）
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
      select: { teamId: true, userId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: project.teamId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    const explicit = await this.prisma.projectMember.findMany({ where: { projectId } });
    const explicitMap = new Map(explicit.map((m) => [m.userId, m.role]));
    const items = members.map((m) => {
      const explicitRole = explicitMap.get(m.userId);
      const inherited = m.userId === project.userId
        ? 'PROJECT_OWNER'
        : m.role === 'OWNER' ? 'PROJECT_OWNER' : 'PROJECT_EDITOR';
      return {
        userId: m.userId, name: m.user.name, email: m.user.email,
        teamRole: m.role,
        effectiveRole: explicitRole ?? inherited,
        source: explicitRole ? 'explicit' : 'inherited',
      };
    });
    return { items };
  }

  /** 统一授予规则（spec 1.2 修订）：普通角色 PO/TeamOA 可设；设 OWNER 仅 PO/TeamOWNER */
  private async assertCanManage(projectId: string, callerId: string, grantRole: 'PROJECT_VIEWER' | 'PROJECT_EDITOR' | 'PROJECT_OWNER') {
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
      select: { teamId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    const projectRole = await this.perm.resolve(projectId, callerId);
    const teamMember = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId: callerId } },
      select: { role: true },
    });
    const isProjectOwner = projectRole === 'PROJECT_OWNER';
    const isTeamOwnerOrAdmin = teamMember?.role === 'OWNER' || teamMember?.role === 'ADMIN';
    if (!isProjectOwner && !isTeamOwnerOrAdmin) throw new ForbiddenException('无项目管理权限');
    if (grantRole === 'PROJECT_OWNER' && !isProjectOwner && teamMember?.role !== 'OWNER') {
      throw new ForbiddenException('仅项目所有者或团队 OWNER 可授予项目所有者角色');
    }
  }

  async add(projectId: string, callerId: string, targetUserId: string, role: 'PROJECT_VIEWER' | 'PROJECT_EDITOR' | 'PROJECT_OWNER') {
    await this.assertCanManage(projectId, callerId, role);
    const project = await this.prisma.canvasProject.findUnique({ where: { id: projectId }, select: { teamId: true } });
    const inTeam = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project!.teamId, userId: targetUserId } },
    });
    if (!inTeam) throw new BadRequestException('目标用户不是团队成员');
    return this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: targetUserId } },
      update: { role },
      create: { projectId, userId: targetUserId, role },
    });
  }

  async changeRole(projectId: string, callerId: string, targetUserId: string, role: 'PROJECT_VIEWER' | 'PROJECT_EDITOR' | 'PROJECT_OWNER') {
    return this.add(projectId, callerId, targetUserId, role); // upsert 同构，权限规则统一
  }

  async remove(projectId: string, callerId: string, targetUserId: string) {
    await this.assertCanManage(projectId, callerId, 'PROJECT_EDITOR');
    const record = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: targetUserId } },
    });
    if (!record) throw new NotFoundException('无项目成员记录');
    if (record.role === 'PROJECT_OWNER') {
      const ownerCount = await this.prisma.projectMember.count({
        where: { projectId, role: 'PROJECT_OWNER' },
      });
      if (ownerCount <= 1) throw new BadRequestException('不能移除最后一个项目所有者');
    }
    await this.prisma.projectMember.delete({ where: { id: record.id } });
    return { ok: true };
  }
}
```

`project-member.controller.ts`：

```typescript
@Controller('api/project/:id/members')
@UseGuards(TeamGuard)
@TeamSource('project')
export class ProjectMemberController {
  constructor(private readonly svc: ProjectMemberService) {}

  @Get()
  list(@Param('id') id: string, @Req() req: Request) {
    return this.svc.list(id, (req as any).user.id);
  }

  @Post()
  add(@Param('id') id: string, @Body() body: { userId: string; role: 'PROJECT_VIEWER' | 'PROJECT_EDITOR' | 'PROJECT_OWNER' }, @Req() req: Request) {
    return this.svc.add(id, (req as any).user.id, body.userId, body.role);
  }

  @Patch(':userId')
  changeRole(@Param('id') id: string, @Param('userId') userId: string, @Body() body: { role: 'PROJECT_VIEWER' | 'PROJECT_EDITOR' | 'PROJECT_OWNER' }, @Req() req: Request) {
    return this.svc.changeRole(id, (req as any).user.id, userId, body.role);
  }

  @Delete(':userId')
  remove(@Param('id') id: string, @Param('userId') userId: string, @Req() req: Request) {
    return this.svc.remove(id, (req as any).user.id, userId);
  }
}
```

team.module.ts 注册 controller + service，并加入 app module 的 controllers（team.module 已在 AppModule 引入则自动生效）。

`project.service.ts:33-45` create 事务内追加：

```typescript
await tx.projectMember.create({
  data: { projectId: project.id, userId, role: 'PROJECT_OWNER' },
});
```

（create 当前非事务则包一层 `$transaction`；保持返回值不变。）

- [ ] **Step 4: 跑测试确认通过**

```bash
cd apps/api && npx jest src/modules/team/project-member.service.spec.ts src/modules/project
```

- [ ] **Step 5: 前端 ProjectMembersPanel**

`projectMemberApi.ts`：`listProjectMembers / addProjectMember / changeProjectMemberRole / removeProjectMember` 四函数（apiFetch，路径 `/project/${id}/members`）。

`ProjectMembersPanel.tsx`（antd Table + 添加下拉）：

```typescript
interface Row { userId: string; name: string; email: string; teamRole: string; effectiveRole: string; source: 'explicit' | 'inherited' }

export function ProjectMembersPanel({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => setRows((await listProjectMembers(projectId)).items), [projectId]);
  useEffect(() => { void load(); }, [load]);
  const columns: ColumnsType<Row> = [
    { title: '成员', dataIndex: 'name' },
    { title: '团队角色', dataIndex: 'teamRole' },
    { title: '项目角色', dataIndex: 'effectiveRole',
      render: (v, r) => <Tag color={v === 'PROJECT_OWNER' ? 'gold' : v === 'PROJECT_EDITOR' ? 'blue' : 'default'}>{v.replace('PROJECT_', '')}</Tag> },
    { title: '来源', dataIndex: 'source', render: (v) => (v === 'inherited' ? <Tag>继承</Tag> : <Tag color="cyan">显式</Tag>) },
    { title: '操作', key: 'op', render: (_, r) => (
      <Dropdown menu={{
        items: [
          { key: 'EDITOR', label: '设为编辑' },
          { key: 'VIEWER', label: '设为只读' },
          { key: 'OWNER', label: '设为所有者', danger: true },
          { type: 'divider' },
          { key: 'remove', label: '移除显式记录', danger: true, disabled: r.source === 'inherited' }, // 继承成员无 ProjectMember 记录，remove 会 404
        ],
        onClick: async ({ key }) => {
          if (key === 'remove') await removeProjectMember(projectId, r.userId);
          else await changeProjectMemberRole(projectId, r.userId, key as any);
          void load();
        },
      }}>
        <Button size="small">管理</Button>
      </Dropdown>
    ) },
  ];
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span>项目成员</span>
        <Button size="small" type="primary" onClick={() => setAdding(true)}>添加成员</Button>
      </div>
      <Table rowKey="userId" dataSource={rows} columns={columns} pagination={false} size="small" />
      <AddMemberModal open={adding} onClose={() => setAdding(false)} onDone={load} projectId={projectId} rows={rows} />
    </div>
  );
}

function AddMemberModal({ open, onClose, onDone, projectId, rows }: {
  open: boolean; onClose: () => void; onDone: () => void; projectId: string; rows: Row[];
}) {
  const [userId, setUserId] = useState<string>();
  const [role, setRole] = useState<'PROJECT_VIEWER' | 'PROJECT_EDITOR' | 'PROJECT_OWNER'>('PROJECT_EDITOR');
  const candidates = rows.filter((r) => r.source === 'inherited'); // 仅对继承成员做显式覆盖
  const submit = async () => {
    if (!userId) return;
    await addProjectMember(projectId, userId, role);
    onDone(); onClose();
  };
  return (
    <Modal open={open} title="添加项目成员" onCancel={onClose} onOk={submit}>
      <Select style={{ width: '100%' }} placeholder="选择成员" value={userId} onChange={setUserId}
        options={candidates.map((r) => ({ value: r.userId, label: r.name }))} />
      <Select style={{ width: '100%', marginTop: 8 }} value={role} onChange={setRole}
        options={[
          { value: 'PROJECT_VIEWER', label: '只读' },
          { value: 'PROJECT_EDITOR', label: '编辑' },
          { value: 'PROJECT_OWNER', label: '所有者' },
        ]} />
    </Modal>
  );
}
```

（Modal 内表单：成员 Select（options 来自 list 接口 rows 中 source=inherited 的成员）、角色 Select；提交调 `addProjectMember`。）挂载点：`grep -rn "项目设置\|ProjectSettings" apps/web/src/pages/canvas --include="*.tsx"` 定位现有项目设置弹窗，无则在 TopBar 项目名旁加入口按钮打开含该 Panel 的 Modal。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/web/src
git commit -m "feat(team): ProjectMember CRUD——防绕过授予规则/最后 OWNER 保护/继承角色列表 + 前端面板"
```

### Task 10: 创建团队端点 + web 团队切换器

**Files:**
- Modify: `apps/api/src/modules/team/team.service.ts`（createTeam）
- Modify: `apps/api/src/modules/team/team.controller.ts`
- Modify: `apps/api/src/modules/team/team.service.spec.ts`
- Modify: `apps/web/src/api/teamApi.ts`
- Create: `apps/web/src/components/TeamSwitcher.tsx`（挂 Navbar——位置 `grep -rn "Navbar\|navbar" apps/web/src/components apps/web/src/layouts --include="*.tsx" -l` 定位）

- [ ] **Step 1: 写失败测试**

```typescript
it('createTeam：credits=0、无 register_grant 流水、创建者 OWNER', async () => {
  prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
  const team = { id: 't1' };
  prisma.team.create.mockResolvedValue(team);
  prisma.teamMember.findFirst.mockResolvedValue(null); // 无既有团队
  await svc.createTeam('u1', '新团队');
  expect(prisma.teamBalance.create).toHaveBeenCalledWith({ data: { teamId: 't1', credits: 0 } });
  expect(prisma.teamCreditTransaction.create).not.toHaveBeenCalled();
  expect(prisma.teamMember.create).toHaveBeenCalledWith({ data: { teamId: 't1', userId: 'u1', role: 'OWNER' } });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd apps/api && npx jest src/modules/team/team.service.spec.ts -t createTeam
```

- [ ] **Step 3: 实现**

team.service.ts：

```typescript
/** spec 1.1：主动建团 credits=0、无流水（注册赠送只给默认团队一次，防刷） */
async createTeam(userId: string, name: string) {
  const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return this.prisma.$transaction(async (tx) => {
    const team = await tx.team.create({
      data: { name: name.trim() || `${user?.name ?? '用户'}的团队`, ownerId: userId, status: 'ACTIVE' },
    });
    await tx.teamMember.create({ data: { teamId: team.id, userId, role: 'OWNER' } });
    await tx.teamBalance.create({ data: { teamId: team.id, credits: 0, subscriptionCredits: 0 } });
    return team;
  });
}
```

team.controller.ts（注意 `mine` 之前注册，避免 `:id` 路由吞掉 `create`）：

```typescript
@Post('create')
@SkipTeamGuard()
createTeam(@Body() body: { name: string }, @Req() req: Request) {
  return this.teamService.createTeam((req as any).user.id, body.name);
}
```

同时写审计（Task 12 接线后补——本 Task 留 TODO 由 Task 12 统一替换，见其清单）。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 前端**

`teamApi.ts` 加 `createTeam(name)`。

`TeamSwitcher.tsx`：

```typescript
export function TeamSwitcher() {
  const [teams, setTeams] = useState<{ id: string; name: string; role: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const current = localStorage.getItem('currentTeamId');
  const currentTeam = teams.find((t) => t.id === current) ?? teams[0];
  const load = useCallback(async () => setTeams(await getMyTeams()), []);
  useEffect(() => { void load(); }, [load]);

  const switchTo = (id: string) => {
    if (id === current) return;
    localStorage.setItem('currentTeamId', id);
    location.reload();
  };
  const create = async () => {
    const team = await createTeam(name);
    localStorage.setItem('currentTeamId', team.id); // 创建后自动切换（spec 1.1）
    location.reload();
  };

  return (
    <Dropdown menu={{
      items: [
        ...teams.map((t) => ({ key: t.id, label: <span>{t.name}{t.id === currentTeam?.id ? ' ✓' : ''}</span> })),
        { type: 'divider' },
        { key: 'create', label: '新建团队' },
      ],
      onClick: ({ key }) => key === 'create' ? setOpen(true) : switchTo(key),
    }}>
      <Button size="small">{currentTeam?.name ?? '团队'} <DownOutlined /></Button>
      <Modal open={open} title="新建团队" onCancel={() => setOpen(false)} onOk={create}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="团队名称" />
      </Modal>
    </Dropdown>
  );
}
```

挂载到 Navbar 用户区。**解散回退**：工作区加载处（或 TeamSwitcher load 后）检测 `current` 不在 teams 中 → `localStorage.setItem('currentTeamId', teams[0].id)`（无团队不可能，一期禁解散唯一团队）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/web/src
git commit -m "feat(team): 创建团队端点(余额0防刷) + Navbar 团队切换器/新建/解散回退"
```

### Task 11: OWNER 转让

**Files:**
- Modify: `apps/api/src/modules/team/team.service.ts`（transferOwnership）
- Modify: `apps/api/src/modules/team/team.controller.ts`
- Modify: `apps/api/src/modules/team/team.service.spec.ts`
- Modify: `apps/web/src/pages/team/TeamPage.tsx`（成员 tab 三点菜单）

- [ ] **Step 1: 写失败测试**

```typescript
it('transferOwnership：事务内三写一审计', async () => {
  prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
  prisma.teamMember.findUnique.mockImplementation(({ where }) => {
    const k = where.teamId_userId;
    if (k.userId === 'owner1') return { role: 'OWNER' };
    if (k.userId === 'u2') return { role: 'MEMBER' };
    return null;
  });
  await svc.transferOwnership('t1', 'owner1', 'u2');
  expect(prisma.teamMember.update).toHaveBeenCalledWith({ where: { teamId_userId: { teamId: 't1', userId: 'owner1' } }, data: { role: 'ADMIN' } });
  expect(prisma.teamMember.update).toHaveBeenCalledWith({ where: { teamId_userId: { teamId: 't1', userId: 'u2' } }, data: { role: 'OWNER' } });
  expect(prisma.team.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { ownerId: 'u2' } });
});

it('非 OWNER 拒绝 / 目标非成员拒绝 / 转让给自己拒绝', async () => {
  prisma.teamMember.findUnique.mockResolvedValue({ role: 'ADMIN' });
  await expect(svc.transferOwnership('t1', 'a1', 'u2')).rejects.toThrow('仅 OWNER');
  prisma.teamMember.findUnique.mockImplementation(({ where }) =>
    where.teamId_userId.userId === 'owner1' ? { role: 'OWNER' } : null);
  await expect(svc.transferOwnership('t1', 'owner1', 'ghost')).rejects.toThrow('团队成员');
  await expect(svc.transferOwnership('t1', 'owner1', 'owner1')).rejects.toThrow('自己');
});
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

```typescript
/** spec 1.3：事务内 原 OWNER→ADMIN / 目标→OWNER / Team.ownerId 同步（审计由 Task 12 统一接线） */
async transferOwnership(teamId: string, callerId: string, targetUserId: string) {
  const caller = await this.requireMember(teamId, callerId);
  if (caller.role !== 'OWNER') throw new ForbiddenException('仅 OWNER 可转让团队');
  if (targetUserId === callerId) throw new BadRequestException('不能转让给自己');
  const target = await this.requireMember(teamId, targetUserId);
  return this.prisma.$transaction(async (tx) => {
    await tx.teamMember.update({ where: { teamId_userId: { teamId, userId: callerId } }, data: { role: 'ADMIN' } });
    await tx.teamMember.update({ where: { teamId_userId: { teamId, userId: targetUserId } }, data: { role: 'OWNER' } });
    return tx.team.update({ where: { id: teamId }, data: { ownerId: targetUserId } });
  });
}
```

（controller 加 `@Post(':id/transfer-ownership')`；审计写入不在本 Task 实现——Task 12 的接线清单含 transferOwnership，届时在事务内补 `audit.logTx`，operatorName 从 `prisma.user.findUnique({ where: { id: callerId } })` 取。）

UI：TeamPage 成员 tab 行操作菜单（仅当查看者是 OWNER 且行用户非自己）加「转让所有权」项 → Modal.confirm 输入确认 → 调 API → 刷新。

- [ ] **Step 4: 跑测试确认通过 + Commit**

```bash
git add apps/api/src apps/web/src
git commit -m "feat(team): OWNER 转让——事务内三写 + 二次确认 UI"
```

### Task 12: 审计日志写入接线

**Files:**
- Modify: `apps/api/src/common/audit/audit.service.ts`（+teamId、+logTx）
- Modify: `apps/api/src/common/audit/audit.service.spec.ts`
- Modify: `apps/api/src/modules/team/team.service.ts`（各动作接线）
- Modify: `apps/api/src/modules/team/team-credit.service.ts`（充值/订阅由回调侧接——实际在 team-recharge.service.ts / team-subscription.service.ts 成功事务处）
- Modify: `apps/api/src/modules/team/project-member.service.ts`（项目成员动作）

- [ ] **Step 1: 写失败测试（audit.service）**

```typescript
it('log 带 teamId 写入', async () => {
  await svc.log({ operatorId: 'u1', operatorName: 'a', teamId: 't1', targetType: 'TEAM', targetId: 't1', action: 'create_team' });
  expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ teamId: 't1', action: 'create_team' }),
  }));
});

it('logTx 在传入事务上写', async () => {
  const tx = { auditLog: { create: jest.fn() } };
  await svc.logTx(tx as any, { operatorId: 'u1', operatorName: 'a', teamId: 't1', targetType: 'TEAM_MEMBER', targetId: 'u2', action: 'remove_member' });
  expect(tx.auditLog.create).toHaveBeenCalled();
});
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

audit.service.ts：`AuditLogParams` 加 `teamId?: string | null`；log 的 create data 加 `teamId: params.teamId ?? null`；新增：

```typescript
async logTx(tx: { auditLog: { create(args: any): Promise<unknown> } }, params: AuditLogParams): Promise<void> {
  await tx.auditLog.create({ data: { /* 同 log 的字段映射，teamId 含 */ } });
}
```

接线清单（各 service 成功路径调用 `this.audit.log/logTx`，operatorName 从 user 表缓存或调用点已有数据取）：

| 文件 | 方法 | action / targetType |
|---|---|---|
| team.service.ts | createTeam | create_team / TEAM |
| team.service.ts | disbandTeam | disband_team / TEAM |
| team.service.ts | removeMember | remove_member / TEAM_MEMBER |
| team.service.ts | changeRole | change_role / TEAM_MEMBER（before/after role） |
| team.service.ts | setQuota | adjust_quota / TEAM_MEMBER（before/after quota） |
| team.service.ts | transferOwnership | transfer_ownership / TEAM_MEMBER |
| team.service.ts | approve/reject | approve_join / reject_join / TEAM_MEMBER |
| team-recharge.service.ts | 回调成功事务 | recharge / TEAM（afterValue: credits） |
| team-subscription.service.ts | 购买成功事务 / expire processor | subscribe / expire / TEAM |
| project-member.service.ts | add/changeRole/remove | add_project_member / change_project_role / remove_project_member / PROJECT_MEMBER |

各 service 构造函数注入 `AuditService`（common/audit 已有 module 导出则直接 import；无 module 则在 team.module providers 注册 AuditService）。

- [ ] **Step 4: 跑测试确认通过（team 全量 + audit）**

```bash
cd apps/api && npx jest src/modules/team src/common/audit
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(team): 审计写入接线——10 类动作全量覆盖 + logTx 事务内审计"
```

### Task 13: 审计查询端点 + TeamPage 审计 tab

**Files:**
- Modify: `apps/api/src/modules/team/team.controller.ts`
- Modify: `apps/api/src/modules/team/team.service.ts`（listAuditLogs）
- Modify: `apps/api/src/modules/team/team.service.spec.ts`
- Modify: `apps/web/src/api/teamApi.ts`
- Modify: `apps/web/src/pages/team/TeamPage.tsx`

- [ ] **Step 1: 写失败测试**

```typescript
it('listAuditLogs：按 teamId 分页倒序；非 OWNER/ADMIN 拒绝', async () => {
  prisma.teamMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
  await expect(svc.listAuditLogs('t1', 'u1', 1, 20)).rejects.toThrow('仅团队管理员');
  prisma.teamMember.findUnique.mockResolvedValue({ role: 'OWNER' });
  prisma.auditLog.findMany.mockResolvedValue([]);
  prisma.auditLog.count.mockResolvedValue(0);
  await expect(svc.listAuditLogs('t1', 'u1', 1, 20)).resolves.toEqual({ items: [], total: 0 });
});
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

service：

```typescript
async listAuditLogs(teamId: string, callerId: string, page = 1, pageSize = 20) {
  const caller = await this.requireMember(teamId, callerId);
  if (caller.role !== 'OWNER' && caller.role !== 'ADMIN') throw new ForbiddenException('仅团队管理员可查看审计日志');
  const where = { teamId };
  const [items, total] = await Promise.all([
    this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    this.prisma.auditLog.count({ where }),
  ]);
  return { items, total };
}
```

controller：

```typescript
@Get(':id/audit-logs')
listAuditLogs(@Param('id') id: string, @Query() q: { page?: string; pageSize?: string }, @Req() req: Request) {
  return this.teamService.listAuditLogs(id, (req as any).user.id, Number(q.page) || 1, Number(q.pageSize) || 20);
}
```

web：teamApi 加 `getAuditLogs(teamId, page, pageSize)`；TeamPage 左导航加第 5 项「审计日志」，tab 内容为 antd Table（服务端分页，列：时间/操作者/动作（中文映射常量表）/对象/摘要（beforeValue→afterValue JSON 简渲染））。

- [ ] **Step 4: 跑测试 + Commit**

```bash
cd apps/api && npx jest src/modules/team
git add apps/api/src apps/web/src
git commit -m "feat(team): 审计查询端点 + TeamPage 第5 tab"
```

### Task 14: VIEWER 只读贯通（collab readOnly + 执行 403）

**Files:**
- Modify: `apps/api/src/modules/collab/collab.gateway.ts`（onAuthenticate）
- Modify: `apps/api/src/modules/collab/collab.gateway.spec.ts`
- Modify: `apps/api/src/modules/execution/execution.controller.ts` 或 service（execute/enqueue 入口）
- Modify: `apps/api/src/modules/execution`（相关 spec）

- [ ] **Step 1: 写失败测试**

```typescript
it('onAuthenticate：PROJECT_VIEWER 返回 readOnly', async () => {
  permSvc.resolve.mockResolvedValue('PROJECT_VIEWER');
  const ctx = await hooks.onAuthenticate({ requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }), documentName: 'project:p1', requestParameters: new URLSearchParams() });
  expect(ctx).toMatchObject({ readOnly: true });
});

it('onAuthenticate：EDITOR 正常可写', async () => {
  permSvc.resolve.mockResolvedValue('PROJECT_EDITOR');
  const ctx = await hooks.onAuthenticate({ /* 同上 */ });
  expect(ctx.readOnly).toBeFalsy();
});

it('execute：VIEWER 403', async () => {
  permSvc.resolve.mockResolvedValue('PROJECT_VIEWER');
  await expect(service.execute('p1', undefined, 'u1', undefined)).rejects.toThrow('无项目编辑权限');
});
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

collab.gateway.ts 注入 `ProjectPermissionService`（collab.module import TeamModule 或直接注册该 service），onAuthenticate 在成员校验后追加：

```typescript
const projectRole = await this.perm.resolve(projectId, session.user.id);
if (!projectRole) throw new Error('非团队成员');
return {
  user: { id: session.user.id, name: session.user.name, role: member.role },
  readOnly: projectRole === 'PROJECT_VIEWER', // spec 1.2：Hocuspocus 拒绝只读连接的写更新
};
```

execution.service.execute 在 project 加载后：`await this.perm.assertEditor(projectId, userId);`（enqueue controller 侧同调）。lighting 等提交端点同模式（Task 7 Step 5 已 grep 出的清单内执行类端点全部接 assertEditor）。

- [ ] **Step 4: 跑测试 + Commit**

```bash
cd apps/api && npx jest src/modules/collab src/modules/execution
git add apps/api/src
git commit -m "feat(team): VIEWER 只读贯通——collab readOnly + 执行端点 403"
```

---

## 阶段 D：前端 undo

### Task 15: canvasUndo.ts——Y.UndoManager 建立 + 快捷键改调

**Files:**
- Create: `apps/web/src/stores/canvasUndo.ts`
- Create: `apps/web/src/stores/canvasUndo.test.ts`
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（initCollab/destroyCollab 接线 + Origin 常量）
- Modify: `apps/web/src/hooks/useGroupKeyboard.ts:6,73,76`（改 import 与调用）

- [ ] **Step 1: 写失败测试**

```typescript
import * as Y from 'yjs';
import { Origin, attachUndoManager, undoCanvas, redoCanvas } from './canvasUndo';

describe('Y.UndoManager 集成（spec 4.2/4.4）', () => {
  it('local-user 事务入栈；server/provider origin 不入栈', () => {
    const doc = new Y.Doc();
    const um = attachUndoManager(doc);
    doc.transact(() => doc.getMap('nodes').set('n1', 'a'), Origin.LocalUser);
    doc.transact(() => doc.getMap('nodes').set('n2', 'b'), 'server');
    doc.transact(() => doc.getMap('nodes').set('n3', 'c'), null as any);
    expect(um.undoStack.length).toBe(1);
  });

  it('undo 恢复旧值，redo 恢复新值', () => {
    const doc = new Y.Doc();
    const um = attachUndoManager(doc);
    const nodes = doc.getMap('nodes');
    doc.transact(() => nodes.set('n1', 'v1'), Origin.LocalUser);
    doc.transact(() => nodes.set('n1', 'v2'), Origin.LocalUser);
    um.stopCapturing();
    doc.transact(() => nodes.set('n1', 'v3'), Origin.LocalUser);
    expect(um.undoStack.length).toBe(2); // stopCapturing 分隔
    um.undo();
    expect(nodes.get('n1')).toBe('v2');
    um.redo();
    expect(nodes.get('n1')).toBe('v3');
  });

  it('栈上限 100 截断', () => {
    const doc = new Y.Doc();
    const um = attachUndoManager(doc);
    const nodes = doc.getMap('nodes');
    for (let i = 0; i < 120; i++) {
      um.stopCapturing();
      doc.transact(() => nodes.set(`n${i}`, i), Origin.LocalUser);
    }
    expect(um.undoStack.length).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd apps/web && npx vitest run src/stores/canvasUndo.test.ts
```

- [ ] **Step 3: 实现**

`canvasUndo.ts`：

```typescript
import * as Y from 'yjs';

/** spec 全局约定 Origin 常量——trackedOrigins 唯一入栈者 */
export const Origin = { LocalUser: 'local-user', Server: 'server' } as const;

const STACK_LIMIT = 100;

let undoManager: Y.UndoManager | null = null;

export function attachUndoManager(doc: Y.Doc): Y.UndoManager {
  undoManager?.destroy();
  undoManager = new Y.UndoManager([doc.getMap('nodes'), doc.getMap('edges')], {
    trackedOrigins: new Set([Origin.LocalUser]),
    captureTimeout: 500,
  });
  undoManager.on('stack-item-added', ({ type }) => {
    // yjs 事件 payload 为 { stackItem, type }，type: 'undo' | 'redo'（无 stack 字段）
    if (type === 'undo' && undoManager!.undoStack.length > STACK_LIMIT) {
      undoManager!.undoStack.shift(); // 手动截断（Y.UndoManager 无内建上限）
    }
  });
  return undoManager;
}

export function detachUndoManager() {
  undoManager?.destroy();
  undoManager = null;
}

export function stopCapturing() {
  undoManager?.stopCapturing();
}

export function getUndoManager() {
  return undoManager;
}

/** 快捷键入口（保留 S-1 语义：undo 后消失节点的活跃进程取消） */
export async function undoCanvas(): Promise<void> {
  const um = undoManager;
  if (!um || um.undoStack.length === 0) return;
  const { useCanvasStore } = await import('./canvasStore');
  const beforeIds = new Set(useCanvasStore.getState().nodes.map((n: any) => n.id));
  um.undo();
  const after = useCanvasStore.getState();
  for (const id of beforeIds) {
    if (!after.nodes.some((n: any) => n.id === id) && after.nodeProcessMap[id]) {
      after.cancelNodeProcess(id);
    }
  }
}

export async function redoCanvas(): Promise<void> {
  if (!undoManager || undoManager.redoStack.length === 0) return;
  undoManager.redo();
}
```

`canvasCollabRuntime.ts`：
- 删除 `LOCAL_ORIGIN/LOCAL_UNDO_ORIGIN/markNextAsUndo/fromUndoFlag`（L24-25、L242-247），改 `import { Origin, attachUndoManager, detachUndoManager, stopCapturing } from './canvasUndo'` 并 `export { Origin } from './canvasUndo'`（过渡期兼容 import）。
- `syncStoreToDoc` 调用处 origin 一律 `Origin.LocalUser`。
- `initCollab` 在 `doc = new Y.Doc()` 后（L167 紧随）立即 `attachUndoManager(doc);`——不依赖 synced 时序（localStorage 恢复 origin=null 不入栈；synced 前 UI 不可交互无 local-user 事务，提前 attach 纯健壮性）
- `destroyCollab`：`detachUndoManager();`
- `onRemote` 的 `fromLocal` 判断（L200）改：`const fromLocal = events.some((e) => e.transaction.origin === Origin.LocalUser);`

`useGroupKeyboard.ts`：import 改 `from '@/stores/canvasUndo'`（undoCanvas/redoCanvas 同名签名兼容，调用点 L73/76 不变）。

- [ ] **Step 4: 跑测试确认通过 + 既有键盘测试**

```bash
cd apps/web && npx vitest run src/stores/canvasUndo.test.ts src/hooks/useGroupKeyboard.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): Y.UndoManager——trackedOrigins 仅 local-user/栈截断/S-1 进程取消/快捷键改调"
```

### Task 16: 桥单向化收尾 + stopCapturing 交互边界

**Files:**
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（applyDocToStore 去 withHistoryPaused、hydrateLoaded 调用移除）
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx:292,311`（拖拽边界 stopCapturing）
- Modify: `apps/web/src/pages/canvas/page.tsx:88,121,128,141`（withHistoryPaused/hydrateLoaded 移除）
- Modify: `apps/web/src/pages/canvas/hooks/useCanvasPersistence.ts:6,43,81`
- Modify: `apps/web/src/pages/canvas/components/nodes/TextInputNode.tsx:8,158-159`、`VideoGenNode.tsx:9,570,593`、`ImageGenNode.tsx:12,962,967`、`groups/GroupNode.tsx:7,30-31`（resize 边界）
- Modify: `apps/web/src/pages/canvas/components/groups/GroupContextMenu.tsx:5,63`

- [ ] **Step 1: 写失败测试（拖拽合并 + 参数停顿分隔，vitest 集成级）**

在 `canvasUndo.test.ts` 追加：

```typescript
it('captureTimeout 内连续事务合并为一个 undo 项，stopCapturing 分隔', async () => {
  const doc = new Y.Doc();
  const um = attachUndoManager(doc);
  const pos = new Y.Map(); doc.getMap('nodes').set('n1', pos);
  doc.transact(() => pos.set('x', 1), Origin.LocalUser);
  doc.transact(() => pos.set('x', 2), Origin.LocalUser); // 500ms 内：合并
  expect(um.undoStack.length).toBe(1);
  stopCapturing();
  doc.transact(() => pos.set('x', 3), Origin.LocalUser);
  expect(um.undoStack.length).toBe(2);
  um.undo();
  expect(pos.get('x')).toBe(2);
});
```

- [ ] **Step 2: 跑测试确认失败→实现→通过**（stopCapturing 已在 Task 15 实现，此用例应直接通过；若失败修复 canvasUndo）

- [ ] **Step 3: 边界接线（逐文件）**

`CanvasView.tsx`：
- `handleNodeDragStart`（L292）：`beginDragTransaction()` 调用删除（函数体清空或删 callback）
- L311 `endDragTransaction()` 改为 `stopCapturing()`
- L193-195 卸载兜底：删除（无 pause 状态需要复位）

`TextInputNode/VideoGenNode/ImageGenNode/GroupNode` 的 `beginDragTransaction()/endDragTransaction()` 对：begin 删除、end 改 `stopCapturing()`（resize 边界）。

`GroupContextMenu.tsx:63`：`withHistoryTransaction(...)` 包装拆除，内层代码保留（多 set 由 captureTimeout 合并）。

`canvasCollabRuntime.ts` applyDocToStore（L123）：`withHistoryPaused(() => {...})` 包装拆除保留函数体；L141 `hydrateLoaded()` 删除（UndoManager 生命周期由 initCollab 的 attachUndoManager 管理，每次项目切换新建即清栈）。

`page.tsx`：L88 `withHistoryPaused(...)` 包装拆除（外层已有 setHydrating(true) L86，防桥回写足够）；L121/128/141 `hydrateLoaded()` 三处调用删除；import 清理。

`useCanvasPersistence.ts`：L43 withHistoryPaused 包装拆除（外层 L41 已 setHydrating(true)）；L81 `hydrateLoaded()` 删除；L6 import 清理。

- [ ] **Step 4: 全量回归（web）**

```bash
cd apps/web && npx vitest run
```

Expected: 阶段 D 已删 zundo 相关用例（Task 17 处理）前允许既有 zundo 测试仍过（本 Task 未动 store temporal）；不允许出现新 FAIL。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): 交互边界 stopCapturing 接线 + withHistoryPaused/hydrateLoaded 退役"
```

### Task 17: 删除 zundo 全套

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts:7,21,159,227,803,844,930,1060,1184,1251`
- Modify: `apps/web/src/stores/canvasHistory.ts`（删 zundo 专用导出，保留 pickStruct*/HISTORY_LIMIT）
- Delete: `apps/web/src/stores/canvasHistoryRuntime.ts`、`canvasHistoryRuntime.test.ts`
- Modify/Delete（按依赖）：`canvasStore.tx.test.ts`、`canvasStore.groups.test.ts`、`canvasStore.test.ts:682-722`（temporal describe）、`useStitchTask.test.ts`、`page.test.tsx:21-22,285-295`、`CanvasView.test.tsx:23-24,428-435`
- Modify: `apps/web/package.json`（卸载 zundo）

- [ ] **Step 1: 改 canvasStore.ts**

- L7 `import { temporal } from 'zundo'` 删除；L21 `import { withHistoryTransaction }` 删除
- L159 `create<CanvasState>()(temporal(...))` 改 `create<CanvasState>()(...)`（中间件包装剥除，内层原样）
- 7 处 `withHistoryTransaction(() => {...})` 调用（L227/803/844/930/1060/1184/1251）拆包装保留函数体
- store 类型里的 `temporal` 相关类型引用如有则清理

- [ ] **Step 2: 精简 canvasHistory.ts**

保留：`HISTORY_LIMIT`、`pickStructNodes`、`pickStructEdges`（bindBridge diff 检测与 localStorage 快照仍用）。
删除：`NodeDataSnapEntry/HistoryPartial/NodeStoreLike/sanitizeDragging/cloneSnap/createPartialize/structuralEquality/reconcileNodeStore`（canvasCollabRuntime L9 的 pickStruct import 保留）。

- [ ] **Step 3: 删 canvasHistoryRuntime.ts 与其测试**

确认无剩余 import：

```bash
cd apps/web && grep -rn "canvasHistoryRuntime" src --include="*.ts*"
```

预期：仅 page.test.tsx/CanvasView.test.tsx 的 vi.mock 行（同步删除 mock 行）。

- [ ] **Step 4: 测试文件迁移**

- `canvasHistoryRuntime.test.ts` 删除（其覆盖的行为由 canvasUndo.test.ts 的 UndoManager 用例承接）
- `canvasStore.tx.test.ts`/`canvasStore.groups.test.ts`：`temporal` 断言（pastStates.length）改写为 UndoManager 断言（`getUndoManager()?.undoStack.length`）或直接删该类断言保留结构断言（undo/redo 行为断言保留：调 undoCanvas 后验节点状态）
- `canvasStore.test.ts:682-722` temporal describe 删除
- `useStitchTask.test.ts:19,39` temporal 断言改 UndoManager 断言
- `page.test.tsx` L21-22 mock 改 `vi.mock('@/stores/canvasUndo', () => ({ undoCanvas: vi.fn(), redoCanvas: vi.fn() }))`；L285-295 hydrateLoaded 断言删除
- `CanvasView.test.tsx` L23-24 mock 改 canvasUndo（stopCapturing: vi.fn()）；L428-435 M-4 兜底断言删除（无 pause 状态）

- [ ] **Step 5: 卸载依赖 + 全量回归**

```bash
cd apps/web && npm uninstall zundo && npx vitest run && npx tsc --noEmit
```

Expected: 全部 PASS，无 zundo 残留 import（`grep -rn "zundo" src` 为空）。

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web)!: zundo 全套退役——store 去 temporal/事务族拆除/测试迁移"
```

---

## 阶段 E：验收

### Task 18: 双实例浏览器验收

**Files:** 无代码（验收任务），产出验收记录于本 plan 勾选。

- [ ] **Step 1: 启动双实例**

```bash
# 实例 A（默认）
cd apps/api && PORT=3000 COLLAB_PORT=3001 npm run start:dev
# 实例 B（新终端）
cd apps/api && PORT=3002 COLLAB_PORT=3003 npm run start:dev
# web
cd apps/web && npm run dev
```

- [ ] **Step 2: spec 验证标准逐项浏览器验收**

1. 多团队：TeamSwitcher 新建团队→余额 0/无流水（psql 查 TeamCreditTransaction）/自动切换；切换 reload 生效
2. 项目角色：用户 B 设为 PROJECT_VIEWER 后打开项目→画布只读（编辑无效果）、执行 403；设回 EDITOR 恢复；Team ADMIN 无记录时可编辑且团队页可删项目；移除最后一个显式 OWNER 被拒
3. OWNER 转让：转让后原 OWNER 变 ADMIN、TeamPage 顶部所有者变化、审计 tab 有 transfer_ownership 记录
4. 审计：1.4 表格动作逐类触发→第 5 tab 分页可见
5. 多实例：浏览器 A 经 ws://localhost:3001、浏览器 B 经 ws://localhost:3003（临时改 `collabUrl()` 或 query 覆盖）同项目编辑实时互见；实例 A 端口执行读取到 B 端 5s debounce 窗口内的新参数（改参数立即执行）
6. SV：改参数→立即点执行→生成使用新参数（非旧值）
7. undo：本地拖拽/参数/删除可 Ctrl+Z；B 用户编辑后 A 端 Ctrl+Z 不回退 B 的内容；一次拖拽=一个 undo 项；连续输入合并；>100 截断；刷新后 undo 栈清空（预期）
8. 回归：模板保存/导入、素材库、组操作、6 类节点生成、presence 光标互见、断网重连恢复

- [ ] **Step 3: 发现问题回到对应 Task 修复后重验**

- [ ] **Step 4: Commit（如有修复）+ 汇报验收结果**
