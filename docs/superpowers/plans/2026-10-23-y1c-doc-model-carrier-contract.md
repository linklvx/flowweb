# Y1c：doc 模型 v4·四平面架构 Implementation Plan（P0 契约 / P1 载体 / P2 内容 / P3 业务与恢复 / P4 交付）

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

<!-- plan v1.3（2026-10-24）：依据 **spec v5（8da256f5——第六轮终裁+用户裁定：架构反转版）** 全量重写（v1.2 整体废止，仅存档；旧 T0-T28 处置映射见尾部）。**架构基线**：四平面（Yjs 协作内容/PG 业务唯一权威/Spool WAL spool-first/Runtime Feed 游标续传）；doc 三根（meta 白名单/nodes/edges，exec 根删除）；**服务端 serving 期零业务 doc 写=可测试不变量**；单实例 ADR（instances:1）；硬重置无兼容层。**门结构**：六项 go/no-go=**工程门**（实施团队按证据自判——G1@T7/G2@T10/G6@T13/G3@T16-20/G4@T21/G5@T22；任一失败=对应任务先改再写码，禁「按默认写红了再改」）；阶段出口 P0-P4=**用户确认点①-⑤**；世代切换首次真跑=执行门（T27）。**纪律**：每卡先红（真实变红+真 PG 并发/故障注入用例——mock 测不出水位/前缀/锁序）→绿→commit；写码前 grep 实证（行号=47e37467 快照）；三面 tsc；偏离滚动登记 §0；迁移×3 串行（P1 载体→P3 业务→P3 资源）；门禁 requires 规则（任何 gate 依赖后序任务=评审红）承袭。 -->

**Goal:** 落地 doc 模型 v4 四平面架构——P0 契约冻结（全类型 schema 矩阵+DocCodec 双出口+两现行 bug+ExecutionRequest/WAL/Feed 协议）→P1 载体垂直切片（spool-first 写管线+连续前缀+批量 PG+快照/vacuum+崩溃恢复+Feed 最小闭环）→P2 内容（全类型矩阵落地+Y.Text/XmlFragment/Y.Map/媒体数组+Tiptap 双端+单 UndoManager+读者全量改道）→P3 业务（ExecutionRequest+PG 权威执行态+Outbox/Feed 全量+交付退款 fencing+收缩 FrameGate+拒帧恢复+维护窗口）→P4 交付（reset 工具+故障演练+负载基准+删除清单+发布门）。

**Architecture:** 见 spec v5 §2-§7（四平面/写管线七步/ACK 三档/代际四元/八版本维度/交付状态机/生命周期义务观察器）。核心不变量：①客户端帧由 gate 拥有持久化（listener 禁 connection-origin 二次 append）；②ACK 前帧已 WAL fsync；③snapshot 只从 PG 前缀生成；④barrier committedSeq=本连接全帧前缀；⑤业务输赢由 PG 事务+fencing 裁定；⑥服务端 serving 期零业务 doc 写。

**Tech Stack:** TypeScript strict / Yjs exact 13.6.32 / Hocuspocus 4.6.0（**不 patch y-protocols**——服务端注入 errorHandler 或 post-check；最小 patch 仅 @hocuspocus/server 侧）/ y-prosemirror（T0 pin——与 @tiptap/react 2.10.0 ProseMirror 矩阵匹配 exact 版）/ @tiptap/react 2.10.0 / NestJS / Prisma / vitest+node:test / CI postgres。

**执行纪律：** 每卡先红→绿→commit；写码前 grep 实证；行号=47e37467；三面 tsc；文档 diff 随卡；迁移串行不并行；每阶段出口用户确认。

## 文件结构（触碰面全景）

| 文件 | 动作 | 责任 | 阶段 |
|---|---|---|---|
| packages/shared/src/canvas/doc-schema-v4.ts | **建** | 全类型树形矩阵+meta 白名单（T3） | P0 |
| packages/shared/src/canvas/doc-codec.ts | **建** | canonical+read model+toPublicReadModel 双出口——zero-yjs（T4） | P0 |
| packages/shared/src/canvas/docShape.ts+canvas-doc-manifest.ts | 改 | 键分类/准入面共用；re-export 删除（T4/T19） | P0/P2 |
| packages/shared/src/collab/{draft-envelope,runtime-event,doc-protocol}.ts | **建** | DraftEnvelope(+merge policy)/RuntimeEvent/水位与 WAL 帧协议契约（T5） | P0 |
| apps/web/src/stores/nodeStore.ts:20,:225,:719,:725+AddNodeMenu:92+canvasStore:159-166 | 改 | bug① textInput 单源+nodeTypeMap 收口（T1） | P0 |
| nodes/TextConfigPanel.tsx:157+executionApi/enqueue-worker 链 | 改 | bug② 最小修——prompt 只随请求发送（T2） | P0 |
| scripts/check-collab-cjs.mjs 扩+ADR-01 单实例 | **建** | census 静态门（未分类字段红/服务端读者/裸构造）+单实例 ADR（T5/T8） | P0/P1 |
| apps/api/prisma/schema.prisma+迁移×3 | 改 | P1 载体族（CanvasDoc 头四元+水位/Snapshot/Update/MaintenanceOperation/维护审计）→P3 业务族（ExecutionRequest/NodeExecution/ExecutionOutbox/MaterializeRun/RefundObligation/NodeLifecycle/DeliveryFence）→P3 资源族（StorageReservation/ObjectManifest 扩）（T7/T21/T23） | P1/P3 |
| collab-frame-gate.service.ts（重写现 guardSyncFrame） | 改/**建** | beforeSync 准入+spool-first+帧字节精确 copy（T9/T24） | P1/P3 |
| collab-spool.service.ts+collab-persistence.service.ts | 改 | 帧协议升级+连续前缀批量 PG+水位（T8-T11） | P1 |
| collab-document.service.ts:194-224,:248-264,:307-326（vacuumReplace/deliverArtifact/writeExecStatus） | 改/**删** | vacuumEpoch 解耦（T12）/deliverArtifact 改 PG 写+doc 写零化（T22）/writeExecStatus 退役（T32） | P1/P3/P4 |
| collab-shrink.service.ts+registry | 改 | vacuum 不动 generation+4410 三分载荷（T12/T25） | P1/P3 |
| apps/api runtime-feed.service.ts（新）+web runtime store | **建** | Feed 快照+游标+stateless 通知+续传（T13/T22） | P1/P3 |
| canvasUndo.ts+retention 无（删） | 改 | 单 manager+addToScope+E26 精确释放（T18） | P2 |
| TextInputNode/PromptInput/TextNodeFullscreen/TextNodeToolbar+canvasIntents | 改 | XmlFragment 双端+容器唯一创建+Y.Text 域（T15/T16） | P2 |
| nodeStore:716-720/useImageUpload/CanvasView/ImageGenNode | 改 | 媒体列表 Y.Array 单卡（T17） | P2 |
| execution.service/generation-intent/materialize/team-credit | 改 | ExecutionRequest+docSeq+worker 零 doc 读+fencing+退款（T21-T23） | P3 |
| collab-lifecycle-observer.service.ts（新） | **建** | 只读观察+义务与前缀批同事务+反向索引（T26） | P3 |
| collab-maintenance.service.ts+REST gateway+rebuild 脚本 | **建** | 维护窗口+stage 表+admin guard（T27） | P3 |
| packages/shared/src/constants/collab-close-code.ts+web recovery | 改/**建** | 4411+4410 三分+server-restored 恢复模式（T25） | P3 |
| apps/web 全读者~27 处/14 文件+api video-work-clone:33+registry rebuild:635 | 改 | read model 全量改道+旧字段删除（T19） | P2 |
| canvasCollabRuntime.ts+local-collab-cache.ts | 改 | per-tab 缓存 mergeUpdates+增量投影+save barrier 客户端（T18/T21/T28 前移项） | P2/P3 |
| deploy.sh+scripts/reset-collab.mjs+collab-ops-runbook | 改/**建** | reset 工具+发布门（T30/T34） | P4 |

**不动红线**：NODE_ENVELOPE_KEYS；ecosystem 双进程（compact=COLLAB_ROLE worker 真进程隔离）；yjs 私有 API 禁令（不做 struct adapter——incarnation=PG lifecycleSeq）；四平面职责边界（业务状态禁回 doc）。

---

## P0：契约（T0-T6——除两 bug 外零生产代码变更）

### Task 0: 基线 spike+census 固化
**Files:** spike/census 产出记入本卡（零生产代码）
- [ ] y-prosemirror exact pin 调研（`pnpm why prosemirror-model` 实证矩阵；T16 落地）
- [ ] **四个 spike**：①嵌套 XmlFragment+Tiptap 双端绑定（含 PromptInput mention/image 节点）②WAL group commit 测量（fsync 延迟/≤20ms 批窗口/批量大小曲线）③8MiB 传输预测量（permessage-deflate vs HTTP seed）④undo `addToScope(fragment)` 可行性（嵌套 fragment 事务入栈验证）
- [ ] **census 固化**：①节点类型全集（真实创建/保存/加载/执行/导入/导出路径枚举——group/videoEdit 必入册）②全类型字段路径 census（envelope+data 键树）③readRecordsFromMaps 全调用点（web+server）④textInput prompt 全消费面 ⑤**doc.exec 全触碰面清单**（写守卫/GC/vacuum 搬运/摄入点——P3/P4 删除输入）⑥服务端写 doc 全路径清单（deliverArtifact/尺寸写点/维护写——不变量验收输入）⑦39 裸 `project:${pid}` ⑧per-tab 缓存现状与 IDB 键面
- [ ] Commit（spike 结论文档+census 清单）。

### Task 1: bug① isTextNode 统一+创建链单源
**Files:** nodeStore.ts:20,:225,:719,:725；AddNodeMenu.tsx:92；canvasStore.ts:159-166；TextInputNode.test.tsx:84,:91；nodeStore.test.ts:543
- [ ] 先红：夹具改生产名 `'textInput'`+删 isTextNode mock→重挂载断言正文保留→**红**
- [ ] 绿：isTextNode 判 NODE_TYPES.TEXT；删 :613-621 幽灵兜底；:719/:725 裸字面量全清；AddNodeMenu:92+nodeTypeMap 翻译链收口；创建类型断言（resolvedType∈值集）
- [ ] 全仓 grep 节点 type 裸字面量清零；web tsc+测试绿→Commit。

### Task 2: bug② 最小修——prompt 只随请求发送（不落 doc、不写过渡形状）
**Files:** nodes/TextConfigPanel.tsx:157；apps/web executionApi（enqueue/execute 加 promptText 参数）；apps/api execution.controller/execution.service（请求参数优先）；回归+E2E
- [ ] 先红：①「生成后正文不被覆盖」（现 :157 写 content）→**红**②E2E「panel prompt→callTextGen 收到 panel 值」（现经 content 覆盖回流——删写后无通道）→**红**
- [ ] 绿：:157 删覆盖写（prompt 留本地态随请求发送）；enqueue/execute 请求体加 `promptText`（可选——ExecutionRequest P3 落持久行，此参数即其前向通道非垫片）；worker `nodeClaimPack` 优先请求 promptText；**doc 无任何过渡形状**（textInput.prompt=Y.Map{text:Y.Text} 终形=T15/P2 落）
- [ ] 测试绿（含 audioGen content 现状不动——T15 迁）→Commit。

### Task 3: DOC_SCHEMA_V4 全类型树形矩阵
**Files:** packages/shared/src/canvas/doc-schema-v4.ts（新）+schema-contract.spec.ts（新）
- [ ] 表形（树形+全类型+容器语义——spec §3.1 矩阵冻结）：

```ts
export type YFieldType = 'text' | 'xml' | 'map' | 'array' | 'lww-array' | 'lww' | 'server-forbidden';
export interface DataKeySpec { yType: YFieldType; writer: 'user' | 'server-feed'; // server-feed=尺寸等经 feed 下发客户端代写（显式白名单）
  reader: string[]; permission: 'free' | 'protected'; undo: boolean; mediaRef: boolean;
  importExport: boolean; maxBytes?: number; items?: DataKeySpec; children?: Record<string, DataKeySpec>; }
export const DOC_SCHEMA_V4: Record<string /*nodeType 全集含 group/videoEdit*/, { envelope: readonly string[]; data: Record<string, DataKeySpec>; }>;
export const META_WHITELIST: readonly string[]; // meta 根用户可编辑白名单
// 未知类型=显式 schema 错误（写拒+读侧只读保真策略标注）；exec 根不在 schema——写入即 DENY
```

- [ ] 先红：schema-contract.spec——「census ①全集逐类型 envelope+data 全路径穷举」「组合合法性（writer=server-feed⇒白名单登记；array⇒Y.Array+undo 可用）」「键集与 canvas-doc-manifest 现键零漂移」「META_WHITELIST ⊆ meta 现键」（现无类型维度=红前置）
- [ ] 绿+断言族全绿→Commit。

### Task 4: DocCodec 双出口+zero-yjs
**Files:** packages/shared/src/canvas/doc-codec.ts（新）+round-trip 属性测试
- [ ] 接口（DocLike 纯结构+工厂注入——shared 零 yjs 依赖；DocLike 扩 createText/createArray/createXmlFragment 或 yjs 类型直用+conformance 测试二选一定案）：`serializeCanvas(docLike): CanvasDocument`（canonical——备份/重建/semanticEqual）+`toReadModel(docLike): CanvasReadModel`（plain JSON——REST/执行/导出；文本显式 string，富文本 PM JSON/HTML）+`toPublicReadModel(readModel, policy)`（公开快照 sanitize+URL allowlist）；readCanvas 只返回 read model——禁止共享类型逃逸
- [ ] readRecordsFromMaps 收编唯一 import；docShape re-export 删除——调用点（census ③含服务端）全量改道；**无 transformV3ToV4Draft**（硬重置——spec v5-13）
- [ ] 先红：round-trip 属性测试（含 XmlFragment/mention/image PM 节点/Y.Array 媒体/position Y.Map 逐键——语义相等非字节相等）→绿+census 门→Commit。

### Task 5: 协议契约冻结收口
**Files:** packages/shared/src/collab/{draft-envelope,runtime-event,doc-protocol}.ts（新）+耐久常量+runbook 草节+fixture
- [ ] 冻结清单：**ExecutionRequest** 字段（spec §6.1 全列+docSeq/paramsHash/幂等键/PII 256KB 上限）；**RuntimeEvent**（kind/payload 形+游标语义）；**WAL 帧协议**（帧 ID/单调序号/CRC 边界/水位字段/坏段分类码）；**ACK 三档+耐久五档**常量与 UI 文案映射；**八版本维度表**（作用域/比较/重置）；**4410 三分载荷**（generation-stale/doc-vacuuming+discardLocalCache/server-restored）+4411；**DraftEnvelope（含 merge policy 算法）**；nodeId 语法（URL-safe 禁 `:`）+slot 编码（固定枚举）；**save barrier 协议**（onStateless {nonce,sessionEpoch,g,editWatermark}→{nonce,g,committedSeq}+首语句同步捕获纪律）
- [ ] fixture：双端并发语料（每类型典型+边界）+WAL 故障语料（坏 CRC/截断/缺号/重复）+feed 故障语料（乱序/缺口/旧代）
- [ ] census 静态门进 verify fast（check-collab-census 扩：未分类新字段红+服务端读者清单+裸构造门+**doc.exec 触碰面零增长**）
- [ ] **P0 出口=用户确认点①**→Commit。

## P1：载体（T7-T14——最小可恢复协作垂直切片；G1/G2/G6 三工程门）

### Task 7: G1 门——迁移一载体族+genesis 双路+缺头三态
**Files:** schema.prisma+迁移一；project.service.ts:45-108；canvas.service.ts:37-53
- [ ] 表形（BigInt 默认 0 非 0n；relation 双侧全补+onDelete: Cascade；CanvasProject opposite 补全；先 reset 再 migrate 豁免登记）：

```prisma
model CanvasDoc { projectId String @id  generation Int @default(0)  schemaVersion Int  vacuumEpoch Int @default(0)
  currentSnapshotRev BigInt @default(0)  appendSeq BigInt @default(0)  spoolSeq BigInt @default(0)
  pgSeq BigInt @default(0)  purgeBelowSeq BigInt?  lifecycle String @default("SERVING")
  maintenanceId String?  admissionCutoff BigInt? /* drain 辅助——非 epoch */
  project CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@unique([maintenanceId]) } // raw SQL partial
model CanvasDocSnapshot { projectId String  generation Int  snapshotRev BigInt  stateSeq BigInt  state Bytes
  stateHash String  vacuumEpoch Int  schemaVersion Int  createdAt DateTime @default(now())
  @@id([projectId, generation, snapshotRev])  project CanvasProject @relation(...) }
model CanvasDocUpdate { projectId String  generation Int  seq BigInt  update Bytes  frameId String
  updateHash String  createdAt DateTime @default(now())  @@id([projectId, generation, seq])
  @@unique([projectId, generation, updateHash])  project CanvasProject @relation(...) }
model MaintenanceOperation { maintenanceId String @id  projectId String  stage String  status String
  error String?  idempotencyKey String @unique  leaseOwner String?  createdAt  updatedAt  @@index([projectId, status]) }
model DocWriteAudit { id  projectId  generation  actor  command  origin  nodeId?  updateHash  receipt Json?  createdAt  @@index(...) }
```

- [ ] 先红：①genesis 双路（POST /canvases 建头+Snapshot(g,0,0)）②缺头三态（missing 非 `?? 0`）③`prisma validate`（空 model/单侧 relation/缺 opposite 三形态红实测——本卡真绿）
- [ ] G1 证据：prisma validate+migrate diff+SQL dry-run（行锁/水位 UPDATE RETURNING/去重 no-op）→**G1 go/no-go 判定**（不过=修表形重跑，禁绕过）
- [ ] 交错（并发双创建）绿→Commit。

### Task 8: 单实例 ADR+WAL 帧协议升级
**Files:** docs/superpowers/adr/ADR-01-single-instance.md（新）；collab-spool.service.ts
- [ ] ADR-01：instances:1 复杂度边界（非 HA）/单写者/重启恢复顺序（WAL→PG 前缀校验→重建→开放写）/扩容=独立批前置条件
- [ ] spool 帧协议升级：帧 ID+单调序号（per project）+水位字段+坏段分类码（crc/truncated/missing-seq/dup-id 四档）；磁盘上限+背压+故障停收（fail-closed）
- [ ] 先红：坏段分类用例（构造坏 CRC/截断/缺号/重复 ID→分档隔离告警=现无分类红）→绿→Commit。

### Task 9: spool-first 写管线核心
**Files:** collab-frame-gate.service.ts（重写 guardSyncFrame 收编）；collab-persistence.service.ts（listener 改造）
- [ ] 先红：①现 apply→listener 二次 append 路径（connection-origin 双写断言）=红②ACK 时帧未 fsync（spool 先于 apply 断言——现 listener 后置）=红
- [ ] beforeSync 准入（身份/权限/generation/格式→解码+结构权限+预算+图约束→**帧字节精确 copy 独立 buffer**）→spool.putBatch+fsync（group commit ≤20ms 批窗）→放行 apply→广播；**update listener 禁 connection-origin 二次 append**（gate 拥有持久化）；维护写独立 append 通道（现状维持）
- [ ] 用例：并發双连接帧串行准入；SS2 大帧预算拒；帧字节 copy（subarray 池化 buffer 越界读反例——lib0 实测语料）→Commit。

### Task 10: G2 门——连续前缀+批量 PG+持久水位
**Files:** collab-persistence.service.ts（worker 批提交改造）
- [ ] 先红（G2 故障矩阵——真 PG）：①同帧重复送达零重复业务效果②PG 提交失败 WAL 保留且 pgSeq 不越失败帧③fsync 前后 kill -9 符合 ACK 等级④PG 提交成功但内存水位未更即崩→重启零重复⑤snapshot 已发布 WAL 未清时重启正确⑥WAL 达清理条件重启不误删
- [ ] 连续前缀单事务多行 append（复用 512 条/8MiB+1MiB 分片）→confirm spool→pgSeq/spoolSeq 水位推进；崩溃恢复=从 PG 已提交水位重放 WAL（不依赖进程内状态）
- [ ] **G2 go/no-go 判定**（不过=不进 P2）→Commit。

### Task 11: 快照发布+compact+WAL 清理
**Files:** canvas-doc-update.repository.ts（compact 重写）；COLLAB_ROLE worker 调度
- [ ] 先红：两 compact 并发 PK 冲突折正常 miss=红；kill 在指针发布后/purge 前不续跑=红
- [ ] 快照只从 PG 前缀生成（重放在 worker 进程——行锁+generation/appendSeq CAS 授权，不拿租约）；指针短事务+**purgeBelowSeq 同事务持久**+提交后 worker 分批删+启动续跑；保留策略（当前代 2 份+旧代最终 1 份）；snapshot 独立观测 gauge
- [ ] 交错（装载×compact×append）绿→Commit。

### Task 12: vacuumEpoch 解耦
**Files:** canvas-doc-update.repository.ts:194-224（vacuumReplace）；collab-shrink.service.ts:292-347；registry 4410 载荷
- [ ] 先红：vacuum 后 generation/docName/缓存键变化（v1.2 语义反例）=红
- [ ] vacuumReplace 改 `vacuumEpoch+1`（不动 generation）+快照替换；4410 `doc-vacuuming` 载荷带 `discardLocalCache:true`；客户端同 docName 清缓存重连（空 SV 放行不循环）；`schemaVersion⇒generation` 启动断言（违反拒启）
- [ ] vacuum 前后 generation/docName 不变断言+换代预演（generation 路径独立用例）绿→Commit。

### Task 13: G6 门——Runtime Feed 最小闭环+单实例故障恢复
**Files:** apps/api runtime-feed.service.ts（新）；web runtime store 接线；registry 恢复路径
- [ ] Feed 最小：REST 快照端点+游标（docSeq/状态水位）+stateless 通知（onStateless 唤醒）+重连续传（游标失效全量）；UI=unknown 不显示 idle 契约首达
- [ ] **G6 故障演练**：kill -9 每阶段/坏 WAL 段/PG 不可用/磁盘满/重启——恢复顺序=WAL→PG 前缀校验→重建→开放写；无法证明一致=fail-closed 拒服务
- [ ] **G6 go/no-go 判定**+观测指标落地（wal_fsync_latency/wal_pending_bytes/doc_pg_lag_seq/doc_prefix_gap_total/doc_recovery_total/doc_frame_rejected_total）→Commit。

### Task 14: P1 出口
- [ ] G1/G2/G6 证据汇编+verify 全绿→**用户确认点②**→Commit。

## P2：内容（T15-T20；G3 工程门）

### Task 15: 容器规则先行+Y.Text 域
**Files:** canvasIntents 写路径+collab-doc-writer；audioGen/multiImageGen prompt 域；nodeStore 文本域
- [ ] 先红：整串覆盖写被拒（getHTML/整串 diff 形态）=红；懒建容器掩盖结构错误=红
- [ ] 容器=结构创建时一次性建（唯一创建者=写 seam+缺=拒绝不懒建）；undo 重建合法；恢复不夹带 server 字段；nodeId 即身份（PG lifecycleSeq 预备——P3 T26 落表）；Y.Text 域：audioGen.prompt/multiImageGen.prompt=textInput.prompt（Y.Map{text:Y.Text}——T2 请求通道外的 doc 持久形本卡落）+splice 单一 seam+整串覆盖拒；image/video prompt=XmlFragment（T16）
- [ ] IME/粘贴/选区/两端同位插入并发用例绿→Commit。

### Task 16: XmlFragment+Tiptap 双端（G3 主体）
**Files:** TextInputNode/PromptInput/TextNodeFullscreen/TextNodeToolbar；apps/web package.json（y-prosemirror exact pin）
- [ ] 先红：现 getHTML 整串写 data.content=红；两客户端格式化合并后树合法性=红
- [ ] content=嵌套 XmlFragment（容器规则=T15）；PromptInput（image/video 域）=XmlFragment+mention(/,@)+image PM 节点（PromptValue{text,html,referencedImageIds} 三出口）；单 editor 实例（全屏/工具栏复用）；plugin 首次事务前注册；getHTML 只读导出
- [ ] **G3 用例**：双端并发格式化/mention 插入/图片引用/粘贴/删除节点 fragment 随子树/undo 重建恢复→**G3 go/no-go 判定**（不过=调容器或绑定，禁 JSON 垫片）→Commit。

### Task 17: 媒体列表 Y.Array 单卡
**Files:** nodeStore:716-720；canvasIntents:151-157；useImageUpload；CanvasView:261-264；ImageGenNode:189-198；读者（imageNodeApi:26 等）
- [ ] 先红：整串数组替换（并发 add/remove 丢一方反例）=红
- [ ] allImages/images=Y.Array<item>（写读同卡改道——census 清单）；并发 add/remove/reorder/undo 用例；media-refs 读侧双形态收敛维持
- [ ] 绿→Commit。

### Task 18: 单 UndoManager+E26 精确释放+per-tab 缓存
**Files:** canvasUndo.ts:15-31,:41-43；local-collab-cache.ts（记录扩展）
- [ ] 先红：①shift 截断后 encodeStateAsUpdate 字节不回落（现行泄漏）=红②两标签 dirty LWW 丢一方（构造双 tab 离线编辑语料）=红
- [ ] 单 manager+`addToScope(fragment)`（编辑器挂载时——T0 spike④ 结论）；不挂 yUndoPlugin；Ctrl+Z 薄 keymap 焦点路由；**E26 精确交集释放**（被截断出栈项∧扣除剩余栈项引用交集——keepItem parent 链实证）；clear() 仅字节预算硬兜底；500ms 合并窗口用例
- [ ] per-tab 缓存：记录{tabId,snapshot,stateVector,savedSeq,unsyncedDirty,diverged,at}+boot mergeUpdates 并集+clean 不覆盖 dirty+同步成功删己+generation/vacuum 清整族+IDB blocked 降级
- [ ] B16 继承组+多标签用例绿→Commit。

### Task 19: 全读者改道+旧字段删除
**Files:** web 全读者（census ③）+api video-work-clone:33+registry rebuild:635；snapshot-filter；execAligned/data.status fallback（execAligned 留至 T22 feed 切换后删）
- [ ] 先红：改道后删 data.fileId/result/status 写者→任一读者 broken=红（census 门——含服务端）
- [ ] 全读者投影合成改道 DocCodec read model；公开快照 toPublicReadModel sanitize+缓存键 (pid,g,snapshotRev)+ETag=appendSeq；position Y.Map 逐键并发断言；**exec 根 doc 侧读者本卡起零新增**（T0 census⑤ 门）
- [ ] G28 继承（broken reader 零——web+server）绿→Commit。

### Task 20: P2 出口
- [ ] G3 证据汇编+verify 全绿→**用户确认点③**→Commit。

## P3：业务（T21-T28；G4/G5 工程门）

### Task 21: G4 门——ExecutionRequest+docSeq+save barrier
**Files:** 迁移二（ExecutionRequest/NodeExecution/ExecutionOutbox/MaterializeRun/RefundObligation/NodeLifecycle(lifecycleSeq)/DeliveryFence——字段=spec §6.1/6.2/6.5+T5 冻结）；execution.controller/service；web save barrier 客户端
- [ ] 先红：①受理后改 prompt/拓扑/上游→执行仍用快照（重放用例）=红②paramsHash 重放一致=红③并发两请求互串=红④前缀校验失败落半行=红
- [ ] 客户端：save barrier（onStateless {nonce,...}→**处理器首语句同步捕获前缀**→flush→回执 {nonce,committedSeq}）→execute 带 docSeq；服务端：等 `appendSeq>=docSeq`→受理事务冻结全字段（256KB+PII 策略）；GenerationIntent=claim 创建关联 requestId；worker 请求链零 doc 读
- [ ] **G4 go/no-go 判定**→Commit。

### Task 22: G5 门——PG 权威执行态+Outbox+Feed 全量+服务端 doc 写零化
**Files:** collab-document.service.ts:248-264（deliverArtifact 改 PG 写——**不变量⑥首达**）；runtime-feed.service.ts 全量；projection-outbox.poller；尺寸模式接线
- [ ] 先红：①serving 期服务端写 doc（deliverArtifact 现状）=红（不变量测试）②feed 漏推后状态错乱（断线语料）=红
- [ ] NodeExecution 当前行+projectedExecSeq/projectedEventVersion 元组+ExecutionOutbox（generation+businessKey+claim lease SKIP LOCKED）；ArtifactProjection 分步退役；**尺寸模式**：服务端计算→PG 记录→feed 下发→客户端用户域 origin+白名单写 doc；Feed 全量：快照+游标续传+stateless 通知+缺口对账+旧代事件隔离；UI unknown 契约
- [ ] **G5 用例**：断线/漏推/重复/乱序/旧代/游标失效全量快照→**G5 go/no-go 判定**（旧投影写者保留至本卡过门后 T32 删）→Commit。

### Task 23: worker fencing+交付幂等+退款义务+资源回收
**Files:** 迁移三（StorageReservation 状态机列+ObjectManifest 扩/GC claim）；materialize-job；team-credit；safe-remote-fetch
- [ ] 先红：旧 run 迟到退款误命中（时序交错）=红；lease 过期在飞 reservation 被释放（oversale）=红；GC 交错误删=红
- [ ] materializeRunId/expectedExecSeq fencing（B12/B17 继承）；交付状态机（受控任务→受限 key→校验→fencing 事务终局→outbox→清理——spec §6.3）；RefundObligation（unique(intentRowId,execSeq)+reversesId 幂等）；StorageReservation 终态释放+upperBoundBytes 必填（无值 fail-closed）；ObjectManifest delete-claim+有界 orphan
- [ ] 全组绿→Commit。

### Task 24: 收缩 FrameGate+协议错误面收口
**Files:** collab-frame-gate（T9 基础上扩语义面）；@hocuspocus/server errorHandler 注入或 post-check
- [ ] 先红：①写 exec 根/未知类型/未知键/值类型错/容器替换/raw update 替换 live 现放行=红②apply 抛错后假 ACK（esm:277-281 现状）=红
- [ ] DENY 面（schema 权限+exec 根+预算+clientID 绑定——session guard 扩展首见绑定/跨连接冒用拒）；NORMALIZE 面（悬挂边/父链环/跨组/重复边——读侧屏蔽+graph_anomaly_total）；**不 patch y-protocols**：首选服务端注入 errorHandler（apply 成功才 ACK）+post-check（gate 内部 decode 结果 vs doc.store 精确对账——SV/时钟而非模糊）；最小 patch 仅 @hocuspocus/server 侧+固定版本+上游差分回归
- [ ] fuzzer（T5 语料+bit-flip）+B5 继承（不假 ACK/receipt 不一致隔离重载）绿→Commit。

### Task 25: 拒帧恢复+4411+4410 三分+恢复模式
**Files:** shared collab-close-code.ts；web rejected-recovery.ts；runtime 恢复路径
- [ ] 先红：被拒后重复 apply 服务器态「修复」=红（CRDT 单调性反例）；g_client>g_server 静默 purge（现状导出→reload 缺接受路径）=红
- [ ] 4411 注册链+resolveCloseAction 档；REJECTED/DIVERGED 状态机（DraftEnvelope+merge policy+同代 fresh doc+TypedDraft+多标签 BroadcastChannel）；4410 三分（generation-stale 全会话重建/doc-vacuuming 同 name 清缓存/**server-restored 只读 recovery+草稿导出+管理员裁定**）
- [ ] B6/B7 继承组绿→Commit。

### Task 26: 生命周期义务观察器
**Files:** collab-lifecycle-observer.service.ts（新）；NodeLifecycle/DeliveryFence（迁移二已建）
- [ ] 先红：删除节点后取消义务无持久提交点（删 A/并发 finalize 两序反例）=红
- [ ] 只读观察已受理帧事务→义务行**与对应帧前缀 PG 批事务同事务落库**；反向索引（edgesByNode/mediaRefsByNode 装载建+增量维护——incident O(1)）；lifecycleSeq 数值序+当前行 partial unique；用例：delete 已删 no-op 不二次退款/undo 重建=新 lifecycleSeq/delete+restore 同帧两行/两项目同 nodeId 不互串
- [ ] B11/B12 继承组绿→Commit。

### Task 27: 维护窗口+世代切换（执行门）
**Files:** collab-maintenance.service.ts（新）+REST gateway（admin guard+幂等键）+scripts/collab-rebuild-gen.mjs；MaintenanceOperation 消费
- [ ] 先红：QUIESCING 后 drain flush 被拒=红；CLI 无租约直写=红
- [ ] freeze（gate 停收标志）→drain（全部已受理帧至 PG——单串行口无需 epoch）→unload→export（DocCodec canonical）→fresh doc→generation++→snapshot0；stage/水位持久化；空画布保头升代；归档=一份 PG dump 回滚；**世代切换首次真跑=执行门——单独请用户确认**
- [ ] 每 stage kill -9 演练+G9 继承组绿→Commit。

### Task 28: P3 出口
- [ ] G4/G5 证据汇编+增量投影（YEvent path[0] observeDeep——单节点 patch 断言）+verify 全绿→**用户确认点④**→Commit。

## P4：交付（T30-T34；T29=独立生产前置批不在本批）

### Task 29（占位）: 生产前置批 charter（独立批——owner/date 待定）
- [ ] charter stub 落 runbook：PITR RPO≤5min/RTO≤30min+MinIO 版本化 RPO≤15min+季度 restore drill+每小时 replay canary+HA 决策+混沌矩阵——**未过不得开放生产流量**（本批发布说明=单机/dev-test 诚实登记）。

### Task 30: reset-collab 工具+部署顺序
**Files:** scripts/reset-collab.mjs（新）；deploy.sh+gate-decision.mjs；collab-ops-runbook.md
- [ ] 先红：deploy 在旧消费者在线时 reset=红（顺序断言）；gate 判据缺 inflight/stranded 阻断=红
- [ ] reset 可重复执行（drop/recreate/清 spool/清本地缓存键/清公开快照缓存）+种子；破坏性发布流程（维护关写→drain→**停全部旧 DB 消费者**→reset/schema deploy→部署→就绪检查→开放写）；迁移串行校验（禁并行同 schema 状态）
- [ ] 空库 reset→migrate→seed→双端协作全绿→Commit。

### Task 31: 故障演练矩阵
- [ ] kill -9 每阶段（spool/apply/批提交/快照/维护）；PG failover；网络分区；磁盘满；OOM；时钟偏移；双浏览器/多标签/IDB blocked/断网重连/拒帧恢复/reset 后重连（B3 形态：内容根恢复+exec 从 PG 派生断言）
- [ ] 全部符合耐久契约（fail-closed/隔离恢复/零静默丢弃/水位不越）→Commit。

### Task 32: 删除清单执行（spec §6.7——删码与新路径同可编译切片）
- [ ] 删：doc.exec 读写链+writeExecStatus+applyWriteExecStatusToDoc+deleteExecOrphans+projectExecToStore doc 源（切 runtime store）+deliverArtifact doc 写面+data.fileId/result/status 写者与 fallback+execAligned 旧链+rebuildVacuumDoc exec 搬运+guardSyncFrame 旧面+vacuum generation+1 残留+transform/归档残留（若有）+provider recovery 旧档
- [ ] grep 零锚点断言进 verify（T0 census⑤/⑥ 清单逐项）；`doc.getMap('exec')` 写零；服务端 serving 期零业务 doc 写不变量测试常驻 CI
- [ ] 三面 tsc+全测试绿→Commit。

### Task 33: 负载基准
- [ ] 10k 节点冷加载（服务端解码/装载/read model/首屏分轴）+8MiB 混合（传输/解码/fsync/apply/PG 批/投影分轴）+10 连接真实并发；P50/P95/P99+CPU/RSS/IO/PG 锁等待；可见节点 viewport culling 与文档总量分轴
- [ ] **实测转 CI 性能门禁**（不预声称指标——先基准后门禁）→Commit。

### Task 34: 发布门
- [ ] 发布门全绿（verify full+故障演练+负载基准+删除清单+reset 实弹）→**用户确认点⑤=全批终出口**（证据汇编：单机/dev-test 限制+机损 RPO=PG 批延迟诚实登记+T29 前置条件）→Commit。

---

## 执行顺序与关键路径

- **P0（立即）**：T0（4 spike+8 census）→T1/T2（两 bug 先红后绿）→T3/T4（矩阵+codec）→T5（协议冻结）→**确认点①**。
- **P1**：T7（G1）→T8→T9→T10（G2）→T11→T12→T13（G6）→**确认点②**。
- **P2**：T15（容器+Y.Text 先行）→T16（G3）→T17→T18→T19→**确认点③**。
- **P3**：T21（G4）→T22（G5）→T23→T24→T25→T26→T27（执行门）→T28（含增量投影）→**确认点④**。
- **P4**：T30→T31→T32→T33→T34（**确认点⑤**）。T29=独立生产批。
- 关键路径：T3/T4→T7/T9/T10→T12/T13→T15/T16→T21/T22→T24/T26→T30/T32/T34。迁移×3 串行（T7→T21→T23）。

## §0 执行期偏离登记（滚动）

| # | 偏离 | 卡 | 依据 |
|---|---|---|---|
| （执行期填写） | | | |

**旧任务处置映射**（v1.2→v1.3）：旧 T0-T5→新 T0-T5（T2 改最小修/T3 全类型/T4 无 transform/T5 协议扩）；旧 T6-T11→T7-T12+T14（WAL-first 重写/vacuumEpoch/删 admissionEpoch）；旧 T12-T15b→T15-T18+T19（transform 删/单 manager/媒体单卡/lifecycleSeq）；旧 T16-T19→T24/T25/T26/T27+T9（provenance/candidate/shadow 删；屏障=T21 onStateless）；旧 T20-T23→T21-T23（ExecutionRequest 重构）；旧 T24-T27→T19/T22/T28/T33；旧 T28→T30/T31/T34；旧 T29→T29 维持。

**门禁总览**：工程门 G1=T7｜G2=T10｜G6=T13｜G3=T16-T20｜G4=T21｜G5=T22——按证据自判，不过=先改再写码。用户确认点①=T5｜②=T14｜③=T20｜④=T28｜⑤=T34；执行门=T27 世代切换首跑。继承验收锚（v4 语义存续）：genesis 双路= T7｜前缀/装载守卫=T10/T11｜富文本并发=T16｜E26=T18｜broken reader 零=T19｜受理冻结/前缀一致=T21｜feed 可靠=T22｜退款/交付 fencing=T23｜准入 DENY/NORMALIZE=T24｜拒帧恢复=T25｜生命周期义务=T26｜维护演练=T27｜发布门=T34。
