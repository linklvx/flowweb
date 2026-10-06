# Y0a-1 写读一致性+测试基座 Implementation Plan（v4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 Y0a 第一子批——(projectId,seq) 唯一约束+append 单语句（**AppendResult 判别返回契约——签名一步定死，防 Y0a-3 加 fence 时中途改签名连锁**）+compact 强化（按 id 删/stateSeq 精确/**{compacted,reason} 返回契约+maybeCompact 仅成功开窗**/pendingStructs 弹性放弃/svDominates 委托 svSatisfied 纯函数锚）+loadForHydration 单 RR 事务+超时自愈（仅可重试类触发·**P2024 排除+自愈增量预算 ≤8s**）+load 路径 stash peek/consume（关第四条蒸发路径，spec §1.10）+既有 repository.spec 冲击面改写+docShape 值守卫+对抗语料全量 FakeMap+四条扫描门禁+测试基座（db-fixtures/mock-repo 含 hydrateWithRecovery 委托/failing-repo/双 client 装置/库锚）+collab-core 最小 CI job（**收敛为 int 显式清单+passed 口径条数断言——库锚/语料/门禁归 test job，防双源**）（spec v2.4 §3 Y0a-1）。

**Architecture:** PG=单实例 delta 并集日志+CRDT 幂等+锁只管 compact。本批把写侧三件套与装载单事务固化为结构不变量锚；撕裂当期不可达（库串行化），只做隔离级别性质验证。v2 修订：SV inline 哨兵删、预检改超时自愈、Proxy 故障器砍、storeInFlight 移 Y0a-2。v3 修订（第五轮外审裁定）：takeStash 改 peek/consume、自愈加错误分类+compact opts 独立预算、pendingStructs 分支 throw→return、mock-repo 补 hydrateWithRecovery 委托、语料改全量 FakeMap 嵌套+docShape 值守卫、A9 锚改失败态、脚本移 apps/api/scripts/、CI 条数断言改显式清单+numPassedTests、扫描门禁扩 collab 全目录、既有 repository.spec 六用例改写清单。**v4 修订（spec v2.4 对齐——五~七轮外审收敛）**：①append 返回 `AppendResult`（`{ok:true,seq}|{ok:false,reason:'fenced'|'no-row'}`，本批恒 ok:true）；②compact 返回 `{compacted,reason?:'abandoned'|'empty'}`+**maybeCompact 仅 `compacted===true` 开窗**（放弃不开窗=下次 store 立即重试——撤 v3"60s 节流设计语义"裁定，见 Task 3 Step 5 重裁理由）；③自愈分类**去 P2024**（池饥饿 fail-closed 不放大）+预算 60s→**自愈增量 ≤8s**（compact 6s/1s+重试装载 2s/500ms）；④collab-core 撤"库锚+语料+门禁"步（test job 经 verify 常跑=第二真源）；⑤dist 断言移入根 verify 链；⑥gateway 既有 compact stub 需随返回契约补 `.mockResolvedValue({compacted:true})`（窗口断言依赖）。

**Tech Stack:** NestJS/Prisma/PG16/yjs 13.6.32/@hocuspocus/server 4.6.0/vitest（*.int.spec.ts 真库惯例）/tsx（脚本运行，`seed: tsx` 先例）。

**执行门（spec §2.1）**：Task 10 出口清单全绿后**请用户确认再启动 Y0a-2 plan**。

**TDD 纪律**：先失败测试（红）→最小实现（绿）→commit；结构锚如实声明（对"迁移前/破坏后"红，不伪装行为红门）。**探针前置纪律（v8 目录第 10 条）**：每个新守卫/断言落地时附最小可复现构造。

---

## File Structure

| 文件 | 动作 | 职责 |
|------|------|------|
| `apps/api/prisma/schema.prisma` | Modify:808-843 | CanvasDoc+stateSeq；`@@unique([projectId,seq])` 替换 `@@index`；CollabLease 模型 |
| `apps/api/prisma/verify-indexes.sql` | Modify | 新约束/表/列存在块+冗余索引 NOT EXISTS 否定块 |
| `apps/api/src/test-utils/db-fixtures.ts` | Create | User→Team(ownerId)→CanvasProject FK 链 fixture（int 共用） |
| `apps/api/src/test-utils/mock-repo.ts` | Create | repo mock 工厂（5 个既有 spec 收敛+loadForHydration 默认态） |
| `apps/api/src/test-utils/failing-repo.ts` | Create | repo 边界故障注入助手（append/compact 抛错） |
| `apps/api/src/test-utils/dual-client-server.ts` | Create | 双 client+单 Server 装置（自 gateway.spec 提取） |
| `apps/api/src/test-utils/poll-until.ts` | Create | 轮询等待助手（禁固定 sleep） |
| `apps/api/src/modules/collab/canvas-doc-update.repository.ts` | Modify | append 单语句（**AppendResult 返回契约**）；compact 强化（**{compacted,reason} 返回**+opts.timeoutMs/maxWaitMs+pendingStructs return 放弃·计数+ERROR 单点）；loadForHydration(opts)+hydrateWithRecovery（分类触发·**P2024 排除**）；删 loadUpdates |
| `apps/api/src/modules/collab/canvas-doc-update.repository.spec.ts` | Modify | 既有六用例冲击面改写（3 红 3 绿）+pendingStructs 放弃 mock 用例（含返回形状断言） |
| `apps/api/src/modules/collab/sv.util.ts` | Modify | svDominates 一行委托 svSatisfied（单源，禁第二实现） |
| `apps/api/src/modules/collab/collab.gateway.ts` | Modify | loadDocument 数据源切换+stash peek/consume（关第四条蒸发路径）+onModuleInit 改 async await listen+**maybeCompact 仅成功开窗** |
| `apps/api/src/modules/collab/canvas-doc-hydration.int.spec.ts` | Create | 隔离性质+水位+超时自愈（真 PG） |
| `apps/api/src/modules/collab/canvas-doc-update.repository.append.int.spec.ts` | Create | append 单语句+P2002（真 PG） |
| `apps/api/src/modules/collab/canvas-doc-update.repository.compact.int.spec.ts` | Create | stateSeq 精确+等价重放+updatedAt（真 PG） |
| `apps/api/src/modules/collab/collab.library-anchors.spec.ts` | Create | 库锚（A1/A5/A6 独立 Server；A7 确定性构造；A8 单元；A9 装置） |
| `apps/api/src/modules/collab/collab-contract-guards.spec.ts` | Create | 四条扫描门禁 |
| `apps/api/src/modules/collab/adversarial-readers.spec.ts` | Create | 读者全函数（DocLike 工厂+真 Y.Doc 双路径） |
| `packages/shared/src/testing/adversarial-doc.ts` | Create | 种子化对抗 DocLike 工厂（零 yjs 依赖） |
| `packages/shared/src/index.ts` | Modify | `export * from './testing/adversarial-doc';` |
| `apps/api/tsconfig.json` | Modify | exclude 补 `**/test-utils/**` |
| `apps/api/scripts/collab-compact.ts` | Create | 人工出口（tsx 直调 repo.compact——单源；落 api 包 scripts/ 得 tsconfig.scripts.json typecheck 载体） |
| `packages/shared/src/canvas/docShape.ts` | Modify | readRecordsFromMaps 节点/边值 isDocMap 守卫（非 map 值跳过——E68 读侧全函数） |
| `packages/shared/src/canvas/docShape.fillRead.test.ts` | Modify | 守卫用例（非 map 节点/边值跳过不抛） |
| `scripts/verify-indexes.mjs` | Modify | runner 块级容错（SQL 错计失败块继续——红证据完整） |
| `apps/api/src/modules/collab/store.metrics.ts` | Modify | yjsCompactAbandonedTotal（compact 健康度唯一真实指标，P0 告警线） |
| `scripts/check-no-testutils-in-dist.mjs` | Create | dist 泄漏断言（SKIP guard） |
| `apps/api/package.json` | Modify | `test:int` script |
| `package.json`（根） | Modify | verify 链追加 api nest build+dist 泄漏断言（构建产物检查归 verify——spec §4.5 v2.4） |
| `.github/workflows/ci.yml` | Modify | collab-core 最小 job（migrate deploy+int 显式清单+条数断言——库锚/语料/门禁归 test job 防双源） |

**不改**：storeDocument/失败路径/spool（Y0a-2）；租约消费代码（Y0a-3，本批只建表+seed）；extension-redis（Y0a-3）；putStash 与 store 提前 drain(:273)/retry stash 级(:380) 两处 takeStash（Y0a-2 统一 peek 化——本批只改 load 侧读路径）。

**命令口径**：int 用例本地跑=Git Bash 前缀赋值 `DATABASE_URL=postgresql://flowweb:123456@localhost:5432/flowweb pnpm --filter @flowweb/api exec vitest run <path>`（仓内无 cross-env，勿引入）。

---

### Task 1: schema 迁移三件套+verify-indexes 门禁

**Files:**
- Modify: `apps/api/prisma/schema.prisma:808-843`
- Modify: `apps/api/prisma/verify-indexes.sql`

- [ ] **Step 1: 先写 verify-indexes 新块（对现状留红相——D13）**

`verify-indexes.sql` 末尾追加（**注意：runner 按空行分块且判据=每块 ≥1 行，块内禁空行**）：

```sql
-- Y0a-1: unique constraint on CanvasDocUpdate(projectId, seq)（pg_constraint 口径）
SELECT conname FROM pg_constraint WHERE conrelid = '"CanvasDocUpdate"'::regclass AND contype = 'u' AND pg_get_constraintdef(oid) LIKE '%projectId%seq%';
-- Y0a-1: CanvasDoc.stateSeq column NOT NULL DEFAULT 0
SELECT column_name FROM information_schema.columns WHERE table_name = 'CanvasDoc' AND column_name = 'stateSeq' AND is_nullable = 'NO' AND column_default LIKE '%0%';
-- Y0a-1: CollabLease seed row
SELECT scope FROM "CollabLease" WHERE scope = 'primary' AND owner IS NULL AND epoch = 0;
-- Y0a-1: 冗余非唯一 (projectId,seq) 索引必须不存在（否定断言：NOT EXISTS 返回 1 行=通过）
SELECT 'redundant_index_absent' AS ok WHERE NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'CanvasDocUpdate' AND indexdef LIKE '%CREATE INDEX%' AND indexdef NOT LIKE '%UNIQUE%' AND indexdef LIKE '%projectId%' AND indexdef LIKE '%seq%');
```

- [ ] **Step 2: verify-indexes runner 块级容错+跑红并留档**

runner 现状 `await client.query(b)` 无 try/catch——首个 SQL 错误整轮崩溃，红证据只能拿到第一块。改 `scripts/verify-indexes.mjs` 循环体（:51-61）：

```javascript
for (const b of blocks) {
  blockNo++;
  let res;
  try {
    res = await client.query(b);
  } catch (e) {
    failed++;
    console.error(`[块 ${blockNo}] SQL 错误: ${e.message}——SQL: ${b.replace(/\s+/g, ' ').slice(0, 90)}…`);
    continue;
  }
  const names = res.rows.map((r) => r.indexname ?? r.conname ?? JSON.stringify(r)).join(', ');
  if (res.rowCount === 0) {
    failed++;
    console.error(`[块 ${blockNo}] 空（索引/约束不存在）——SQL: ${b.replace(/\s+/g, ' ').slice(0, 90)}…`);
  } else {
    console.log(`[块 ${blockNo}] ${res.rowCount} 行: ${names}`);
  }
}
```

（既有块在容错前后都必须全绿——本改动只影响失败时的报告完整性。）

```bash
DATABASE_URL=postgresql://flowweb:123456@localhost:5432/flowweb node scripts/verify-indexes.mjs
```
（runner 自带 findRepoRoot——命令统一从仓根执行，不再 `cd apps/api`。）Expected: FAIL（新块 0 行/`CollabLease` 不存在计为错误块——**四个新块全部出现在失败清单**）。**把输出粘进本文件此步骤下方留档**：

```
[块 1] 1 行: user_subscription_one_active
[块 2] 2 行: UserSubscription_status_nextGrantDate_idx, UserSubscription_status_currentPeriodEnd_idx
[块 3] 空（索引/约束不存在）——SQL: SELECT conname FROM pg_constraint WHERE conrelid = '"CanvasDocUpdate"'::regclass AND conty…
[块 4] 空（索引/约束不存在）——SQL: SELECT column_name FROM information_schema.columns WHERE table_name = 'CanvasDoc' AND colu…
[块 5] SQL 错误: 关系 "CollabLease" 不存在——SQL: SELECT scope FROM "CollabLease" WHERE scope = 'primary' AND owner IS NULL AND epoch = 0;…
[块 6] 空（索引/约束不存在）——SQL: SELECT 'redundant_index_absent' AS ok WHERE NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tab…
verify-indexes: 4/6 块断言失败
```

（exit 1；四个新块全部在列——块 5 的 SQL 错误被 Step 2 容错捕获继续执行，块 6 才得以出现在失败清单。本机 DATABASE_URL 实际密码为 `flowweb_dev`（apps/api/.env 同源），本文档命令中 `123456` 系笔误口径，执行时以 .env 为准。）

- [ ] **Step 3: 改 schema.prisma**

`model CanvasDoc` 加 `stateSeq BigInt @default(0)`（state 行后）；`model CanvasDocUpdate` 的 `@@index([projectId, seq])` 替换为 `@@unique([projectId, seq])`；模型区新增：

```prisma
// Y0a-1：单实例租约行（消费代码在 Y0a-3；本批仅建表+迁移 seed）
model CollabLease {
  scope     String    @id
  owner     String?
  epoch     BigInt    @default(0)
  expiresAt DateTime?
}
```

- [ ] **Step 4: 生成迁移并人工检查**

```bash
cd apps/api && npx prisma migrate dev --name y0a_integrity
```
（生成目录自动带本地时间戳前缀，与既有 23 个迁移同形态。）检查 migration.sql：①CREATE UNIQUE INDEX ②DROP INDEX 旧 ③ADD COLUMN stateSeq ④CREATE TABLE CollabLease ⑤**无去重/清洗 SQL**。末尾追加（显式手工段标记）：

```sql
-- ============ 手工段（Y0a-1）：租约种子行（幂等）——非 prisma migrate dev 生成 ============
INSERT INTO "CollabLease" ("scope", "owner", "epoch") VALUES ('primary', NULL, 0)
ON CONFLICT ("scope") DO NOTHING;
```

存量撞约束（本地 246 行正常 append 不撞；撞=脏数据）→ 先人工 psql 清洗再重跑迁移。

- [ ] **Step 5: verify-indexes 转绿+全量回归+commit**

```bash
DATABASE_URL=postgresql://flowweb:123456@localhost:5432/flowweb node scripts/verify-indexes.mjs && pnpm verify
```
Expected: 全 PASS（含既有套件——schema 变更不破 mock 套件）。

```bash
git add apps/api/prisma && git commit -m "feat(collab): Y0a-1 迁移三件套——(projectId,seq) 唯一+stateSeq+CollabLease 种子+verify-indexes 否定块"
```

---

### Task 2: append 单语句+P2002 行为锚

**Files:**
- Modify: `apps/api/src/modules/collab/canvas-doc-update.repository.ts:16-21`
- Modify: `apps/api/src/modules/collab/canvas-doc-update.repository.spec.ts:33-38`（append 用例改写——冲击面）
- Create: `apps/api/src/test-utils/db-fixtures.ts`
- Test: `apps/api/src/modules/collab/canvas-doc-update.repository.append.int.spec.ts`

- [ ] **Step 1: 落 db-fixtures（User→Team→Project FK 链——Team.ownerId NOT NULL+FK→User）**

```typescript
// apps/api/src/test-utils/db-fixtures.ts
// Y0a-1：int 用例 FK 链 fixture——CanvasDocUpdate.projectId→CanvasProject→Team(ownerId)→User
// （既有 int 惯例 generation-intent.int.spec.ts 不建链因其表无 FK；本批表有 Cascade FK，必须全链）
import { PrismaClient } from '@prisma/client';

const FIXTURE_USER = 'y0a-fixture-user';
const FIXTURE_TEAM = 'y0a-fixture-team';

export async function ensureProjectFixture(prisma: PrismaClient, projectId: string, name = 'y0a-int'): Promise<void> {
  await prisma.user.upsert({
    where: { id: FIXTURE_USER },
    update: {},
    create: { id: FIXTURE_USER, name: 'y0a-fixture', email: 'y0a-fixture@local.test', emailVerified: true },
  });
  await prisma.team.upsert({
    where: { id: FIXTURE_TEAM },
    update: {},
    create: { id: FIXTURE_TEAM, name: 'y0a-fixture-team', ownerId: FIXTURE_USER },
  });
  await prisma.canvasProject.upsert({
    where: { id: projectId },
    update: {},
    create: { id: projectId, name, teamId: FIXTURE_TEAM },
  });
}

export async function cleanupProjectFixture(prisma: PrismaClient, projectId: string): Promise<void> {
  await prisma.canvasDocUpdate.deleteMany({ where: { projectId } });
  await prisma.canvasDoc.deleteMany({ where: { projectId } });
  await prisma.canvasProject.deleteMany({ where: { id: projectId } });
}
```

（字段已按 schema 一手核对，无试错项：User 必填 id/name/email/emailVerified（emailVerified Boolean 无默认值）；Team 必填 id/name/ownerId；CanvasProject 必填 id/name/teamId（userId 可空）。）

- [ ] **Step 2: 写失败测试（P2002 行为锚+序列消耗≡插入行数）**

```typescript
// canvas-doc-update.repository.append.int.spec.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { ensureProjectFixture, cleanupProjectFixture } from '../../test-utils/db-fixtures';
import * as Y from 'yjs';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'y0a1-append-int';

maybe('append（真 PG）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);

  beforeAll(async () => { await ensureProjectFixture(prisma, PID); });
  afterAll(async () => { await cleanupProjectFixture(prisma, PID); await prisma.$disconnect(); });

  it('append 返回 AppendResult：ok:true 且 seq 严格递增、行数一致（局部不变量——不读全局序列 last_value：vitest 并行 worker 下它反映所有会话取号，跨文件干扰必红）', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    const u = Y.encodeStateAsUpdate(new Y.Doc());
    const seqs: bigint[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await repo.append(PID, u);
      expect(r.ok).toBe(true);          // 契约 15：成功判据=ok===true（本批恒 true；fence 断言 Y0a-3 才追加）
      if (r.ok) seqs.push(r.seq);
    }
    expect(seqs[1] > seqs[0]).toBe(true);
    expect(seqs[2] > seqs[1]).toBe(true);
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(3);
  });

  it('重复 (projectId,seq) 被唯一约束拒绝（P2002 行为锚——对未迁移库此用例红=Task 1 红相的运行时面）', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    const u = Y.encodeStateAsUpdate(new Y.Doc());
    const r0 = await repo.append(PID, u);                          // 占用该 seq
    if (!r0.ok) throw new Error('expected ok');
    await expect(
      prisma.canvasDocUpdate.create({ data: { projectId: PID, seq: r0.seq, update: Buffer.from([0]) } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
```

- [ ] **Step 3: 跑（确认 fixture 链可建+用例红/绿状态）**

```bash
DATABASE_URL=postgresql://flowweb:123456@localhost:5432/flowweb pnpm --filter @flowweb/api exec vitest run src/modules/collab/canvas-doc-update.repository.append.int.spec.ts
```
Expected: 两用例在迁移后的库上应绿（红相已由 Task 1 Step 2 留档）。

- [ ] **Step 4: 实现单语句 append**

替换 `canvas-doc-update.repository.ts:16-21`：

```typescript
  /** Y0a-1：单语句原子 append（取号+插入同一语句——消灭两语句间进程死窗口）。
   *  返回契约（spec v2.4 §1.2/契约 15）：AppendResult 判别类型——fenced=0 行**不抛异常**，调用方
   *  禁以"未抛错"判成功；本批无租约断言恒 {ok:true}（WHERE owner+TTL 断言 Y0a-3 追加，届时 0 行
   *  返回 {ok:false,reason:'fenced'}——签名本批一步定死，防 Y0a-3 中途改签名连锁）。 */
  async append(projectId: string, update: Uint8Array): Promise<{ ok: true; seq: bigint } | { ok: false; reason: 'fenced' | 'no-row' }> {
    const rows = await this.prisma.$queryRaw<{ seq: bigint }[]>`
      INSERT INTO "CanvasDocUpdate" (id, "projectId", seq, update, "createdAt")
      SELECT gen_random_uuid()::text, ${projectId}, nextval('canvas_doc_update_seq')::bigint, ${Buffer.from(update)}, now()
      RETURNING seq`;
    return rows.length === 0 ? { ok: false, reason: 'no-row' } : { ok: true, seq: rows[0].seq };
  }
```

（调用方 `storeDocument` 现不消费返回值——void 兼容；Y0a-2 BOI 重写时按契约 15 消费。）

- [ ] **Step 5: 改写既有 append mock 用例（冲击面清单——v3 新增）**

`canvas-doc-update.repository.spec.ts:33-38` 旧断言 `canvasDocUpdate.create` 被调——单语句路径不再走 Client create，必红。改写为：

```typescript
  it('append 单语句：$queryRaw 取号+INSERT 同语句，返回 AppendResult；不经 canvasDocUpdate.create', async () => {
    prisma.$queryRaw.mockResolvedValue([{ seq: 7n }]);
    const r = await repo.append('p1', new Uint8Array([1, 2]));
    expect(r).toEqual({ ok: true, seq: 7n });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.canvasDocUpdate.create).not.toHaveBeenCalled();
  });
```

- [ ] **Step 6: 跑绿+commit**

```bash
DATABASE_URL=postgresql://flowweb:123456@localhost:5432/flowweb pnpm --filter @flowweb/api exec vitest run src/modules/collab/canvas-doc-update.repository.append.int.spec.ts src/modules/collab/canvas-doc-update.repository.spec.ts
```
（compact 相关 mock 用例本步仍绿——其改写归 Task 3 Step 6；全量 `src/modules/collab` 回归在 Task 3 Step 7。）

```bash
git add apps/api/src/modules/collab/canvas-doc-update.repository.ts apps/api/src/modules/collab/canvas-doc-update.repository.append.int.spec.ts apps/api/src/modules/collab/canvas-doc-update.repository.spec.ts apps/api/src/test-utils/db-fixtures.ts && git commit -m "feat(collab): Y0a-1 append 单语句化+P2002 行为锚+递增锚+FK 链 fixture+append mock 用例改写"
```

---

### Task 3: compact 强化（按 id 精确删+stateSeq 精确+pendingStructs 弹性+svDominates 纯函数锚）

**Files:**
- Modify: `apps/api/src/modules/collab/canvas-doc-update.repository.ts:43-71`
- Modify: `apps/api/src/modules/collab/store.metrics.ts`
- Modify: `apps/api/src/modules/collab/sv.util.ts`
- Modify: `apps/api/src/modules/collab/collab.gateway.ts:306-311`（maybeCompact 消费返回值——仅成功开窗）
- Modify: `apps/api/src/modules/collab/collab.gateway.spec.ts` / `collab.gateway.persist-status.spec.ts`（compact stub 补 `.mockResolvedValue({compacted:true})`——v4 冲击面，见 Step 5b）
- Modify: `apps/api/src/modules/collab/canvas-doc-update.repository.spec.ts`（compact 三用例改写+$transaction 断言补全+放弃用例——冲击面清单见 Step 6）
- Test: `apps/api/src/modules/collab/canvas-doc-update.repository.compact.int.spec.ts`

- [ ] **Step 1: 加指标（唯一 compact 健康度指标，P0 告警线）**

`store.metrics.ts` 追加：

```typescript
/** Y0a-1：compact 健康度唯一真实指标（v2.2 升 P0 告警线）——pendingStructs!=null 放弃本次；
 *  放弃不开窗=下次 store 立即重试（spec v2.4 E23——pendingStructs!=null 是需人工介入的异常态，
 *  活跃编辑期每 debounce 窗一次 ERROR+计数递增正是 P0 线要的最响信号；未编辑 doc 无 store 触发源不空转）。
 *  计数+ERROR 单点落 repo 的 abandoned 分支（gateway 与装载自愈两路覆盖，防双计）。 */
export const yjsCompactAbandonedTotal = new Counter({
  name: 'yjs_compact_abandoned_total',
  help: 'compact 写快照前 pendingStructs!=null 放弃本次的次数（放弃不开窗·下次 store 立即重试；连续命中=P0 人工介入信号）',
  registers: [register],
});
```

（`yjs_compact_sv_violation_total` **不创建**——inline 哨兵已删，spec v2.2 §1.5。）

- [ ] **Step 2: svDominates 落 sv.util.ts 一行委托（单源——禁第二实现）**

```typescript
/** SV 支配性（Y0a-1 纯函数锚——Y1c-1 破坏后结构锚的基础件）：rowSv 全部 clock ⊆ snapSv。
 *  委托 svSatisfied 单源；?? 0 语义=snap 缺该 client 且 clock>0 即不支配（真实 SV 不含 0 clock 条目，
 *  与更严缺省仅 clock=0 边界差——不构成语义分歧）。禁在本文件外再写 SV 解码/比较。 */
export const svDominates = (rowSv: Uint8Array, snapSv: Uint8Array): boolean => svSatisfied(snapSv, rowSv);
```

- [ ] **Step 3: 写失败测试**

```typescript
// canvas-doc-update.repository.compact.int.spec.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { svDominates } from './sv.util';
import { ensureProjectFixture, cleanupProjectFixture } from '../../test-utils/db-fixtures';
import * as Y from 'yjs';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

function docWithNodes(count: number): Y.Doc {
  const doc = new Y.Doc();
  for (let i = 0; i < count; i++) doc.getMap('nodes').set(`n${i}`, new Y.Map([['x', i]]));
  return doc;
}

describe('svDominates 纯函数锚（无需 DB）', () => {
  it('阴性对照：row clock 超前 snap → false', () => {
    const a = new Y.Doc(); a.getMap('nodes').set('k', new Y.Map([['x', 1]]));
    const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); b.getMap('nodes').set('m', new Y.Map([['x', 2]]));
    const svA = Y.encodeStateVector(a);                 // 只含 a 的 clock
    const lateOnly = Y.diffUpdate(Y.encodeStateAsUpdate(b), svA); // 只含 b 后写部分
    expect(svDominates(Y.encodeStateVectorFromUpdate(lateOnly), svA)).toBe(false); // late clock ⊄ snap
  });
  it('阳性对照：row ⊆ snap → true；空 SV（DS-only）→ true', () => {
    const a = new Y.Doc(); a.getMap('nodes').set('k', new Y.Map([['x', 1]]));
    const u = Y.encodeStateAsUpdate(a);
    expect(svDominates(Y.encodeStateVectorFromUpdate(u), Y.encodeStateVector(a))).toBe(true);
    expect(svDominates(new Uint8Array([0, 0]), Y.encodeStateVector(a))).toBe(true); // 空 SV 天然被支配
  });
});

maybe('compact（真 PG）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);
  const PID = 'y0a1-compact-int';

  beforeAll(async () => { await ensureProjectFixture(prisma, PID); });
  afterAll(async () => { await cleanupProjectFixture(prisma, PID); await prisma.$disconnect(); });

  it('stateSeq 恒等于被删行最大 seq（精确赋值——禁 GREATEST；注释口径：精确 = 依赖 advisory lock 串行，去锁并发化必须先落 Y1c-1 CAS 形态）', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    expect(await repo.compact(PID)).toEqual({ compacted: false, reason: 'empty' });   // 返回契约：无行=empty（spec §1.3 v2.4）
    await repo.append(PID, Y.encodeStateAsUpdate(docWithNodes(5)));
    await repo.append(PID, Y.encodeStateAsUpdate(docWithNodes(3)));
    const rows = await prisma.canvasDocUpdate.findMany({ where: { projectId: PID }, select: { seq: true }, orderBy: { seq: 'asc' } });
    const t0 = Date.now();
    expect(await repo.compact(PID)).toEqual({ compacted: true });                      // 返回契约：成功
    const docRow = await prisma.canvasDoc.findUnique({ where: { projectId: PID } });
    expect(docRow!.stateSeq).toBe(rows[rows.length - 1].seq);        // 精确 =
    expect(docRow!.updatedAt.getTime()).toBeGreaterThanOrEqual(t0);  // updatedAt create 分支（@updatedAt 只在 Client 层生效——防未来改裸 SQL）
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(0);
    // update 分支（v3）：库已清空⇒首次 compact 走 upsert.create；再 append+compact 命中 update 分支
    await repo.append(PID, Y.encodeStateAsUpdate(docWithNodes(2)));
    const t1 = Date.now() - 5;                                       // 容忍时钟粒度
    await repo.compact(PID);
    const row2 = await prisma.canvasDoc.findUnique({ where: { projectId: PID } });
    expect(row2!.updatedAt.getTime()).toBeGreaterThanOrEqual(t1);    // update 分支 updatedAt 前进
  });

  it('compact 后新 Y.Doc 重放 state ≡ 原 doc 节点集', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    const src = docWithNodes(8);
    await repo.append(PID, Y.encodeStateAsUpdate(src));
    await repo.compact(PID);
    const row = await prisma.canvasDoc.findUnique({ where: { projectId: PID } });
    const revived = new Y.Doc();
    Y.applyUpdate(revived, new Uint8Array(row!.state));
    expect(revived.getMap('nodes').size).toBe(src.getMap('nodes').size);
  });
});
```

- [ ] **Step 4: 跑红**

```bash
DATABASE_URL=postgresql://flowweb:123456@localhost:5432/flowweb pnpm --filter @flowweb/api exec vitest run src/modules/collab/canvas-doc-update.repository.compact.int.spec.ts
```
Expected: FAIL——①stateSeq 断言（compact 未写 stateSeq，列恒 0≠maxSeq）②svDominates 未导出。留档输出。

- [ ] **Step 5: 实现 compact 强化（{compacted,reason} 返回契约+opts 独立预算，单 temp）**

替换 compact（:43-71）：

```typescript
  /** Y0a-1 compact（spec v2.4 §1.3）：按实读行 id 精确删除（被删集≡被重放集）；stateSeq 精确 =maxSeq
   *  （精确赋值依赖 advisory lock 串行——去锁并发化必须先落 Y1c-1 CAS 形态，禁 GREATEST/单调化包装）；
   *  返回契约 {compacted,reason}：empty=无行静默；abandoned=pendingStructs!=null 放弃本次——计数+ERROR
   *  落本分支单点（gateway 与装载自愈两路覆盖，防双计），**禁 throw**（gateway :297-301 catch 会把它计入
   *  yjsStoreCompactFailureTotal=污染 abandoned 的 P0 告警线）。
   *  （SV inline 哨兵已删——pendingStructs 检查通过前提下 per-row SV 支配性恒真，探针证伪见 spec §1.5。）
   *  opts：交互式事务独立预算（自愈路径 6s/1s·运维脚本 120s/5s；默认 5s/2s 与 Prisma 隐含值对齐）。 */
  async compact(
    projectId: string,
    opts?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<{ compacted: boolean; reason?: 'abandoned' | 'empty' }> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId})::bigint)`;
        const rows = await tx.canvasDocUpdate.findMany({
          where: { projectId },
          orderBy: { seq: 'asc' },
          select: { id: true, seq: true, update: true },
        });
        if (rows.length === 0) return { compacted: false, reason: 'empty' as const };
        const maxSeq = rows[rows.length - 1].seq;
        const docRow = await tx.canvasDoc.findUnique({ where: { projectId } });
        const temp = new Y.Doc();
        if (docRow) Y.applyUpdate(temp, new Uint8Array(docRow.state));
        for (const r of rows) Y.applyUpdate(temp, new Uint8Array(r.update));
        if (temp.store.pendingStructs !== null) {
          yjsCompactAbandonedTotal.inc();
          this.logger.error(`compact abandoned (pendingStructs non-null) for ${projectId}——保留全部行，下次 store 立即重试`);
          return { compacted: false, reason: 'abandoned' as const };   // 空事务提交：不写不删，行全保留
        }
        const newSnapshot = Y.encodeStateAsUpdate(temp);
        temp.destroy();
        await tx.canvasDoc.upsert({
          where: { projectId },
          update: { state: Buffer.from(newSnapshot), stateSeq: maxSeq },
          create: { projectId, state: Buffer.from(newSnapshot), stateSeq: maxSeq },
        });
        await tx.canvasDocUpdate.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
        return { compacted: true };
      },
      { isolationLevel: 'RepeatableRead', timeout: opts?.timeoutMs ?? 5_000, maxWait: opts?.maxWaitMs ?? 2_000 },
    );
  }
```

- [ ] **Step 5b: maybeCompact 消费返回值（仅成功开窗）+gateway spec stub 补丁（v4 冲击面）**

`collab.gateway.ts` maybeCompact（:306-311）改：

```typescript
  /** 批3-4：compact 时间门限（≥COMPACT_INTERVAL_MS 一档；基线 load 播种、compact 后重置）。
   *  Y0a-1（spec v2.4 §1.3）：仅 compacted===true 开新窗——abandoned 不开窗（窗口仍从上次成功起算，
   *  早已过期⇒下次 store 立即重试）；empty 同不开窗（无行时 attempt=一次 findMany(0)，代价可忽略）。 */
  private async maybeCompact(projectId: string): Promise<void> {
    const last = this.lastCompactAt.get(projectId);
    if (last !== undefined && Date.now() - last < COMPACT_INTERVAL_MS) return;
    const r = await this.repo.compact(projectId);
    if (r.compacted) this.lastCompactAt.set(projectId, Date.now());
  }
```

**gateway spec 冲击面（纪律 11）**：`collab.gateway.spec.ts` / `collab.gateway.persist-status.spec.ts` 的 compact inline stub（`compact: vi.fn()` 形态）统一补 `.mockResolvedValue({ compacted: true })`——存量窗口断言（:551-:570 等"窗口过期→compact 一次→窗口重置→二次 store 不再 compact"链）依赖 compact 后窗口被重置，stub 返回 undefined 时窗口恒不重置→`toHaveBeenCalledTimes(1)` 必红；`:598/:733` 的 `mockRejectedValueOnce(lock timeout)` 不变（throw 路径仍走 :297-301 catch）。此补丁在 Task 4 Step 6 换 mock-repo 工厂后消失（工厂默认即该形状）。

**形态裁定（v4 重裁，撤 v3"maybeCompact 零改动=60s 节流设计语义"）**：spec v2.4 E23/§1.3 定形"放弃不开窗"。v3 曾以"pendingStructs 持存期每次 store 全量重放=热路径灾难"主张保留 60s 节流；v2.4 推翻该裁定的理由：①pendingStructs!=null 是需人工介入的异常态（本批唯一 P0 告警线）——活跃编辑期每 debounce 窗（prod 2s）一次 ERROR+计数递增正是告警线要的最响信号，60s 节流把它稀释 30 倍；②未编辑的 doc 无 store 触发源、不存在空转放大；③放大成本=每 debounce 窗一次 findMany+重放，有界且只在"最需要被发现"的时刻发生。

文件头 import 补 `yjsCompactAbandonedTotal`，repository 加 `private readonly logger = new Logger(CanvasDocUpdateRepository.name)`（`@nestjs/common` import——直连形态，hydrateWithRecovery 复用）。

- [ ] **Step 6: 既有 repository.spec 六用例改写（冲击面清单——v3：新实现实测 3 红 3 绿，v2"兼容"结论作废）**

| 用例（行号） | 冲击 | 处置 |
|---|---|---|
| append 用 nextval（:33） | Task 2 Step 5 已改写 | 已处置 |
| compact 条件删除（:40） | deleteMany 断言 `{seq:{lte:5n}}` 红；`$transaction` 断言**精确等于** `{isolationLevel}`（:57-59）——新实现加 timeout/maxWait 后也红；`$queryRaw [{max:5n}]` mock 不再被消费 | rows 补 `id:'u1'`；删 max mock；deleteMany 断言改 `{ where: { id: { in: ['u1'] } } }`；$transaction 断言改 `expect.objectContaining({ isolationLevel: 'RepeatableRead' })`（opts 演进不炸锚） |
| 旧快照+增量重放（:62） | 仍绿，但 rows 无 id（deleteMany 得 `id IN (undefined)`） | rows 补 `id`（卫生） |
| 无增量行（:85） | 仍绿；`$queryRaw max:null` mock 成死代码 | 删 max:null mock |
| 恢复路径取证（:93） | 仍绿 | rows 补 `id`（卫生） |
| 跨两轮幂等（:113） | deleteMany 两次 nth 断言 `{seq:{lte}}` 红；两处 `$queryRaw.mockResolvedValueOnce` 消费错位 | 删两个 once-mock；两轮 findMany rows 补 id；deleteMany 断言改两轮各自 `{ id: { in: […] } }` |
| **新增** pendingStructs 放弃 | 旧实现无此分支 | 新 mock 用例：findMany 返回超前行（`Y.diffUpdate(encodeStateAsUpdate(a), svA)` 形态——A7b 同款构造）+canvasDoc null → 断言返回值 `{compacted:false,reason:'abandoned'}`+upsert/deleteMany **均未调用**+`yjsCompactAbandonedTotal` 计数+1（对旧实现红=放弃分支真红门，先红后绿） |

- [ ] **Step 7: 跑绿+回归+commit**

```bash
DATABASE_URL=postgresql://flowweb:123456@localhost:5432/flowweb pnpm --filter @flowweb/api exec vitest run src/modules/collab/canvas-doc-update.repository.compact.int.spec.ts src/modules/collab/canvas-doc-update.repository.spec.ts && pnpm --filter @flowweb/api exec vitest run src/modules/collab
```
（全量 collab 回归含 Step 5b 的 gateway 两 spec——stub 补丁后窗口断言链应全绿。）

```bash
git add apps/api/src/modules/collab/canvas-doc-update.repository.ts apps/api/src/modules/collab/store.metrics.ts apps/api/src/modules/collab/sv.util.ts apps/api/src/modules/collab/collab.gateway.ts apps/api/src/modules/collab/collab.gateway.spec.ts apps/api/src/modules/collab/collab.gateway.persist-status.spec.ts apps/api/src/modules/collab/canvas-doc-update.repository.spec.ts apps/api/src/modules/collab/canvas-doc-update.repository.compact.int.spec.ts && git commit -m "feat(collab): Y0a-1 compact 强化——{compacted,reason} 返回契约+maybeCompact 仅成功开窗+pendingStructs 放弃(P0 告警·repo 单点)+svDominates 委托单源+既有 spec 冲击面改写"
```

---

### Task 4: loadForHydration 单 RR 事务+超时自愈（分类触发）+gateway 切换+stash peek/consume+删 loadUpdates

**Files:**
- Modify: `apps/api/src/modules/collab/canvas-doc-update.repository.ts`（hydrateWithRecovery+删 loadUpdates）
- Modify: `apps/api/src/modules/collab/collab.gateway.ts:218-246`（数据源切换+stash peek/consume+新增 peekStash/consumeStash 两私有方法）
- Modify: `apps/api/src/modules/collab/collab.gateway.spec.ts`（peek/consume 用例追加+repo stub 切工厂）
- Create: `apps/api/src/test-utils/mock-repo.ts`
- Test: `apps/api/src/modules/collab/canvas-doc-hydration.int.spec.ts`

- [ ] **Step 1: 落 mock-repo 工厂（5 个既有 spec 的收敛点）**

```typescript
// apps/api/src/test-utils/mock-repo.ts
// Y0a-1：repo mock 工厂——gateway 侧 spec 的 repo stub 收敛到单点（接口变更改这里，不改 15 处）。
// hydrateWithRecovery 默认委托 loadForHydration（gateway 实际调用的就是它——缺此键则 5 个既有 spec 的
// gateway 一装载 doc 即 TypeError）：逐用例覆写 loadForHydration 即改装载行为（挂起不 reject 不进
// catch，红4 语义保持）；需模拟自愈语义时直接覆写 hydrateWithRecovery。
import { vi } from 'vitest';

export interface MockRepo {
  append: ReturnType<typeof vi.fn>;
  loadForHydration: ReturnType<typeof vi.fn>;
  hydrateWithRecovery: ReturnType<typeof vi.fn>;
  compact: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
}

export function createMockRepo(over: Partial<MockRepo> = {}): MockRepo {
  const repo = {
    append: vi.fn(async () => ({ ok: true as const, seq: 1n })),          // AppendResult（spec v2.4 §1.2——Y0a-2 BOI 按契约 15 消费）
    loadForHydration: vi.fn(async () => ({ state: null, updates: [], stateSeq: 0n })),
    compact: vi.fn(async () => ({ compacted: true as const })),            // 返回契约（spec v2.4 §1.3——maybeCompact 仅成功开窗依赖此形状）
    count: vi.fn(async () => 0),
    ...over,
  };
  (repo as MockRepo).hydrateWithRecovery =
    over.hydrateWithRecovery ?? ((projectId: string) => (repo as MockRepo).loadForHydration(projectId));
  return repo as MockRepo;
}
```

- [ ] **Step 2: 写失败测试（水位过滤+分页取尽+超时自愈）**

`canvas-doc-hydration.int.spec.ts`：

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { ensureProjectFixture, cleanupProjectFixture } from '../../test-utils/db-fixtures';
import * as Y from 'yjs';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'y0a1-hydration-int';

maybe('loadForHydration（真 PG）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);

  beforeAll(async () => { await ensureProjectFixture(prisma, PID); });
  afterAll(async () => { await cleanupProjectFixture(prisma, PID); await prisma.$disconnect(); });

  async function reset() {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
  }

  it('装载=快照+seq>stateSeq 增量，与全量重放逐位等价', async () => {
    await reset();
    const d1 = new Y.Doc(); d1.getMap('nodes').set('a', new Y.Map([['x', 1]]));
    await repo.append(PID, Y.encodeStateAsUpdate(d1));
    await repo.compact(PID);
    const d2 = new Y.Doc(); Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1));
    d2.getMap('nodes').set('b', new Y.Map([['x', 2]]));
    await repo.append(PID, Y.encodeStateAsUpdate(d2));
    const { state, updates, stateSeq } = await repo.loadForHydration(PID);
    expect(state).not.toBeNull();
    expect(updates.length).toBe(1);                    // 只拉 seq>stateSeq 的一行
    expect(stateSeq).toBeGreaterThan(0n);
    const revived = new Y.Doc();
    Y.applyUpdate(revived, new Uint8Array(state!));
    for (const u of updates) Y.applyUpdate(revived, new Uint8Array(u));
    expect(revived.getMap('nodes').has('a')).toBe(true);
    expect(revived.getMap('nodes').has('b')).toBe(true);
  });

  it('分页取尽：520 行增量全部装载（页 500）', async () => {
    await reset();
    const base = new Y.Doc(); base.getMap('nodes').set('base', new Y.Map([['x', 0]]));
    await repo.append(PID, Y.encodeStateAsUpdate(base));
    await repo.compact(PID);
    for (let i = 0; i < 520; i++) {
      const d = new Y.Doc(); Y.applyUpdate(d, Y.encodeStateAsUpdate(base));
      d.getMap('nodes').set(`k${i}`, new Y.Map([['x', i]]));
      await repo.append(PID, Y.encodeStateAsUpdate(d));
    }
    const { updates } = await repo.loadForHydration(PID);
    expect(updates.length).toBe(520);
    const snap = await prisma.canvasDoc.findUnique({ where: { projectId: PID } });
    const revived = new Y.Doc();
    Y.applyUpdate(revived, new Uint8Array(snap!.state));
    for (const u of updates) Y.applyUpdate(revived, new Uint8Array(u));
    expect(revived.getMap('nodes').size).toBe(521);
  });

  it('超时自愈（仅可重试类）：P2028 首败 → compact(6s/1s 自愈预算) → 重试装载(2s/500ms) 成功（vi.spyOn 白盒；自愈增量 ≤8s——spec v2.4 契约 13）', async () => {
    await reset();
    const d = new Y.Doc(); d.getMap('nodes').set('s', new Y.Map([['x', 1]]));
    await repo.append(PID, Y.encodeStateAsUpdate(d));
    await repo.compact(PID);   // 先真 compact 造快照行——重试装载（真实现）拿到非空 state
    const loadSpy = vi.spyOn(repo, 'loadForHydration')
      .mockRejectedValueOnce(Object.assign(new Error('Transaction query timeout'), { code: 'P2028' }));
    const compactSpy = vi.spyOn(repo, 'compact').mockResolvedValue({ compacted: true });
    try {
      const { state } = await repo.hydrateWithRecovery(PID);
      expect(state).not.toBeNull();
      expect(compactSpy).toHaveBeenCalledWith(PID, { timeoutMs: 6_000, maxWaitMs: 1_000 });
      expect(loadSpy).toHaveBeenCalledTimes(2);   // 首败+重试（重试带 {timeoutMs:2_000,maxWaitMs:500}）
      expect(loadSpy).toHaveBeenLastCalledWith(PID, { timeoutMs: 2_000, maxWaitMs: 500 });
    } finally {
      loadSpy.mockRestore();
      compactSpy.mockRestore();
    }
  });

  it('非可重试类（P1001 连接失败）直接上抛——不 compact 不重试（防故障放大，负例真红门）', async () => {
    await reset();
    const loadSpy = vi.spyOn(repo, 'loadForHydration')
      .mockRejectedValueOnce(Object.assign(new Error("Can't reach database server"), { code: 'P1001' }));
    const compactSpy = vi.spyOn(repo, 'compact').mockResolvedValue({ compacted: true });
    try {
      await expect(repo.hydrateWithRecovery(PID)).rejects.toMatchObject({ code: 'P1001' });
      expect(compactSpy).not.toHaveBeenCalled();
      expect(loadSpy).toHaveBeenCalledTimes(1);
    } finally {
      loadSpy.mockRestore();
      compactSpy.mockRestore();
    }
  });

  it('P2024（连接池饥饿）v2.4 移出自愈集——直接上抛不 compact 不重试（自愈动作自身需持池连接=饥饿期零成功率纯放大）', async () => {
    await reset();
    const loadSpy = vi.spyOn(repo, 'loadForHydration')
      .mockRejectedValueOnce(Object.assign(new Error('Timed out fetching a new connection from the connection pool'), { code: 'P2024' }));
    const compactSpy = vi.spyOn(repo, 'compact').mockResolvedValue({ compacted: true });
    try {
      await expect(repo.hydrateWithRecovery(PID)).rejects.toMatchObject({ code: 'P2024' });
      expect(compactSpy).not.toHaveBeenCalled();
      expect(loadSpy).toHaveBeenCalledTimes(1);
    } finally {
      loadSpy.mockRestore();
      compactSpy.mockRestore();
    }
  });
});
```

（vi.spyOn 建实例自有属性——`this.loadForHydration`/`this.compact` 在方法体内经实例访问均穿透（实例属性遮蔽原型）；正例先真 compact 造快照行使重试装载拿到非空 state。）

- [ ] **Step 3: 跑红**

```bash
DATABASE_URL=postgresql://flowweb:123456@localhost:5432/flowweb pnpm --filter @flowweb/api exec vitest run src/modules/collab/canvas-doc-hydration.int.spec.ts
```
Expected: FAIL（`loadForHydration is not a function`）。留档。

- [ ] **Step 4: 实现 loadForHydration+hydrateWithRecovery（最终形态，删 loadUpdates）**

```typescript
  private static readonly PAGE_ROWS = 500;

  /** Y0a-1 装载读唯一入口（spec §4.3-1）：单 RR 事务覆盖快照+全部分页增量（E42①(i)——MVCC 使
   *  compact 的 DELETE 对本快照不可见，撕裂结构性不存在）。apply 由调用方在事务外执行。
   *  本方法即 spec v2.4 契约 1 的 readConsistent 实现体——Y0a-3 落地 readSnapshotOnly 时提取
   *  "一个实现、两出口"，禁复制第二份（投影出口只去 apply/store/compact 包装）。
   *  预算规则：timeout 8s < 客户端 synced 死线 10s−2s；maxWait 2s（池排队由 connection_limit 承担）；
   *  opts 供自愈路径重试时收紧预算（契约 13 v2.4）。
   *  raw SQL 规则：bigint 参数一律显式 ::bigint。 */
  async loadForHydration(
    projectId: string,
    opts?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<{ state: Buffer | null; updates: Buffer[]; stateSeq: bigint }> {
    return this.prisma.$transaction(
      async (tx) => {
        const docRow = await tx.canvasDoc.findUnique({ where: { projectId }, select: { state: true, stateSeq: true } });
        const updates: Buffer[] = [];
        let cursor = docRow?.stateSeq ?? 0n;
        for (;;) {
          const page = await tx.$queryRaw<{ seq: bigint; update: Buffer }[]>`
            SELECT seq, update FROM "CanvasDocUpdate"
            WHERE "projectId" = ${projectId} AND seq > ${cursor}::bigint
            ORDER BY seq ASC LIMIT ${CanvasDocUpdateRepository.PAGE_ROWS}`;
          if (page.length === 0) break;
          for (const r of page) {
            if (r.update.length > 4 * 1024 * 1024) {
              // 单行巨帧：观测不拒绝（源头治理归 Y0b 配额批——已入库数据不该在装载侧 DoS 自己）
              this.logger.warn(`huge hydration row ${projectId} seq=${r.seq} bytes=${r.update.length}`);
            }
            updates.push(r.update);
          }
          cursor = page[page.length - 1].seq;
          if (page.length < CanvasDocUpdateRepository.PAGE_ROWS) break;
        }
        return { state: docRow?.state ?? null, updates, stateSeq: docRow?.stateSeq ?? 0n };
      },
      { isolationLevel: 'RepeatableRead', timeout: opts?.timeoutMs ?? 8_000, maxWait: opts?.maxWaitMs ?? 2_000 },
    );
  }

  /** Y0a-1 超时自愈一次（契约 §4.3-13·v2.4：**仅可重试类触发，P2024 排除**）：装载事务失败且属
   *  P2028/P1008 或 timeout 语义 → 串行跑 compact{6s/1s}（装载事务已回滚，无并发装载——与 E42⑤
   *  "装载进行中 compact"警示不同态，注释写明时序）→ 以收紧预算 {2s/500ms} 重试装载一次——
   *  **自愈增量总 ≤8s**（v2.4 从 60s 下调：60s 挂在客户端已放弃的请求上下文=零收益纯挂 Nest handler
   *  与池连接，违 §7.2 预算规则；例外路径声明见 §7.2）。
   *  P2024（连接池取连接超时——池饥饿非事务超时）**不在自愈集**：compact 是交互式事务自身需持池
   *  连接，饥饿期执行=零成功率纯放大——直接上抛 fail-closed；P1000/P1001/P1010/P1017 同不放大。
   *  compact 自身失败→WARN+`yjsStoreCompactFailureTotal` 计数后**仍重试装载**（契约 13：不构成新
   *  fail-closed 死锁）；仍失败才向上抛（外层折 db-unavailable）。禁前置全量聚合探测（v2.2 证伪）。 */
  private static readonly RETRYABLE_HYDRATION_CODES = new Set(['P2028', 'P1008']);   // v2.4：P2024 移出（池饥饿）
  private isRetryableHydrationError(e: unknown): boolean {
    const code = (e as { code?: string })?.code;
    if (code != null && CanvasDocUpdateRepository.RETRYABLE_HYDRATION_CODES.has(code)) return true;
    return e instanceof Error && /timeout/i.test(e.message);
  }

  async hydrateWithRecovery(projectId: string): Promise<{ state: Buffer | null; updates: Buffer[]; stateSeq: bigint }> {
    try {
      return await this.loadForHydration(projectId);
    } catch (first) {
      if (!this.isRetryableHydrationError(first)) throw first;
      try {
        await this.compact(projectId, { timeoutMs: 6_000, maxWaitMs: 1_000 });
      } catch (compactErr) {
        yjsStoreCompactFailureTotal.inc();
        this.logger.warn(`hydrate recovery compact failed for ${projectId}: ${(compactErr as Error).message}`);
      }
      return this.loadForHydration(projectId, { timeoutMs: 2_000, maxWaitMs: 500 });   // 重试一次；仍失败向上抛
    }
  }
```

**同时**：①删除 `loadUpdates` 方法（契约"唯一入口靠删除保证"——本文件 Task 2 用例已改为 count/seq 断言，无 loadUpdates 消费）②logger 直连形态已在 Task 3 落地（`new Logger(CanvasDocUpdateRepository.name)`）——本步 loadForHydration 巨帧 WARN 与 hydrateWithRecovery 均用 `this.logger.warn(...)` 直调，无 `?.` 链③文件头 import 补 `yjsStoreCompactFailureTotal`（hydrate 自愈 compact 失败计数——store.metrics.ts 同文件族，spec §1.4 v2.4"WARN+计数"）。

- [ ] **Step 5: gateway 切换+stash peek/consume（关闭第四条蒸发路径——v3 撤"搬移"方案）**

`collab.gateway.ts` loadDocument：数据源两步读（:218-223）替换；stash 改 **peek→apply→…→consume**（原 takeStash 在此先删——syncFromPeers/版本门抛错时库卸载 doc，stash 已删又随 doc 消失=净丢；单纯"搬到门后"也不对——门看到的是没有 stash 的旧状态，若 stash 带正确 schema 戳合法档会被误拒。peek 推迟删除是唯一两全形态）：

```typescript
      // Y0a-1：装载读唯一入口（契约 §4.3-1）+超时自愈（契约 §4.3-13·仅可重试类）
      const { state, updates } = await this.repo.hydrateWithRecovery(projectId);
      if (state) {
        yjsCanvasDocBytes.set({ projectId }, state.length);   // 快照字节播种（现状语义保留）
        applyReplayed(new Uint8Array(state));
      }
      for (const u of updates) applyReplayed(new Uint8Array(u));
      // Y0a-1（v3）：stash=peek→apply→…→consume（consume 在门+stamp 全过后的 try 块末尾）。
      // apply 位次与现状逐位一致（:224 原位）——门的输入语义不变；删除是唯一破坏性动作，恒在最后。
      const stash = this.peekStash(projectId);
      if (stash) Y.applyUpdate(document, stash);  // 窗口外回灌：事件进 pending
      await this.redisSync.syncFromPeers(documentName, document, 1000);
      const nodeCount = [...document.getMap('nodes').keys()].length;
      try {
        ensureSchemaVersion(toDocLike(document));
      } catch (e) {
        this.logger.error(`[O0b-0] 版本门拒绝载入 ${documentName}：${(e as Error).message}（${nodeCount} 节点）`);
        throw Object.assign(e as Error, { schemaRefusal: true });
      }
      if (document.getMap('meta').get('schemaVersion') !== CANVAS_DOC_SCHEMA_VERSION) {
        stampDocSchema(toDocLike(document));
      }
      this.consumeStash(projectId);   // 门+stamp 全过才删（其后无抛错点）
```

配套两个新私有方法（**takeStash/putStash 本批不动**——store 提前 drain(:273)/retry stash 级(:380) 两处 takeStash 与失败路径 putStash 归 Y0a-2 统一 peek 化）：

```typescript
  /** Y0a-1：load 路径只读探测（不删——syncFromPeers/版本门抛错时 stash 必须存活于 unflushed） */
  private peekStash(projectId: string): Uint8Array | undefined {
    return this.unflushed.get(projectId);
  }

  /** Y0a-1：load 路径消费（门+stamp 通过后调用——删除恒在最后） */
  private consumeStash(projectId: string): void {
    if (this.unflushed.delete(projectId)) yjsUnflushedProjects.set(this.unflushed.size);
  }
```

**本步新增用例（第四条蒸发路径关闭的真锚——collab.gateway.spec.ts 追加）**：

```typescript
  it('Y0a-1 peek/consume：版本门拒绝 ⇒ stash 存活；正常档 ⇒ 消费后清空', async () => {
    const { onLoadDocument } = extractHooks();
    // 拒绝档：meta.schemaVersion=999（ensureSchemaVersion 判据=戳存在且≠当前版本）
    const bad = new Y.Doc();
    bad.getMap('meta').set('schemaVersion', 999);
    bad.getMap('nodes').set('n', new Y.Map());
    repo.hydrateWithRecovery.mockResolvedValueOnce({ state: Buffer.from(Y.encodeStateAsUpdate(bad)), updates: [], stateSeq: 0n });
    (gateway as any).putStash('p-peek', Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())));
    await expect(onLoadDocument({ document: new Y.Doc(), documentName: 'project:p-peek' }))
      .rejects.toMatchObject({ schemaRefusal: true });
    expect((gateway as any).unflushed.has('p-peek')).toBe(true);      // 未消费——蒸发路径已关
    // 正常档：无戳空 doc（stamp 自愈路径）⇒ stash 被消费
    repo.hydrateWithRecovery.mockResolvedValueOnce({ state: null, updates: [], stateSeq: 0n });
    await onLoadDocument({ document: new Y.Doc(), documentName: 'project:p-peek' });
    expect((gateway as any).unflushed.has('p-peek')).toBe(false);
  });
```

- [ ] **Step 6: 既有 spec 切 mock-repo+跑绿+commit**

把 5 个 gateway spec 文件的 repo stub（collab.gateway.spec.ts:71-77 等 15+ 处）改为 `createMockRepo(...)`（各自覆盖项不变：durableRows 台账 append/loadForHydration 喂行/红4 stalling 改 `loadForHydration: vi.fn(() => new Promise(() => {}))`——**保持用例名与断言不变，只换注入形态**；`loadUpdates` 的 mock 全删。hydrateWithRecovery 由工厂默认委托——挂起的 loadForHydration 使委托调用同样挂起，红4 语义等价：挂起不 reject、不进 catch）。

```bash
pnpm --filter @flowweb/api exec vitest run src/modules/collab && DATABASE_URL=postgresql://flowweb:123456@localhost:5432/flowweb pnpm --filter @flowweb/api exec vitest run src/modules/collab
```
Expected: mock 与 int 双绿（红4 的"装载窗口挂起"语义等价迁移后仍守护）。

```bash
git add apps/api/src/modules/collab apps/api/src/test-utils/mock-repo.ts && git commit -m "feat(collab): Y0a-1 loadForHydration 单RR事务+超时自愈+takeStash 后移关第四条蒸发路径+删 loadUpdates+mock-repo 工厂"
```

---

### Task 5: 真 PG 隔离性质用例+可达性固化（spec §1.6）

**Files:**
- Test: `apps/api/src/modules/collab/canvas-doc-hydration.int.spec.ts`（追加 describe）

- [ ] **Step 1: 追加隔离性质用例（gate 用 try/finally+race 兜底）**

```typescript
maybe('装载×compact 隔离性质（结构锚——对破坏后代码红，如实声明）', () => {
  it('RR 事务装载中途并发 compact 提交：事务内行集不变（MVCC 快照一致性——v3 确定序：compact 提交后才放行行读）', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    const base = new Y.Doc(); base.getMap('nodes').set('s', new Y.Map([['x', 0]]));
    await repo.append(PID, Y.encodeStateAsUpdate(base));
    await repo.compact(PID);
    for (let i = 0; i < 3; i++) {
      const d = new Y.Doc(); Y.applyUpdate(d, Y.encodeStateAsUpdate(base));
      d.getMap('nodes').set(`c${i}`, new Y.Map([['x', i]]));
      await repo.append(PID, Y.encodeStateAsUpdate(d));
    }
    let started = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));   // 无时间兜底——挂死由 vitest 超时兜底=真红
    const loading = prisma.$transaction(
      async (tx) => {
        const snap = await tx.canvasDoc.findUnique({ where: { projectId: PID } });
        started = true;                                      // 首语句即建 RR 快照
        await gate;
        const rows = await tx.$queryRaw<Buffer[]>`
          SELECT update FROM "CanvasDocUpdate" WHERE "projectId" = ${PID} ORDER BY seq ASC`;
        return { snap, rows };
      },
      { isolationLevel: 'RepeatableRead', timeout: 8_000, maxWait: 2_000 },
    );
    const t0 = Date.now();
    while (!started && Date.now() - t0 < 2_000) await new Promise((r) => setTimeout(r, 20));
    if (!started) throw new Error('loading transaction did not take snapshot');
    await repo.compact(PID);   // 先提交（装载事务只持快照不持锁——advisory lock 无竞争，不被阻塞）
    release();                 // 提交后放行：rows 读确定发生在 compact 提交之后
    const { snap, rows } = await loading;
    expect(snap).not.toBeNull();
    expect(rows.length).toBe(3);   // 已提交 DELETE 对 RR 快照不可见——装载不缺行
    // 反证注释（结构锚红相演示，勿写成会跑的断言）：若装载拆成两条独立语句且 compact 先提交，
    // 此处 rows=0 → 装载撕裂（对破坏后实现红）
  });

  it('装载进行中直调 compact：装载结果完整（可达性固化——锚 A4 回归防线，防未来 fire-and-forget）', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    const d = new Y.Doc(); d.getMap('nodes').set('z', new Y.Map([['x', 0]]));
    await repo.append(PID, Y.encodeStateAsUpdate(d));
    const [loaded] = await Promise.all([
      repo.loadForHydration(PID),
      (async () => { await new Promise((r) => setTimeout(r, 10)); await repo.compact(PID); })(),
    ]);
    const revived = new Y.Doc();
    if (loaded.state) Y.applyUpdate(revived, new Uint8Array(loaded.state));
    for (const u of loaded.updates) Y.applyUpdate(revived, new Uint8Array(u));
    expect(revived.getMap('nodes').has('z')).toBe(true);
  });
});
```

（`prisma/repo/PID` 已在文件顶部作用域——Task 4 Step 2 的 describe 变量提升共用；afterAll 清理仅一处。）

- [ ] **Step 2: 跑绿+commit**

```bash
DATABASE_URL=postgresql://flowweb:123456@localhost:5432/flowweb pnpm --filter @flowweb/api exec vitest run src/modules/collab/canvas-doc-hydration.int.spec.ts
git add apps/api/src/modules/collab/canvas-doc-hydration.int.spec.ts && git commit -m "test(collab): Y0a-1 真PG隔离性质+可达性固化（gate try/finally 兜底）"
```

---

### Task 6: 双 client 装置提取+库行为锚（实际集合=A1/A5/A6/A7/A8/A9）

**Files:**
- Create: `apps/api/src/test-utils/dual-client-server.ts`
- Create: `apps/api/src/test-utils/poll-until.ts`
- Test: `apps/api/src/modules/collab/collab.library-anchors.spec.ts`

- [ ] **Step 1: 落 poll-until + 提取装置（自 collab.gateway.spec.ts:43-107 移植，无占位）**

```typescript
// apps/api/src/test-utils/poll-until.ts
export async function pollUntil(cond: () => boolean | Promise<boolean>, deadlineMs = 5_000, intervalMs = 50): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`pollUntil timeout after ${deadlineMs}ms`);
}
```

```typescript
// apps/api/src/test-utils/dual-client-server.ts
// Y0a-1：双 client+单进程单 Server 装置——构造形态自 collab.gateway.spec.ts beforeEach 移植
// （位置参数构造+随机端口段 20000+random(20000)=既有惯例 spec:81——port=0 时库不回写 configuration.port，
// 必用随机段；provider 带 token query）。Y2/Y1a 复用地基。
import { vi } from 'vitest';
import * as Y from 'yjs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { CollabGateway } from '../modules/collab/collab.gateway';
import { CollabDocumentService } from '../modules/collab/collab-document.service';
import { createMockRepo, MockRepo } from './mock-repo';

export interface DualClientKit {
  gateway: CollabGateway;
  docService: CollabDocumentService;
  repo: MockRepo;
  url: string;
  connect(name: string, token?: string): { ydoc: Y.Doc; provider: HocuspocusProvider; synced: Promise<void> };
  dispose: () => Promise<void>;
}

export async function startDualClientServer(over: Partial<MockRepo> = {}, debounce = 300): Promise<DualClientKit> {
  const prisma: any = {
    session: { findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: 't' }, expiresAt: new Date(Date.now() + 86400000) }) },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
    canvasDoc: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
  };
  const repo = createMockRepo(over);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const gateway = new CollabGateway(prisma, new EventEmitter2() as any, repo as any, { syncFromPeers: async () => {} } as any, { resolve: async () => 'PROJECT_EDITOR' } as any, port, debounce);
  await gateway.onModuleInit();   // Step 1b 后为 async+await listen——无端口竞态
  const url = `ws://127.0.0.1:${port}`;
  const providers: HocuspocusProvider[] = [];
  return {
    gateway,
    docService: new CollabDocumentService(gateway),
    repo,
    url,
    connect(name: string, token = 'tok') {
      const ydoc = new Y.Doc();
      const provider = new HocuspocusProvider({ url: `${url}?token=${token}`, name, document: ydoc });
      providers.push(provider);
      const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()));
      return { ydoc, provider, synced };
    },
    async dispose() {
      for (const p of providers.splice(0)) await p.destroy();
      await (gateway as any).server.destroy();
    },
  };
}
```

（移植完成后 collab.gateway.spec.ts 的 beforeEach 改 import 本 helper，跑一遍保证既有用例不红。）

- [ ] **Step 1b: gateway `onModuleInit` 改 async+await listen（P1-1 端口竞态——生产小改）**

`collab.gateway.ts:434-437` 现状同步签名、`this.server.listen()` 的 Promise 被丢弃——端口可能未绑定即有消费方连接（既有 integration 用例靠 listen 快侥幸通过）。改：

```typescript
  async onModuleInit(): Promise<void> {
    // 跨实例同步：仅回复本实例已打开的文档（Document extends Y.Doc，内存态最新）
    this.redisSync.getDocument = (name) => this.server.hocuspocus.documents.get(name);
    await this.server.listen();
    this.startSessionSweep();
    // I3/M2：解散事件到达时 projects 可能已删——按 payload.projectIds 关连接，不查库
    this.eventEmitter.on('team.disbanded', (payload: { teamId: string; projectIds: string[] }) => {
      this.closeTeamDocuments(payload.projectIds);
    });
  }
```

（NestJS 生命周期与既有 spec 的 `await gateway.onModuleInit()` 调用点均兼容 async 形态。）

- [ ] **Step 2: 写库锚断言（独立最小 Server 承载 A1/A5/A6；确定性构造 A7；单元 A8；装置 A9）**

```typescript
// collab.library-anchors.spec.ts
// 库行为锚（实际集合 A1/A5/A6/A7/A8/A9）——测库不测我们的包装（v2.2 修订：gateway.hooks 事后覆盖
// 对库无效——Server 构造时捕获闭包引用；库锚一律独立最小 Server 直挂钩子）。
import { describe, it, expect } from 'vitest';
import { Server } from '@hocuspocus/server';
import { shouldSkipStoreHooks } from '@hocuspocus/server';
import * as Y from 'yjs';
import { pollUntil } from '../../test-utils/poll-until';
import { startDualClientServer } from '../../test-utils/dual-client-server';

describe('A7 pendingStructs 边界（确定性构造，纯 yjs）', () => {
  it('A7b 超前行（diffUpdate 子集）→ pendingStructs 非 null', () => {
    const a = new Y.Doc(); a.getMap('nodes').set('k', new Y.Map([['x', 1]]));
    const svA = Y.encodeStateVector(a);
    a.getMap('nodes').set('m', new Y.Map([['x', 2]]));              // 同 doc 后写（clock 超前 svA）
    const laterOnly = Y.diffUpdate(Y.encodeStateAsUpdate(a), svA);  // 只含后写 struct（实测 27B 级）
    const c = new Y.Doc();                                          // 空 doc：无前置 struct
    Y.applyUpdate(c, laterOnly);
    expect(c.store.pendingStructs).not.toBeNull();                  // 产生 pending
  });
  it('A7a 整行缺失（只 apply 半组行）→ pendingStructs 为 null 且内容缺失（读侧守卫推迟 Y1c-1 的实证依据）', () => {
    const d1 = new Y.Doc(); d1.getMap('nodes').set('n1', new Y.Map([['x', 1]]));
    const d2 = new Y.Doc(); d2.getMap('nodes').set('n2', new Y.Map([['x', 2]]));
    const c = new Y.Doc();
    Y.applyUpdate(c, Y.encodeStateAsUpdate(d2));                    // 只给后半（d1 整行缺失）
    expect(c.store.pendingStructs).toBeNull();                      // 整行缺失不可探测
    expect(c.getMap('nodes').has('n1')).toBe(false);                // 但内容确实缺——守卫盲区实证
  });
});

describe('A8 store 跳过判据（公开导出，禁手写等价物）', () => {
  it('withDoc 路径（source=local 无 skipStoreHooks）必触发 store；connection 源不跳过', () => {
    expect(shouldSkipStoreHooks({ source: 'local' } as any)).toBe(false);
    expect(shouldSkipStoreHooks({ source: 'connection' } as any)).toBe(false);
  });
});

describe('A1/A5/A6（独立最小 Server——库直挂钩子）', () => {
  it('A1+A5：store 钩子抛错→doc 留内存且库不再自动重试（debounce 不重武装）', async () => {
    let calls = 0;
    const server = new Server({
      port: 0, quiet: true, stopOnSignals: false, debounce: 100, maxDebounce: 150,
      onStoreDocument: async () => { calls++; throw new Error('boom'); },
    });
    await server.listen();
    try {
      const name = 'p-anchor-a1';
      const conn = await server.openDirectConnection(name);
      await conn.transact((doc) => { doc.getMap('nodes').set('n', new Y.Map([['x', 1]])); });
      await conn.disconnect();                          // 触发 store→失败（:1147/:1171 失败也卸载——A6 面）
      await pollUntil(() => calls >= 1, 3_000);
      const settled = calls;
      await new Promise((r) => setTimeout(r, 1_000));    // >5×debounce：失败不重武装则 calls 不增
      expect(calls).toBe(settled);                       // A5：库不自动重试——gateway 自管退避是唯一重试源
    } finally {
      await server.destroy();
    }
  });

  it('A6：DirectConnection 断开后（store 失败被吞）doc 仍被卸载——失败也卸载语义（spool 承重性）', async () => {
    const server = new Server({
      port: 0, quiet: true, stopOnSignals: false, debounce: 100, maxDebounce: 150,
      onStoreDocument: async () => { throw new Error('boom'); },
    });
    await server.listen();
    try {
      const name = 'p-anchor-a6';
      const conn = await server.openDirectConnection(name);
      await conn.transact((doc) => { doc.getMap('nodes').set('n', new Y.Map([['x', 1]])); });
      await conn.disconnect();
      await pollUntil(
        () => !server.hocuspocus.documents.has(name), 5_000,
      );                                                // A6：卸载发生（与 A1 的 WS 路径"不卸载"相反——两路径分立断言）
      expect(server.hocuspocus.documents.has(name)).toBe(false);
    } finally {
      await server.destroy();
    }
  });
});

describe('A9 最后连接关闭→脏 doc 销毁（WS 路径·失败态——spool 承重性锚：store 失败后断连仍卸载）', () => {
  it('append 持续失败下 provider 断开：服务端已收写入 → debounce store 失败 → doc 仍从 documents 消失', async () => {
    const kit = await startDualClientServer({ append: vi.fn(async () => { throw new Error('boom'); }) }, 200);
    try {
      const name = 'project:p-anchor-a9';
      const { provider, synced } = kit.connect(name);
      await synced;
      provider.document.getMap('nodes').set('n', new Y.Map([['x', 1]]));
      await pollUntil(() => kit.gateway.server.hocuspocus.documents.get(name)?.getMap('nodes').has('n') === true, 5_000);  // 写已达服务端（destroy 前确认——防"update 未达即断开"的通过无意义竞态）
      await provider.destroy();
      await pollUntil(() => !kit.gateway.server.hocuspocus.documents.has(name), 8_000);   // A2 四条件不含"store 成功"
      expect(kit.gateway.server.hocuspocus.documents.has(name)).toBe(false);
    } finally {
      await kit.dispose();
    }
  });
});
```

（**探针前置（纪律第 10 条）**：A1/A5/A6/A9 断言集落库前，先以本文件为探针跑一次——若 A1 用例中 `calls` 恒 0 或 A6 中 doc 永不消失，即库行为与锚假设不符，**停下来核对 dist 行号再改锚**，禁为绿调断言。）

- [ ] **Step 3: 跑绿+既有 spec 换 helper 回归+commit**

```bash
pnpm --filter @flowweb/api exec vitest run src/modules/collab/collab.library-anchors.spec.ts src/modules/collab/collab.gateway.spec.ts
git add apps/api/src/test-utils/dual-client-server.ts apps/api/src/test-utils/poll-until.ts apps/api/src/modules/collab/collab.gateway.ts apps/api/src/modules/collab/collab.library-anchors.spec.ts apps/api/src/modules/collab/collab.gateway.spec.ts && git commit -m "test(collab): Y0a-1 装置提取+库锚（独立Server承载A1/A5/A6，确定性A7，A9 失败态锚）+onModuleInit async 化——探针先行"
```

---

### Task 7: failingRepo 助手+构建排除+dist 断言（Proxy 形态已砍——v2.2）

**Files:**
- Create: `apps/api/src/test-utils/failing-repo.ts`
- Modify: `apps/api/tsconfig.json`
- Create: `scripts/check-no-testutils-in-dist.mjs`

- [ ] **Step 1: failingRepo（repo 边界 stub——循既有 stub 惯例）**

```typescript
// apps/api/src/test-utils/failing-repo.ts
// Y0a-1：repo 边界故障注入助手（单测/int 层）——v2.2 砍 Proxy 形态（无消费者且与 dist 排除矛盾）。
// Y0a-2 演练层（子进程注入）改用 DB 触发器/REVOKE（spec Y0a-2 移入项登记）。
import { createMockRepo, MockRepo } from './mock-repo';

export function failingRepo(opts: { failAppend?: number; failCompact?: number } = {}): MockRepo {
  const repo = createMockRepo();
  let appends = 0, compacts = 0;
  if (opts.failAppend != null) {
    repo.append.mockImplementation(async () => {
      appends += 1;
      if (appends <= opts.failAppend!) throw new Error(`injected append failure #${appends}`);
    });
  }
  if (opts.failCompact != null) {
    repo.compact.mockImplementation(async () => {
      compacts += 1;
      if (compacts <= opts.failCompact!) throw new Error(`injected compact failure #${compacts}`);
    });
  }
  return repo;
}
```

- [ ] **Step 2: tsconfig 排除+dist 断言（SKIP guard）+verify 链接线（spec §4.5 v2.4——构建产物检查归 verify 职责，不入 collab-core）**

`apps/api/tsconfig.json` exclude 数组追加 `"**/test-utils/**"`。

`scripts/check-no-testutils-in-dist.mjs`：

```javascript
// Y0a-1：dist 内禁 test-utils（廉价保险——故障注入已不入 src 生产面；防未来误放）
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps/api', 'dist');
if (!existsSync(dist)) { console.log('SKIP: dist not built'); process.exit(0); }
const bad: string[] = [];
(function walk(d: string) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(d, e.name));
    else if (e.name.includes('test-utils') || e.name.includes('failing-repo') || e.name.includes('dual-client')) bad.push(join(d, e.name));
  }
})(dist);
if (bad.length) { console.error('FAIL: test-utils leaked into dist:\n' + bad.join('\n')); process.exit(1); }
console.log('OK: no test-utils in dist');
```

**verify 链接线（根 package.json）**：`verify` 脚本在 `pnpm --filter @flowweb/api exec tsc -p tsconfig.scripts.json --noEmit &&` 之后插入两段：

```
pnpm --filter @flowweb/api exec nest build && node scripts/check-no-testutils-in-dist.mjs &&
```

（构建一次 api 使断言在 verify 内非 SKIP——代价=每次 verify 多一次 nest build（~20-40s），spec §4.5 v2.4 明确"构建产物检查属 verify 职责"故接受；test job 因此天然覆盖。）

- [ ] **Step 3: 三态验证（正/反/SKIP——D13 红证据）+commit**

```bash
cd apps/api && npx nest build && node ../../scripts/check-no-testutils-in-dist.mjs
# Expected: OK。反向红证据：临时移除 tsconfig 的 "**/test-utils/**" 再 build → 脚本 exit 1 → 留档输出 → 还原。
node ../../scripts/check-no-testutils-in-dist.mjs   # rm -rf dist 后再跑 → SKIP: dist not built
pnpm verify   # 尾部含 nest build+断言——全绿（verify 链接线生效证明）
git add apps/api/tsconfig.json apps/api/src/test-utils/failing-repo.ts scripts/check-no-testutils-in-dist.mjs package.json && git commit -m "feat(test-infra): Y0a-1 failingRepo 助手+构建排除+dist 泄漏断言接入 verify 链（SKIP guard，红证据留档）"
```

---

### Task 8: 对抗语料（docShape 值守卫+全量 FakeMap 嵌套+真 Y.Doc 双路径）

**Files:**
- Modify: `packages/shared/src/canvas/docShape.ts:122-148`（节点/边值守卫——实证真缺陷修复）
- Modify: `packages/shared/src/canvas/docShape.fillRead.test.ts`（守卫用例）
- Create: `packages/shared/src/testing/adversarial-doc.ts`
- Modify: `packages/shared/src/index.ts`（追加一行导出）
- Test: `apps/api/src/modules/collab/adversarial-readers.spec.ts`

- [ ] **Step 0: 探针（纪律 10）——值守卫缺失现状实证**

docShape.ts:124-125 节点值 `v as DocMapLike → m.get('position')` **无守卫**（:140 data 值有 isDocMap 守卫；:143-145 边值同样裸 `.get`）——Y.Map 值可为任意 JSON，纯对象节点值 ⇒ `m.get is not a function` TypeError。这是 E68 读侧铁律的真违例（v2 语料 plain-object 值全部撞此处=语料"空转"根因）。守卫落地前先用一例 FakeMap 塞 `data.content` 节点跑 `readRecordsFromMaps` 确认现状抛错留档，改后同语料产出记录。

- [ ] **Step 1: docShape 节点/边值守卫（真缺陷修复——读侧全函数）**

`readRecordsFromMaps` 的 nodes/edges 值先经 `isDocMap` 判定（本文件 :79 既有内部谓词——同文件复用非新造），非 map 值跳过：

```typescript
export function readRecordsFromMaps(doc: DocLike): { nodes: DocNodeRecord[]; edges: DocEdgeRecord[] } {
  const nodes = [...doc.getMap('nodes').entries()].flatMap(([id, v]) => {
    if (!isDocMap(v)) return [];   // E68 读侧全函数：doc 值可为任意 JSON——非 map 值跳过不抛
    const m = v;
    const posV = m.get('position');
    // ……以下与原体逐行一致（position/parentId/width/height/data/type 键读取不变）
    return [{ /* …原字段… */ }];
  });
  const edges = [...doc.getMap('edges').entries()].flatMap(([id, v]) => {
    if (!isDocMap(v)) return [];
    const m = v;
    return [{ id, source: m.get('source') as string | undefined, target: m.get('target') as string | undefined }];
  });
  return { nodes, edges };
}
```

`docShape.fillRead.test.ts` 补两用例：非 map 节点值跳过（nodes 空不抛）/非 map 边值跳过。

```bash
pnpm --filter @flowweb/shared build && pnpm --filter @flowweb/shared test -- --run
```

- [ ] **Step 2: 生成器（全量 FakeMap 嵌套——语料必须真的到达读者深分支）**

```typescript
// packages/shared/src/testing/adversarial-doc.ts
// Y0a-1（E70 最小版）：对抗 DocLike 工厂。节点/data 值一律 FakeMap 嵌套（plain object 会被
// Step 1 值守卫跳过=空转）；scalar-node 一例专测守卫行为。零 yjs 依赖（shared 保持无 yjs）。
import type { DocLike, DocMapLike } from '../canvas/docShape';

class FakeMap implements DocMapLike {
  constructor(private readonly backing = new Map<string, unknown>()) {}
  get(k: string) { return this.backing.get(k); }
  set(k: string, v: unknown) { this.backing.set(k, v); return this; }
  has(k: string) { return this.backing.has(k); }
  delete(k: string) { return this.backing.delete(k); }
  entries(): Iterable<[string, unknown]> { return this.backing.entries(); }
}

/** 递归嵌套：对象值→FakeMap；原始值原样（content/width 等叶子保持 string/number） */
const fm = (o: Record<string, unknown>): FakeMap => new FakeMap(new Map(
  Object.entries(o).map(([k, v]) =>
    [k, v !== null && typeof v === 'object' && !Array.isArray(v) ? fm(v as Record<string, unknown>) : v]),
));

export interface AdversarialCase { name: string; build(): DocLike }

export function generateAdversarialDocs(seed = 42): AdversarialCase[] {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const LONG = 'x'.repeat(1024 * 1024);
  const deep = (n: number): unknown => (n <= 0 ? { leaf: true } : { child: deep(n - 1) });
  const mk = (nodes: Record<string, unknown>, meta: Record<string, unknown> = {}) => (): DocLike => {
    const maps: Record<string, FakeMap> = { nodes: fm(nodes), edges: new FakeMap(), meta: fm(meta) };
    return { getMap: (n: string) => maps[n] ?? new FakeMap(), createMap: () => new FakeMap() };
  };
  return [
    { name: 'long-content', build: mk({ n1: { data: { content: LONG } } }) },
    { name: 'deep-128', build: mk({ n1: { data: deep(128) } }) },
    { name: 'parent-cycle', build: mk({ a: { parentId: 'b' }, b: { parentId: 'a' } }) },
    { name: 'unknown-fields', build: mk({ n1: { totally: 'unknown', data: { extra: 1 } } }) },
    { name: 'empty-maps', build: mk({ n1: { data: {} } }) },
    { name: 'type-confusion', build: mk({ n1: { x: 'str', data: { width: 'wide' } } }, { schemaVersion: 'not-a-number' }) },
    { name: 'scalar-node', build: () => {   // 值守卫专测：非 map 节点值 → 跳过
      const nodes = new FakeMap(new Map([['raw', 'just-a-string']]));
      return { getMap: (n: string) => (n === 'nodes' ? nodes : new FakeMap()), createMap: () => new FakeMap() };
    } },
    ...Array.from({ length: 8 }, (_, i): AdversarialCase => ({
      name: `fuzz-${i}`,
      build: mk({ [`f${i}`]: { x: rnd() > 0.5 ? LONG.slice(0, 1000) : rnd(), data: deep(1 + Math.floor(rnd() * 20)) } }),
    })),
  ];
}
```

（withProto 删除——原型污染非本读者有效威胁模型：出口 `Object.fromEntries` 天然 own-property 安全。）

`packages/shared/src/index.ts` 追加：`export * from './testing/adversarial-doc';`

- [ ] **Step 3: 读者断言（双路径+非空转锚）**

```typescript
// adversarial-readers.spec.ts
import { describe, it, expect } from 'vitest';
import { generateAdversarialDocs, readRecordsFromMaps, ensureSchemaVersion, fillDoc } from '@flowweb/shared';
import { toDocLike } from './doc-like.util';
import * as Y from 'yjs';

const cases = generateAdversarialDocs(42);
const byName = (n: string) => cases.find((c) => c.name === n)!;

describe('api 读者全函数（E68 读侧铁律：任意语料要么产出结果要么 typed 拒绝，绝不崩）', () => {
  it.each(cases.map((c) => [c.name]))('%s：FakeMap 路径 readRecordsFromMaps 不抛且返回数组', (name) => {
    const r = readRecordsFromMaps(byName(name).build());
    expect(Array.isArray(r.nodes)).toBe(true);
    expect(Array.isArray(r.edges)).toBe(true);
  });

  it('非空转锚：long-content 语料真的到达读者出口（防"守卫跳过一切"的 vacuous 绿）', () => {
    const r = readRecordsFromMaps(byName('long-content').build());
    expect(r.nodes).toHaveLength(1);
    expect((r.nodes[0].data as Record<string, unknown>).content).toHaveLength(1024 * 1024);
  });

  it('值守卫行为锚：scalar-node 跳过（nodes 空）不抛', () => {
    const r = readRecordsFromMaps(byName('scalar-node').build());
    expect(r.nodes).toHaveLength(0);
  });

  it.each(cases.map((c) => [c.name]))('%s：真 Y.Doc 路径（fillDoc→toDocLike 读写双侧适配）读者不抛', (name) => {
    const doc = new Y.Doc();
    expect(() => {
      // 写侧同样走 toDocLike（Y.Doc 无 createMap——裸传 fillDoc 会 throw 被 catch 吞=断言真空）
      const r = readRecordsFromMaps(byName(name).build());
      fillDoc(toDocLike(doc), r.nodes, r.edges);
      void readRecordsFromMaps(toDocLike(doc));
    }).not.toThrow();
  });

  it('ensureSchemaVersion：要么放行要么抛 typed Error（畸形 meta 不崩进程）', () => {
    for (const c of cases) {
      try { ensureSchemaVersion(c.build()); } catch (e) { expect(e).toBeInstanceOf(Error); }
    }
  });
});
```

- [ ] **Step 4: 构建+导出面更新+跑绿+commit**

```bash
pnpm --filter @flowweb/shared build && node scripts/check-shared-dist.mjs --write && git diff --stat packages/shared
# 期望：dist 期望清单更新（adversarial-doc 入列）——review diff 后保留
pnpm --filter @flowweb/shared test -- --run && pnpm --filter @flowweb/api exec vitest run src/modules/collab/adversarial-readers.spec.ts
git add packages/shared apps/api/src/modules/collab/adversarial-readers.spec.ts && git commit -m "test(shared): Y0a-1 docShape 值守卫（E68 读侧全函数）+对抗语料全量 FakeMap+非空转锚"
```

---

### Task 9: collab-compact.ts 人工出口（apps/api/scripts/——tsconfig.scripts.json 静态载体）

**Files:**
- Create: `apps/api/scripts/collab-compact.ts`

- [ ] **Step 1: 实现（CJS 安全形态：禁 import.meta/顶层 await——tsconfig module=commonjs）**

```typescript
// apps/api/scripts/collab-compact.ts —— Y0a-1 compact 人工出口（装载超时自愈也失败时的最终运维动作）
// 运行：DATABASE_URL=... pnpm --filter @flowweb/api exec tsx scripts/collab-compact.ts <projectId> [--json]
// 载体：tsconfig.scripts.json include "scripts"（pnpm verify 的 `tsc -p tsconfig.scripts.json --noEmit`
// 步覆盖——运维出口有静态 typecheck，不在事故中才发现坏了）；tsx 是 api 包 devDependency（仓根
// npx 解析不到）；直调 repo.compact=唯一实现（禁脚本重抄 SQL——双源）。
import { PrismaClient } from '@prisma/client';
import { CanvasDocUpdateRepository } from '../src/modules/collab/canvas-doc-update.repository';

async function main(): Promise<void> {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error('usage: pnpm --filter @flowweb/api exec tsx scripts/collab-compact.ts <projectId> [--json]');
    process.exit(1);
  }
  const json = process.argv.includes('--json');
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);   // 构造签名收 PrismaService——脚本侧窄化转型
  try {
    const before = await prisma.canvasDocUpdate.count({ where: { projectId } });
    const r = await repo.compact(projectId, { timeoutMs: 120_000, maxWaitMs: 5_000 });   // 运维出口独立长预算
    const after = await prisma.canvasDocUpdate.count({ where: { projectId } });
    if (!r.compacted) {
      // abandoned（pendingStructs!=null——人工介入场景本体）/empty：如实打印 reason，非零退出码提示运维
      const msg = `compact 未执行：reason=${r.reason}（${before} 行 → ${after} 行增量，行未动）`;
      console.log(json ? JSON.stringify({ projectId, before, after, ...r }) : msg);
      process.exitCode = 2;
      return;
    }
    console.log(json ? JSON.stringify({ projectId, before, after, compacted: true }) : `compact 完成：${before} 行 → ${after} 行增量`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
```

（`as any`：scripts 目录不在 eslint `{src,test}` 范围，tsc 经 tsconfig.scripts.json 通过即可。服务器场景 runbook 注明同命令或指向 dist 产物。）

- [ ] **Step 2: 本地真库跑+typecheck 载体验证+commit**

```bash
DATABASE_URL=postgresql://flowweb:123456@localhost:5432/flowweb pnpm --filter @flowweb/api exec tsx scripts/collab-compact.ts y0a1-compact-int
# 期望：`compact 未执行：reason=empty（0 行 → 0 行增量，行未动）`+退出码 2（int 用例 afterAll 已清理——
# empty 返回契约即通线证明：连接/迁移/直调/返回契约/断开全链路；顺手验证 compacted 分支可对有行项目跑一次）
pnpm --filter @flowweb/api exec tsc -p tsconfig.scripts.json --noEmit
git add apps/api/scripts/collab-compact.ts && git commit -m "feat(scripts): Y0a-1 collab-compact 人工出口（apps/api/scripts 静态载体+CJS 安全形态+120s 独立预算）"
```

---

### Task 10: 四条扫描门禁+collab-core 最小 CI job+doc-gate 先验+子批收尾

**Files:**
- Create: `apps/api/src/modules/collab/collab-contract-guards.spec.ts`
- Modify: `apps/api/package.json`（scripts）
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 四条扫描门禁（v3：范围扩 collab 全目录+只留否定断言——循 doc-shape-single-source.guard 惯例）**

```typescript
// collab-contract-guards.spec.ts
// Y0a-1 契约守卫（spec §4.3-1/2/5/10）。范围=collab 目录全部非 spec 生产文件（repository 自身=唯一入口，
// 豁免"禁直查"三条）；契约 5 只留否定断言（正向断言锚死内部写法——Y0a-2 合法重构会误红）。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname);
const repoSrc = readFileSync(join(SRC, 'canvas-doc-update.repository.ts'), 'utf8');
const prodFiles = readdirSync(SRC)
  .filter((f) => f.endsWith('.ts') && !f.includes('.spec.'))
  .filter((f) => f !== 'canvas-doc-update.repository.ts')
  .map((f) => ({ name: f, src: readFileSync(join(SRC, f), 'utf8') }));

describe('Y0a-1 冻结契约扫描', () => {
  it('契约 1：装载读唯一入口——collab 生产文件（repository 外）不得直查 CanvasDoc+CanvasDocUpdate 拼装载', () => {
    for (const f of prodFiles) expect(f.src, f.name).not.toMatch(/canvasDocUpdate\.findMany|canvasDoc\.findUnique/);
  });
  it('契约 2：append 唯一入口——生产代码不得绕过 repo.append 直插 CanvasDocUpdate', () => {
    for (const f of prodFiles) expect(f.src, f.name).not.toMatch(/canvasDocUpdate\.create/);
  });
  it('契约 5：compact 禁 fire-and-forget（否定断言——调用形态自由，void 形态零容忍）', () => {
    for (const f of prodFiles) expect(f.src, f.name).not.toMatch(/void\s+this\.(maybeCompact|repo\.compact)\(/);
  });
  it('契约 10：stateSeq 唯一写者=compact 事务——repository 外零引用', () => {
    for (const f of prodFiles) expect(f.src, f.name).not.toMatch(/stateSeq/);
  });
  it('loadUpdates 已删（唯一入口靠删除保证）', () => {
    expect(repoSrc).not.toMatch(/async loadUpdates/);
  });
});
```

（regex 以实际代码形态校准——**先跑**：现网关应全绿；然后故意注入一处 `void this.maybeCompact()` 验证红（D13），还原。）

- [ ] **Step 2: test:int 脚本+collab-core 最小 job（本子批即建——出口判据 CI 可见）**

`apps/api/package.json` scripts 加：

```json
"test:int": "vitest run \"src/**/*.int.spec.ts\""
```

（本地便利入口跑全部 int；CI 不用它做条数断言——显式清单才能锁本批用例。）

`.github/workflows/ci.yml` 追加 job：

```yaml
  # Y0a-1（E69③ 最小起步·spec §4.5 v2.4 收敛）：collab-core 唯一增量=int 真库显式清单+passed 口径条数
  # 断言。库锚/语料/契约门禁均为常规 vitest spec——test job 经 verify 已常跑，此处重跑=第二真源（防双源，
  # "collab 绿"唯一定义=test job）；kill -9/SIGTERM 演练自 Y0a-2 起（test job 无法跑的子进程形态才是真增量）；
  # dist 泄漏断言已入根 verify（Task 7）。条数断言不用 numTotalTests（skip 计入——DATABASE_URL 缺失时全
  # skip 也过=被它要防的模式击穿）；也不用全量 glob（既有 generation-intent int 5 用例入池稀释约束力）。
  collab-core:
    if: github.event_name == 'push' || github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: flowweb, POSTGRES_PASSWORD: '123456', POSTGRES_DB: flowweb }
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgresql://flowweb:123456@localhost:5432/flowweb
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @flowweb/api exec prisma generate
      - run: pnpm --filter @flowweb/shared build
      - run: pnpm --filter @flowweb/api exec prisma migrate deploy
      - name: collab int（显式清单——本批三个 int spec）
        run: pnpm --filter @flowweb/api exec vitest run src/modules/collab/canvas-doc-update.repository.append.int.spec.ts src/modules/collab/canvas-doc-update.repository.compact.int.spec.ts src/modules/collab/canvas-doc-hydration.int.spec.ts --reporter=json --outputFile=/tmp/int.json
      - name: int 条数断言（passed≥13 且零失败零跳过——红证据：注释 DATABASE_URL 跑一次必红）
        run: node -e "const r=require('/tmp/int.json');const p=r.numPassedTests??0,f=r.numFailedTests??0,s=r.numPendingTests??0;if(f>0||s>0||p<13){console.error('FAIL: passed',p,'failed',f,'skipped',s);process.exit(1)}console.log('collab int passed:',p)"
```

（条数下限=append(2)+compact int(2)+svDominates 纯函数(2，compact int 文件内 describe)+hydration(5：等价/分页/自愈/P1001 负例/P2024 负例)+隔离性质(2)=**13**；redis service 本子批不需要（int 用例零 Redis），Y0a-3 起补。）

- [ ] **Step 3: doc-gate 先验+全量回归**

```bash
node scripts/doc-gate.mjs
pnpm verify && pnpm --filter @flowweb/api exec eslint "{src,test}/**/*.ts"
```
（doc-gate 违规时**不自动覆写**：仅当输出含 `[canonical-drift]` 才 `node scripts/doc-gate.mjs --write-canonical` 并 review git diff；其他违规（vocabulary/dead-path/ref-existence）修因不修表。）

- [ ] **Step 4: 子批出口清单核对（spec §4.1 Y0a-1 行——逐项打勾+载体）**

```
□ 隔离性质用例绿（真 PG，确定序：compact 提交后放行行读）〔载体：collab-core int〕——Task 5
□ 库锚（A1/A5/A6/A7/A8/A9·失败态）绿（独立 Server+确定性构造）〔载体：test job（verify 常跑）——collab-core 不重跑防双源，spec §4.5 v2.4〕——Task 6
□ svDominates 委托单测锚绿（阳性+阴性对照，sv.util.ts 单源）——Task 3
□ stateSeq 精确赋值+updatedAt 双分支（create+update）断言绿〔collab-core int〕——Task 3
□ pendingStructs 放弃：{compacted,reason} 返回+mock 用例红→绿（对旧实现真红）+计数/ERROR repo 单点零双计+maybeCompact 仅成功开窗（gateway 窗口断言链全绿）——Task 3
□ 既有 repository.spec 六用例改写完成（3 红改写+3 卫生补 id）——Task 2/3
□ 语料全函数绿（全量 FakeMap+非空转锚+scalar-node 守卫锚+真 Y.Doc 双侧 toDocLike）——Task 8
□ docShape 值守卫落地+shared 测试绿——Task 8
□ 装置提取后既有 collab 套件全绿（mock-repo 工厂+hydrateWithRecovery 委托切换+AppendResult/compact 返回形状）——Task 4/6
□ verify-indexes 新块绿（含 NOT EXISTS 否定块+runner 块级容错）——Task 1
□ 四条扫描门禁落（collab 全目录+void 红证据）——Task 10
□ stash peek/consume 用例绿（版本门拒绝 stash 存活+正常档消费——第四条蒸发路径本批关闭，spec §1.10）——Task 4
□ onModuleInit async 化后既有 integration 套件绿——Task 6
□ dist 无 test-utils（SKIP guard+反向红证据留档+verify 链接线生效）——Task 7
□ doc-gate canonical 无漂移（仅 drift 时 --write 且 review diff）——Task 10
□ collab-core job 绿+int 条数断言生效（显式清单+passed≥13 口径；注释 DATABASE_URL 跑一次红=红证据）——Task 10
□ commit 历史干净（每 Task 一 commit，显式文件列表）
```

- [ ] **Step 5: 向用户汇报出口清单，请求确认进 Y0a-2 plan（执行门）**

（Y0a-2 待办已随 spec v2.2/v2.4 登记：storeInFlight Gauge+归属转移同点（增减两点规则=契约 14）；DB 触发器演练注入；BOI 主路径重写+spool——**append 消费按契约 15：`!r.ok`（含 fenced）与 throw 合并走 spool 分支，BOI 红相增补第三种（fenced 0 行不抛错→"未抛错当成功"的旧实现照常 splice=帧蒸发，spec §6.1 v2.4）**。**跨批登记（v3）**：Y0a-3 必办=collab.gateway.spec.ts:242-244 的 elapsed<3000 时序断言/注释建立在 RedisExtension disconnectDelay 2×1000ms 上，随 extension-redis 删除同批重写；multi-instance spec 的 repo 形状随租约改写一并核对——两项已进 spec §3 Y0a-3。**跨批登记（v4）**：Y0a-3 落地 readSnapshotOnly 时提取 `readConsistent` 两出口（契约 1 v2.4——本批 loadForHydration 即实现体，禁复制第二份）；fence WHERE 追加后 append 的 fenced/no-row 分支用例（leaseRowMissing 区分同批）。）

---

## Self-Review 记录（v4）

- **Spec 覆盖**：spec v2.4 §3 Y0a-1 全项↔Task 映射：1.1→T1；1.2（append 单语句+**AppendResult 返回契约**）→T2；1.3（**{compacted,reason} 返回契约+仅成功开窗**+pendingStructs return 形态+svDominates 委托）→T3；1.4（超时自愈·分类触发·**P2024 排除+增量预算 ≤8s**）→T4；1.5→T6（storeInFlight 已移 Y0a-2）；1.6→T5；1.7→T7；1.8→T8（含 docShape 值守卫——语料实证真缺陷）；1.9→T6；**1.10（load 路径 stash peek/consume——spec v2.4 补的工作项）→T4**；人工出口→T9；扫描门禁→T10；collab-core（**§4.5 v2.4 收敛：int+条数断言为唯一增量**）→T10。✓
- **冲击面清点（纪律 11）**：Modify 文件=repository（六用例 3 红 3 绿改写清单 T3+append 用例 T2+返回契约三处消费：maybeCompact T3/hydrateWithRecovery T4/脚本 T9）/gateway（5 spec+kit 的 repo stub 切 mock-repo 工厂 T4、onModuleInit async T6、**maybeCompact 开窗 T3+两 spec stub 补丁 T3 Step 5b——存量窗口断言 :551-:570 链依赖 compact 后窗口重置**）/schema+verify-indexes.sql+runner（T1）/docShape+fillRead 测试（T8）/store.metrics/sv.util/shared index/根 package.json（verify 链 T7）——全部附消费点清单。✓
- **占位扫描**：无 throw 占位/双实现开放项；v3→v4 两处裁定翻转均已写明理由与撤回对象（maybeCompact 零改动→仅成功开窗；自愈集含 P2024→排除）。✓
- **类型一致性**：`append→Promise<{ok:true,seq:bigint}|{ok:false,reason:'fenced'|'no-row'}>`（本批恒 ok:true）；`compact(projectId, opts?: {timeoutMs?: number; maxWaitMs?: number})→Promise<{compacted:boolean; reason?:'abandoned'|'empty'}>`（自愈 6s/1s·脚本 120s/5s·默认 5s/2s）；`loadForHydration(projectId, opts?)` 返回 `{state:Buffer|null,updates:Buffer[],stateSeq:bigint}`；`createMockRepo` 含 hydrateWithRecovery 委托+两返回形状；`svDominates=(rowSv,snapSv)=>svSatisfied(snapSv,rowSv)`（sv.util.ts 单源）。✓
- **失败分支推演（v8.3 纪律 10 增补——首批适用）**：append 空行→{ok:false,'no-row'}（不炸 rows[0]）；compact 无行→empty 静默；pendingStructs→abandoned 计数+ERROR（不 throw）；P2024→fail-closed 不自愈；maybeCompact 消费 undefined 返回→窗口不开（stub 补丁覆盖）。✓
- **探针前置**：T8 Step 0（值守卫缺失现状实证）；T3（pendingStructs 放弃用例对旧实现真红）；T6（锚断言即探针——不符先核 dist 禁调断言）；T1（verify-indexes 先红后绿+runner 容错后红证据完整）。✓
- **环境注意**：Git Bash 前缀 env（无 cross-env）；命令统一仓根执行；tsx 经 `pnpm --filter @flowweb/api exec`（api devDep，仓根 npx 解析不到）；doc-gate 仅 drift 时覆写；git add 显式列表；verify 链新增 nest build（~20-40s 成本，spec §4.5 v2.4 裁定接受）。✓



