# 地基修复批（foundation correctness batch）Implementation Plan v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec v5.1（docs/superpowers/specs/2026-11-11-foundation-batch-design.md，active）四卡——C2 MediaFact 当前态表 → C3a MediaBinding 帧级投影 → C1 时间语义终态 rebaseline → C3b PG oracle 证人+DeletionBarrier，批末一次全环境 reset 部署（用户指令时点）。

**Architecture:** 派生索引单写者（appendBatch inTx 帧级快照+SAVEPOINT 隔离）+连续投影前缀水位（**帧/binding 水位两 UPDATE 解耦**）+PG 重建 oracle 永久删除证人（**候选无关全 UUID 叶**+DeletionBarrier fence/drain）+引用并集保护（**保留 mediaId FK=锁耦合**）；时间语义经单一终态 init 全列 timestamptz 归一。每卡 additive 独立 verify 绿，C1 为终态 schema cut。

**Tech Stack:** TypeScript strict / NestJS / Prisma（迁移 additive 纪律）/ Yjs 13.6.32 / vitest+node:test / prom-client / `pnpm verify:fast`（12 步）与 `pnpm verify`（full 31 步）。

**执行纪律（批级，承 spec §0）：** 每任务先红→绿→commit；行号=当前 master；每卡双评审（spec ✅+quality ✅）才进下卡；**C3a-4/C3a-7/C3a-8 等高风险 commit 逐个跑 `pnpm verify`（full）**；迁移 additive+immutability baseline 同 commit；指标入 `.metrics.ts`+`--write-metric-names` 同 commit；spec §3 为设计权威——冲突以 spec 为准并停下上报。

**v1→v2 修订（第六轮三外审 P0 全采纳）：** C2 版本纪律（bumpFactVersionAndUpsert RETURNING+probe.fail 终态 increment+pending→processing）；C3a-4 两 UPDATE+lifecycle 在 SAVEPOINT 外+pgSeq 前进断言；C3a-5 预检序 DELETING 优先+skip 清行；C3a-6 rebuild CAS 加 pgSeq=S；C3a-7 CloneBinding 确定删除（web 零生产调用）+bindInTx 方法删除；C3a-8 import dirty 前置独立事务+reconcile 漂移检测禁活 doc+backfill 持久状态行；C1 allowlist 一次生成审阅入库+baseline=pre-batch+immutability --rebaseline+反向字段；C3b oracle 候选无关+generation+短事务+worker 进程；**C3b-4a DeletionBarrier 新任务**；C3b-4 对象先删；shadow 同快照；E-1 加 soak+restore drill。

---

## 文件结构总览（触碰面）

| 文件 | 动作 | 卡 |
|---|---|---|
| apps/api/prisma/schema.prisma | 改（MediaFact/CanvasDoc 两列/Media.deletionState+审计列/oracle 双表/终态全 tsz+CanvasProject.mediaBindings） | 四卡 |
| apps/api/prisma/migrations/* | 建（C2/C3a/C3b additive；C1 单一新 init 替换全链） | 四卡 |
| packages/shared/src/canvas/media-refs.ts | 改（collectMediaRefsForNode 单源） | C3a |
| apps/api/src/modules/collab/collab-project-actor.service.ts | 改（touched 保守收集+bindingDelta） | C3a |
| apps/api/src/modules/collab/canvas-doc-update.repository.ts | 改（inTx 组合闭包+SAVEPOINT+**两 UPDATE**+loadForHydrationAt） | C3a |
| apps/api/src/modules/collab/media-binding-projector.ts | **建** | C3a |
| apps/api/src/modules/collab/binding-rebuild.service.ts + projection-backfill.runner.ts | **建** | C3a |
| apps/api/src/modules/collab/collab-binding.controller.ts | 改（**CloneBinding 删除**+BindMedia pairArtifact 唯一） | C3a |
| apps/api/src/modules/artifact-core/media-registration.service.ts | 改（bindInTx 方法删除+MediaFact 写点+confirm RETURNING） | C2/C3a |
| apps/api/src/modules/media/media-facts.controller.ts | 改（归一+合成+pending 映射） | C2 |
| apps/api/src/modules/media-delivery/oracle-worker.service.ts + media-reference.service.ts + media-referrer.registry.ts | **建** | C3b |
| apps/api/src/modules/media-delivery/media-gc.service.ts / collab/project-erasure.stages.ts | 改（并集+DELETING+Barrier+对象先删） | C3b |
| scripts/check-{schema-timestamps,raw-sql-time,rebaseline-delta,updated-at-triggers,media-binding-writers}.mjs | **建** | C1/C3a |

---

# 卡 C2：MediaFact 当前态表

### Task C2-1：MediaFact 表与迁移

**Files:** Modify `apps/api/prisma/schema.prisma`；Create 迁移 `<ts>_mediafact_current_state/migration.sql`

- [ ] **Step 1：schema 增模型**（Media 加 `facts MediaFact[]`）：

```prisma
model MediaFact {
  mediaId     String
  factType    String
  factVersion BigInt
  payload     Json
  updatedAt   DateTime @db.Timestamptz(3)
  media       Media @relation(fields: [mediaId], references: [id], onDelete: Cascade)
  @@id([mediaId, factType])
}
```
（C2 起即 timestamptz——Date 参数绑定在 tsz 下 instant 正确；raw 迁移附 `CHECK ("factType" IN ('state','natural'))`。）
- [ ] **Step 2：**`npx prisma migrate dev --name mediafact_current_state`+immutability `--write` 同 commit；**+8 会话 round-trip 红测**（Asia/Shanghai 会话写读 updatedAt 与 DB now() 差毫秒级）。
- [ ] **Step 3：**`pnpm verify:fast`；**Step 4：Commit** `feat(c2): MediaFact 当前态表（tsz+factType CHECK+FK Cascade）`。

### Task C2-2：写点改道+版本纪律（红先行）

**Files:** Create `apps/api/src/modules/artifact-core/media-fact-write.ts`；Modify `media-registration.service.ts:148-166,258-305`、`media-probe.poller.ts:419-463`、`materialize-job.service.ts:406-430,551-565`；Test `media-fact-write.int.spec.ts`

- [ ] **Step 1：红测**（五族）：①版本单调（v5→3n 不倒退→7n 前进）；②并发两写者→版本 6/7 双落；③无 projectId media 有 natural fact；④confirm 后 state fact 存在且 **factVersion=DB 递增返回值**（禁预读+1）；⑤probe 终态失败：已有 processing state vN→终态后 state=`failed` 且 **factVersion=N+1**（非终态重试不写 fact）。
- [ ] **Step 2：跑红**：`cd apps/api && pnpm test:int -- media-fact-write`。
- [ ] **Step 3：实现**——统一版本入口：

```ts
// media-fact-write.ts
export async function bumpFactVersionAndUpsert(tx, mediaId, factType, payload, now = new Date()) {
  const rows = await tx.$queryRaw<{ factVersion: bigint }[]>`
    UPDATE "Media" SET "factVersion" = "factVersion" + 1
    WHERE "id" = ${mediaId} AND "deletedAt" IS NULL RETURNING "factVersion"`;
  if (rows.length === 0) return { skipped: 'media-missing' as const };
  // upsertMediaFactInTx：ON CONFLICT (mediaId,factType) DO UPDATE SET ..., "updatedAt"=${now}
  // WHERE EXCLUDED."factVersion" > "MediaFact"."factVersion"（updatedAt=Date 参数绑定）
}
```
confirmInTx/probe 终态/register/complete/materialize 全部经此入口（已有 increment 的路径改为读回 RETURNING 值传同版本）；probe 非终态不写；`Media.status` 不变（probe 失败=probe 维失败，state fact 记 `{status:'failed',errorCode}` 语义在 payload）。
- [ ] **Step 4：绿+`pnpm verify:fast`；Step 5：Commit** `feat(c2): 5 写点改道+bumpFactVersionAndUpsert 版本纪律（RETURNING 原子递增）`。

### Task C2-3：facts 端点归一与合成

**Files:** Modify `media-facts.controller.ts:40-106`；Test `media-facts.controller.spec.ts`+`apps/web/src/stores/mediaFacts.test.ts`（**注意 .test.ts 后缀**）

- [ ] **Step 1：红测**：①纯 natural v5 无 state→响应含合成 state 行（`Media.status` 映射：**pending→processing**；completed/failed 直传）+max(factVersion) 归一+state 前 natural 后；②deletedAt 过滤；③payload 坏行跳过+计数；④web 双顺序合并 natural+state 双全。
- [ ] **Step 2：红→实现（normalizeFactRows 纯函数+合成映射）→绿；Step 3：Commit**。

### Task C2-4：旧面退役（表暂留 C1）

**Files:** Modify `intent-reconcile.service.ts:538-555`（删 outbox+dead-letter 段，保留 ArtifactProjection/ReconcileAction 清理）、`delivery-lag.metrics.ts:31-35`、`scripts/collab-soak-metrics.mjs:79`/`collab-soak.mjs:361`、`scope-column.registry.ts:59`；测试 census（含 **`t23-resource-recovery.int.spec.ts:95`**、dev-reset-canvas.mjs:75、project-erasure.purge.c4c1:171、provider-convergence.e2e:332-346、materialize/artifact-commit/media-probe/media-facts/media-fact-outbox 各 spec）。

- [ ] **Step 1：**`grep -rn "MediaFactOutbox\|mediaFactOutbox" apps/api/src apps/api/scripts scripts --include="*.ts" --include="*.mjs"` 盘点逐处改/删（census 留档 commit message）。**Step 2：改造+`--write-metric-names`；Step 3：退役 grep 锚 spec 绿；Step 4：verify:fast+Commit**。

### Task C2-5：观测

**Files:** `media-fact.metrics.ts`：`media_fact_age_seconds{factType}`（行龄——**dashboard 用**；**不做全局 version_lag 告警**——factVersion 全局递增会使 natural 永久假 lag；state 维可用 `Media.status≠completed 且 age>阈值` P1 观测）+`media_fact_read_total{result}`+事实 canary（**专用 synthetic team/media**——seed 注入+runbook 登记清理责任；生产环境 canary 用只读断言）。
- [ ] **Step 1：实现+红测→绿→`pnpm verify`（full）→Commit**。

### Task C2-6：卡收口

- [ ] 旧表零新行实证+`pnpm verify` 全绿+双评审派发。

---

# 卡 C3a：MediaBinding 帧级投影

### Task C3a-1：collectMediaRefsForNode 单源

**Files:** `packages/shared/src/canvas/media-refs.ts`+spec；红测：未知 type 含 fileId 也扫（不按 type 收窄）/数组 item.id=targetItemId/slot 键含 role/`collectMediaRefs(doc)` 聚合等价。绿+`cd packages/shared && pnpm test`+Commit。

### Task C3a-2：schema additive

CanvasDoc 加 `mediaBindingSeq BigInt @default(0)`+`bindingsDirty Boolean @default(false)`；Media 加 `deletionState String @default("ACTIVE")`（CHECK IN ACTIVE,DELETING）；additive+immutability --write+verify:fast+Commit。

### Task C3a-3：帧级快照捕获（actor）

**Files:** `collab-project-actor.service.ts`（observeDeep 区）；Test `collab-project-actor.binding-delta.spec.ts`

- [ ] **Step 1：红测**：①数组-only splice→delta 含 node；②`nodes.set(existingId,newMapWithMedia)` root update→touched（现零分支）；③`set('data',newMap)` 整替换→touched；④position-only→不 touched；⑤**`meta`/`exec` 顶层 map 事件不误触**（判定加 `nodes.has(nodeId)`）。
- [ ] **Step 2：实现**（独立 touched Set；帧边界算 `bindingDelta`；`binding_delta_bytes` 直方图入 applied 预算）→绿→Commit。

### Task C3a-4：appendBatch 组合闭包+两 UPDATE+SAVEPOINT（红先行）

**Files:** `canvas-doc-update.repository.ts:189-296`；Test `canvas-doc-update.binding-tx.int.spec.ts`（真 PG）

- [ ] **Step 1：红测**：①注入投影 throw→**帧行落 PG∧pgSeq 前进至 newPgSeq∧lifecycle 行在∧binding 缺∧bindingsDirty=true∧mediaBindingSeq 不进**（五断言——SAVEPOINT 序+lifecycle 外的合并锚）；②批 N 失败批 N+1 成功→水位停 N−1 且 dirty；③bindingCovered∧非 dirty→binding 水位 CAS 推进。
- [ ] **Step 2：实现**：

```ts
// inTx 组合闭包（actor 侧装配）
await repo.appendBatch(pid, rows, wm, async (tx) => {
  const lifecycleCounts = frames ? await lifecycle.persistFramesInTx(tx, pid, frames) : undefined; // SAVEPOINT 外
  await tx.$executeRaw`SAVEPOINT media_binding_projection`;
  let covered = false;
  try { await projectBindings(tx, pid, batchDelta); await tx.$executeRaw`RELEASE SAVEPOINT media_binding_projection`; covered = true; }
  catch { await tx.$executeRaw`ROLLBACK TO SAVEPOINT media_binding_projection`; await tx.canvasDoc.update({ where: { projectId: pid }, data: { bindingsDirty: true } }); }
  return { bindingCovered: covered, lifecycleCounts };
});
```
repository 内**两条 UPDATE 解耦**（第六轮 P0-1）：

```sql
-- ① 帧水位：永远推进（与 binding 无关）
UPDATE "CanvasDoc" SET "walCheckpointSeq"=$wc,"pgSeq"=$newPg WHERE "projectId"=$pid AND "pgSeq"=$expectedPg;
-- ② binding 水位：独立 CAS，允许 0 行（失败/落后不影响 ①）
UPDATE "CanvasDoc" SET "mediaBindingSeq"=$newPg WHERE "projectId"=$pid AND "mediaBindingSeq"=$expectedContiguous AND "bindingsDirty"=false AND $covered;
```
- [ ] **Step 3：绿+`pnpm verify`（full——高风险 commit）+Commit**。

### Task C3a-5：MediaBindingProjector

**Files:** Create `media-binding-projector.ts`（入 SIZE_LIMITS 锚）；Test `media-binding-projector.int.spec.ts`

- [ ] **Step 1：红测**：①diff 语义（upsert/槽位+mediaId 条件删/NODE_DELETED 全删）；②**预检顺序（第六轮 P0-4/P0-8）**：

```ts
if (!media) return skip('missing');
if (media.teamId !== teamId) return skip('cross-team');
if (media.deletionState === 'DELETING') return writeBinding(); // 照写（忽略 deletedAt）——删除 recheck 证人
if (media.deletedAt != null) return skipAndClearSlot('soft-deleted'); // 跳过+清该槽现存行
return writeBinding();
```
红测媒体形态：`deletedAt≠null ∧ DELETING`→照写；`deletedAt≠null ∧ ACTIVE`→跳过+旧行清。③unnest 批量；④typed `BindingProjectionFailed` 抛给闭包。
- [ ] **Step 2：实现+绿+锚登记+Commit**。

### Task C3a-6：水位不变量闭环

**Files:** `canvas-doc-genesis.ts:32-53`（同事务置 dirty）、actor boot 判定（`replayed>0 ∨ mediaBindingSeq<pgSeq ∨ dirty`）、Create `binding-rebuild.service.ts`+repository 加 `loadForHydrationAt(pid, pgSeq)`（选 `stateSeq<=S` 最新 snapshot+`(stateSeq,S]` updates——rebuild/漂移检测专用，**禁 live doc**）

- [ ] **Step 1：红测**：①genesis 种子含 fileId→新项目 dirty；②rebuild 读 S 后 append→**CAS（`mediaBindingSeq=expected ∧ pgSeq=S ∧ dirty=true` 三条件，第六轮 P0-5）失败→dirty 保持**；再 rebuild 至新 S→清 dirty 且 `mediaBindingSeq===pgSeq`；③持续写→持续 dirty+`projection_backfill_remaining` 告警分诊（安全但可见）。
- [ ] **Step 2：实现+绿+Commit**。

### Task C3a-7：命令面+静态门禁（红先行）

**Files:** Modify `collab-binding.controller.ts`（**CloneBinding 确定删除**：路由/handler/DTO/测试——grep 证据〔第六轮实证〕：web 生产零调用〔仅 collabApi.ts 导出+collabApi.test.ts〕、生产 copy/paste 走 BindMedia〔canvasStore.ts:579〕；web 侧同步删 collabApi.cloneBinding 导出+类型+测试）、`collab-media.controller.ts:111-146`（replaceMedia 去 bindInTx）、`artifact-commit.service.ts:594-615`（finalize 去 bindInTx）、**`media-registration.service.ts:186-212`（bindInTx 方法本体删除——白名单不含本文件）**；BindMedia pairArtifact 唯一腿+doc 源节点兜底读（withSession read+400 分档 plan 内定义）；Create `scripts/check-media-binding-writers.mjs`（delegate+raw SQL 文本扫描；白名单=projector/binding-rebuild/erasure 批删/orphan-cleanup/tests）

- [ ] **Step 1：红测**：①copy/paste e2e（客户端 doc 帧自足→目标节点 binding 经投影出现+零裂图）；②门禁负控（非白名单加 mediaBinding.delete→红；media-registration 残留 bindInTx→红）；③BindMedia 零 binding 读写。
- [ ] **Step 2：实现+门禁入 verify 链+绿+`pnpm verify`（full）+Commit**。

### Task C3a-8：恢复四路+reconcile 只读化+BackfillRunner

**Files:** `collab-spool.service.ts:1772-1858`（replayAll→rebuild 队列）、`collab-recovery-import.service.ts:280-289`（**前置独立 PG 事务置 dirty 再 apply**——apply 在内存无同事务载体，第六轮 P1-9）、maintenance/vacuum 缝置 dirty、`binding-reconcile.service.ts`（只读漂移检测——**用 loadForHydrationAt/pgSeq 前缀，禁活 doc**〔第六轮 P1-4〕；发现面扩 CanvasDoc 全表）；Create `projection-backfill.runner.ts`（**持久完成状态行 `ProjectionBackfillState`**〔跨进程 GC/erasure 可查——第六轮 P1-7〕+分页/限速/backfillEpoch 断点续跑）

- [ ] **Step 1：红测**：①kill -9（帧1 加 M flush、帧2 删 M 未 flush、崩溃重启）→PG doc 有 M∧binding 有 M；②import 前置 dirty+apply 后崩溃窗（dirty 已持久）→消费前 rebuild；③vacuum→dirty；④reconcile 只读（写面零）+漂移注入检测；⑤backfill 100 项目不惊群+断点续跑+持久状态行可查。
- [ ] **Step 2：实现+绿+`--write-metric-names`+`pnpm verify`（full）+Commit**。

### Task C3a-9：卡收口

- [ ] 红测全族（spec §3.2.8）+对拍契约 **`binding@mediaBindingSeq == oracle(doc@pgSeq)`**（独立测试递归实现）+`pnpm bench:load:smoke`（append p95/写放大/delta 预算不回归——超限停卡上报）+`pnpm verify`+双评审。

---

# 卡 C1：时间语义终态 rebaseline

### Task C1-1：终态 schema+新 init

**Files:** schema 全 DateTime 加 `@db.Timestamptz(3)`；MediaBinding 加 `project CanvasProject @relation(fields:[projectId],references:[id],onDelete:Cascade)`+**CanvasProject 加 `mediaBindings MediaBinding[]` 反向字段**（mediaId FK **保留**——v5.1 裁定）；删 MediaFactOutbox 模型+MediaFactState enum；**删除 `prisma/migrations/` 全部旧目录（git 历史保留），只留新单一 init**（含 set_updated_at 函数：**首行 `IF current_setting('app.skip_updated_at',true)='on' THEN RETURN NEW; END IF;`+TG_OP 分支**〔INSERT 仅 NULL 设/UPDATE 始终〕+全部 updatedAt 表触发器+全部 raw 对象逐字）；**check-migration-immutability 加 `--rebaseline --confirm` 显式模式**（mergeBaseline 单向只增不删——旧模式 squash 永红，第六轮 P0-5；替换文件 diff 可审阅）；additive `BASELINE` 抬新 init+**EXEMPTIONS 旧条目清+migrate-diff-allowlist+check-fresh-replay 同批清**（第六轮 P1）。

- [ ] **Step 1：旧库 pre-batch 快照**：`pg_dump --schema-only`（**pre-batch 旧链 scratch 重放**——覆盖 C2/C3a/C1 全部 delta，第六轮 P1-2）→`gate-evidence/schema-before-v2.sql`+对象清单 JSON+tag 旧 commit+baseline ADR。
- [ ] **Step 2：**`prisma validate` 绿（反向字段核对）→新 init 生成→`npx prisma migrate reset --force` 空库只重放新 init 红测绿。
- [ ] **Step 3：**immutability `--rebaseline --confirm`+additive BASELINE+migrate-diff --write+状态文件清单 runbook 注记+Commit。

### Task C1-2：三向 allowlist 对象门

**Files:** Create `scripts/check-rebaseline-delta.mjs`：对比重放库 vs `schema-before-v2.sql`（baseline=pre-batch）——old-only 命中 removed（MediaFactOutbox 表+索引列/MediaFactState enum）/new-only 命中 added（MediaFact/CanvasDoc 两列/Media.deletionState/set_updated_at 函数+触发器/**CanvasProject.mediaBindings 关系**）/列类型 delta 由列级 census 派生（存活 naive 恰好全转换——不 hardcode）；函数/触发器 body 逐字；**allowlist JSON 生成一次+人工审阅+入库，gate 只读不自动写**（防自证，第六轮 P1）。

- [ ] **Step 1：门自测负控**（缺 ledger_guard→红/多一列 naive→红/少 removed 条目→红/**多一个非预期对象→红**）→verify 链注册→Commit。

### Task C1-3：时间代码全量

同 v1（补偿谓词/::timestamp/脚本三件/deploy-guard 翻转+改名/测试锚全量）；验收=`grep AT TIME ZONE 'utc'` 零命中+`grep ::timestamp` 零命中+`pnpm verify` full+Commit。

### Task C1-4：三门禁+双时区

同 v1（schema 门/raw SQL 门含日历函数分类〔extract(epoch) 豁免〕/双时区连接级注入全 claim 面+epochStartedAt DB 钟比较/CI +8 矩阵/生产 timezone=UTC）；红测负控+verify 注册+Commit。

### Task C1-5：触发器 coverage 门+canary 容量

**Files:** Create `check-updated-at-triggers.mjs`（每 updatedAt 表必挂）；红测：UPDATE 自动 now/**UPDATE restore skip_updated_at=on 保留历史**（第六轮 P1-1：GUC 检查在 C1-1 函数首行）/INSERT 显式历史保留/appendBatch canary 窗命中；canary 容量评估登记卡评审；`pnpm verify`+Commit。

### Task C1-6：卡收口

- [ ] dev reset 全链演练+对象门绿+`pnpm verify`+双评审+runbook §16（bump 注释/回滚=旧备份+旧代码树/状态文件重置/skip_updated_at 通道/`--rebaseline` 运维注记）。

---

# 卡 C3b：PG oracle 证人+DeletionBarrier

### Task C3b-1：oracle 双表 schema

`CanvasReferenceOracle{projectId,mediaId,verifiedSeq BigInt,@@id([projectId,mediaId]),@@index([mediaId])}`+`CanvasReferenceOracleScan{projectId @id,historyEpoch,**generation Int**,verifiedSeq BigInt,status CHECK(VERIFYING|COMPLETE|FAILED),refCount Int,scannedAt @db.Timestamptz(3),error String?}`；additive+immutability --write+verify:fast+Commit。

### Task C3b-2：PG oracle worker（候选无关）

**Files:** Create `oracle-worker.service.ts`（**worker 进程装配**——第六轮 P2；入锚）；Test `oracle-worker.int.spec.ts`

- [ ] **Step 1：红测**：①**候选无关**：重建 doc 遍历全 Yjs 容器（Map/Array/Text/XmlElement/XmlText 五类型各一用例）string 叶，**UUID 形态全量写入 CanvasReferenceOracle**（查询按候选过滤——候选集外引用不假阴性，第六轮 P0-6）；②**短事务纪律**：RR 短事务只读 pgSeq+snapshot+updates→事务外重建扫描→另起事务 CAS pgSeq 未变+写行/header（防长 RR）；③header 状态机（VERIFYING→COMPLETE〔refCount=0 也写〕/FAILED）+oracle 行按 project 原子替换；④**复用条件=historyEpoch+generation+verifiedSeq 三同且非 dirty**（vacuum 换代不复用）；⑤单 doc 预算/超时→bail-out。
- [ ] **Step 2：实现+绿+`--write-metric-names`（scan_age/coverage_ratio）+Commit**。

### Task C3b-3：decision snapshot+isMediaReferenced+referrer registry

**Files:** Create `media-reference.service.ts`+`media-referrer.registry.ts`

- [ ] **Step 1：红测**：①`decideTeamReferenceSnapshot`：DELETING/erased 项目**保守计入**（最后 COMPLETE oracle 行——排除仍引用项目会误删，第六轮 P1-8）；②oracle 臂 join header 校验 epoch+generation+verifiedSeq；③referrer registry 每条 `{table,column,kind:mediaId|objectKey,resolve}`（ObjectManifest/VideoTrim/coverKey 是**对象键**需 key→mediaId 映射——第六轮 P1-6）；每个 referrer 单独保护（binding-only/oracle-only/structured-only/objectKey-only 四组）；④erasure scope（A 擦 B 引用→detach；仅 A→删）。
- [ ] **Step 2：实现+绿+Commit**。

### Task C3b-4a：DeletionBarrier（新增任务——第六轮 P0）

**Files:** `media-reference.service.ts`（barrier 编排）；Test `deletion-barrier.int.spec.ts`

- [ ] **Step 1：红测（本批 P0 锚）**：media 进 DELETING→**客户端 doc 帧写引用且已 apply 未 flush**→GC 删除决策→**保留/中止**（无 barrier 时 binding/oracle 均不可见该帧——测试即证明 barrier 必要）。
- [ ] **Step 2：实现**：`decideTeamReferenceSnapshot` 第 0 步=对 team 内全部 CanvasDoc 项目**按 projectId 序**取 `lockProject`+`flushThrough` drain 至 `appliedSeq==pgSeq`（team 级低频 freeze 秒级可受）→再走 decision snapshot 五步序；barrier 失败/超时→整体 bail-out。
- [ ] **Step 3：绿+Commit**。

### Task C3b-4：DELETING 状态机+删除序（红先行）

**Files:** `media-gc.service.ts`+`project-erasure.stages.ts`；Media 审计列（deletionRequestedAt/RunId/Reason——raw 迁移）

- [ ] **Step 1：红测**：①CAS 抢占（双 worker 一者零行）；②recheck 命中→中止回 ACTIVE+conflict 计数+审计；③**删除序=对象先删（404 容忍）→行删（第六轮 P0-7：行先删则对象失败无重试锚）；对象失败→行保留 DELETING 下轮重试**；④用户恢复→ACTIVE；⑤facts 过滤 DELETING+content 可读。
- [ ] **Step 2：实现+绿+runbook §13（复位/人工/审计语义）+Commit**。

### Task C3b-5：消费面切换+shadow+回滚开关

**Files:** `media-gc.service.ts:112-201`+`project-erasure.stages.ts:194-254`（并集单源+复核窗保留+Barrier 接线）；`media_ref_shadow_mismatch_total{consumer,dir}`（missing=阻断；extra=告警+触发 rebuild 清理）；回滚开关（config：binding 候选降级纯 oracle）；**shadow 对拍用 decision snapshot 同快照**（第六轮 P1-7——同 pgSeq/epoch 对拍防假 mismatch）。

- [ ] **Step 1：红测**（shadow 注入双向/开关降级/大团队超时保守保留）→绿→`pnpm verify`（full）→Commit。

### Task C3b-6：卡收口+批末出口门

- [ ] spec §3.4 红测全族+coverage 首轮证据+抽样影子首轮零 mismatch（或处置留痕）+`pnpm verify`+双评审。
- [ ] **批末 E-1**：四卡全闭+`pnpm verify` full 全绿+五门禁负控红证（三向 allowlist/schema/raw-SQL/单写者/触发器）+**`pnpm bench:load:smoke`+30min soak（dev 形态；full 权威档维持部署窗）+restore drill 一次（旧备份恢复→binding/oracle/facts 重建+verify）**（第六轮 P1-15）+RPO/RTO 四面成文+呈报包 `gate-evidence/foundation-exit.txt`+**部署窗停等用户指令**（reset-collab §16）。

---

## Self-Review 记录

①Spec v5.1 覆盖：§3.1→C2-1..6；§3.2→C3a-1..9（含两 UPDATE/SAVEPOINT 序/预检序/CAST pgSeq=CAS）；§3.3→C1-1..6（含 --rebaseline/反向字段/pre-batch baseline/skip GUC）；§3.4→C3b-1..6（含 4a Barrier/候选无关/对象先删/generation）。②占位符：无。③签名一致：bumpFactVersionAndUpsert/projectBindings/bindingCovered/loadForHydrationAt/isMediaReferenced/decideTeamReferenceSnapshot 跨任务一致。④v1 张力消除：CloneBinding 由条件分支改确定删除（grep 证据在案）。
