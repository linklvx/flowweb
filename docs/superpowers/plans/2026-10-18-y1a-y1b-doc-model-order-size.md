# Y1a+Y1b：doc 模型 v3·序与尺寸/只读 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

<!-- plan v8（2026-10-18）：三份 v7 外审高度收敛+三并行核验坐实+挖出三现存 bug 后四用户裁决落地（2026-10-18 八次确认）——v10 五大换代方向维持，本轮收敛为**单一代际/单一 epoch/单一事务**。**四裁决**：①**repair 换轨方案 A**（推翻 v10 裁决③——repairRev 三致命缺口实证〔客户端 URL 只 csv/cb 无自报 rev runtime:1572；doc-status dedup=${state}:${frozen}+客户端 msg.rev<=last return 吞 rev 变化；repair 不改 SV preVacuumSv 检测不到〕：repair=一次 generation 跳变的 doc rewrite——vacuumGate 互斥→beginVacuumEra 冻结+4410→quiesce〔writesSettled 覆盖服务端 outbox——DocDelivery/attach 维护门 503 退避〕→离线重排→**等价断言=忽略 order|slot 的节点/边/data 等价**→单事务 vacuumReplace〔state+preVacuumSv+generation+1〕→客户端零新协议〔preVacuumSv 内容级 fence+consumeGenerationJump 单链+IDB 四维键联动〕；**repairRev 删除**；ack 降 UX；**purgeForeignCaches 反语义 bug 同修**〔现状传会话旧键=保留脏代删其他代 local-cache-key:71〕）；②**全局单调 execSeq+三硬约束**（**DB sequence nextval 分配三处**〔new claim/同 jobId 重入/rearm〕禁 increment/max+1；DB BigInt wire/doc 用 string 守卫 BigInt 比较；进 exec 守卫/finalize CAS/唯一键+job data+onTick/reanchor+**reserve/reservedExecSeq+void_/settle CAS**+同 job 重入 claim 事务内 reservation 继承+旧 execSeq void/settle 一律失败；attempts=免费重试配额不混用——反例 A〔同 job stalled 重排 processor:40+重入不递增 attempts generation-intent:130/:158〕/B〔exec 守卫只比 attempts 不比 intentId document:313-331——**新 intent 的 loading/done 被旧 done 永久拦截=现存 bug**〕/C 三实证）；③**producer 分两层=一个 Media 写入服务+两个编排器**（**MediaRegistrationService=唯一 Media 写入点**：register/confirm 两形态共用 sniff/MIME/quota/probeState/natural 初始化+registerInTx/confirmInTx/bindInTx **禁止第二处 media.create/bindMedia**；ArtifactCommit=资金五路径〔text/image/video/edit/lighting〕finalize 事务内调 registerInTx+execSeq CAS+settleInTx+complete+DocDelivery；非资金六路径〔upload confirm/stitch/trim/separate/copy/export〕走 MediaRegistration **不碰 settle/complete/DocDelivery/exec**——四路径零 GenerationIntent 实证；非资金幂等锚 registrationKey=taskId+artifactIndex|mediaId|exportRequestId+Media @@unique(bucket,key)；非资金零 doc 写 attach consumer 交付；**不造 creditCost=0 intent**；两层只共享 Media/linkMedia 原语）；④**DocDelivery=typed flush+批量+复核**（withSession(write) 增 flush:true+**flushDocument(pid):'appended'|'noop'|'spooled'|'terminal'|'failed'**〔storeDocumentSerialized/saveMutex〕；只有 appended〔或 noop∧isPersistedComplete∧目标匹配〕才 delivered；**spooled≠delivered** 继续重试不耗 maxAttempts；按 project 批量一个 withSession 全 apply 后一次 flush；flush 后复核 target/execSeq/expectedValue→superseded/orphaned/delivered；lease 覆盖 flush+recheck+mark；delivered=PG 至少一次；**withSession 写后 debounce 未落库实证 residency:459-468——mark delivered 撒谎根修**）。 -->
<!-- v8 同批收编：**锁序契约 20**（finalize 先 lockBalance 再 CAS intent——credit-ledger:58 注释+reserve/settle/void/rollback 四处先 balance；先锁 intent=ABBA 死锁）+**InTx 方法族**（completeInTx/settleInTx/createXxxInTx——complete 根 prisma:255+settle 自开事务:132 根修）+finalize 幂等检查事务内 CAS 前+40P01 有界重试 3 次 jitter；**唯一键全带 execSeq+artifactIndex+targetItemId**（稳定 ImageItem.id——删除/重排按 id 现算实证 targetIndex 会漂移）；**对象 key=artifacts/{teamId}/{intentRowId}/{execSeq}/{index}-{sha256}**+If-None-Match+hash 校验+orphan sweep 前缀+龄阈值；**旧 reconcile 三后门删除**（backfillSucceeded:215 直接置 SUCCEEDED/threeCheck resultRef:244/settleStranded probeArtifacts→**不变量巡检**〔SUCCEEDED⇒stored∧Media∧settled——告警人工不自动退款〕）；**rearm 事务**（execSeq nextval+reservation 继承+旧 outbox superseded+**资金归一化**〔rearm 残留冻结 mayCall:false 静默跳过外呼=现存 bug team-credit:102+execution:325〕）；**worker 端点 op 白名单 exec-only**（fileId/resultUrl 在服务端白名单内 write.controller:32+manifest:83——收窄）；**MediaFactOutbox 替换 probedAt watermark**（事务乱序提交必漏实证；factVersion 单调/pending 行+SKIP LOCKED/probe·server-natural·attach 三写入点/来源 union(Media.projectId,binding)/重启零回放/emitter 单实例假设显式化=instances:1 多实例归 Y7）；**MIME 全链**（file-type 库+**API 代理流式 /api/media/:id/content 按 sniffedMimeType 设 Content-Type+attachment+CSP sandbox+生产 MinIO 直链禁用**+presign Content-Type 条件+SVG 拒+sharp 重编码剥载荷+Media.size BigInt〔Int 2.147GB 上限〕+**生产上传 /flowai 渗透修复**〔mediaUploadUtils:31 dev 假设——生产 MinIO 直连下无背书〕）；probe（**图片批 4 lease 180s/视频 batch 1 lease 5min**〔批 2×90s 覆盖不了下载+ffprobe〕/nextProbeAt jitter/claim 按 sniffedMimeType 路由〔伪报 audio 的图片不再永 skipped〕/索引 [probeState,nextProbeAt]/40MP+downscale 产品策略）；text 90 天（resultText 非空行延长）；exec error reconcile 活跃项目过滤+24h 窗；attach=只填空/replace=显式命令；观测+8 指标；**每卡真 PG 并发用例**（A3 不够早）；**交付 owner 唯一**（资金型=DocDelivery；binding 对 sourceIntent 非空跳过 fileId 写）。外审误判修正：生产 /flowai 同源直出不成立（MinIO 域名直连——上传侧渗透才是真问题）；reconcile 带状态+时间窗非全表；multiImage targetIndex 漂移不成立（UI 按 id 现算）。 -->
<!-- 执行纪律核心：plan 中每个被调用的 API/类型/DI 令牌/进程形态，写码前 grep 实证。行号=2026-10-18 快照。**每卡先红须含真 PG 并发用例（锁序/双 claim/崩溃窗）——mock 测不出代际/锁序问题。** -->

**Goal:** 落地 doc 模型 v3——placement 复合单键序域（order|slot+vendor+等值键）+Media 读模型（REST/**MediaFactOutbox**/快照 join+probe+MIME 全链）+**execSeq 单一代际**（资金 ArtifactCommit/非资金 MediaRegistration 两编排器+flushDocument 持久化交付）+WriteOutcome+fileId 收口+只读双层+双 bump，批出口=verify 全绿+门禁全过+四曲线+资金矩阵含代际/锁序/flush 崩溃窗。

**Architecture:** doc=nodes/edges+exec+meta（四根不动）；Media 表=媒体事实权威；**execSeq=全局单调执行代际（DB sequence）**；资金=ArtifactCommitService（lockBalance→intent CAS→registerInTx→settleInTx 单事务）；非资金=MediaRegistrationService（唯一 media.create 点）；交付=DocDelivery（deliverArtifact 复合 op+**flushDocument 五态**+复核）；facts=MediaFactOutbox（pending 行无 watermark）；repair=**generation 跳变**（vacuum 协议复用）；排序单实现（slot 派生）；双 bump 版本门。

**Tech Stack:** TypeScript strict / Yjs exact 13.6.32 / Hocuspocus 4.6.0 / NestJS / sharp exact 0.34.5（40MP+并发 1）/ ffprobe 8.1.2（CI/部署 pin）/ fast-deep-equal / **file-type** / vitest / node:test。

**执行纪律：** 每卡先红（真实变红+**真 PG 并发用例**）→绿→commit；写码前 grep 实证；三面 tsc；文档 diff；每片出口用户确认。

## 文件结构（触碰面全景·v8）

| 文件 | 动作 | 责任 | 片 |
|---|---|---|---|
| 根+apps package.json / ci.yml | 改 | T0 pin（yjs/sharp/fast-deep-equal/**file-type**+ffprobe CI/部署） | P0-pre |
| docShape.ts+全仓 ~141 处 | 改 | T1 改名 StoredNodeRecord | P0-pre |
| scripts/check-plan-census.mjs | **建** | census | P0-pre |
| collab-doc-ops.ts | **建** | 写原语+类型同迁 | P0-pre |
| apps/api/prisma/schema.prisma + migration | 改 | T3 全量（**exec_seq DB sequence**+probe 族+factVersion+MediaBinding+artifactState+DocDelivery+**MediaFactOutbox**+Media 补列） | P0-pre |
| shared/src/canvas/media-fact.ts | **建** | MediaFact+mediaRefsOf 七键 | C0b |
| media-facts.controller.ts + media-fact-emitter.ts | **建** | REST（IDOR 校验）+**outbox emitter（SKIP LOCKED）** | C0b |
| media-probe/media-probe.poller.ts | **建** | probe 单相（批/lease 分型+sniffed 路由） | C0b |
| execution/artifact-commit.service.ts | **建** | **资金 finalize（lockBalance→CAS→registerInTx→settleInTx）** | C0b |
| media-registration/media-registration.service.ts | **建** | **唯一 Media 写入点（registerInTx/confirmInTx/bindInTx）** | C0b |
| media-delivery/attach-consumer.poller.ts | **建** | attach 消费者（linkMedia CAS+targetItemId） | C0b |
| execution/delivery-outbox.service.ts | **建** | DocDelivery（deliverArtifact+**flushDocument+复核**）+exec error reconcile | C0b |
| collab/collab-media.controller.ts | **建** | attach/replaceMedia 端点+repair 端点（vacuum 协议） | C0b/A2 |
| media.service.ts + media-content.controller.ts | 改/建 | **GET /api/media/:id/content 代理流式（Content-Type/attachment/CSP）** | C0b |
| collab-write.port.ts + controller | 改 | WriteOutcome+同值 no-op+**端点 op 白名单 exec-only** | C0b |
| execution/ + intent-reconcile + team-credit + generation-intent | 改 | T6 execSeq 链路+InTx 族+**后门删除**+rearm 归一化 | C0b |
| collab/collab-residency.service.ts + collab-persistence.service.ts | 改 | **withSession flush:true+flushDocument 五态**；MAINTENANCE origin | C0b/A2 |
| shared/canvas/placement.ts / order-key.ts / order-records.ts / validate·normalize | **建** | placement 判别/vendor/deriveStoryboardCells/五路径 | A1 |
| web/canvas-allocator.ts | **建** | allocator+等值键+slot 重映射 | A1 |
| collab/collab-pathology.ts | **建** | soft/hard+**repair=vacuum 协议复用**+purgePidCaches 修复 | A2 |
| collab/collab-content-guard.ts | **建** | guard（exec+身份键域） | A2 |
| scripts/collab-repair-doc-order.mjs | **建** | CLI | A2 |
| collab/collab-harness/ | **建** | 双端真连+**execSeq/flush/repair-vacuum 故障注入** | A3 |
| web utils/stores + groups/ + 三组件 | 改 | order/slot 写链+身份键不回送+**cells 消费面**+ImageItem 去 url | C0b/A1/B2 |
| web/src/utils/mediaUploadUtils.ts + mediaApi.ts | 改 | **生产 /flowai 渗透修复**（环境感知改写） | C0b |
| video-work/snapshot-filter.util.ts + video-work-clone.service.ts | 改 | FilteredNode+公开 natural+cells 删 | C0b/A1 |
| shared/types/group.ts + storyboardConfig.ts | 改 | GROUP_NODE_DATA_KEYS 删 cells+capacity 派生 | A1 |
| scripts/dev-reset-canvas.mjs | **建** | 六表清+双 bump 演练 | B3 |

**不动红线**：NODE_ENVELOPE_KEYS；exec 域写面；ecosystem 双进程；doc-status generation 跳变消费链；DOC_TOP_LEVEL_MAPS 四根；Y1c-1 世代段。

---

## 片 P0-pre：机械前置（T0-T3——零行为变更）

### Task 0: exact pin+ffprobe CI/部署 pin
**Files:** 两 package.json（yjs/sharp exact+**fast-deep-equal+file-type**）+overrides+ci.yml（ffprobe 安装 pin）+media-process（版本探测）
- [ ] 先红（pin+CI ffprobe 步）→实现+Commit。

### Task 1: DocNodeRecord→StoredNodeRecord 单 commit 改名
- [ ] census→改名→三面 tsc+全量绿→Commit。

### Task 2: 抽 collab-doc-ops.ts 纯模块
- [ ] 原语+类型同迁+环检测零命中→Commit。

### Task 3: Prisma 全量迁移（v11 表结构）
**Files:** schema.prisma+migration（`execseq_outbox_registration_flush`）

- [ ] **Step 1: schema**

```prisma
// DB sequence（migration SQL: CREATE SEQUENCE "exec_seq" AS BIGINT）
enum ProbeState { pending running done failed skipped }
// Media 增列（v11）
probeState ProbeState @default(pending)  // confirm 后按 sniffed 重算
probeAttempts Int @default(0)
probeError String? @db.VarChar(512)
probeFailureKind String?
probeLeaseUntil DateTime?
probeRunId String?
nextProbeAt DateTime?                   // jitter 退避
probedAt DateTime?                      // 仅审计
factVersion BigInt @default(0)          // v11：单调事实版本（每次 natural/sniff 变更+1）
naturalWidth Int? / naturalHeight Int?  // display
naturalRotation Int?                    // 血缘
naturalSource String?
sniffedMimeType String?
sourceIntentRowId String?               // 资金型锚（=GenerationIntent.id）
sourceExecSeq BigInt?                   // v11：代际（替代 sourceAttempt）
sourceRegistrationKey String?           // 非资金幂等锚（taskId+index|mediaId|exportRequestId）
artifactIndex Int @default(0)
objectKey String? / objectSha256 String?
size BigInt                             // v11：Int→BigInt（2GB 上限根修）
bindings MediaBinding[]
@@unique([bucket, key])                 // v11：对象级幂等
@@unique([sourceIntentRowId, sourceExecSeq, artifactIndex])  // 资金型 finalize 幂等
@@unique([sourceRegistrationKey])       // 非资金幂等（nullable unique）
@@index([probeState, nextProbeAt])
@@index([sourceIntentRowId, sourceExecSeq])
```

```prisma
enum AttachState { pending attaching attached orphaned superseded failed }
model MediaBinding {
  id String @id @default(cuid())
  mediaId / projectId / nodeId / teamId String
  role String @default("primary")
  targetField String @default("fileId")    // fileId|referenceImage|images|allImages
  targetItemId String?                     // v11：稳定项 id（ImageItem.id）——非漂移 index
  expectedValue String?                    // attach=空（只填空）；replace 走显式命令
  attachState AttachState @default(pending)
  attachAttempts Int @default(0)
  nextAttachAt DateTime @default(now())
  attachLeaseUntil DateTime?
  attachRunId String?
  attachedAt DateTime?
  maxAttempts Int @default(10)
  lastError String? @db.VarChar(512)
  createdAt DateTime @default(now())
  media Media @relation(fields: [mediaId], references: [id], onDelete: Cascade)
  @@unique([mediaId, projectId, nodeId, role])
  @@index([attachState, nextAttachAt])
  @@index([projectId, nodeId])
}
```

```prisma
enum ArtifactState { stored failed }
// GenerationIntent 增列（v11）
execSeq BigInt @unique                    // 全局单调（exec_seq sequence nextval）
reservedExecSeq BigInt?                   // reserve 时写；settle/void CAS 匹配
execProjectedExecSeq BigInt?              // error 投影代际（替代布尔标记）
artifactState ArtifactState?
resultText String? @db.Text
@@index([status, artifactState])
@@index([status, execProjectedExecSeq])
```

```prisma
enum DeliveryState { pending delivering delivered orphaned superseded failed }
model DocDelivery {
  id String @id @default(cuid())
  intentRowId String
  execSeq BigInt                          // v11：代际快照
  projectId / nodeId String
  kind String                             // text|resultUrl|videoUrl|fileId
  payload Json?
  artifactIndex Int @default(0)
  targetField String @default("fileId")
  targetItemId String?
  expectedValue String?
  state DeliveryState @default(pending)
  attempts Int @default(0)
  leaseUntil DateTime?
  runId String?
  nextAttemptAt DateTime @default(now())
  maxAttempts Int @default(10)
  deliveredAt DateTime?
  lastError String? @db.VarChar(512)
  createdAt DateTime @default(now())
  @@unique([intentRowId, execSeq, nodeId, kind, artifactIndex])  // v11：含代际
  @@index([state, nextAttemptAt])
  @@index([intentRowId, execSeq])
}
```

```prisma
model MediaFactOutbox {                   // v11：替换 watermark
  id BigInt @id @default(autoincrement())
  mediaId String
  projectId String                        // union(Media.projectId, binding.projectId)
  factVersion BigInt
  payload Json                            // {natural:{width,height}}
  state String @default("pending")        // pending|published|dead
  attempts Int @default(0)
  nextAttemptAt DateTime @default(now())
  leaseUntil DateTime?
  publishedAt DateTime?
  createdAt DateTime @default(now())
  @@index([state, nextAttemptAt, id])
}
```

- [ ] **Step 2: migration（含 CREATE SEQUENCE exec_seq）+fresh replay 必验**。
- [ ] **Step 3: Commit**。

**片 P0-pre 出口**：三面 tsc 绿+全量绿+census+pin 绿。

---

## 片 B1a（必做）：只读命令门（T4）

### Task 4: canEditCommand 单源门+七命令补门（维持 v7）
**Files:** syncStatus+nodeStore+canvasStore（七命令首行门）+canvasUndo
- [ ] 先红（G34 含七命令 viewer cs 突变红相）→绿+Commit。

---

## 片 C0b：服务端事实写（T5-T10）

> **五面纪律**：每卡自检生产/交付/消费/生命周期/崩溃端；**每卡至少一个真 PG 并发用例**。

### Task 5: media-facts 读模型（MediaFactOutbox emitter+REST+join+MIME 全链+通路修复）

**Files:**
- Create: media-fact.ts+media-facts.controller.ts（**IDOR 校验：ids∈binding.projectId∪Media.projectId**）+media-fact-emitter.ts（SKIP LOCKED 认领）
- Create: media-content.controller.ts（**GET /api/media/:id/content 代理流式**）
- Modify: storage.service.ts（confirm **file-type 嗅探+白名单拒+删对象+按 sniffed 重算 probeState**）+minio.service.ts（presign Content-Type 条件）
- Modify: mediaUploadUtils.ts+mediaApi.ts（**生产 /flowai 渗透修复**——环境感知）+snapshot-filter（FilteredNode+公开 natural）+nodeStore（ImageItem 去 url）
- Test: media-fact/emitter/content/snapshot/storage spec

- [ ] **Step 1: 先红（G42/G28/M1-M2）**

```ts
describe('ADR-1 media 读模型+MIME（G42/G28/M2）', () => {
  it('MediaFactOutbox：事务乱序提交（A 先写 probedAt 后提交——**红相：watermark 跳过 A**）→outbox pending 行下轮必达；重启零回放；correction 新 version 必达；attach 后到补发', async () => { /* 断言 */ });
  it('REST：≤500+项目成员+**IDOR 拒（跨项目 mediaId 403）**+ETag；doc 四根不动', () => { /* 断言 */ });
  it('MIME：confirm file-type 嗅探→HTML/SVG/PE 拒+删对象+计数；**伪报 audio 的图片按 sniffed 重算 pending**（red：永 skipped）；presign Content-Type 条件', async () => { /* 断言 */ });
  it('media content 代理：按 sniffedMimeType 设 Content-Type+非白名单 attachment+CSP sandbox；**生产 MinIO 直链禁用**', async () => { /* 断言 */ });
  it('上传通路：生产环境 uploadUrl 不改写 /flowai（red：mediaUploadUtils:31 无条件改写）；ImageItem 无 url 键', () => { /* 断言 */ });
  it('快照 join：RawNode.natural{width,height} 注入+FilteredNode 显式（公开 payload：natural 在/mediaId·probe 域不在）', () => { /* 断言 */ });
});
```

- [ ] **Step 2: 实现**→**Step 3: 绿+Commit**（`feat(shared+api): outbox emitter+MIME 全链+通路修复（ADR-1/G42/M2）`）。

### Task 6: execSeq 链路+ArtifactCommit+MediaRegistration+InTx 族+flushDocument+后门删除

**Files:**
- Modify: generation-intent.service.ts（**execSeq nextval 三处**+rearm 事务〔execSeq+reservation 继承+资金归一化+旧 outbox superseded〕+completeInTx）+team-credit.service.ts（**settleInTx/voidInTx**+reserve 写 reservedExecSeq+settle/void CAS 匹配）+execution.service.ts（撤自行 settle/complete/交付——producer 迁移）+ai-download/ai-image-edit/lighting/trim processor 迁移
- Create: artifact-commit.service.ts（**lockBalance→intent FOR UPDATE 重验→幂等前置→registerInTx→CAS→settleInTx**+40P01 重试）+media-registration.service.ts（registerInTx/confirmInTx/bindInTx）
- Modify: collab-document.service.ts（**exec 守卫 execSeq 化**——BigInt 比较+reason-aware；deliverArtifact 复合 op 前置判定）+collab-doc-ops（同值 no-op deep-equal）
- Modify: collab-residency.service.ts+collab-persistence.service.ts（**withSession flush:true+flushDocument 五态**〔storeDocumentSerialized/saveMutex〕+维护门 503）
- Create: delivery-outbox.service.ts（认领+批量 apply+一次 flush+复核+exec error reconcile〔execProjectedExecSeq+活跃项目+24h〕）
- Modify: intent-reconcile.service.ts（**三后门删除**〔backfillSucceeded/threeCheck resultRef/settleStranded probeArtifacts〕→不变量巡检；cleanTerminalIntents 交付终态门+resultText 90d）
- Test: 全 spec（**真 PG 并发**）

- [ ] **Step 1: census**。
- [ ] **Step 2: 先红（G44/G48/G58）**

```ts
describe('ADR-3/6 execSeq+finalize+flush（G44/G48/G58）', () => {
  it('execSeq 代际：**同 job 双 worker（BullMQ stalled）旧提交必败**（red：attempts 不变旧产物通过 CAS 复现）；**新 intent 新代不被旧 done 挡**（red：反例 B 现存 bug 复现——新行 loading 被 terminal-superseded）；旧 error 不覆盖新 loading', async () => { /* 真 PG 并发 */ });
  it('rearm：execSeq nextval+reservation 继承（reservedExecSeq→新值）+**残留冻结归一化**（red：mayCall:false 静默跳过外呼现存 bug 复现）+旧 outbox superseded', async () => { /* 断言 */ });
  it('finalize 锁序：**并发 reaper+finalize 死锁注入——零 40P01 或 3 次重试收敛**；lockBalance 先于 intent（契约 20）', async () => { /* 真 PG 并发 */ });
  it('finalize 幂等：同 (intent,execSeq,index) 重复提交返回已有 Media 零重复 settle；对象 sha256 校验（不同字节拒）', async () => { /* 断言 */ });
  it('资金矩阵：settle 失败整体回滚（零 Media 零 delivered）；多产物一次事务 N Media 整组；Media 已建未 stored→sourceExecSeq 反查（当前代）不误 release', async () => { /* 矩阵 */ });
  it('flush：**四崩溃窗**（apply 前/flush 前/flush 后 mark 前/mark 后 emit 前）全收敛；**spooled≠delivered 继续重试不耗 maxAttempts**（red：mark delivered 时 doc 未落库——debounce 窗 kill 复现=扣费无产物无重试）；批量一次 flush；flush 后复核（execSeq/expectedValue/节点）→superseded/orphaned/delivered', async () => { /* 断言 */ });
  it('deliverArtifact 前置判定在 data patch 前（stale/execSeq/expected 全过才写——red：先 data 后 exec 的 partial 复现）', async () => { /* 断言 */ });
  it('后门删除：backfillSucceeded/threeCheck resultRef/settleStranded probeArtifacts grep 零命中；不变量巡检（SUCCEEDED⇒stored∧Media∧settled 违反→告警人工）', async () => { /* grep+断言 */ });
  it('exec 投影：loading/skipped worker strict（exec-only+execSeq）；error=DB→API reconcile（execProjectedExecSeq≠当前+活跃项目+24h 窗）；alignExecFromIntents 重建', async () => { /* 断言 */ });
  it('text：resultText 落库=物化；data.result≤32KB；intent/:id/result 入口；**resultText 非空行 cleanTerminal 延长 90d**（red：7 天删行全文丢失）', async () => { /* 断言 */ });
});
```

- [ ] **Step 3: 实现**→**Step 4: 绿+Commit**（`feat(exec+collab): execSeq+两编排器+flushDocument（ADR-3/6 v8/G44/G48/G58）`）。

### Task 7: probe 单相（分型批/lease+sniffed 路由+40MP）

**Files:** media-probe.poller.ts（worker）+九处 create 面+sweep+media-process（server natural 同事务 done+**factVersion+outbox 插入**）
- [ ] 先红（G23/M1）：claim（**图片批 4 lease 180s/视频 batch 1 lease 5min**——red：批 2×90s 覆盖不了下载+ffprobe 复现；sniffed 路由+deletedAt+SKIP LOCKED）/nextProbeAt jitter/skipped 触发点/server natural done+outbox/sharp 40MP+downscale（产品策略 UX）/EXIF 5-8/ffprobe 沙箱/零 doc 写→绿+Commit。

### Task 8: 两编排器 producer 接线+attach 消费者+fileId 命令

**Files:**
- Modify: **资金五路径**（execution text/image/video+ai-image-edit+lighting——producer 只调 ArtifactCommit）+**非资金六路径**（upload confirm/stitch/trim/separate/copy/export——调 MediaRegistration+bindInTx；**job data 带 registrationKey**）
- Modify: media-delivery.service.ts（纯 DB）+attach-consumer.poller.ts（**资金型 binding 跳过 fileId 写**——DocDelivery owner 唯一）
- Create/Modify: collab-media.controller.ts（attach 同 team+**replaceMedia/attach 显式命令**〔attach=只填空〕）
- Test: media-delivery/attach-consumer/controller spec

- [ ] **Step 1: 先红（G43/G46/G51）**

```ts
describe('ADR-7 两编排器+attach（G43/G46/G51）', () => {
  it('**MediaRegistrationService=唯一 media.create 点**（grep 全仓 media.create 零第二处——red：现状 stitch:97/trim:110/generated-media:54 直建复现）；资金五走 ArtifactCommit/非资金六走 MediaRegistration（不碰 settle/complete/DocDelivery/exec——red：无 intent 空指针复现）', async () => { /* grep+矩阵 */ });
  it('非资金幂等：registrationKey（taskId+index|mediaId|exportRequestId）重试不重复建 Media/binding；@@unique(bucket,key)', async () => { /* 断言 */ });
  it('attach 消费者：status=completed 解耦 probe；linkMedia 原子 CAS（withSession 内）；**targetItemId 稳定定位**（red：targetIndex 漂移场景——删除/重排后错位复现）；**资金型 binding 跳过 fileId 写**（DocDelivery 唯一 owner）', async () => { /* 断言 */ });
  it('attach=只填空/replace=显式命令（非空替换走 replaceMedia 带 expected）；同 team；七键 mediaRefsOf', async () => { /* 断言 */ });
});
```

- [ ] **Step 2: 实现**→**Step 3: 绿+AI 全链冒烟+Commit**。

### Task 9: web 禁写+身份键不回送+服务端 manifest 拒写+端点白名单

**Files:** canvasIntents+nodeStore（updateConfig 显式键）+**canvas-doc-manifest.ts（writeNodeData 拒 fileId/resultUrl/videoUrl/result/natural——仅 linkMedia/deliverArtifact 复合 op 可写）**+collab-write.controller.ts（**op 白名单：worker 仅 writeExecStatus loading/skipped**）

- [ ] 先红（直发身份键零写/updateConfig 不回送/**服务端 writeNodeData 携 fileId→UNKNOWN_KEY 拒**〔red：现状白名单内可写〕/**worker 端点 writeNodeData→拒**）→绿+Commit。

### Task 10: 消费端接线（store 重连全量刷+factVersion）+E2E+片出口
**Files:** canvasCollabRuntime（全量拉+按 factVersion 忽略旧+清空）+nodeStore
- [ ] 先红（全量刷/outbox 事件 version/清空）→E2E 真链路+G42/G43/G44/G46/G48/G51/G58 矩阵→Commit+呈报。

---

## 片 A1：doc 契约+placement 语义（T11-T18，维持 v7 口径+T15 双 bump）

### Task 11: 【并入 T15】双 bump 3（csv+docSchema 两门）——维持 v7。
### Task 12: placement 三型+DOC_NODE_KEYS 7 键（order|slot 判别；读写 vendor 严格）——维持 v7。
### Task 13: order-key vendor+四曲线+等值键 needs-layer-repair——维持 v7。
### Task 14: orderRecords+deriveStoryboardCells（capacity 派生+overflowIds）+收编——维持 v7。
### Task 15: validate+fillDoc slot 写链+四出口+manifest（deliverArtifact/linkMedia 进表）+【T11 双 bump】——维持 v7。
### Task 16: 判别联合+allocator+order/slot 写链+**cells 回流面 11 处删除**——维持 v7（T16 测试矩阵维持）。
### Task 17: normalize 五路径+binding 复制（cells remap 删）——维持 v7。
### Task 18: 空间 tie-break+doc-shape-invalid——维持 v7。

**片 A1 出口**：维持 v7 判据+呈报。

---

## 片 A2：序域执行（T19-T21）

### Task 19: soft/hard+on-demand repair=**vacuum 协议复用**+病理档

**Files:**
- Create: collab-pathology.ts（soft 计数+病理档+**repair 执行体=vacuum 复用**）
- Modify: collab-shrink.service.ts（**vacuumGate 共享**——repair 与 vacuum 互斥）+collab-doc-registry.service.ts（beginVacuumEra/vacuumReplace 复用——repair 变换注入+**等价断言=忽略 order|slot 的节点/边/data 等价**）+collab-residency.service.ts（**维护门 assertMaintenanceFree 覆盖 withSession/withDoc 全写路径**——DocDelivery/attach 消费者维护窗 503 退避）+MAINTENANCE origin
- Modify: **web purgePidCaches 修复**（local-cache-key+runtime——generation jump 清同 pid 全部代+**真 IDB 测试断言实际删除集合**〔red：现状保留脏旧代复现〕）
- Create/Modify: collab-media.controller.ts（repair 端点——异步 202+单飞+OWNER/ADMIN）
- Test: collab-pathology.spec.ts

- [ ] **Step 1: 先红（G45/G53）**

```ts
describe('ADR-5 v8 repair=generation 跳变（G45/G53）', () => {
  it('repair 执行体：vacuumGate 互斥（**repair 进行中 vacuum→409/反之**——red：两套内存态互不知复现）→beginVacuumEra 冻结+4410+serving 门→quiesce（writesSettled）→离线重排→**等价断言（忽略 order|slot）**→单事务 vacuumReplace（generation+1）→purge+释放', async () => { /* 断言 */ });
  it('**旧客户端内容级拒**：repair 前旧 SV 重连→guardSyncFrame preVacuumSv→4410 doc-generation-stale→consumeGenerationJump 单链一次 reload（red：repairRev 三缺口复现——无自报 rev/rev 被吞/离线 pending 回写）', async () => { /* 真连 */ });
  it('**维护门全覆盖**：repair 窗口 DocDelivery/attach 消费者 writeNodeData→503 退避不 mark（red：维护窗内交付 fileId 被 repair 覆盖丢失复现）', async () => { /* 断言 */ });
  it('**purgePidCaches**：generation jump 后同 pid 全部代 IDB 库被清（真 IDB 断言——red：现状保留脏旧代复现）', async () => { /* 断言 */ });
  it('ack 降 UX：不 ack 超时→照常 close 不中止 repair；soft/hard/dup/病理档维持', async () => { /* 断言 */ });
});
```

- [ ] **Step 2: 实现**→**Step 3: 绿+双端演练+Commit**（`feat(collab): repair=generation 跳变+purge 修复（ADR-5 v8/G45/G53）`）。

### Task 20: guard——spike（exec+身份键域）→档位+post-apply
**Files:** collab-content-guard.ts+scripts/c0a-guard-exec-spike.mjs+collab-doc-registry:677
- [ ] spike（exec 伪造+**身份键直写**检测）→定档→post-apply 恒做（afterTransaction 队列+删键+诊断 close）+guard-contract.spec+Commit。

### Task 21: repair CLI（placement/slot/dup/binding——经维护租约）
- [ ] 先红（四形态+环+duplicateLayers+binding 缺失）→绿+Commit。

---

## 片 A3：收敛 harness（T22）

### Task 22: 五件套+双端真连+故障注入（v11 矩阵）

**Files:** web node config+fixtures+api collab-harness/provider-convergence.e2e-spec.ts

- [ ] 先红：五件套（slot 派生档）/双端收敛/G17 改口档/分镜并发零成员丢失/等值邻居/重复键层 repair/双端避让/真连+分区重启/attach 503/**DocDelivery flush 四窗**/**execSeq 代际矩阵（同 job 双 worker/新 intent 不被旧终态挡/旧 error 不覆盖新 loading）**/**exec alignExecFromIntents 重建**/**repair=vacuum 并发（一进一 409）+旧 IDB 全代清+离线 pending 拒合并**/**outbox 乱序提交+重启零回放**/reset 联动。
- [ ] 绿+Commit（`feat(web+api): A3 harness（G12/G17/G45/G46/G53/G55/G58）`）。

---

## 片 B1-B2（T23-T27，维持 v7 口径）

### Task 23: DocShapeInvalidError+enterDocInvalid 收窄——维持 v7。
### Task 24: resync 分流+write-rejected 节流（repair UX=generation 单链）——维持 v7。
### Task 25: 删除面+cells 消费面迁移（T26 同窗先行）——维持 v7。
### Task 26: applyIntrinsicFit（store+display+imageRotation+分镜跳过+G28 公开 natural）——维持 v7。
### Task 27: D6 autoOrigin——维持 v7。

---

## 片 B3：终出口（T28）

### Task 28: 双 bump 门+dev reset（六表）+verify/CI+UX 签字+soak

**Files:** collab-protocol+docShape:41（双常量=3）+session-guard（csv 拒连；docSchema 拒载既有门）+dev-reset-canvas.mjs（**六表清：CanvasDoc/CanvasDocUpdate/MediaBinding/DocDelivery/MediaFactOutbox/Media 生成物**+spool/Redis+MinIO temp+IDB 预置）+verify-manifest（census/排序/guard/曲线/pin/cells 零残留/**media.create 单点**）

- [ ] Step 1 先红（G21/G33/D2/G57）：旧 bundle（csv=2）→schema-outdated→一次 reload（守卫不绕过）；旧 doc（docSchema=2）→拒载+IDB 不命中+Redis 键失效；Redis 停机协作不受影响；reset 六表→零重放零复活→两轮零回灌。
- [ ] Step 2 双 bump（唯一新代码=两常量）→Step 3 verify/CI 全绿+双拒实证。
- [ ] Step 4 UX 签字（slot 交互/身份键不回送+fileId 替换显式命令/hard 128 修复入口/text 32KB 截断+全文入口/媒体库保留 N 天/**40MP 图片上限+downscale 提示**/**media content 代理下载行为**）。
- [ ] Step 5 soak（数字 SLO）：10k+10 客户端 10min：投影 p95≤30ms+React commit+doc 字节不随同值写增长+单帧<128KB+doc<8MB+probe lag p95≤60s+attach lag≤10s+delivery lag p95≤60s+**outbox lag**+facts 批量 p95≤100ms+**artifact commit p95**+**applied_unpersisted=0**+内存上界。
- [ ] Step 6 Commit+部署窗呈报。

---

## 验收门禁（v8 汇总——判据随 spec v11 §5 权威表）

**保留**：G1-G15/G17（改口）/G18-G20/G22/G47/G54/G55/G56/G57（v10 口径）。

| 门 | v11 增强点 |
|---|---|
| G42 | **MediaFactOutbox（乱序提交必达/重启零回放/correction 必达/attach 补发/IDOR 拒）**——watermark 三缺口根修 |
| G43 | **两编排器**（MediaRegistration=唯一 media.create 点 grep 零第二处；非资金不碰资金域；registrationKey 幂等） |
| G44 | deliverArtifact **前置判定在 data patch 前**+execSeq reason-aware+deep-equal no-op |
| G46 | targetItemId 稳定定位+**资金型 binding 跳过 fileId 写（owner 唯一）** |
| G48 | **execSeq 三反例全绿（同 job 双 worker/新 intent 不被挡/旧 error 不覆盖）+锁序死锁注入零 40P01+幂等前置+rearm 归一化（现存 bug 根修）** |
| G23/M1 | 分型批/lease+sniffed 路由+jitter+40MP |
| M2 | **media content 代理+MinIO 直链禁用+sharp 重编码+size BigInt+生产通路修复** |
| G53 | **repair=generation 跳变**（vacuumGate 互斥 409/等价断言/旧 SV 内容级拒/IDB 全代清/**维护门全覆盖交付 503**）——repairRev 三缺口根修 |
| G58 | **flush 四窗全收敛+spooled≠delivered+批量一次 flush+flush 后复核**——mark delivered 撒谎根修 |

---

## 自检（plan v8——writing-plans Self-Review）

**四裁决落位**：①repair 方案 A=T19（vacuum 复用+purgePidCaches 修复）+T22（并发/旧 IDB 注入）；②execSeq=T3（sequence+三列）+T6（分配三处+守卫+CAS+rearm 继承归一化——**三现存 bug 同卡根修**）+T22（代际矩阵）；③两编排器=T6（ArtifactCommit+MediaRegistration+InTx 族）+T8（producer 分层接线+grep 单点门）；④flush=T6（flushDocument 五态+批量+复核）+T22（四窗注入）。

**五面闭环**：生产端（T6/T8 两编排器）/交付端（T6 flush+T5 outbox）/消费端（T5+T10+T26）/生命周期端（T17+T28 六表+text 90d）/崩溃端（T6 锁序/幂等/四窗+T19 维护门+T22 注入）。

**v7→v8 实质差异（执行者勿混用）**：①execSeq 全局代际（DB sequence）替代 intentAttempts——三反例根修；②repairRev 删除→repair=generation 跳变（vacuum 协议复用）+purgeForeignCaches bug 修复；③MediaFactOutbox 替换 probedAt watermark；④producer 分两层（MediaRegistration 唯一 media.create 点）；⑤flushDocument typed 五态（spooled≠delivered）；⑥锁序 balance→intent+InTx 方法族+幂等前置+40P01 重试；⑦唯一键全带 execSeq+artifactIndex+targetItemId；⑧对象 key hash+If-None-Match+sweep；⑨旧 reconcile 三后门删除→不变量巡检；⑩MIME 全链（media content 代理+直链禁用+重编码+size BigInt+生产通路修复）；⑪probe 分型批/lease+sniffed 路由；⑫worker 端点 op 白名单+manifest 身份键拒写；⑬每卡真 PG 并发用例。

**执行期语义定位点（已实证）**：同 jobId 重入不递增 attempts（generation-intent:130/:158）+rearm:183+新行=1（schema:1004）；BullMQ 同 jobId（processor:40）；exec 守卫只比 attempts（document:313-331——反例 B 现存 bug）；reserve mayCall:false（team-credit:102-108+execution:325——rearm 静默跳过现存 bug）；契约 20（credit-ledger:58+team-credit:90/:156/:186/:235）；complete 根 prisma:255+settle 自开:132；后门（reconcile:215/:244）；四路径零 intent（stitch:97/trim:110/generated-media:54/confirmUpload）+ExecutionJobData.intentRowId 死代码:272；withSession 零 flush（residency:459-468）；vacuum 全套（registry:564-581/repo:180-210/registry:679-698/runtime:594-601）；doc-status 去重（registry:965-977+runtime:1450-1470）；URL 只 csv/cb（runtime:1572）；**purgeForeignCaches 反语义（local-cache-key:71+测试只断言参数 cache.spec:100-113——现存 bug）**；worker 端点白名单内含 fileId（write.controller:32+manifest:83）；**生产上传 /flowai 渗透（mediaUploadUtils:31）**；Media.size Int（schema:279）；仓内零嗅探库；UI 按 ImageItem.id 现算（MultiImageConfigPanel:69/:82——targetIndex 批评不成立但整数组覆盖仍在）；reconcile 带时间窗+索引（:102-139/:350-352+schema:1025-1027）。

**与 spec v11 的对齐**：全部 T 卡/门禁与 spec v11 §4/§5 一致；裁决引用=§0.1 v11 口径（⑪⑫⑬+②⑨）；偏离走 spec §0.4。
