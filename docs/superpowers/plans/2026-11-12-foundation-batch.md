# 地基修复批（foundation correctness batch）Implementation Plan v1

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec v5（docs/superpowers/specs/2026-11-11-foundation-batch-design.md，active@fe14e347）四卡——C2 MediaFact 当前态表 → C3a MediaBinding 帧级投影 → C1 时间语义终态 rebaseline → C3b PG oracle 证人，批末一次全环境 reset 部署（用户指令时点）。

**Architecture:** 派生索引单写者（appendBatch inTx 帧级快照）+连续投影前缀水位+PG 重建 oracle 永久删除证人+引用并集保护；时间语义经单一终态 init 全列 timestamptz 归一。每卡 additive 独立 verify 绿，C1 为终态 schema cut（零 DROP 迁移零豁免）。

**Tech Stack:** TypeScript strict / NestJS / Prisma（迁移 additive 纪律）/ Yjs 13.6.32 / vitest+node:test / prom-client / pnpm verify 链（fast 12 步·full 31 步）。

**执行纪律（批级，承 spec §0）：** 每任务先红→绿→commit；行号=当前 master（c87bc2ac 系）；每卡双评审（spec ✅+quality ✅）才进下卡；迁移 additive+immutability baseline `--write` 同 commit；指标入 `.metrics.ts`+`--write-metric-names` 同 commit+涉指标 commit 跑 `pnpm verify`（full）；census/模块锚随卡；批内在 master 直接开发（house 近批惯例，worktree 可选）；新 commit 禁 amend。**spec §3 为设计权威——本 plan 给执行序与锚点，冲突以 spec 为准并停下上报。**

---

## 文件结构总览（触碰面）

| 文件 | 动作 | 卡 |
|---|---|---|
| apps/api/prisma/schema.prisma | 改（MediaFact 建/CanvasDoc 两列/Media.deletionState/oracle 双表/终态全 tsz） | C2/C3a/C1/C3b |
| apps/api/prisma/migrations/* | 建（C2/C3a/C3b additive；C1 新单一 init） | 四卡 |
| packages/shared/src/canvas/media-refs.ts | 改（collectMediaRefsForNode 单源） | C3a |
| apps/api/src/modules/collab/collab-project-actor.service.ts | 改（touched 收集+bindingDelta 捕获） | C3a |
| apps/api/src/modules/collab/canvas-doc-update.repository.ts | 改（inTx 无条件+SAVEPOINT+水位 CAS+bindingCovered） | C3a |
| apps/api/src/modules/collab/media-binding-projector.ts | **建**（投影器纯函数+批量 SQL） | C3a |
| apps/api/src/modules/collab/projection-backfill.runner.ts | **建** | C3a |
| apps/api/src/modules/media-delivery/binding-reconcile.service.ts | 改（降只读漂移检测） | C3a |
| apps/api/src/modules/collab/collab-binding.controller.ts | 改（CloneBinding 删除/BindMedia pairArtifact） | C3a |
| apps/api/src/modules/artifact-core/media-registration.service.ts | 改（MediaFact 写点+confirmInTx state fact） | C2 |
| apps/api/src/modules/media/media-facts.controller.ts | 改（归一+合成+ACL） | C2 |
| apps/api/src/modules/execution/intent-reconcile.service.ts | 改（outbox 段退役） | C2 |
| apps/api/src/modules/media-delivery/oracle-worker.service.ts | **建**（PG oracle） | C3b |
| apps/api/src/modules/media-delivery/media-gc.service.ts | 改（并集+DELETING+oracle） | C3b |
| apps/api/src/modules/collab/project-erasure.stages.ts | 改（并集+DELETING+复核窗维持） | C3b |
| scripts/check-schema-timestamps.mjs 等 | **建**（三门禁+对象门） | C1 |

---

# 卡 C2：MediaFact 当前态表

### Task C2-1：MediaFact 表与迁移

**Files:** Modify `apps/api/prisma/schema.prisma`（Media 模型附近 + Media 模型加反向关系）；Create `apps/api/prisma/migrations/<ts>_mediafact_current_state/migration.sql`

- [ ] **Step 1：schema 增模型**（Media 模型内加 `facts MediaFact[]`）：

```prisma
model MediaFact {
  mediaId     String
  factType    String
  factVersion BigInt
  payload     Json
  updatedAt   DateTime @db.Timestamptz(3)   // C1 前为 naive——Date 参数绑定写法两期均正确
  media       Media @relation(fields: [mediaId], references: [id], onDelete: Cascade)
  @@id([mediaId, factType])
}
```
raw 迁移附 `CHECK ("factType" IN ('state','natural'))`（Prisma 不可表达，注释注明同 scope-column 惯例）。

- [ ] **Step 2：迁移+基线**：`cd apps/api && npx prisma migrate dev --name mediafact_current_state`（additive；`node scripts/check-migration-immutability.mjs --write` 同 commit）。
- [ ] **Step 3：verify**：`pnpm verify:fast`（12 步全绿）。
- [ ] **Step 4：Commit**：`feat(c2): MediaFact 当前态表 additive 迁移（factType CHECK+FK Cascade）`。

### Task C2-2：写点改道+state fact 补全（红先行）

**Files:** Modify `apps/api/src/modules/artifact-core/media-registration.service.ts:258-305`、`media-probe.poller.ts:419-443`、`materialize-job.service.ts:406-430,551-565`；Test `apps/api/src/modules/artifact-core/media-fact-write.int.spec.ts`（新建，真 PG）

- [ ] **Step 1：写红测**（核心锚——版本单调+Date 参数绑定+无 projectId 也写+confirm state）：

```ts
// media-fact-write.int.spec.ts 摘要（四用例族）
// ①版本单调：先 upsert factVersion=5n(payload A)，再以 3n(payload B) upsert → 行仍 v5/A；以 7n → 行 v7。
// ②无 projectId：Media(projectId=null, status='completed') 经 probe doneNatural 路径 → MediaFact(media,'natural') 行存在。
// ③confirmInTx：上传 confirm 事务后 → MediaFact(media,'state',{status:'completed'}) 行存在（与 Media.completed 同事务）。
// ④probe 失败：probeState='failed' 路径 → state fact {status:'failed',errorCode} 行存在（状态机矩阵无空洞）。
```

- [ ] **Step 2：跑红**：`cd apps/api && pnpm test:int -- media-fact-write`（期望 4 族全红——写点未改道）。
- [ ] **Step 3：实现**：新建 `apps/api/src/modules/artifact-core/media-fact-write.ts`——`upsertMediaFactInTx(tx,{mediaId,factType,factVersion,payload,now:Date})`：

```sql
INSERT INTO "MediaFact" ("mediaId","factType","factVersion","payload","updatedAt")
VALUES (${mediaId},${factType},${factVersion},${payload}::jsonb,${now})
ON CONFLICT ("mediaId","factType") DO UPDATE SET
  "factVersion"=EXCLUDED."factVersion","payload"=EXCLUDED."payload","updatedAt"=${now}
WHERE EXCLUDED."factVersion" > "MediaFact"."factVersion"
```
（updatedAt=**Date 参数绑定**——spec §0 两期兼容裁定；probe/materialize 路径外套 `INSERT..SELECT..WHERE EXISTS(SELECT 1 FROM "Media" WHERE id=${mediaId} AND "deletedAt" IS NULL)` 防 FK 竞态，零命中=skip+计数）。
5 写点改调（去 createMany/去 `if(params.projectId)`）；`confirmInTx`（:148-166）事务内补 `upsertMediaFactInTx(tx,{factType:'state',payload:{status:'completed'},factVersion:media.factVersion+1})`；probe fail 路径（:451-463）补 failed state fact。
- [ ] **Step 4：跑绿+verify:fast**。
- [ ] **Step 5：Commit**：`feat(c2): 5 写点改道 MediaFact 单行 upsert（版本单调+Date 参数绑定）+confirm/probe-fail state fact 补全`。

### Task C2-3：facts 端点归一与合成

**Files:** Modify `apps/api/src/modules/media/media-facts.controller.ts:40-106`；Test `media-facts.controller.spec.ts`（既有）+`media-facts-normalize.spec.ts`（新建）

- [ ] **Step 1：红测**（合成+归一+ACL）：①只有 natural v5 无 state 行的 media → 响应含 state 行（从 `Media.status` 合成，factVersion=Media.factVersion）且 natural 行以 `max(factVersion)` 合成版本返回、state 在前 natural 在后；②`deletedAt≠null` media 不返回；③payload 非 JSON/超 schema → 跳过+`media_fact_read_total{result=invalid}` 计数。
- [ ] **Step 2：跑红 → 实现 → 跑绿**：controller 读改为 MediaFact 直查（去 published 标记段 :77-83）+归一函数（纯函数入 shared 或 controller 内：`normalizeFactRows(mediaId, rows, media)`）+合成；客户端契约测试（web `mergeFactRows` 双顺序 natural+state 合并双全——apps/web/src/stores/mediaFacts.spec.ts 补两序用例）。
- [ ] **Step 3：Commit**：`feat(c2): facts 端点当前态直查+max(factVersion) 归一+Media.status 合成 state+deletedAt 过滤`。

### Task C2-4：旧面退役（表暂留）

**Files:** Modify `intent-reconcile.service.ts:538-555`（删 outbox 清理段+dead-letter 段，保留 ArtifactProjection/ReconcileAction 清理）、`delivery-lag.metrics.ts:31-35`（删 lag gauge）、`scripts/collab-soak-metrics.mjs:79`/`collab-soak.mjs:361`（去 lag 采样）、`apps/api/src/modules/collab/scope-column.registry.ts:59`（删 MediaFactOutbox 条目）；测试 census：`dev-reset-canvas.mjs:75`、`project-erasure.purge.c4c1.int.spec.ts:171`、`provider-convergence.e2e:332-346`、materialize/artifact-commit/media-probe/media-facts/media-fact-outbox 各 spec——逐处删旧表引用改 MediaFact（或删除过时用例）。

- [ ] **Step 1：grep 锚盘点**：`grep -rn "MediaFactOutbox\|mediaFactOutbox" apps/api/src apps/api/scripts scripts --include="*.ts" --include="*.mjs"` 输出逐处标注改/删（census 留档 commit message）。
- [ ] **Step 2：退役改造**（上述文件）+`--write-metric-names` 再生（lag 移除）。
- [ ] **Step 3：红测转绿**：`media-fact-outbox.int.spec.ts` 改写为「退役面零存在」grep 锚 spec（媒体事实全走 MediaFact）；旧表 5 写点 grep 零命中。
- [ ] **Step 4：verify:fast + Commit**：`refactor(c2): MediaFactOutbox 旧面退役（写读清理/lag/soak/registry/测试 census 十四处）——表体留待 C1 终态 init 删`。

### Task C2-5：观测

**Files:** Modify/建 `apps/api/src/modules/media/media-fact.metrics.ts`；指标：`media_fact_version_lag{factType}`（gauge=max(0, Media.factVersion−MediaFact.factVersion)，挂 worker 既有 poller ≤60s）+`media_fact_read_total{result=hit|miss|invalid}`+事实 canary（synthetic 专用 media/team——seed 注入，定时写读回断言 version/payload，失败告警 `media_fact_canary_failed_total`）。

- [ ] **Step 1：指标实现+`--write-metric-names` 同 commit+THRESHOLDS 评估（version_lag P1 挂不挂归卡评审裁）。
- [ ] **Step 2：红测**（canary 写读回+version_lag 推进）→绿→`pnpm verify`（full——涉指标纪律）。
- [ ] **Step 3：Commit**；**Task C2-6 卡收口**：dev 库 fixture 死行随表退役消失实证（`SELECT count(*) FROM "MediaFactOutbox"` 旧表无新行）+`pnpm verify` 全绿+卡双评审派发。

---

# 卡 C3a：MediaBinding 帧级投影

### Task C3a-1：collectMediaRefsForNode 单源（shared）

**Files:** Modify `packages/shared/src/canvas/media-refs.ts`；Test `packages/shared/src/canvas/media-refs.spec.ts`

- [ ] **Step 1：红测**：`collectMediaRefsForNode(nodeId, nodeYMap)` 返回槽位集 `Map<slotKey,{targetField,targetItemId,role,mediaId}>`——未知 type 节点含 `fileId` 也扫（**不按 type 收窄**）；数组槽 item.id=targetItemId；词表=`MEDIA_REF_TARGET_FIELDS` 全集。`collectMediaRefs(doc)` 改为其逐节点聚合（行为等价红测）。
- [ ] **Step 2：实现+绿+shared 池 `cd packages/shared && pnpm test`+Commit**。

### Task C3a-2：schema additive

**Files:** `schema.prisma` CanvasDoc 加 `mediaBindingSeq BigInt @default(0)`+`bindingsDirty Boolean @default(false)`；Media 加 `deletionState String @default("ACTIVE")`（raw CHECK `IN ('ACTIVE','DELETING')`）；迁移 additive+immutability --write 同 commit；`pnpm verify:fast`；Commit。

### Task C3a-3：帧级快照捕获（actor）

**Files:** Modify `collab-project-actor.service.ts`（observeDeep :202-270 区+mkAppliedEntry 区）；Test `collab-project-actor.binding-delta.spec.ts`（新建）

- [ ] **Step 1：红测**（捕获完备性——touched 保守规则）：①数组-only splice（已有节点 allImages 追加/删除）→bindingDelta 含该 node；②`nodes.set(existingId,newMapWithMedia)`（root update 形态——现 actor 零分支）→touched；③`set('data',newMapWithMedia)` 整 map 替换→touched；④position-only 变更→**不**touched。断言 delta=该 node 槽位终态集（按 C3a-1 函数）。
- [ ] **Step 2：实现**：observeDeep 内独立 touched Set（不复用/不清 L2 eventBuffer）：规则=事件 `path[0]` 存在且该 node 事件非 position/edge 类（即 path[1]==='position' 或 events 落 edges map 时跳过）→ `touched.add(nodeId)`；root `nodes` add/**update**/delete → add/delete 进 touched（delete 终态=空集）。帧边界（collector.begin/take 既有缝）对 touched 全集算 `bindingDelta: Map<nodeId, SlotSet>`（O(touched×词表)——内存字节计入 applied 队列预算+`binding_delta_bytes` 直方图）。delta 随 `AppliedEntry` 入队。
- [ ] **Step 3：绿+Commit**：`feat(c3a): actor 帧级 touched 保守收集+bindingDelta 捕获（root update/data 整键/数组 splice 全覆盖）`。

### Task C3a-4：appendBatch 无条件 inTx+SAVEPOINT+水位 CAS（repository）

**Files:** Modify `canvas-doc-update.repository.ts:189-296`（appendBatch 签名+inTx 闭包+水位 UPDATE）；Test `canvas-doc-update.binding-tx.int.spec.ts`（真 PG）

- [ ] **Step 1：红测**：①投影器 throw（注入）→帧行落 PG+`bindingsDirty=true`+`mediaBindingSeq` 不进；②批 N 失败→批 N+1 成功→水位停 N−1 且 dirty（**连续 CAS：`WHERE "mediaBindingSeq"=${expectedContiguous}` 不匹配不推进**）；③`bindingCovered=false` 时水位不推进、`=true` 且非 dirty 时 CAS 推进至 newPgSeq。
- [ ] **Step 2：实现**：inTx 闭包**无条件**传入（与 lifecycleObserver 解耦）；闭包内 `SAVEPOINT media_binding_projection`→投影→`RELEASE`/异常 `ROLLBACK TO`+dirty+返回 covered=false；水位 UPDATE 两形态（:285-293）加 `"mediaBindingSeq"` 分支列与 CAS 条件；`CanvasDoc.updatedAt` **不手写**（C1 触发器接管——本卡不动 updatedAt）。
- [ ] **Step 3：绿+Commit**。

### Task C3a-5：MediaBindingProjector

**Files:** Create `apps/api/src/modules/collab/media-binding-projector.ts`（纯函数+批量 SQL；入 module-size 锚 `scripts/check-collab-module-size.mjs` SIZE_LIMITS）；Test `media-binding-projector.int.spec.ts`

- [ ] **Step 1：红测**：①diff 语义——node 终态集 vs 现存行：新增/变更 slot→upsert（唯一键 [projectId,nodeId,role,targetField,targetItemId] 置 mediaId）、消失→**按槽位+mediaId 条件删**（换绑对=单行换 mediaId）；NODE_DELETED 终态空集→全删；②预检——media 不存在/跨队/软删→跳过+`media_binding_skip_total{reason}`；**deletionState='DELETING'→照写不跳过**；③批量 SQL 用 `unnest` 数组绑定（无 65535 参数面）；④投影异常→向 C3a-4 闭包抛 typed `BindingProjectionFailed`。
- [ ] **Step 2：实现+绿+SIZE_LIMITS 锚登记+Commit**。

### Task C3a-6：水位不变量闭环（genesis/rebuild/boot）

**Files:** Modify `canvas-doc-genesis.ts:32-53`（genesis 同事务置 dirty）、`collab-project-actor.service.ts` boot 判定（`replayed>0 ∨ mediaBindingSeq<pgSeq ∨ bindingsDirty`→dirty）；Create `apps/api/src/modules/collab/binding-rebuild.service.ts`

- [ ] **Step 1：红测**：①genesis 种子 doc（模板含 fileId）→新项目 `bindingsDirty=true`（0==0 假覆盖修）；②rebuild 序（锁外读 pgSeq=S 快照→分页 diff 写→短事务 CAS `mediaBindingSeq: S→清 dirty`）——与 append 交错 100 次：CAS 失败→dirty 保持+水位不进；③rebuild 开始即置 dirty（覆盖竞态修）。
- [ ] **Step 2：实现+绿+Commit**：`feat(c3a): 连续投影前缀水位不变量（dirty 禁推进/genesis dirty/rebuild CAS）`。

### Task C3a-7：命令面读写两改+静态门禁

**Files:** Modify `collab-binding.controller.ts`（**CloneBinding 命令删除**——先 grep `clone-binding|CloneBinding` apps/web 确认调用方：若 copy/paste 仅依赖 doc 帧+命令冗余→删路由/handler/测试；BindMedia pairBinding 腿删除留 pairArtifact 唯一+doc 源节点兜底读）、`collab-media.controller.ts:111-146`（replaceMedia 去 bindInTx 调用）、`artifact-commit.service.ts:594-615`（finalize 去 bindInTx）；Create `scripts/check-media-binding-writers.mjs`（静态门禁：`mediaBinding.upsert|create|delete|deleteMany|updateMany` 与 raw SQL `INSERT INTO "MediaBinding"|UPDATE "MediaBinding"|DELETE FROM "MediaBinding"` 仅允许白名单文件=projector/binding-rebuild/erasure 批删/orphan-cleanup/tests——白名单变更需评审注记）

- [ ] **Step 1：红测**：①copy/paste e2e（web：复制含媒体节点→粘贴→目标节点 binding 行经投影出现〔≤drain 周期〕+裂图零）；②BindMedia 源配对只读 NodeArtifact/doc；③门禁负控——非白名单文件加一处 mediaBinding.delete→门红。
- [ ] **Step 2：实现+门禁入 verify 链（verify-chain.mjs 注册）+绿+Commit**。

### Task C3a-8：恢复四路+reconcile 只读化+BackfillRunner

**Files:** Modify `collab-spool.service.ts:1772-1858`（replayAll 接帧级投影重派生：重放项目进 rebuild 队列）、`collab-recovery-import.service.ts:280-289`（**前置**置 dirty 与 apply 同事务）、`collab-maintenance.service.ts`/vacuum 换代缝（置 dirty）、`binding-reconcile.service.ts`（降只读：漂移检测 `media_binding_drift_total`+触发 rebuild；写面全删；发现面候选扩 CanvasDoc 全表轮转）；Create `projection-backfill.runner.ts`（枚举 `mediaBindingSeq<pgSeq ∨ dirty` 分页/限速/backfillEpoch 断点续跑/未完成期 GC·erasure bail-out gauge `projection_backfill_remaining`）

- [ ] **Step 1：红测**：①kill -9（帧1 加 M 落 WAL、帧2 删 M 未 flush、只 flush 帧1 崩溃重启）→重放后 PG doc 有 M∧binding 有 M（**P0 锚**）；②import 含 3 引用→dirty→消费前 rebuild 收敛；③vacuum 换代→dirty；④reconcile 交错 100 次不写 binding 只检测；⑤backfill 100 项目不惊群+断点续跑。
- [ ] **Step 2：实现+绿+`--write-metric-names`+Commit**。

### Task C3a-9：卡收口

- [ ] 红测全族复核（spec §3.2.8 列表逐项）+独立 oracle 对拍契约 `binding@lastWalSeq == oracle(doc@lastWalSeq)`（测试专用递归扫描实现，禁 import 生产函数）+`pnpm bench:load:smoke`（append p95/写放大/delta 预算 vs 冻结基线不回归——超限停卡上报）+`pnpm verify`+双评审派发。

---

# 卡 C1：时间语义终态 rebaseline

### Task C1-1：终态 schema+新 init 生成

**Files:** `schema.prisma` 全 DateTime 加 `@db.Timestamptz(3)`（CollabLease 既有）；MediaFact.updatedAt 标 tsz；MediaBinding 去 `media` FK 关系+加 `project CanvasProject @relation(fields:[projectId],references:[id],onDelete:Cascade)`；**删除 MediaFactOutbox 模型+MediaFactState enum**；新 init 含 `set_updated_at()` 函数（UPDATE 始终 `NEW."updatedAt":=now()`；INSERT `WHEN (NEW."updatedAt" IS NULL)`）+全部 updatedAt 表触发器+全部 raw 对象（CHECK/partial unique/**ledger_guard()+两资金触发器逐字**/enum 域/CANARY 等迁移内 raw SQL 全集盘点）；迁移链 squash 为单一 `0_init` 等价物（保留旧目录删除+`migration-checksums.json` 重建+additive BASELINE 抬新 init+migrate-diff --write）。

- [ ] **Step 1：旧库快照留档**：`pg_dump --schema-only` → `gate-evidence/schema-before-v2.sql`+对象清单 JSON（tag 旧 commit+baseline ADR 一页——`docs/superpowers/adr/ADR-xx-rebaseline-v2.md` 记「为什么/对象全集/回滚=旧备份+旧代码树」）。
- [ ] **Step 2：新 init 生成+本地 reset 回放**：`cd apps/api && npx prisma migrate reset --force` 全链重放绿。
- [ ] **Step 3：Commit**（含 immutability --write/additive BASELINE/状态文件清单 runbook 注记）。

### Task C1-2：三向 allowlist 对象门（脚本）

**Files:** Create `scripts/check-rebaseline-delta.mjs`：重放库 vs `gate-evidence/schema-before-v2.sql` 对比——old-only 必须命中 removed 白名单（MediaFactOutbox 表+索引列/MediaFactState/MediaBinding.mediaId FK）、new-only 命中 added（MediaFact/CanvasDoc 两列/Media.deletionState/set_updated_at 函数+触发器/projectId FK）、**列类型 delta 由列级 census 派生**（存活 naive 列恰好全转换——不 hardcode 数目）；函数/触发器 body 逐字；ownership/comments/SET 过滤；**allowlist JSON 由 pg_dump 生成器产出不手写**。

- [ ] **Step 1：红测（门自测）**：负控——伪造缺 `ledger_guard` 的重放→红；多一列 naive→红；少一个 removed 条目→红。**Step 2：入 verify 链+Commit**。

### Task C1-3：时间代码全量

**Files:** 补偿谓词拆除（grep 全仓 `AT TIME ZONE 'utc'`/`'UTC'` 清零——含 v2 文件清单+`media-registration.service.ts:249` `::timestamp`→`${param}` Date 绑定或 `::timestamptz`+`:250` AT TIME ZONE 行拆除）；脚本三件 `reset-collab.mjs:283`/`drill-fault.mjs:152`/`drill-cutover.mjs:605` bump SQL 改裸 `now()`；`deploy-guard.test.mjs:396-411` 断言翻转+**测试改名**（裸 now+epochStartedAt 列 timestamptz 断言）；测试锚翻转（`generation-intent.service.spec.ts:619-625` 等全仓同款 grep）。

- [ ] **Step 1：grep 盘点→逐处改造→`grep -rn "AT TIME ZONE 'utc'" apps packages scripts` 零命中（注释除外）+`grep -rn "::timestamp" apps/api/src` 零命中**。
- [ ] **Step 2：`pnpm verify`（full）全绿+Commit**。

### Task C1-4：三门禁+双时区

**Files:** Create `scripts/check-schema-timestamps.mjs`（DateTime 缺 `@db.Timestamptz(3)` 红——负控：加 naive 列必红）；raw SQL 门扩（`check-raw-sql-time.mjs` 或并入现有 doc/code gate：禁 `timestamp(3)`/`timestamp without time zone`/`now()::timestamp`/任意 `::timestamp` 参数 cast/补偿式 `AT TIME ZONE 'utc'`/date-part 类 `extract`/`::date` 无显式时区——**`extract(epoch ...)` 豁免**；报表层显式 `AT TIME ZONE 'Asia/Shanghai'`+注释豁免）；Create `apps/api/src/modules/collab/timezone-invariants.int.spec.ts`（双时区：`$transaction` 内 `SET LOCAL TIME ZONE 'UTC'`/`'Asia/Shanghai'` 两腿+独立 client `options=-c timezone=...` 形态——用例集=lease 过期续租/probe·materialize·projection-outbox·object-manifest·erasure claim/runtime·execution retention/heartbeat/@default(now()) 插入/@updatedAt/`sourceUrlExpiresAt` round-trip/`epochStartedAt` vs DB now() ≤2s——两腿同结果）；CI `ci.yml` +8 矩阵腿（TZ+PGTZ=Asia/Shanghai）；生产 `DATABASE_URL` options 加 `timezone=UTC`（ecosystem/runbook 注记）。

- [ ] **Step 1：三门禁红测（负控）→实现→verify 链注册→CI 矩阵→`pnpm verify`+Commit**。

### Task C1-5：触发器 coverage 门+canary 容量

**Files:** Create `scripts/check-updated-at-triggers.mjs`（每 updatedAt 表必挂 set_updated_at——新增表漏挂红）；红测：appendBatch UPDATE 后 updatedAt 前进（DB 钟）+canary 7d 窗含只编辑项目；INSERT 显式历史 `updatedAt='2020-01-01'` 保留；restore `SET LOCAL app.skip_updated_at` 通道 runbook 注记；**canary 容量评估**：updatedAt 修复后 active 宇宙复测 `ceil(active×1.25/24)` 与 `CANARY_POLL_BATCH_CAP` headroom——登记于卡评审。

- [ ] **Step 1：实现+红测+`pnpm verify`+Commit**。

### Task C1-6：卡收口

- [ ] dev reset 全链演练（`prisma migrate reset`+seed+smoke）+对象门绿+`pnpm verify`+双评审派发+runbook §16 更新（bump 注释/回滚=旧备份+旧代码树/状态文件重置清单/skip_updated_at 通道）。

---

# 卡 C3b：PG oracle 证人

### Task C3b-1：oracle 双表 schema

**Files:** `schema.prisma`：`CanvasReferenceOracle{projectId,mediaId,verifiedSeq BigInt,@@id([projectId,mediaId]),@@index([mediaId])}`+`CanvasReferenceOracleScan{projectId @id,historyEpoch String,verifiedSeq BigInt,status String,refCount Int,scannedAt DateTime,error String?}`（raw CHECK status IN ('VERIFYING','COMPLETE','FAILED')）；additive 迁移+immutability --write+verify:fast+Commit。

### Task C3b-2：PG oracle worker

**Files:** Create `apps/api/src/modules/media-delivery/oracle-worker.service.ts`（+module-size 锚）；Test `oracle-worker.int.spec.ts`（真 PG+真 Yjs）

- [ ] **Step 1：红测**：①从 Snapshot+Update 在 pgSeq 重建 doc→**通用 UUID 候选驱动扫描**（遍历 Y.Map/Y.Array/Y.Text/Y.XmlElement/Y.XmlText 全类型 string 叶∈候选集——五类型各一「UUID 藏在里面」用例）；②单 RR 事务（pgSeq+snapshot+updates+verifiedSeq 同快照）；③扫描后 CAS 校验 pgSeq 未变（变了重试→再漂移 bail-out）；④header 状态机（VERIFYING→COMPLETE〔零引用 refCount=0 也写〕/FAILED）+oracle 行按 project 原子替换（不累积）；⑤增量：pgSeq 未变→复用 header 不重扫；⑥单 doc 预算/超时→bail-out 保守保留。
- [ ] **Step 2：实现+绿+`--write-metric-names`（scan_age/coverage_ratio）+Commit**。

### Task C3b-3：decision snapshot+isMediaReferenced scope+referrer registry

**Files:** Create `apps/api/src/modules/media-delivery/media-reference.service.ts`：`isMediaReferenced(mediaId,{teamId,excludeProjectId?,includeDeletedProjects?})`（并集：Binding∪Oracle〔verifiedSeq===决策 pgSeq〕∪NodeArtifact∪VideoWork∪LightingTask∪VideoTrim∪VideoProject.data 深扫∪ObjectManifest∪ArtifactProjection.mediaId∪GenerationIntent.resultRef——**referrer registry**（同 scope-column.registry 形态文件 `media-referrer.registry.ts`）登记全部持 mediaId 表列+新增列 census 红门）；`decideTeamReferenceSnapshot(teamId, candidates)`（枚举 CanvasDoc 项目〔DELETING/erased 用最后 COMPLETE 或排除〕→S_i→逐项目 oracle→决策五步序——spec §3.4.4）

- [ ] **Step 1：红测**：erasure scope（A 擦除 B 引用 M→detach 保留；仅 A 引用→删）；每个 referrer 单独保护（binding-only/oracle-only/structured-only 三组）；零引用项目 coverage 通过；verifiedSeq=100≠pgSeq=110→bail-out；「GC 扫描后新增 binding」交错→保留。
- [ ] **Step 2：实现+绿+Commit**。

### Task C3b-4：Media DELETING 状态机

**Files:** Modify `media-gc.service.ts`+`project-erasure.stages.ts`：`UPDATE "Media" SET "deletionState"='DELETING' WHERE id=${id} AND "deletionState"='ACTIVE' RETURNING`（CAS 抢占——双 worker 一者零行）；审计列（Media 加 `deletionRequestedAt/deletionRunId/deletionReason` raw 迁移）；DELETING 期：命令面拒（C3a-7 已断）+投影照写（C3a-5 已落）+facts 端点过滤+content 可读；删除事务=媒体行 `FOR UPDATE`+`isMediaReferenced` re-check→命中→**中止回 ACTIVE**+`media_deletion_conflict_total{reason}`+复核窗重置；未命中→DB 行删→对象删（失败重试容忍）；用户恢复 deletedAt=null→ACTIVE；DELETING 复位/人工语义入 runbook §13。

- [ ] **Step 1：红测**：**DELETING 媒体+客户端 doc 帧写引用（apply 未 append）→删除事务保留/中止**（P0 锚）；双 worker 抢占；中止回退+审计行；对象删失败→行保留下轮。
- [ ] **Step 2：实现+绿+Commit**。

### Task C3b-5：消费面切换+shadow+回滚开关

**Files:** Modify `media-gc.service.ts:112-201`（引用图=isMediaReferenced 并集单源——补 Lighting/Trim/Manifest 缺口；grace+DELETING+decision snapshot 接线）、`project-erasure.stages.ts:194-254`（resolveMediaDisposition 收编 scope 化 helper；**复核窗保留**）；`media_ref_shadow_mismatch_total{consumer,dir}`（missing=阻断保留；extra=告警+触发 rebuild 清理 `media_binding_stale_total`）；运行时开关（env/config：binding 候选一键降级纯 oracle——降级态=跳过 binding 臂）。

- [ ] **Step 1：红测**：shadow 注入 binding 少一行/多一行→保留+告警；开关降级态判定仍全绿；大团队/大 doc/超时→保守保留。
- [ ] **Step 2：实现+绿+`pnpm verify`+Commit**。

### Task C3b-6：卡收口+批末出口门

- [ ] spec §3.4.10 红测全族复核+coverage 首轮证据（decision snapshot 全链留档 gate-evidence/）+抽样影子首轮零 mismatch（或处置留痕）+`pnpm verify`+双评审。
- [ ] **批末 E-1**：四卡全闭+`pnpm verify` full 全绿+三门禁/对象门/单写者门/触发器门负控红证+bench-smoke 不回归+RPO/RTO 四面成文+呈报包 `gate-evidence/foundation-exit.txt`（诚实登记：loopback 未退役/投影 bug 降级面/Node 日历族/clock_timestamp）+**部署窗停等用户指令**（服务器 reset-collab §16 全环境重置）。

---

## Self-Review 记录

①Spec 覆盖：§3.1→C2-1..6；§3.2→C3a-1..9；§3.3→C1-1..6；§3.4→C3b-1..6；§3.5→E-1。②占位符：无 TBD/「适当处理」；实现步骤均带签名/SQL 形态/文件行号。③类型一致性：`upsertMediaFactInTx`/`collectMediaRefsForNode`/`isMediaReferenced`/`bindingCovered` 各任务签名一致。④已知张力：C3a-7 CloneBinding 调用方核实若发现产品依赖（web 实调且 doc 帧不自足）→停卡上报裁定（spec §6 已立 Y2 立项出口）。
