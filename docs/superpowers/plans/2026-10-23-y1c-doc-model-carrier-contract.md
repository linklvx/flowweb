# Y1c：doc 模型 v3·载体与契约 Implementation Plan（Phase 0 / -1a / -2a / -1b / -2b / -3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

<!-- plan v1（2026-10-23）：依据 spec v4（99ff0dbc——三轮外审收敛+用户两项裁定 v4-1 三档准入/v4-2 片序重排）。**plan 期定案四项**（spec §9 观察项收口）：①**租约锁形=pg_advisory_xact_lock_shared**（键=COLLAB_LEASE_SCOPE 派生 int；takeover 用 pg_advisory_xact_lock exclusive；不拆行——心跳 UPDATE 零接触；若 T7 基准显示争用再评估拆行，登记偏离）②**执行输入快照=GenerationIntent 扩列 `inputSnapshot Json?`**（{promptText,promptHtml?,upstreamMediaIds[]}单行原子随 claim——不建 InputSnapshot 表：零 join、paramsHash 已同表）③**CanvasDocUpdate 不做原生分区**（dev 规模 YAGNI；compact 分批 purge+按 (pid,g,seq) 索引覆盖增长；Y6 重评）④**-1b 不拆两半**（三档制已采纳——-1b-1/-1b-2 折中形态不需要）。8MiB SS2 压缩 vs HTTP seed=T27 实测任务（非 plan 定案）。**执行门**：世代切换首次执行（T10 维护演练首次真跑）前单独请用户确认（:163）；每阶段出口=用户确认点。**纪律**：每卡先红（真实变红+真 PG 并发用例）→绿→commit；写码前 grep 实证（行号=2d62fcfc 快照）；三面 tsc；偏离滚动登记本文件 §0。 -->

**Goal:** 落地 doc 模型 v4——Phase 0 契约冻结（per-node-type schema+DocCodec+两现行 bug 首修）→-1a 载体（appendSeq 行锁+{owner,epoch,g} 围栏+genesis 双路+维护状态机 admissionEpoch+世代 DocKey 化）→-2a 内容（Y.Text 分型+嵌套 XmlFragment+y-prosemirror+RetentionCoordinator+incarnation）→-1b 准入（三档 FrameGate+decode/父链/provenance+拒帧恢复+生命周期受理+保存屏障）→-2b exec（扁平组件键+NodeExecution/ExecutionOutbox+执行输入快照+物化 run fence）→-3 门禁（读者改道同单元+reservation 状态机+GC delete-claim+客户端增量投影）；批末 v4 单发布。

**Architecture:** 载体=CanvasDoc 头+maintenance 族（advisory shared 锁+appendSeq 行内取号+提交前缀构造保证）+CanvasDocSnapshot(g,rev) 追加+CanvasDocUpdate(g,seq)+CanvasDocProvenance（服务器写区间）；准入=FrameGate 串行窗（beforeSync 令牌跨到 apply+三档 DENY/NORMALIZE/ACCEPT+decode 父链判定，无全量索引）；exec=doc 扁平组件键（execution:<nodeId>/artifact:<nodeId>:<slot> 服务器专写）+PG NodeExecution/ExecutionOutbox（eventVersion 同事务+partial unique+generation CAS）；内容=嵌套 Y.XmlFragment（y-prosemirror 直绑）+Y.Text+DocCodec 单源序列化；恢复=REJECTED/DIVERGED+同代 fresh doc+DraftEnvelope；资源=reservation 终态释放+GC delete-claim。

**Tech Stack:** TypeScript strict / Yjs exact 13.6.32 / Hocuspocus 4.6.0（含 y-protocols patch fork）/ **y-prosemirror（T0 pin——与 Tiptap 2.10.0 ProseMirror 版本矩阵匹配的 exact 版）** / @tiptap/react 2.10.0 / NestJS / Prisma / vitest+node:test / CI postgres。

**执行纪律：** 每卡先红（含真 PG 并发/交错用例——mock 测不出代际/锁序）→绿→commit；写码前 grep 实证；行号=2d62fcfc；三面 tsc；文档 diff 随卡；每阶段出口用户确认。

## 文件结构（触碰面全景）

| 文件 | 动作 | 责任 | 阶段 |
|---|---|---|---|
| packages/shared/src/canvas/doc-schema-v4.ts | **建** | per-node-type 表单源（T3） | P0 |
| packages/shared/src/canvas/doc-codec.ts | **建** | encodeNode/decodeNode/serializeCanvas/semanticEqual（T4） | P0 |
| packages/shared/src/canvas/docShape.ts+canvas-doc-manifest.ts | 改 | 键分类二分/运行时准入面共用（T3/T25） | P0/-3 |
| apps/web/src/stores/nodeStore.ts:20,:225,:613 | 改 | bug① textInput 统一（T1） | P0 |
| apps/web/src/pages/canvas/components/config-panel/TextConfigPanel.tsx:157 | 改 | bug② 覆盖写修复（T2） | P0 |
| apps/api/prisma/schema.prisma+迁移×3 | 改 | T6 载体表形/T20 exec 表/T26 reservation·GC | -1a/-2b/-3 |
| apps/api/src/modules/collab/canvas-doc-update.repository.ts | **重写** | appendSeq 行锁+advisory+装载 RR+compact 分批（T7-T9） | -1a |
| collab-lease.service.ts / collab-persistence.service.ts / collab-doc-registry.service.ts | 改 | advisory 锁形/错误模型/DocKey 升维/装载三态（T7/T8/T11） | -1a |
| collab-maintenance.service.ts+scripts/collab-rebuild-gen.mjs | **建** | 维护状态机+CLI 控制面（T10） | -1a |
| packages/shared/src/collab/doc-name.ts+scripts/check-collab-census.mjs | **建/改** | buildDocName 唯一构造器+裸构造静态门（T11） | -1a |
| apps/api/src/modules/canvas/canvas.service.ts:37-47+project/project.service.ts:100-107 | 改 | genesis 双路+缺头三态（T6） | -1a |
| apps/web/src/stores/canvasCollabRuntime.ts | 改 | 增量投影/4410 全会话/拒帧恢复（T18/T27） | -1b/-3 |
| apps/web/src/stores/canvasUndo.ts+retention-coordinator.ts | 改/**建** | RetentionCoordinator+shift 修复（T15） | -2a |
| TextInputNode.tsx+TextNodeFullscreen/TextNodeToolbar/prompt-input/PromptInput | 改 | 嵌套 XmlFragment+y-prosemirror 四面（T13） | -2a |
| collab-frame-gate.service.ts+collab-admission/（decoder.ts/parent-chain.ts/provenance.ts/policy.ts） | **建** | 串行窗+三档判定器（T16） | -1b |
| patches/y-protocols+pnpm patch | **建** | 重抛+ACK 后置 fork（T17） | -1b |
| collab-lifecycle-admission.service.ts | **建** | 生命周期效果提取+同事务义务（T19） | -1b |
| collab-document.service.ts+media-delivery/projection-outbox.poller.ts | 改 | 扁平组件键/writeExecStatus 退役/watermark/g 维度（T20-T22） | -2b |
| materialize-job.service.ts+team-credit.service.ts | 改 | materializeRunId 裁定+expectedExecSeq（T23） | -2b |
| media/safe-remote-fetch.service.ts+media-gc.service.ts+storage-* | 改 | cap 传入/delete-claim/reservation 状态机（T26） | -3 |
| apps/web 全读者 ~27 处/14 文件 | 改 | 改道+fallback 删除（T24） | -3 |
| deploy.sh:134-159+scripts/lib/gate-decision.mjs | 改 | 破坏性发布流程+inflight 判据（T28） | 批末 |

**不动红线**：NODE_ENVELOPE_KEYS；ecosystem 双进程；锁序契约 §2.10（T19/T23 全按此核对）；四根 doc 顶层集合（meta/nodes/edges/exec——manifest 演进不改集合）。

---

## Phase 0：契约冻结（T0-T5——除两 bug 外零生产代码变更）

### Task 0: 依赖 pin 调研+census 基线
**Files:** 调研产出记入本卡（无代码变更）；census 清单固化为后续卡输入
- [ ] y-prosemirror exact 版本调研（与 @tiptap/react 2.10.0 依赖的 prosemirror-* 版本矩阵匹配——`pnpm why prosemirror-model` 实证；锁定 exact 写入 apps/web/package.json 于 T13 落地）
- [ ] census 固化：①裸 `project:${pid}` 39 处清单（grep 产出入 T11）②创建路径全集（POST /canvases+POST /api/projects+seed 脚本+测试装置）③data.fileId/status 读者 27 处/14 文件复核 ④Tiptap 四面清单复核（TextInputNode/PromptInput/TextNodeFullscreen/TextNodeToolbar）
- [ ] Commit（census 文档入 docs/superpowers/plans/ 附件节或本卡注释）。

### Task 1: bug① isTextNode 统一（PC2 前半）
**Files:** apps/web/src/stores/nodeStore.ts:20,:224-225,:613-621；apps/web/src/pages/canvas/components/nodes/TextInputNode.test.tsx:84,:91；nodeStore.test.ts:543
- [ ] 先红：TextInputNode.test 夹具 type 改生产名 `'textInput'`+删 isTextNode mock（用真守卫）→重挂载用例断言正文保留→**红**（真守卫判 'text' 恒 false）
- [ ] 绿：isTextNode 判 `node.type === NODE_TYPES.TEXT`（单源引用）；删 :613-621 `type:'text'` 幽灵兜底分支（缺节点 else 改显式拒绝/忽略）；nodeStore.test 手写 'text' 夹具全改 NODE_TYPES.TEXT
- [ ] 全仓 grep `=== 'text'`（节点 type 判定处）清零；web tsc+相关测试绿→Commit（fixbug 前置——注明 PC2）。

### Task 2: bug② TextConfigPanel 覆盖写修复（PC2 后半）
**Files:** TextConfigPanel.tsx:157；apps/web 新增回归测试
- [ ] 先红：用例「生成后 textInput 正文不被 prompt 覆盖」（模拟 handleGenerate→断言 data.content 不变、data.prompt 更新）→**红**（现 :157 写 content）
- [ ] 绿：:157 改 `applyNodeDataPatch(nodeId, { prompt })`（正文唯一写者=编辑器）；audioGen 的 content=prompt 义维持现状（物理迁键=T12——契约已由 T3 冻结）
- [ ] 测试绿→Commit。

### Task 3: docSchemaV4 per-node-type 表（PC1）
**Files:** packages/shared/src/canvas/doc-schema-v4.ts（新）+schema-contract.spec.ts（新）
- [ ] 表形（TS 单源，全部 NODE_TYPES 枚举×data 键穷举）：

```ts
export type YFieldType = 'text' | 'xml' | 'array' | 'lww' | 'server-only';
export interface DataKeySpec { yType: YFieldType; writer: 'user' | 'server' | 'both-creating-only';
  reader: string[]; ownership: 'user' | 'server'; undo: boolean; permission: 'free' | 'protected';
  mediaRef: boolean; importExport: boolean; maxBytes?: number; }
export const DOC_SCHEMA_V4: Record<string /*nodeType*/, {
  envelope: readonly string[]; data: Record<string, DataKeySpec>; }>;
// 覆盖：textInput{content:xml·user·undo, prompt:text·user} / audioGen{prompt:text}
// imageGen|videoGen{prompt.text:text, allImages:array·mediaRef} / multiImageGen{prompt:text}
// 通用{position/size/config:lww·user} / exec 根:server-only / 未知类型=空表+ DENY
```

- [ ] 先红：schema-contract.spec——「每个 NODE_TYPES 成员在表内有 envelope+data 全键」「SERVER_WRITABLE 与 ownership:server 键集一致」「键集与 canvas-doc-manifest 现键零漂移 diff」（现 manifest 无类型维度=红前置）
- [ ] 绿+断言族全绿→Commit。

### Task 4: DocCodec（PC1）
**Files:** packages/shared/src/canvas/doc-codec.ts（新）+round-trip 属性测试
- [ ] 接口：`encodeNode(type, yNode|data): CodecNode` / `decodeNode(type, codec): {data, texts}` / `serializeCanvas(docLike): CanvasDocument` / `semanticEqual(a,b)`（canonical：类型/稳定 ID/引用/排序/文本内容——XML 归一化比较）
- [ ] readRecordsFromMaps 收编：codec 内唯一 import 点；docShape 对外改 re-export（调用面零改动）
- [ ] 先红：round-trip 属性测试（随机 text/marks/嵌套 XML/array/lww 组合——语义相等非字节相等；现无 codec=红）
- [ ] 绿+census 门（eslint rule 或 check-collab-census：`readRecordsFromMaps` 仅 doc-codec.ts 可 import）→Commit。

### Task 5: 契约冻结收口（PC1/PC3）
**Files:** shared 耐久性契约常量+docs（collab-ops-runbook 草节）+fixture 语料
- [ ] content 分键契约定稿（textInput.prompt=Y.Text/audioGen.prompt 迁移目标形——物理迁移 T12）；创建路径双路 census 报告（含种子事务形）；执行输入快照契约（`GenerationIntent.inputSnapshot Json?`={promptText,promptHtml?,upstreamMediaIds[]}——T20 落地）；耐久性契约表（`local/synced/durable/archived` 四档常量+UI 文案映射——只有 durable 承诺不丢）
- [ ] fixture 冻结：-2a 语义比对语料（每类型典型+边界）+-1b fuzz 种子语料（含部分应用 bit-flip 变异集）
- [ ] PC1-PC3 全绿+**Phase 0 出口=用户确认点①**→Commit。

## 片 -1a：载体（T6-T11）

### Task 6: Prisma 迁移一+genesis 双路+缺头三态（G1/B3）
**Files:** schema.prisma+migration `y1c1_carrier_v4`；project.service.ts:45-108；canvas.service.ts:37-53
- [ ] 先红：①双路种子测试——POST /canvases 后查 CanvasDoc+Snapshot(g,0,0) 存在（现懒建=红）②缺头三态——project.service 缺头返回 `missing` 非 generation=0（现 `?? 0`=红）
- [ ] schema（核心）：

```prisma
model CanvasDoc {
  projectId String @id
  generation Int @default(0)  schemaVersion Int  lifecycle String @default("SERVING")
  currentSnapshotRev BigInt @default(0n)  appendSeq BigInt @default(0n)
  maintenanceId String?  maintenanceStage String?  maintenanceError String?
  admissionCutoff BigInt?  maintenanceSourceGeneration Int?  maintenanceTargetGeneration Int?
  targetSchemaVersion Int?
  @@unique([maintenanceId]) // Prisma 层表达；migration SQL 写 partial: WHERE "maintenanceId" IS NOT NULL
}
model CanvasDocSnapshot { projectId String  generation Int  snapshotRev BigInt  stateSeq BigInt
  state Bytes  stateHash String  schemaVersion Int  createdAt DateTime @default(now())
  @@id([projectId, generation, snapshotRev]) }
model CanvasDocUpdate { projectId String  generation Int  seq BigInt  update Bytes
  updateHash String  createdAt DateTime @default(now())  @@id([projectId, generation, seq]) }
model CanvasDocProvenance { projectId String  generation Int  clientId BigInt  clockStart BigInt  clockEnd BigInt
  @@id([projectId, generation, clientId, clockStart]) }
model NodeLifecycle { nodeId String  incarnationId String  generation Int  exists Boolean
  deletedAt DateTime?  fence Json?  @@id([nodeId, incarnationId, generation]) }
model DeliveryFence { /* 同主键族——取消/退款义务行，义务字段由 T19/T23 填充 */ }
```

- [ ] 迁移后旧 state/stateSeq/preVacuumSv 列删除（硬切豁免登记）；种子双路同事务（project+doc 头+snapshot0）；缺头=missing/present/corrupt 三态判别函数（DB 行缺失=missing；行在指针悬空=corrupt）
- [ ] additive 门豁免登记（spec 载明 reset runbook）→交错用例（并发双创建）绿→Commit。

### Task 7: appendSeq 行锁+{owner,epoch,g} 围栏+advisory 锁形+错误模型（G2/G4/B1/B4）
**Files:** canvas-doc-update.repository.ts（重写）；collab-lease.service.ts；collab-persistence.service.ts:356-365；pg-error.util.ts:4-7
- [ ] 先红（真 PG 并发）：①ABA——同 owner 捕获 epoch=7、另一连接重获 epoch=9 后提交旧操作→现 owner-only EXISTS 放行=红②FK 误分类——注入内部 FK 错（snapshot 悬空）→现全 23503 终态丢批=红
- [ ] append SQL：

```sql
SELECT pg_advisory_xact_lock_shared(hashtext('collab-lease:' || ${scope}));
-- 锁 CanvasDoc 行后：
SELECT owner, epoch, generation, lifecycle FROM "CanvasDoc" WHERE "projectId"=${pid} FOR UPDATE;
-- 验证 owner=$owner AND epoch=$capturedEpoch AND generation=$expectedGeneration AND lifecycle='SERVING'
UPDATE "CanvasDoc" SET "appendSeq"="appendSeq"+1 WHERE "projectId"=${pid} RETURNING "appendSeq";
INSERT INTO "CanvasDocUpdate"(...) VALUES (...${seq}...);
```

- [ ] 错误模型重写：约束级判别（P2003 meta→constraint 名白名单→仅 project FK+DB 复核 CanvasProject 缺失才终态丢弃；内部 FK=fail-closed 保留+告警计数 yjs_persist_fk_internal_total）
- [ ] G2 前缀交错组（A 取号未提交/B 提交/装载）绿；心跳并发 append 不受阻（3s 心跳 ping 用例）→Commit。

### Task 8: 装载 RR+前缀连续+读侧守卫（G5）
**Files:** canvas-doc-update.repository.ts（readConsistent 改新表形）；collab-doc-registry.service.ts 装载路径
- [ ] 先红：删增量整行/删指针行/改字节→分档 reason 拒载（现无守卫=红）
- [ ] 装载=单 RR 事务（头+Snapshot(R)+S<seq<=N 全增量+连续+计数+SHA-256 校验）→事务外 apply（失败拒载不返回半文档）；yjs_doc_incomplete_total{reason=missing|corrupt|prefix-gap|hash|replay}；readCanvas 出口同判据
- [ ] 交错（装载×compact×append 三方）用例绿→Commit。

### Task 9: compact v4（G3/B2 部分）
**Files:** canvas-doc-update.repository.ts compact；新 worker-thread 重放器（api 内 worker_threads）
- [ ] 先红：两 compact 并发 PK 冲突被折成正常 miss=红；单事务全量 deleteMany=红（断言分批）
- [ ] 事务外 worker/thread 重放（RSS 上限+显式 timeout）→短事务 advisory+FOR UPDATE 头→四元组 (g,R,epoch,lifecycle) 比对→INSERT Snapshot(R+1)+指针前移+**分批 deleteMany（1k/批按 seq 升序）**；PK 冲突=回滚实查分类（conflict/not-owner/epoch/generation/incomplete）
- [ ] 调度（1,000 行/2MiB/60s+30s 间隔+全局并发 1）+bloat 观测；**保留策略**（当前代留最近 2 份+最近两旧代各最终 1 份——检查点语义；禁删当前指针引用行）→三方交错绿→Commit。

### Task 10: 维护状态机+世代切换协议（G9/B2/B3——含执行门）
**Files:** collab-maintenance.service.ts（新）；collab-persistence.service.ts（drain 授权档+spool 标签）；collab-spool.service.ts（帧头受理标签）；scripts/collab-rebuild-gen.mjs（新）；registry/residency 接线
- [ ] 先红：①QUIESCING 后 drain flush 被 SERVING-only 拒=红②Promise.race 超时被当排空完成=红③CLI 无租约直写 CanvasDoc=红
- [ ] admissionEpoch：受理入口分配（单调 per project）；spool 帧头持久 `{maintenanceId?,admissionEpoch,generation}`；drain 授权档=lifecycle=QUIESCING ∧ maintenanceId 匹配 ∧ epoch≤cutoff；DRAINED=可查询六元组（pendingBatches/spoolCurrentGen/admissionInFlight/appendTxInFlight/writeWindowIdle/producerPaused——任一不可观测=阻断保持封闭）
- [ ] maintenanceStage 表（stage→允许动作/幂等键/超时）+每 stage kill -9 演练；维护执行者=租约持有者（CLI 只 REST request/轮询——网关校验租约 owner）；空画布保头升代（互斥判据）；归档窗口 7 天；类型化导出重建=DocCodec serializeCanvas→fresh doc（identity -1a）
- [ ] **世代切换首次真跑=执行门——单独请用户确认后执行**；G9+B2/B3 用例绿→Commit。

### Task 11: 世代通道接线+DocKey 升维+csv→4+闩锁删除（G6/G7/G8/B1 部分）
**Files:** packages/shared/src/collab/doc-name.ts（新 buildDocName）；39 处改道；check-collab-census.mjs（裸构造门）；registry+persistence 内存表全清单升维；canvasCollabRuntime.ts:1601+4410 消费链；snapshot-doc-cache.ts；collab-protocol.ts csv=4；Y1b §3.3 闩锁 census
- [ ] 先红：①isValidDocName 翻转（要求段）——现拒带段=红②裸构造静态门红（39 处）③4410 后 provider-only recovery 同 doc 复用=红（G7）
- [ ] buildDocName(pid,g) 唯一构造器+全部改道+census 门进 verify fast；DocKey={pid,g}（documentName 承载）覆盖 registry 12+persistence 10 张表（清单=Phase 0 census）；spool 段键 `.g${N}.`；三层 fencing（onAuthenticate 段 vs DB 列 hardClose 4410 携 g/onLoadDocument 再核/append 已 T7）；4410 消费=完整新会话（拆 observers/UndoManager/cache writer/provider→destroy→新 doc）；公开快照键 (pid,g,appendSeq)；csv=4（shared 单源——65accbe7 纪律）
- [ ] 闩锁删除（census 定位 Y1b §3.3 resync 域→删→Y1b 只读域回归全绿 G11）
- [ ] G6-G8+B1 世代维度用例+两浏览器换代预演→**-1a 出口=用户确认点②**（G1-G11+B1-B4+verify 全绿+世代切换演练证据）→Commit。

## 片 -2a：内容（T12-T15）

### Task 12: 纯文本 Y.Text 分型+content 分键物理迁移（G15）
**Files:** docShape/canvasIntents canApplyIntent seam；audioGen 读写面（AudioConfigPanel 等）；nodeStore 文本域
- [ ] 先红：整串覆盖写被拒（现 getHTML/整串 diff 形态=红）；audioGen doc 键 content→prompt 迁移（现无=红）
- [ ] Y.Text 域（audioGen.prompt/imageGen·videoGen.prompt.text/multiImageGen.prompt=text 类型）：splice 单一 seam（canApplyIntent 前置——整串覆盖拒绝）；audioGen content→prompt 键迁移（DocCodec transform v3→v4-draft；读者同卡改道）；结构上限（节点数/data 字节/文本长度——字节计不分类型）+单键 256KB 间隔门
- [ ] IME composition/粘贴/选区/两端同位插入并发用例（双 client 真并发）绿→Commit。

### Task 13: 嵌套 XmlFragment+y-prosemirror 绑定（G16）
**Files:** TextInputNode.tsx+TextNodeFullscreen/TextNodeToolbar/prompt-input/PromptInput；apps/web package.json（y-prosemirror exact pin=T0 调研版）
- [ ] 先红：现 getHTML 整串写 data.content=红（tree 有效性断言：两客户端格式化合并后树合法）
- [ ] `nodes[id].data.content`=嵌套 Y.XmlFragment（容器唯一创建=T14 规则）；`editor.registerPlugin(ySyncPlugin(fragment))+yUndoPlugin`（StarterKit `history:false`）；快捷键归属（文本焦点内 Ctrl+Z=编辑器协作历史——focus 判定）；全屏/工具栏复用同一 editor 实例；PromptInput 面按 T3 表（Y.Text 域不走 XmlFragment）；HTML 仅渲染/导出（getHTML 只读）
- [ ] 并发格式化/删除节点 fragment 随子树/undo 重建 fragment 恢复用例绿→Commit。

### Task 14: 唯一创建者+incarnation（G17/B10）
**Files:** canvasIntents 写路径+collab-doc-writer；NodeLifecycle 写接点（表已 T6）
- [ ] 先红：两副本并发同 key 建容器→旧路径败者字段不可见=红；替换 live 容器现放行=红
- [ ] 容器创建规则：结构创建时一次性建（叶子只取现有；缺=拒绝/等待）；**undo 重建合法**（incarnation=Item(clientID,clock)——`nodes._map.get(id)` Item 身份提取器）；恢复不得夹带服务器字段（服务端键集校验）
- [ ] B10 用例（delete→undo→re-delete 新 incarnation/delete→refund→undo 不继承取消/替换 live 拒）绿→Commit。

### Task 15: RetentionCoordinator+bounded undo（G19/B16）
**Files:** apps/web/src/collab/retention-coordinator.ts（新）；canvasUndo.ts:13,:41-42
- [ ] 先红：**shift 泄漏**（STACK_LIMIT 截断后 encodeStateAsUpdate 字节不回落=红）；清一个管理器后另一个 undo 恢复空（多管理器用例=红——探针语料入测试）
- [ ] 文档级协调器：登记画布+每编辑器管理器 undo/redo/popped/redone/祖先依赖；**挂 afterTransaction 重建 keep 并集**（Transaction.js:313-325 时序）；drop 算祖先闭包 keepItem(false)；gcFilter 与显式 tryGc 同判定（非重入窗口）；fail-closed 保留；预算单管理器 100 项/4MiB+文档级 16MiB 去重计费；明确过期策略退休最旧；TypedDraft（DraftEnvelope 消费端——结构/文本类型化草稿重生成）
- [ ] B16 全组（清一个/关编辑器/redo 清栈/tryGc 祖先）+G19 绿→Commit。

### Task 15b: 完整重建序列化+时间轴（G18）
**Files:** doc-codec（全类型 encodeNode 扩 XmlFragment/嵌套）+rebuild 路径（registry rebuildVacuumDoc 换 DocCodec）+VideoProject.data 时间轴迁移
- [ ] 先红：rebuildVacuumDoc 非 Map 根降级=红；时间轴域双写=红
- [ ] DocCodec 全类型 round-trip（v3→v4-draft 纯函数变换+语义 fixture=Phase 0 冻结语料）；时间轴真实消费者迁移（未迁移功能留原真源）→G18 绿→**-2a 出口=用户确认点③**→Commit。

## 片 -1b：准入（T16-T19）

### Task 16: FrameGate 串行窗+三档判定器（G12/B5/B8/B9）
**Files:** collab-frame-gate.service.ts（新）；collab-admission/{decoder,parent-chain,provenance,policy}.ts（新）；collab-server.factory.ts:59-63（afterHandleMessage 接线）；registry guardSyncFrame 收编
- [ ] 先红：①A.check/B.check/A.apply/B.apply 交错（两连接并发写受保护根——现各连接独立排队=红）②SS2 全量帧写 exec=红（现 guardSyncFrame 不做语义判定）③伪造 server clientID（provenance 未命中）=红④部分应用语料（Phase 0 bit-flip 集——先 decode 拒）
- [ ] 三档 policy（TS 单源）：

```ts
type Verdict = { tier: 'DENY'; reason: string } | { tier: 'NORMALIZE'; anomalies: GraphAnomaly[] } | { tier: 'ACCEPT' };
// DENY 面（DOC_SCHEMA_V4 权限/预算）：写 exec/meta/服务器字段·替换 live 容器·重复创建 live nodes[id]
// ·DS 删 live 受保护·provenance 未命中·未知类型/键/值类型·超预算(maxStructs/maxDsRanges/maxFrameBytes)
// NORMALIZE 面：悬挂边/父链环/跨组 parent/重复边（读侧规则=renderCanvas 收编 shared 单源；只读不写回；graph_anomaly_total 告警）
```

- [ ] beforeSync 获取 {project,g} 令牌（覆盖 SS2+Update——SS2 独立字节/struct 预算；awareness/stateless 不过闸）→decode structs+DS→父链上溯→受保护判定→provenance 精确命中（CanvasDocProvenance 查询）→持令牌到 apply 完成→afterHandleMessage 幂等令牌匹配释放；beforeHandleMessage 抛错自释放路径；候选帧校验受影响节点（运行时 manifest 准入面——键/值类型/字节/nodeId 语法/每节点键数）；每帧 trace 五段耗时
- [ ] fuzzer（Phase 0 语料+CI corpus）+B5/B8/B9 全组绿→Commit。

### Task 17: y-protocols patch fork+后置校验（G12/B5 部分）
**Files:** patches/y-protocols@1.0.7/（pnpm patch）；collab-frame-gate（SV 对比）
- [ ] 先红：apply 抛错后客户端收到 success ACK=红（现 sync.js:82-89 吞错）
- [ ] fork 只改 readSyncStep2/readUpdate：apply 异常重抛（错误对象携 frameId）；Hocuspocus MessageReceiver 路径 ACK 在 apply 成功后（gate 包裹）；patch 校验和进 CI（package-resolved hash 变=红）+上游 PR 留证；广播在受理成功后（Document.handleUpdate 前 gate 闸）；**后置校验**：beforeSync 记预期 SV/事务计数→afterHandleMessage 对比不一致=隔离重载共享文档及全部相关连接
- [ ] B5 observer 抛错用例（不假 ACK/广播不确认半成品/PG 重载）绿→Commit。

### Task 18: 拒帧恢复协议（G12d/B6/B7）
**Files:** apps/web/src/collab/rejected-recovery.ts（新）；canvasCollabRuntime.ts（diverged 通路扩展 :1743-1761 基础上+incarnation fence）；DraftEnvelope shared 类型
- [ ] 先红：①被拒后重复 apply 服务器态到旧 doc「修复」=红（CRDT 单调性反例语料）②旧 tab 迟到写覆盖 diverged 缓存=红
- [ ] REJECTED/DIVERGED 状态机：停上传+DraftEnvelope 草稿（typed/versioned/project/generation/schema/checksum）→持久 diverged（复用 bootRecord.diverged）+incarnation/version fence（多标签通知）→同代 authoritative fresh Y.Doc（全拆卸——复用 4410 重建机械）→语义差异 UI+新 struct 身份重生成（TypedDraft）→完成/放弃后切缓存 incarnation；RESYNC_REQUIRED 先 pull-only 再重放；pending 因果分档（clean 补依赖/diverged 只 rebase）
- [ ] B6（三档语义：合并冲突 NORMALIZE 收敛+DENY 违规 fresh 收敛）/B7（多标签/重启/IDB blocked）绿→Commit。

### Task 19: 生命周期受理+保存屏障+ServerDocWrite/审计（G13/G14/B11/B12）
**Files:** collab-lifecycle-admission.service.ts（新）；collab-persistence（marker 入口）；collab-doc-writer.service.ts（ServerDocWrite 统一）；collab.gateway（save-barrier 消息）；DocWriteAudit 表迁移补列
- [ ] 先红：①删除节点后取消义务无持久提交点（poller 懒观察竞态——删 A/并发 finalize 两序反例）=红②Sync ACK 后 PG 前 kill 界面称已保存=红③服务端写零审计=红
- [ ] 生命周期效果提取（窗口内前态/后态 diff→created/restored/deleted+引用增删→NodeLifecycle/DeliveryFence 同事务：内容增量+义务+receipt——锁序 §2.10 核对）；commit token 防 listener 二次排队；媒体引用核验未入删除 claim；**ServerDocWrite**：WriteContext{actor,command,g,epoch}+apply+捕获 update+同 PG 事务 append+DocWriteAudit；withDoc/withSession 写面 census 迁移；**保存屏障**：flushPendingUpdates→marker(nonce+sessionEpoch+g+edit watermark)→被 await 有序入口→等前缀进 PG→(nonce,g,committedSeq)；**barrier forces flush**（触发即冲刷 debounce）；拒帧连接屏障不可成功；本地缓存单快照+savedSeq/stateVector
- [ ] B11/B12（两序事务赢者裁定）+G13/G14 绿→**-1b 出口=用户确认点④**→Commit。

## 片 -2b：exec（T20-T23）

### Task 20: NodeExecution/ExecutionOutbox+执行输入快照+writer 迁移（G24/B14）
**Files:** schema.prisma 迁移二；projection-outbox.poller.ts；collab-document.service.ts（writeExecStatus 族退役）；execution.service.ts:183,:512（claim 输入改读 PG）
- [ ] 先红：①无 artifact 的 loading 事件无法落表（现 ArtifactProjection 形状）=红②claim 时活读 doc（改 prompt 后执行内容漂移——重放用例）=红
- [ ] 表形：`NodeExecution(projectId,nodeId,execSeq BigInt,eventVersion Int,status,…)`+`ExecutionOutbox`（kind=runtime|artifact；partial unique：runtime `UNIQUE(intentRowId,execSeq,eventVersion,kind) WHERE artifactId IS NULL`/artifact `UNIQUE(artifactId,artifactRev) WHERE artifactId IS NOT NULL`）；eventVersion 与状态/outbox 同事务；mark CAS=generation+runId+期望状态（代变返回 pending 不耗 attempts）；**inputSnapshot Json?** 受理事务写入（{promptText,promptHtml?,upstreamMediaIds[]}）——claim/worker 只读 PG；writer API 迁移表（claim loading/skipped/error/deliver/replace/clear/sweepOrphan→分派）
- [ ] B14（并发新版本与旧 mark 不丢唤醒）+kill 恢复 30s 锚用例绿→Commit。

### Task 21: doc.exec 扁平组件键+单展示源（G21/G22/G27/B13）
**Files:** collab-document.service.ts（投影写者重写）；web execStatusView/读面
- [ ] 先红：现嵌套 Y.Map 形状（new Y.Map() 建）=红（断言扁平键）；旧 done 整条覆盖回滚已清槽位/新 loading 吞旧槽位（B13 两反例）=红
- [ ] `execution:<nodeId>`/`artifact:<nodeId>:<slot>` plain object 整条原子替换（Y.Map 顶层键——无嵌套共享类型）；**BigInt wire 显式 String()+bigint-json gate**（BigInt toJSON 守卫进 verify——防 JSON 序列化丢精度）；单服务端写者（dispatcher 读 PG 快照+commit-time fence：GI 代际+eventVersion+每槽位 rev+节点围栏+doc g/epoch+outbox runId）；execution 按 (execSeq,eventVersion) **数值序**（BigInt 解析比较——string 字典序禁）；删节点前缀清/读取前缀合成；**单展示源=doc.exec**（冷装载前服务器对账回投；stateless 仅 wake-up）；attempts→execSeq 守卫切换（applyWriteExecStatusToDoc:307-325 重写）
- [ ] G21/G22/G27+B13（数值 10/9/旧 done/新 loading）绿→Commit。

### Task 22: 换代/恢复重投影+watermark（G26/B15）
**Files:** projection-outbox.poller.ts（g 维度+watermark）；registry（冷装载对账）
- [ ] 先红：mark 无 generation 维度（lease 不变 g 变场景误标 projected）=红；换代后 exec 照搬旧代=红
- [ ] execProjectionWatermark(per pid,g)持久——冷装载只补 eventVersion>watermark，换代/恢复/人工修复全量；mark 验证 g+runId；换代重建复制用户内容+exec 从 PG 派生；读侧先查 node 存在后取 exec（孤儿不独立为真）；恢复三态（已退款=已取消需重新生成/在飞=真实 loading/完成=当前槽位）
- [ ] B15（旧 projected 事件/新代冷开缺 exec 不被 dedup 屏蔽）绿→Commit。

### Task 23: 退款代际+物化 run fence（G25/B12/B17）
**Files:** materialize-job.service.ts:175-197,:441-482；team-credit.service.ts:257-284
- [ ] 先红：旧 run 读 lease 通过后新 run 接管完成→旧 run 仍退款（时序交错用例）=红；rollback CAS 仅 status 维度（rearm 后旧代迟到退款误命中）=红
- [ ] materializeRunId/epoch claim（leaseUntil 只控接管）；终态失败事务同校验 runId+status+execSeq+产物身份→持久 RefundObligation（只有裁定赢者安排冲销）；完成事务同 run fence+终态互斥；退款异步重试引用 exact settle row+幂等 reversesId；rollback 族全补 expectedExecSeq+精确 ledger 行身份
- [ ] B12/B17（两序赢者/退款失败可重扫）绿→**-2b 出口=用户确认点⑤**（G21-G27+B11-B15+B17+kill 恢复锚）→Commit。

## 片 -3：门禁（T24-T27）

### Task 24: 读者改道+字段删除同单元（G28）
**Files:** web 全读者（Phase 0 census 27 处/14 文件）+media-refs.ts:70-89（随迁+exec 扫描增补）+snapshot-filter util:133+execAligned/data.status fallback 删除
- [ ] 先红：改道后删 data.fileId/result/status 写者→任一读者 broken=红（census 门）
- [ ] 全读者投影合成改道（图像完成判断/工作流素材/媒体引用/复制粘贴/公开快照/binding/事实订阅/执行输入）；execAligned 与 data.status fallback 删除（execStatusView 收单源）；collectMediaRefs 增补 exec 前缀扫描；公开快照缓存键 (pid,g,appendSeq)+doc-saved 失效+服务端 sanitize+URL allowlist+exec 产物按分享策略过滤
- [ ] G28（broken reader 零）绿→Commit。

### Task 25: E68 执法+manifest 断言族（G29/G32）
**Files:** shared 不变量表（五条三列）；check-collab-census 扩（新字段未分类红+运行时面共用）
- [ ] 先红：不变量缺口（环/悬空边读侧未屏蔽——NORMALIZE 规则未收编）=红；未分类新字段=红
- [ ] 五条三列落地（读侧全函数+NORMALIZE 单源 shared/写侧业务写拒绝/禁修复写回）；静态断言族（DOC_SCHEMA_V4 与运行时 policy 共表）；execute topology 数量断言
- [ ] G29/G32 绿→Commit。

### Task 26: reservation 状态机+GC delete-claim（G30/G31/B18/B19）
**Files:** schema.prisma 迁移三（StorageReservation 状态机列+ObjectManifest 表）；safe-remote-fetch.service.ts:91-94（cap 参数化）；media-gc.service.ts:113-194（claim 化）；storage-quota.service.ts
- [ ] 先红：①lease 过期但 provider/UNKNOWN 在飞→reservation 被释放（oversale）=红②GC 扫描与新引用交错误删=红③付款后超 cap 删已付产物=红
- [ ] StorageReservation 状态机（operationId 唯一+state+leaseUntil——终态 NO_SUBMIT/CANCELED/FAILED 赢得后条件 release；**upperBoundBytes cap 传入 fetch/materialize**（签名加 bytes 参数——全局 env 兜底）；付款后超 cap=持久失败+精确退款；套餐降级不压缩既有（新预留按新限制））；ObjectManifest staged/committed/delete-claimed/deleted——GC PG 条件事务 claim+引用创建/finalize/重试 put 核验尊重 claim+在飞 PUT 排空或版本 fence+晚到补偿；重复 confirm 零副作用；G31 改有界 orphan（零误删+零重复+临时 orphan 有界回收）
- [ ] B18/B19 全组绿→Commit。

### Task 27: 客户端增量投影+规模化（G33/G33b/B20 部分）
**Files:** canvasCollabRuntime.ts:1958-1990,:1308-1358（增量）；不变量检查迁移；provider/ws 压缩或 HTTP seed
- [ ] 先红：远端单节点变更触发全量 setState（性能断言：changed-node patch 计数）=红；10k/8MiB 冷开>3s（基准红——记录基线）
- [ ] YEvent path[0] 收集变更节点→只 patch 变更（未变保引用；结构变更才 reconcile；nodes map 结构共享）；不变量检查出热路径（采样/批量/worker）；**8MiB SS2 实测二选一**：permessage-deflate（ws 服务端+provider 两侧）vs HTTP seed（REST 快照端点+SS2 diff）——实测冷开 P95 决定，另一形态登记弃用原因；双负载验收（10k 短节点+8MiB 混合+10 连接真实并发：P99≤50ms/changed≤delta/冷开 3s/事件循环/heap/压缩写放大）
- [ ] G33/G33b 绿→**-3 出口=用户确认点⑥**→Commit。

## 批末：发布（T28）

### Task 28: v4 发布单元（B20/发布门）
**Files:** docShape.ts（docSchema=4 置位——批末一次性）；deploy.sh:134-159+gate-decision.mjs:15-35；collab-ops-runbook.md
- [ ] 先红：gate 判据不含 storeInFlight/stranded 阻断=红；deploy 在旧消费者在线时 reset=红（顺序断言）
- [ ] docSchema→4+CANVAS_DOC_SCHEMA_VERSION 同刻；破坏性发布流程（外层维护关写→严格 drain 六元组→**停全部旧 api/worker DB 消费者**→allowlist 测试 reset/schema deploy→部署→种子/准入/投影就绪检查→启动 worker→开放写）；gate 扩 storeInFlight 进判据+stranded 阻断+无法观测=阻断；两浏览器换代+多标签 IDB blocked+kill 每 stage 演练+B20 双负载实弹；耐久性已知限制登记（dev/test RPO=24h；生产门=PITR/restore drill/replay canary）
- [ ] 发布门全绿→**全批终出口=用户确认点⑦（证据汇编呈报）**→Commit。

---

## §0 执行期偏离登记（滚动）

| # | 偏离 | 卡 | 依据 |
|---|---|---|---|
| （执行期填写） | | | |

**门禁→任务映射总览**：PC1=T3/T4/T5｜PC2=T1/T2｜PC3=T5｜G1=T6｜G2/B1(世代)=T7｜G3=T9｜G4=T7/T11｜G5/B4=T6/T7/T8｜G6-G8=T11｜G9/B2/B3=T6/T10｜G10=T10/T15b｜G11=T11｜G12/B5/B8/B9=T16/T17｜G12b/B6=T16/T18｜G13=T19｜G14=T19｜G15=T12｜G16=T13｜G17/B10=T14｜G18=T15b｜G19/B16=T15｜G20=T12｜G21-G22/B13=T21｜G23/B11=T19/T23｜G24/B14=T20｜G25/B12/B17=T23｜G26/B15=T22｜G27=T21｜G28=T24｜G29/G32=T25｜G30/B18=T26｜G31/B19=T26｜G33/G33b=T27｜B7=T18｜B20=T28。
