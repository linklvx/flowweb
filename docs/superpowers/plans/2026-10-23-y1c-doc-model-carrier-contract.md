# Y1c：doc 模型 v4·四平面架构 Implementation Plan（P0 契约 / P1 载体 / P2 内容 / P3 业务与恢复 / P4 交付）——v1.7

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

<!-- plan v1.7（2026-10-24）：依据 **spec v5.4（第十轮三外审报告交叉裁决+用户确认采纳——偏离 38）** 对 v1.6 主体保留+定点修订+**P3 重排 T21→T26→T22**。**v1.7 收口要点（接缝与契约）**：①**所有权切换=P1 入口条件**：gateway:340 `onStoreDocument→storeDocumentUnlocked('debounce')`/factory:57 钩子链 T9/T10 同切片拆 telemetry-only——gate pre-apply 的 update 事件会触发库防抖 store=每帧新旧双写（§1.9 实证）；验收=一帧恰一次 WAL append+一次 PG row+一次广播+旧 spool append 计数 0+onStoreDocument 对 connection-origin 零调用。②**CollabProjectActor**（submit/drain ≤20ms/1MiB 一次 fsync 逐帧 apply resolve）+in-flight 去重 promise map（命中 inflight await 原帧 fsync+apply；原帧失败重复帧同错）+FrameEffects 收集（afterTransaction+observeDeep+typeIdToNodeId——T5b 契约/T24 建索引/T26 复用）。③pending 区间预检前移 frame-local（decodeUpdate 区间 vs SV：缺前驱/区间有洞→4412 零 WAL 零 apply；连续覆盖=自包含 SS2 放行；禁 max-clock 单值）+**readOnly/writeFreeze/quota 短路最先**（库检查在 beforeSync 后——VIEWER 帧防写入）。④水位拆义：内存三元 `0≤pgSeq≤appliedSeq≤spoolHeadSeq`；CanvasDoc 列改名 **walCheckpointSeq**（批提交时刻 spoolHeadSeq 采样，永不与 appliedSeq 比较）。⑤historyId：SystemHistory 全局单行唯一权威（删 CanvasDoc 列）+客户端半链（providerVersion h=/缓存键五元/onAuthenticate 先比 historyId 堵同代 PITR 复活/feed cursor 三元/ETag 拼 generation:pgSeq）+段头 lastWriteAt 时间戳栅栏+WAL 帧存 frameHash 跨重启去重。⑥ExecutionRequest：内部 id 主键+historyId 列（重试 409 REQUEST_STALE）+planHash 只盖不可变字段+**资金 per-item 预留**（reservedCredit/expiresAt 15min/sweeper void）+ExecutionInput brotli（raw 8MiB∧stored 2MiB 双限）。⑦frozenDocSeq 正确临界区：**freeze=先拿 gate mutex**→等当前 apply→flushThrough(appliedSeq)→断言 pgSeq==appliedSeq→只读 scope+直接父节点→frozenDocSeq=pgSeq；超时 2s 503/freeze 预算 500ms 回退 PG 重建；同键异 body 409。⑧XML 双层：L1 frame-local struct 扫描（T16 同卡激活——元素名/format key/ContentString 上限/URL 扫描/新子树深度；shared 单表+PM schema 派生 setEqual）+L2 apply 后 changed-subtree walk（T24；毒帧+速率限制防 DoS）。⑨RuntimeProjection 契约+四读径（public 快照发布时 join+projectionSeq 键/导出=render model/**BindMedia·CloneBinding 命令**（复制清空 mediaId/fileId/artifactId）/video-work clone=render model）+merge（nodeVersion 大者胜/墓碑/换代清族）。⑩feed：nodeVersion 单名（snapshot=全量替换统一 cursor——eventVersion/projected 元组废）+事件 taxonomy（v:1/EVENT_KINDS/payload≤64KB/exec.status·exec.artifact·media.fact·node.deleted·doc.vacuumed）+cursor upsert genesis+minRetainedSeq+锁序简化业务行→counter+historyId cursor。⑪maintenance：**行级关闸**（REQUESTED 同事务写 maintenanceId+受理读 IS NULL）+in-flight 含 delivery/outbox+**SWITCHING 事务后 close 4410**+T12 vacuumReplace 委托状态机+4413 定义。⑫S1 验收改写：广播每连接恰一次**含发送者回声**（broadcast 无 filter §1.9 认错）+DirectConnection 门改「serving 期业务写=0」allowlist+去重跨重启+origin 枚举。⑬clientID 单活跃连接。⑭DraftEnvelope B=**用户裁定式**（新增直入/修改逐字段二选一默认保留当前/删除确认）+C=nodeId 不重映射+三行确认面+A=boot 后异常提示。⑮容量：WS maxPayload 16→**9MiB**+认证后入站排队字节上限+fsync **EIO fail-stop**（截断复用仅写前/ENOSPC 档）+WAL 升级序（组提交→4-way hash 分片→全局=新 ADR）+maxResidentDocBytes。⑯T33：错误率=仅 5xx/异常/非预期 1011/断言失败+固定 runner（PR smoke/nightly 硬门）+echo_bytes/apply_replay_ms 软预算超限触发 fork/patch 评审。⑰版本门拆分：protocolVersion+schemaVersion+historyId=硬门，build hash 仅遥测。⑱T29 挂生产前置 gate（synchronous_commit/ProjectErasure/seed·对象存储触发条件数字化/清理 worker）。⑲T19-T21 窗口 dev-only 不部署 beta；S4 基线用 actor 原型。⑳barrier flush ≤250ms 项目级节流+clientSeq 配 sessionEpoch。**架构/门结构/纪律不变**；六项 go/no-go=工程门（manifest+负控）；确认点①=T5/②=T14/③=T20/④=T28/⑤=T34+执行门 T27 维持；每卡先红→绿→commit；迁移×3 串行（T7→T21→T23）。**不再开第十一轮外审——下一步=T9/T10/T21/T22 先红用例**。 -->

<!-- plan v1.5（2026-10-24）：依据 **spec v5.2（f8fd2bc0——第八轮外审采纳+用户两项重裁：勘误精化版）** 对 v1.4（c68087e3）**主体保留+12 卡定点修订**（第八轮外审：「不建议重写全部 34 张任务卡，保留主体修订依赖与少数核心契约」）。**v1.5 收口要点**：①`spoolSeq` 别名删除——CanvasDoc 持久列=`walSeq/pgSeq`，不变量 `0≤pgSeq≤appliedSeq≤walSeq`；②跨表 CHECK 勘误（Snapshot.stateSeq≤pgSeq 由快照发布事务行锁+条件更新保证——T11 机制）；③RuntimeEvent=**per-project feedSeq+同项目行锁内分配且同事务提交**（分配序≡提交序——裸 sequence 分配序≠提交序漏事件洞；S5 实验锚）；④T2=删 :157+**改 execution.service:512 执行读点**（string 直读腿——读链断供实证：`data?.prompt?.text` 只匹配 PromptValue、TextNodeData.prompt:string 恒 miss、textInput 执行 prompt 现状独占依赖 :157 覆盖；上游注入恢复正文语义）+**无 promptText 请求参数**（prompt 权威=doc 单源→T21 服务端从 PG 一致前缀冻结）+同 requestId 断线重试幂等受理；⑤候选文档验证（对照活动 doc 现状增量语义验证——禁全扫）；⑥每帧对照世代权威验证 generation；⑦per-project 写入背压；⑧text 生成链外呼锚（其余链三层防护已在）；⑨ACK 三档+UI 四态映射；⑩savedSeq 只由持久化回执推进；⑪reset 阶段状态持久化；⑫测试三补+性能分轴两补。**架构/门结构/纪律不变**：四平面；六项 go/no-go=工程门（G1@T7/G2@T10/G6a@T13/G3@T16-T20/G4@T21/G5@T22）；用户确认点①=T5/②=T14/③=T20/④=T28/⑤=T34+执行门 T27（**第八轮外审建议取消确认点——用户 2026-10-24 驳回，维持**）；每卡先红→绿→commit；迁移×3 串行（T7→T21→T23）。 -->

**Goal:** 落地 doc 模型 v4 四平面架构——P0 契约冻结（全类型矩阵+DocCodec 真 Yjs 双出口+两现行 bug〔含执行读点改向〕+水位 walSeq/appliedSeq/pgSeq+**gate pre-apply apply 归属**+ExecutionRequest 父子行/RuntimeEvent per-project feedSeq/WAL 帧协议+historyId 收口）→P1 载体垂直切片（spool-first 写管线〔gate pre-apply〕+applied 前缀批量 PG+**barrier 服务端接线**+快照/vacuum 换代+G6a doc 平面故障恢复）→P2 内容（容器规则+Y.Text/XmlFragment/媒体数组+Tiptap 双端+单 UndoManager 收口+读者改道〔只改读者+双读类型〕）→P3 业务（ExecutionRequest 父子行+PG 权威执行态+RuntimeEvent Feed 全量+**投影 overlay**+同切片切交付+收缩 FrameGate〔DENY/NORMALIZE/版本门〕+维护窗口〔9 段转移表〕）→P4 交付（reset 工具+**T30b 切换演练**+故障演练+多项目负载〔硬/软分档〕+删除清单+发布门〔manifest〕）。

**Architecture:** 见 spec v5.4 §2-§7。核心不变量：①客户端帧由 gate（CollabProjectActor）拥有持久化与 apply（listener 禁 connection-origin 二次 append；**onStoreDocument 旧链 T9/T10 拆 telemetry-only——单一所有权**）；②ACK 前帧已 WAL fsync 且已 apply（重复帧 await 原帧完成）；③snapshot 只从 PG 前缀（≤pgSeq）生成（跨表一致性=发布事务行锁）；④barrier 捕获 target=appliedSeq、回执 committedSeq=pgSeq；⑤**PG 只提交已 apply 帧（上界=appliedSeq）**；⑥业务输赢由 PG 事务+fencing 裁定；⑦服务端 serving 期零业务 doc 写（派生字段永不进 doc——CanvasRenderModel=CanvasReadModel⊕RuntimeProjection）；⑧内存水位三元 0≤pgSeq≤appliedSeq≤spoolHeadSeq（CanvasDoc.walCheckpointSeq=批检查点采样，永不与 appliedSeq 比较）。

**Tech Stack:** TypeScript strict / Yjs exact 13.6.32（shared 亦直用——T4）/ @hocuspocus/server（**exact pin 4.6.0——不升级 4.7.x、不引入 patch-package**；apply 归属=gate pre-apply，库内 apply=幂等重放；**S1=九验收契约测试锁定行为——升级致顺序变化即红**）/ y-prosemirror（本库现未用——T16 按 v4-4.3 引入 ySyncPlugin 直绑嵌套 fragment；exact pin+事务 origin 由 S3 spike 定，按需 addTrackedOrigin）/ @tiptap/react 2.10.0 / NestJS / Prisma / vitest+node:test / CI postgres。

**执行纪律：** 每卡先红→绿→commit；写码前 grep 实证；行号=c68087e3 快照；三面 tsc；文档 diff 随卡；迁移串行不并行；每阶段出口用户确认。

## 文件结构（触碰面全景）

| 文件 | 动作 | 责任 | 阶段 |
|---|---|---|---|
| packages/shared/package.json+src/canvas/doc-schema-v4.ts | **建/改** | shared 增 yjs@13.6.32 依赖；全类型树形矩阵+meta 白名单+DataKeySpec **二元**（writer:'server' 字段禁入 doc）+XML_ELEMENTS/MARKS/ATTRS 单表（T3/T4/T16） | P0 |
| packages/shared/src/canvas/doc-codec.ts | **建** | canonical+toReadModel+toPublicReadModel——**真 Yjs 类型直用**（T4） | P0 |
| packages/shared/src/canvas/docShape.ts+canvas-doc-manifest.ts | 改 | 键分类/准入面共用；re-export 删除（T4/T19） | P0/P2 |
| packages/shared/src/collab/{draft-envelope,runtime-event,doc-protocol}.ts | **建** | DraftEnvelope(+merge policy)/RuntimeEvent per-project feedSeq DDL+游标语义/水位三元 walSeq·appliedSeq·pgSeq+WAL 帧协议+ACK 四态 UI 映射+Hocuspocus 方案契约（T5） | P0 |
| apps/web/src/stores/nodeStore.ts:20,:225,:719,:725+AddNodeMenu:92+canvasStore:159-166 | 改 | bug① textInput 单源+nodeTypeMap 收口（T1） | P0 |
| nodes/TextConfigPanel.tsx:157+**apps/api execution.service.ts:512（执行读点改向）+shared resolvePromptText** | 改 | bug② 修=删 :157 覆盖写+:512 改调 **resolvePromptText 单函数**——**无请求参数**（T2） | P0 |
| scripts/check-collab-cjs.mjs 扩+ADR-01 单实例 | **建** | census 静态门（未分类字段红/服务端读者/裸构造/doc.exec 触碰零增长）+单实例 ADR（T5/T8） | P0/P1 |
| apps/api/prisma/schema.prisma+迁移×3 | 改 | P1 载体族（CanvasDoc 水位双列 **walCheckpointSeq**/pgSeq+同行 CHECK+**SystemHistory 单行**+RuntimeFeedCursor/Snapshot〔跨表走发布事务〕/Update 批行形状 actorRanges/MaintenanceOperation 扩展〔maintenanceId 行级关闸〕——删 appendSeq/admissionCutoff/@@unique([maintenanceId])/DocWriteAudit）→P3 业务族（ExecutionRequest 父子行+ExecutionInput/RuntimeEvent taxonomy/NodeExecution+generation 列+nodeVersion/ExecutionOutbox/MaterializeRun/RefundObligation/NodeLifecycle(lifecycleSeq)/DeliveryFence）→P3 资源族（StorageReservation/ObjectManifest claim）（T7/T21/T23） | P1/P3 |
| collab-frame-gate.service.ts（重写现 guardSyncFrame） | 改/**建** | beforeSync 准入（每帧世代+frame-local DENY）+SHA-256 去重+spool-first+**gate pre-apply**+帧字节精确 copy+毒帧/pending 路径（T9/T24） | P1/P3 |
| collab-spool.service.ts+collab-persistence.service.ts | 改 | 帧协议升级（帧带 generation+frameHash）+applied 前缀批量 PG+水位拆义（spoolHeadSeq/walCheckpointSeq）+背压+**onStoreDocument 旧链拆除（所有权切换）**（T8-T11） | P1 |
| collab-doc-registry.service.ts:628-698（rebuildVacuumDoc/guardSyncFrame preVacuumSv 分支） | 改/**删** | vacuum=generation++/新 docName+preVacuumSv 门退役（T12/T24/T32） | P1/P3/P4 |
| collab-document.service.ts:194-224,:248-264,:307-326（vacuumReplace/deliverArtifact/writeExecStatus） | 改/**删** | vacuum 换代（T12）/deliverArtifact 改 PG 写+doc 写零化+doc.exec 停写停读（T22）/writeExecStatus 退役（T32） | P1/P3/P4 |
| apps/api runtime-feed.service.ts（新）+web runtime store | **建** | RuntimeEvent 快照+per-project feedSeq 游标（行锁分配）+心跳+续传（T22/G5） | P3 |
| canvasUndo.ts | 改 | 单 manager 收口：不 addToScope/栈上限 100+整栈 clear（T18） | P2 |
| TextInputNode/PromptInput/ImageExtConfigPanel/PromptEditor/TextNodeFullscreen/TextNodeToolbar+canvasIntents | 改 | XmlFragment 双端（含 imageExtGen 域）+容器唯一创建+Y.Text 域（T15/T16） | P2 |
| AudioConfigPanel/MultiImageConfigPanel+nodeStore:162,:175 | 改 | audioGen content→prompt Y.Text 迁移+multiImageGen prompt 死字段赋形（T15） | P2 |
| nodeStore:716-720/useImageUpload/CanvasView/ImageGenNode | 改 | 媒体列表 Y.Array 单卡（T17） | P2 |
| execution.service/generation-intent/materialize/team-credit+**api-caller.service.ts（text 链外呼锚）** | 改 | ExecutionRequest 全计划+docSeq=pgSeq+PG 一致前缀读（promptText 服务端冻结）+幂等受理+worker 零 doc 读+fencing+退款+text 链锚（T21-T23） | P3 |
| collab-server.factory.ts | 改 | onStateless 接线（save barrier——现状未接；v1.6 前移 T10；无 patch/无升级挂载） | P1 |
| collab-lifecycle-observer.service.ts（新） | **建** | 只读观察+per-walSeq 义务 buffer 与 PG 批同事务+反向索引（T26） | P3 |
| collab-maintenance.service.ts+REST gateway+rebuild 脚本 | **建** | 维护窗口+stage enum+水位承接（跨代连续 seq——T12 落定形态：水位保留不重置，purgeBelowSeq 清档/currentSnapshotRev 归 0）+WAL 切代+admin guard（T27） | P3 |
| packages/shared/src/constants/collab-close-code.ts+web recovery | 改/**建** | 4411+4410 三分（doc-vacuuming 换代+dirty draft 导出）+server-restored 接受路径（T25） | P3 |
| apps/web 全读者~27 处/14 文件+api video-work-clone:33+registry rebuild:635 | 改 | read model 改道（**只改读者——写者保留至 T22/T32**）+ETag=pgSeq（T19） | P2 |
| canvasCollabRuntime.ts+local-collab-cache.ts | 改 | per-tab 缓存 mergeUpdates（savedSeq 只由持久化回执推进）+增量投影+save barrier 客户端（T18/T21/T28 前移项） | P2/P3 |
| deploy.sh+scripts/reset-collab.mjs+collab-ops-runbook+T29 charter | 改/**建** | reset 工具（阶段状态持久化）+发布门+生产硬门 charter（T29/T30/T34） | P4 |

**不动红线**：NODE_ENVELOPE_KEYS；ecosystem 双进程（compact=COLLAB_ROLE worker 真进程隔离）；yjs 私有 API 禁令（不做 struct adapter/不 keepItem/不 doc.store——incarnation=PG lifecycleSeq）；四平面职责边界（业务状态禁回 doc）；**ExecutionOutbox 禁作 feed 日志**。

---

## P0：契约（T0-T6——除两 bug 外零生产代码变更）

### Task 0: 基线 spike+census 固化
**Files:** spike/census 产出记入本卡（零生产代码）
- [ ] **五个 spike（v1.6 修订 S1；S4 定形）**：**S1 Hocuspocus 4.6.0 apply 顺序契约测试（v1.7 验收改写——三处 v1.6 假验收修正）**——真 Server+真 ws client 覆盖九验收：①合法帧 gate pre-apply→库内重放**零额外 update 事件**→恰一次 `SyncStatus(true)`；②**广播到全部连接恰一次（含发送者回声——broadcast 无 filter §1.9 认错；发送者收自身 update 后 apply=no-op 零 UI 副作用；echo 字节数=连接数×帧字节断言）**；③坏帧（构造 malformed update）→gate 抛错→close 4411 **无** SyncStatus(true)+WAL 截断至 appliedSeq+doc 不变；④重复帧 SHA-256 命中=**in-flight 时 await 原帧 fsync+apply 完成后放行**（并发同字节双连接→一个 walSeq+两 ACK 均在 fsync 后；原帧失败重复帧同错）+applied 后 no-op+库内重放幂等零二次广播；⑤SS1 路径零 WAL 帧+SS2 与 Update 双路径覆盖+**VIEWER/writeFreeze/超配额发 Update→doc 不变（readOnly 短路——库检查在 beforeSync 后）**；⑥awareness 路径不受影响；⑦`onLoadDocument` 产 update 但零 WAL 帧（**origin 枚举计数器 gate|connection|load|import|maintenance|server-direct——仅 server-direct serving 写告警**）；⑧**「serving 期业务 doc 写经 DirectConnection=0」静态门（allowlist=load/replay/maintenance/readCanvas/withDoc 读路径——withDoc:78 在役；census 全调用点标注读/生命周期/业务写）**；⑨**onStoreDocument 对 connection-origin 零调用（所有权切换验收——旧防抖 store 不触发）**——升级 4.7.x 致任一顺序变化=此测试先红（行为锁）。**S2 vacuum 离线重连推演**——旧缓存/旧 SV（全 clock<pre 部分陈旧客户端）/dirty draft 三形态对「旧 #g auth 拒绝→DraftEnvelope 导出（三场景表）→清缓存→新 name 重连导入（新 Schema/权限/图结构校验）」全链。**S3 undo origin/scope**——`UndoManager([nodes,edges])` 对嵌套 Y.Text/XmlFragment 变更捕获实证（changedParentTypes 父链）+y-prosemirror exact pin 调研（@tiptap/react 2.10.0 ProseMirror 矩阵）+ySyncPlugin 事务 origin 实测（≠LocalUser 则 T16 addTrackedOrigin）——**证明 addToScope 不需要**。**S4 WAL 多项目 fsync 放大+恢复扫描（v1.7：基线用 CollabProjectActor 原型管线测——旧 per-frame 管线数据不作拓扑依据）**——actor 队列原型（submit/drain ≤20ms/1MiB）下 10 项目×10 连接基线；p95>20ms 持续=**升级序：组提交调优→4-way hash(projectId)%4 分片日志（每片独立 writer/fsync）→仍不达标全局 WAL=新 ADR**；**恢复扫描验证**（坏段尾部截断/隔离后完整有效前缀重建+**段头 historyId 不匹配+lastWriteAt>epochStartedAt 时间戳栅栏双 quarantine**）。**S5 feedSeq 提交顺序实验**——PG 裸 sequence 分配序≠提交序复现（事务 A 取号未提交/B 先提交→游标漏 A）+**RuntimeFeedCursor 专用计数行 `UPDATE lastSeq=lastSeq+1 RETURNING` 行锁方案验证**（分配序≡提交序；锁序契约：counter 最后拿——与 canvas_doc_update_seq 先例〔repository:61-62〕对照定案）
- [ ] **census 固化（v1.6 补三项）**：①节点类型全集（真实创建/保存/加载/执行/导入/导出路径——group/videoEdit 必入册）②全类型字段路径 census（envelope+data 键树——**现状基准：audioGen prompt 住 content:string〔AudioConfigPanel textarea〕；multiImageGen.prompt=零写点死字段；textInput data.prompt:string 每键击落 doc；执行读点 :512 现状 `.text` miss string**）③readRecordsFromMaps 全调用点（web+server）④textInput prompt 全消费面（含 execution.service:512+topology:83-84 上游注入）⑤doc.exec 全触碰面清单（P3/P4 删除输入）⑥服务端写 doc 全路径清单（不变量验收输入）⑦39 裸 `project:${pid}` ⑧per-tab 缓存现状与 IDB 键面 ⑨**全仓 `Y.applyUpdate` 消费面（inbound doc apply 只许 gate/load/import 三处——其余零；lint 门输入）** ⑩**`doc_advisory_xact_lock`+`canvas_doc_update_seq` 全消费面（T10 删除前置——仅 doc 写路径用则删，他处依赖另裁）** ⑪**义务种类候选对照真实子系统（ExecutionOutbox/MediaFactOutbox/搜索/公开快照/配额——T5b 定员输入）**
- [ ] Commit（spike 结论〔S1 版本决策/S3 origin 结论/S4 WAL 拓扑决策/S5 行锁形态〕+census 清单）。

### Task 1: bug① isTextNode 统一+创建链单源
**Files:** nodeStore.ts:20,:225,:719,:725；AddNodeMenu.tsx:92；canvasStore.ts:159-166；TextInputNode.test.tsx:84,:91；nodeStore.test.ts:543
- [ ] 先红：夹具改生产名 `'textInput'`+删 isTextNode mock→重挂载断言正文保留→**红**
- [ ] 绿：isTextNode 判 NODE_TYPES.TEXT；删 :613-621 幽灵兜底；:719/:725 裸字面量全清；AddNodeMenu:92+nodeTypeMap 翻译链收口；创建类型断言（resolvedType∈值集）
- [ ] 全仓 grep 节点 type 裸字面量清零；web tsc+测试绿→Commit。

### Task 2: bug② 修——删 :157 覆盖写+改 :512 执行读点（无请求参数）
**Files:** nodes/TextConfigPanel.tsx:157；**apps/api/src/modules/execution/execution.service.ts:512（执行读点）**；回归+E2E
- [ ] 先红：①「生成后正文不被覆盖」（现 :157 用 prompt 覆盖 content）→**红**②**textInput 无上游文本时执行 prompt 读 `data.prompt:string`**（改前 `data?.prompt?.text` 对 string 恒 miss→落 content 正文/'Hello' 兜底——面板 prompt 执行链断供实证）→**红**③E2E「输入 prompt→取消选中→重新选中→prompt 仍在→生成使用该值」→**红**
- [ ] 绿：**:157 删覆盖写（仅此一行——onChange :204-212 每键击写 data.prompt:string 的现状持久化保留**，不写过渡形状不删持久化）；**shared 建 `resolvePromptText(data)` 单函数（v1.7 认账补落——`typeof data?.prompt==='string' ? data.prompt : data?.prompt?.text ?? data?.content ?? ''`）+单测试文件（string/PromptValue/空三形态参数化）**；**:512 执行读点改调 resolvePromptText（此后 T15 只改函数实现与单测——执行读点永不再改）**；**上游注入恢复正文语义**（topology:83-84 读上游 textInput content=tiptap 正文——:157 删除后语义自动归正，测试锚明示）；**无 promptText 请求参数**（prompt 权威=doc 单源；T21 服务端从 PG 一致前缀冻结 ExecutionRequest.promptText）；终形 prompt=Y.Map{text:Y.Text} 待 T15 迁移（改 resolvePromptText 内部实现）
- [ ] 测试绿（含 audioGen content 现状不动——T15 迁）→Commit。

### Task 3: DOC_SCHEMA_V4 全类型树形矩阵+DataKeySpec 二元（v1.6）
**Files:** packages/shared/src/canvas/doc-schema-v4.ts（新）+schema-contract.spec.ts（新）
- [ ] 表形（树形+全类型+容器语义——spec §3.1 v5.3 矩阵冻结为唯一基准）：

```ts
export type YFieldType = 'text' | 'xml' | 'map' | 'array' | 'lww-array' | 'lww' | 'server-forbidden';
export interface DataKeySpec {
  yType: YFieldType;
  writer: 'user' | 'server';            // 谁可写（权限矩阵）——v1.6：二元；writer:'server' 字段一律禁入 doc（服务端派生只住 PG+Feed）
  reader: string[]; permission: 'free' | 'protected'; undo: boolean; mediaRef: boolean;
  importExport: boolean; maxBytes?: number; items?: DataKeySpec; children?: Record<string, DataKeySpec>;
  canCreate: boolean; canWrite: boolean; canDelete: boolean; // 三操作矩阵
  inExecutionPlan: boolean; // 是否参与执行计划冻结（v5.2——偏离 36 注记）
}
export const DOC_SCHEMA_V4: Record<string /*nodeType 全集含 group/videoEdit*/, { envelope: readonly string[]; data: Record<string, DataKeySpec>; }>;
export const META_WHITELIST: readonly string[];
// 未知类型=显式 schema 错误（写拒+读侧只读保真策略标注）；exec 根不在 schema——写入即 DENY
// v1.6 删 valueSource/authority 两键（display-cache 废止）；Y1a order/slot：envelope=NODE_ENVELOPE_KEYS 派生+data 基类 spec 必含 order:'lww'（适用类型）——setEqual 断言
// 矩阵基准：textInput{content:xml, prompt:map{text}}；audioGen/multiImageGen{prompt:text}；imageGen/videoGen/imageExtGen{prompt:xml}；allImages/images=array
```

- [ ] 先红：schema-contract.spec——「census①全集逐类型 envelope+data 全路径穷举」「**writer:'server' 字段不得出现在 DOC_SCHEMA_V4（如需标注用 yType:'server-forbidden'——v1.7 删 ownership 残留断言）**」「**Y1a envelope=setEqual(NODE_ENVELOPE_KEYS)+order/slot 键覆盖（缺一即红——v1.6）**」「键集与 canvas-doc-manifest 现键零漂移」「META_WHITELIST ⊆ meta 现键」（现无类型维度=红前置）
- [ ] 绿+断言族全绿→Commit。

### Task 4: DocCodec 双出口——真 Yjs 类型直用（删 zero-yjs）
**Files:** packages/shared/package.json（+yjs@13.6.32）；packages/shared/src/canvas/doc-codec.ts（新）+round-trip 属性测试
- [ ] 接口：`serializeCanvas(doc: Y.Doc): CanvasDocument`（canonical——备份/重建/semanticEqual）+`toReadModel(doc: Y.Doc): CanvasReadModel`（plain JSON——REST/执行/导出；文本显式 string，富文本 PM JSON/HTML）+`toPublicReadModel(readModel, policy)`（公开快照 sanitize+URL allowlist）；readCanvas 只返回 read model——禁止共享类型逃逸；**无 transformV3ToV4Draft**（硬重置——spec v5-13）
- [ ] **DocLike fake 镜像不建**（zero-yjs 废止——偏离 33；shared 直用真 Y.Doc/Y.Map/Y.Text/Y.XmlFragment/Y.Array）；readRecordsFromMaps 收编唯一 import；docShape re-export 删除——调用点（census③含服务端）全量改道
- [ ] 先红：round-trip 属性测试（含 XmlFragment/mention/image PM 节点/Y.Array 媒体/position Y.Map 逐键——语义相等非字节相等）→绿+census 门→Commit。

### Task 5: 协议契约冻结收口（v1.6：三段冻结面 T5a/T5b/T5c——同一确认点①）
**Files:** packages/shared/src/collab/{draft-envelope,runtime-event,doc-protocol}.ts（新）+xml-schema.ts（新——T16/T24 消费）+耐久常量+runbook 草节+fixture
- [ ] **T5a 载体/协议**：**水位拆义（偏离 38⑥）**——内存三元 `0≤pgSeq≤appliedSeq≤spoolHeadSeq`+CanvasDoc 列改名 **walCheckpointSeq**（批提交时刻 spoolHeadSeq 采样+同行 CHECK pgSeq≤walCheckpointSeq——**永不与 appliedSeq 比较**）+跨表不变量=快照发布事务（非 CHECK）+ETag/docSeq/committedSeq=pgSeq；**apply 归属（偏离 37①+38③）**——**CollabProjectActor**（submit/drain ≤20ms/1MiB 一次 fsync 逐帧 apply resolve）pre-apply 时序（**⓪readOnly/writeFreeze/quota 短路最先**→frame-local 验证→**pending 区间预检**→去重〔promise map〕→spool+fsync→apply〔origin=`{source:'connection',connection,gate:true}`〕→appliedSeq=walSeq→Hocuspocus 幂等重放→恰一次 SyncStatus(true)）+毒帧协议（WAL 截断至 appliedSeq/4411/pgSeq 重放）+**pending 区间法（decodeUpdate 各 client 区间 vs SV——缺前驱/区间有洞→4412 零 WAL 零 apply；连续覆盖=自包含 SS2 放行；禁 max-clock 单值；检后仍现 pending=毒帧 4411）**+**fsync 分档（写前失败/ENOSPC=截断复用 seq；EIO=fail-stop walHealthy=false/close 1011/要求重启）**+**beforeUnloadDocument drain 纪律+maxResidentDocBytes**；**save barrier（偏离 37⑦+38⑳）**——target=appliedSeq+`{nonce,clientSeq,committedSeq}` 回执+handler 首语句同步捕获/nonce 幂等/永不 throw/显式 sendStateless+触发数字（800ms idle/5s 上限/pagehide/执行前）+**clientSeq 配 tabId/sessionEpoch**+**服务端项目级 flush 节流 ≤250ms（flushThrough 契约=幂等/有界/不阻塞写/返回当前 pgSeq）**+durable watermark 广播（≤1 次/秒，仅辅助）；**WAL 帧协议+段头（偏离 38④⑦）**——SHA-256 去重（先于 walSeq 分配；**帧记录存 frameHash+启动重建有界索引 24h/100k——跨重启零重复 walSeq**）/帧带 generation/**段头 {magic,version,projectId,generation,historyId,lastWriteAt,createdAt}**/CRC 边界/坏段四档+**historyId quarantine（≠SystemHistory）+lastWriteAt>epochStartedAt 时间戳栅栏（防忘 bump）**/`--adopt-wal` 窄窗+审计/换代 namespace 切段；**ACK 三档+UI 四态+版本门拆分（偏离 38⑧）**——**protocolVersion+schemaVersion+historyId=硬门（4406 client-outdated 强刷）；build hash 仅遥测**（每次 hotfix 不强刷全员）；**4413=maintenance-freeze（Retry-After 可重试）**；**帧闸数字**——普通帧=512KB（2×maxTxBytes 单源）/SS2≈8.06MiB/**WS maxPayload 16→9MiB**+认证后 per-connection 入站排队字节上限（2×ss2FrameGate 超限 1009）+入站速率桶（**HTTP seed 端点废止——T29 触发条件：cold p95>3s 或 loop block>50ms**）/SS2 大帧并发信号量（全局内存预算+per-project 1）；**版本维度表**——nodeVersion=节点末次变更 feedSeq（**删 projectedEventVersion/projectedExecSeq——单名单义**）+feedSeq 跨代不重置；**4410 三分+4411+4412+4413+4406 载荷+客户端半链**（providerVersion 带 h=/缓存键五元/onAuthenticate 先比 historyId/ETag 拼 generation:pgSeq——堵同代 PITR 客户端 SS2 复活）
- [ ] **T5b 业务 DDL（exact，偏离 38⑨⑩⑮）**：**ExecutionRequest 父行（内部 id 主键+requestId 项目内唯一+**historyId 列——PITR 后同 requestId 重试 409 REQUEST_STALE**+reservedCredit/totalCredit/expiresAt=15min）+ExecutionNodePlan 子行（**reservedCredit per-item+planHash 只盖不可变字段**〔nodeId/order/type/model/resolution/styleId/pricingRuleId/creditCost/paramsHash——status/execSeq/intentId 不进〕）+ExecutionInput（**encoding=json+gzip/brotli（node:zlib——禁 zstd 原生依赖）；raw≤8MiB ∧ stored≤2MiB 任一超限 413；expiresAt 必填**）**（spec §6.1 v5.4——scopeNodeIds 派生/256KiB prompt 413 不截断/frozenDocSeq 临界区语义/inputHash=contentHash）；**RuntimeEvent（payload v:1+EVENT_KINDS registry〔exec.status/exec.artifact/media.fact/node.deleted/doc.vacuumed〕+payload≤64KB+PII 扫描）+RuntimeFeedCursor（lastSeq+minRetainedSeq；`INSERT ON CONFLICT DO UPDATE RETURNING` upsert+genesis 同事务插行）**——锁序简化「业务行→counter」（CanvasDoc 普通 SELECT/FOR SHARE——不与维护/快照互斥）；**FrameEffects/ProjectDocIndex 契约类型（偏离 38⑮——解 T24↔T26 循环）：`FrameEffect=NODE_CREATED|NODE_DELETED|NODE_RESTORED|EDGE_ADDED|EDGE_REMOVED|MEDIA_REF_ADDED|MEDIA_REF_REMOVED|FIELD_CHANGED{nodeId,key}`（带 walSeq）；`ProjectDocIndex={nodeType/edgesByNode/mediaRefsByNode/apply(effects)/rebuild(doc)}`——effects 由 actor pre-apply 时从 decodeUpdate+索引计算（per-transaction 收集器），与 walSeq 进 observer buffer 与 PG 批同事务；索引与 appliedSeq 同源崩溃重建**；**NodeExecution（generation 列+更新守卫+nodeVersion）+ExecutionOutbox/MaterializeRun/RefundObligation（unique+reversesId）/ObjectManifest（claimOwner/claimUntil）**；**NodeLifecycle（lifecycleSeq+当前行 partial unique）+DeliveryFence（fenceSeq 校验）+义务 closed enum**（按 census⑪ 定员——必含 FEED_TOMBSTONE）；**MaintenanceOperation 9 主段+2 终态转移表**（spec §6.6 v5.4——**行级关闸：REQUESTED 同事务写 CanvasDoc.maintenanceId+受理读 IS NULL**；in-flight 含 delivery/outbox；**SWITCHING 事务后 close 4410**；FAILED 只读显式 resume；切代前置=无在飞执行）；**SystemHistory 全局单行唯一权威（id/historyId/epochStartedAt——bump 单事务；删 CanvasDoc.historyId 列）**+**CanvasDocUpdate.actorRanges Json 单表示（删 actor 列；from/to 十进制字符串；updateHash=有序 frameHash 列表 SHA-256）+DocAuditEvent（敏感操作 180d）**；Undo 策略（D6 维持）
- [ ] **T5c 客户端/恢复（偏离 38⑬⑭）**：**DraftEnvelope 类型+三场景表（B=用户裁定式）**（spec §4.5 v5.4——A 同代 boot mergeUpdates+**合并后异常提示**（ProjectDocIndex 检测重复 order/悬挂边/越界——不阻断）；B **新增直入/修改字段逐字段「当前 vs 草稿」二选一默认保留当前/删除显式确认——无 journal/base 禁自动重放**；C import-as-new+**nodeId 稳定不重映射（冲突=跳过/替换用户选）**+确认面三行（内容数/丢弃引用/不恢复产物·历史·计费）；≤8MiB 单飞幂等；**无 basePgSeq 3-way merge**）；**4410/4411/4412/4413 恢复流+重复 DENY 逃生口（N 次后 recovery 模式）+historyId 客户端半链**（缓存键五元/先比 historyId）；**saved 四态驱动契约**（clientSeq+sessionEpoch 判 Durable；不因连接/SyncStatus 显示）；**RuntimeProjection 契约+merge**（`{projectId,generation,feedSeq,pgSeq,nodes{exec?,media?,deletedAt?},mediaFacts}`——nodeVersion 大者胜/deletedAt 墓碑/换代清族；shared 唯一 merge 函数）+**四读径**（公开快照=发布时服务端 projection join+缓存键加 projectionSeq；导出=render model〔serializeCanvas 仅 doc 备份〕；**复制/粘贴=typed BindMedia/CloneBinding 命令**〔源 nodeId/mediaId 作命令参数；mediaId/fileId/artifactId 清空重产生；cells 格位保留媒体引用清空；跨团队 media ACL〕；video-work clone=render model）；**Runtime Store 离线语义**（IDB TTL 7 天+stale 角标+unknown 不显示 idle）；**T19 census 形态**（`read-model-census.json`：id/file/fields/test 锚+shape hash+27 fixture）；**XML_ELEMENTS/MARKS/ATTRS 单表**（元素/mark/属性/深度≤32/文本≤128KB/URL allowlist/mention·image=mediaId——PM schema 派生+setEqual）
- [ ] fixture：双端并发语料（每类型典型+边界）+WAL 故障语料（坏 CRC/截断/缺号/重复/**historyId 不匹配**）+feed 故障语料（乱序/缺口/旧代/游标失效/**feedSeq 提交顺序交错**/**反向锁序负控**）+barrier 语料（并发 barrier/nonce 重试/maintenance 拒绝）
- [ ] census 静态门进 verify fast（check-collab-census 扩：未分类新字段红+服务端读者清单+裸构造门+doc.exec 触碰面零增长+**`Y.applyUpdate` 消费面=gate/load/import 三处白名单**+**DirectConnection 零使用**）
- [ ] **P0 出口=用户确认点①**（T5a/b/c 三段证据）→Commit。

### 确认点①附带裁定（2026-10-24 用户批准 P1）——首批 11 条契约修正（不改架构；按卡生效：对应修正未完成不得开对应卡）

| # | 修正 | 生效卡 |
|---|---|---|
| 1 | FrameEffects 以 apply 后 actor 临界区内为准；ProjectDocIndex 由 T9 建、T24/T26 复用；NODE_CREATED/RESTORED 加 type | T9 |
| 2 | pending 区间扣除 svClock 已覆盖前缀；SV 覆盖的 Skip 放行；DS-only 未知 clock → 4412 | T9 |
| 3 | 删 media.fact/RuntimeProjection.mediaFacts；加 artifact 槽、exec.status/artifact 分槽、node.restored | T22 |
| 4 | execSeq（执行代际）与 lifecycleSeq/fenceSeq（生命周期）全文分离 | T21/T26 |
| 5 | image.src = mediaId，渲染层解析受控 URL；URL allowlist 仅留给 link href | T16 |
| 6 | shouldQuarantineSegment 时间戳栅栏显式 recoverySuspect，默认 false | T8 |
| 7 | Y1c 四码先走 resolveRecoveryAction；4406 terminal、4411/4412 resync、4413 retry，不被 backoff 吞 | T10/T25 |
| 8 | 版本门加 allowFirstConnect；首连无 historyId 放行并由 auth 下发 | T9 |
| 9 | DraftEnvelope 加 historyId；C 场景逐节点冲突 + 默认 skip | T25 |
| 10 | projection 换代必须全量 snapshot；feed 读 CanvasDoc 用 plain SELECT，不用 FOR SHARE | T22 |
| 11 | LifecycleObligation 定队列：state/attempts/lease + effect→obligation 映射 + 退款路径 | T21/T26 |

开工顺序：**T7 立即开工（不依赖以上业务项）**；T8←#6 后；T9←#1/#2/#8 后；T10←#7 后；T16←#5 后；T21/T26←#4/#11 后；T22←#3/#10 后；T25←#9 后；**T34 发布门=check-collab-census 登记红必须为 0**。
落点纪律：涉 T5 冻结契约文件的项（#1/#2/#3/#5/#6/#7/#8/#9/#11）在对应卡开工前以 TDD 修正批落 shared 契约+测试（独立 commit）；涉卡文语义的项（#4/#10 及各卡步骤措辞）随修正批同步进 plan 卡文；T7 本卡不受门控。

## P1：载体（T7-T14——最小可恢复协作垂直切片；G1/G2/G6a 三工程门）

### Task 7: G1 门——迁移一载体族+genesis 双路+缺头三态
**Files:** schema.prisma+迁移一；project.service.ts:45-108；canvas.service.ts:37-53
- [ ] 表形（BigInt 默认 0 非 0n；relation 双侧全补+onDelete: Cascade；先 reset 再 migrate 豁免登记）：

```prisma
model CanvasDoc { projectId String @id  generation Int @default(0)  schemaVersion Int  vacuumEpoch Int @default(0) /* 遥测 */
  currentSnapshotRev BigInt @default(0)  walCheckpointSeq BigInt @default(0) /* v1.7：批提交时刻 spoolHeadSeq 采样（原 walSeq 列改名）——永不与 appliedSeq 比较 */  pgSeq BigInt @default(0)
  purgeBelowSeq BigInt?  maintenanceId String? /* stage 单源在 MaintenanceOperation；REQUESTED 同事务写入+执行受理读 IS NULL=行级关闸 */
  project CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade) }
// raw SQL: CHECK (pgSeq <= walCheckpointSeq) —— 同行约束
// 跨表不变量 Snapshot.stateSeq <= pgSeq：非 CHECK——由快照发布事务行锁+条件更新保证（T11）
// v1.7：删 CanvasDoc.historyId 列——SystemHistory 全局单行唯一权威（restore 恒整库恢复）
model SystemHistory { id Int @id @default(1)  historyId String  epochStartedAt DateTime  updatedAt DateTime @updatedAt }
// v1.7：bump 单事务（更新 SystemHistory+trigger 同步缓存）提交后才允许启动；启动任一不匹配/缺失/为零=fail-closed 不自动修复
model RuntimeFeedCursor { projectId String @id  lastSeq BigInt @default(0)  minRetainedSeq BigInt @default(0) }  // v1.7：upsert ON CONFLICT；genesis 同事务插行；锁序=业务行→counter（最后拿）
// 无 appendSeq/admissionCutoff/@@unique([maintenanceId])/DocWriteAudit（v1.2 残留全删；审计=actorRanges+DocAuditEvent）
model CanvasDocSnapshot { projectId String  generation Int  snapshotRev BigInt  stateSeq BigInt  state Bytes
  stateHash String @db.Char(64)  vacuumEpoch Int  schemaVersion Int  createdAt DateTime @default(now())
  @@id([projectId, generation, snapshotRev])  project CanvasProject @relation(...) }
// raw SQL: CHECK (octet_length(state) <= 16MiB)
model CanvasDocUpdate { projectId String  generation Int  seq BigInt /* =批 lastWalSeq */  firstWalSeq BigInt  frameCount Int
  updateHash String @db.Char(64) /* v1.7：=有序 frameHash 列表 SHA-256（非 merged update 字节）——重试/重组批幂等 */  actorRanges Json? /* v1.7 单表示（删 actor 列）：[{from,to,userId,actorKind}] from/to=十进制字符串（BigInt 禁入 JSON number）；区间覆盖每帧不重叠无空洞；userId 仅内部 ID */  update Bytes  createdAt DateTime @default(now())
  @@id([projectId, generation, seq])  @@unique([projectId, generation, updateHash])  project CanvasProject @relation(...) }
// raw SQL: CHECK (octet_length(update) <= 16MiB)+CHECK (seq >= firstWalSeq)+CHECK (frameCount > 0)——不存单 frameId（偏离 33）
model DocAuditEvent { id String @id  projectId String  kind String /* delete/execute/permission/maintenance/refund */  userId String
  requestId String?  payload Json? /* 不含正文 */  createdAt DateTime @default(now())  @@index([projectId, createdAt]) }  // 敏感操作同 PG 事务审计（180d 保留）
model MaintenanceOperation { maintenanceId String @id  projectId String
  stage MaintenanceStage /* Prisma enum 9 主段+2 终态（11 值）：REQUESTED/FREEZING/DRAINING/DRAINED/EXPORTING/REBUILDING/SWITCHING/VERIFYING/COMPLETED+FAILED/ABORTED */  status MaintenanceStatus  attempt Int @default(0)
  sourceGeneration Int  targetGeneration Int  schemaVersion Int  cutoffPgSeq BigInt  drainedAt DateTime?
  error String?  idempotencyKey String @unique  leaseOwner String?  createdAt  updatedAt
  @@index([projectId, status]) }
// raw SQL: 活跃维护 partial unique（一项目一活跃）——唯一性在此不在 CanvasDoc
```

- [ ] 先红：①genesis 双路（POST /canvases 建头+Snapshot(g,0,0)+**RuntimeFeedCursor 行+SystemHistory 缺失 fail-closed**）②缺头三态（missing 非 `?? 0`）③`prisma validate`（空 model/单侧 relation/缺 opposite 三形态红实测——本卡真绿）
- [ ] G1 证据：prisma validate+migrate diff+SQL dry-run（行锁/水位 UPDATE RETURNING/去重 no-op/CHECK 生效/快照发布事务验证跨表不变量）→**G1 go/no-go 判定**（不过=修表形重跑，禁绕过）
- [ ] 交错（并发双创建）绿→Commit。
- [ ] **v1.7 执行勘误（2026-10-24 Controller——T7 首卡侦察落定）**：卡文「v1.2 残留全删」前提错误——appendSeq/admissionCutoff/@@unique([maintenanceId])/DocWriteAudit/CanvasDoc.{walSeq,historyId} 列/CanvasDocUpdate.actor 列**从未在任何分支落地**（v1.2 计划 47e37467 设计后 3de896c9 废止存档未执行；spec §6.7 删除清单同名项为同源残留措辞——P4 收口时自然 no-op）。**T7 实际形态=增量为先（方案 B）**：落全部**新**对象（SystemHistory〔含 raw CHECK(id=1)+迁移内 INSERT 引导行〕/RuntimeFeedCursor/CanvasDocSnapshot/DocAuditEvent/MaintenanceOperation+MaintenanceStage enum 11 值/活跃维护 partial unique/raw CHECK 全落）+CanvasDoc **新增**列（vacuumEpoch/currentSnapshotRev/walCheckpointSeq/pgSeq/purgeBelowSeq/maintenanceId+CHECK pgSeq≤walCheckpointSeq）；**CanvasDoc.state/stateSeq/preVacuumSv/schemaVersion@default(3) 与 CanvasDocUpdate 旧形态原样保留**——分别至 T9（新写入方+CanvasDocUpdate 表改形同切片——卡文 CanvasDocUpdate 块=T9 落地形态参考非本卡交付，updateHash 去重探针同延 T9）/T10（advisory lock 写路径+canvas_doc_update_seq 删）/T11（compact 重写+state 列退役）拆除（spec §6.7「删码与新路径同可编译切片」）。**`status` 列=String**（T5b 冻结 MaintenanceOperationRow.status:string 即如此——卡文 `status MaintenanceStatus` enum 记号无值集出处，值域待 T27 消费方定，届时如需 enum 随其迁移收紧）。**SystemHistory 引导=迁移内 INSERT id=1**（historyId=gen_random_uuid()〔核 PG 版本≥13 内建，否则用仓库既有先例〕/epochStartedAt=now()/ON CONFLICT DO NOTHING——安装语义非运行时自动修复；运行时启动校验 fail-closed 不变）。**genesis 双路**共用一个建头 helper：旧 state 种子行为逐字保留（过渡期旧装载路径依赖），新头行集（新列默认+Snapshot(g,0,0)+RuntimeFeedCursor 行）同事务追加+SystemHistory 缺失/为零 fail-closed。G1 证据范围=B 形落地面（updateHash 去重探针在 g1.json notes 登记 deferred-to-T9——非 skipped case）。

### Task 8: 单实例 ADR+WAL 帧协议升级
**Files:** docs/superpowers/adr/ADR-01-single-instance.md（新）；collab-spool.service.ts
- [ ] ADR-01：instances:1 复杂度边界（非 HA）/单写者/重启恢复顺序（WAL→PG 前缀校验→重建 appliedSeq→开放写）/扩容=独立批前置条件（共享耐久日志/所有权租约/fencing）
- [ ] spool 帧协议升级：**SHA-256 帧去重+walSeq 单调序号（per project）+帧内一律携带 generation+帧记录存 frameHash（v1.7——启动重建有界去重索引 24h/100k）**+水位字段+坏段分类码（crc/truncated/missing-seq/dup-hash 四档）+**段头 {magic,version,projectId,generation,historyId,lastWriteAt,createdAt}（v1.7 增 lastWriteAt——时间戳栅栏）——新建段 fsync 文件+目录**；磁盘上限+背压+故障停收（fail-closed）；**拓扑=per-project 定形终态（S4 用 actor 原型管线测；升级序=组提交→4-way hash 分片→全局 WAL=新 ADR）**；**换代=段 namespace 切代+旧段 quarantine**；**恢复扫描=完整有效前缀截断/隔离无效尾部+段头 historyId≠SystemHistory=整段 quarantine fail-closed；lastWriteAt>epochStartedAt 时间戳栅栏=recoverySuspect 恢复怀疑态（修正 #6——自动扫描零重放，重放归恢复流裁定非静默丢段）（`--adopt-wal` 仅 historyId 已匹配+人工确认例外）**；**WAL 损坏只允许丢 walSeq>pgSeq 的帧；fsync 分档（v1.7）：写前失败/ENOSPC=截断回 last-good+复用已分配 seq；EIO=fail-stop（walHealthy=false/停收/close 1011/要求重启+磁盘检查——不进复用路径；`wal_fsync_error_total{device}`）**
- [ ] 先红：坏段分类用例（构造坏 CRC/截断/缺号/重复 hash→分档隔离告警=现无分类红）+**historyId 不匹配段 quarantine（bump 后旧段禁重放）+lastWriteAt 时间戳栅栏（模拟忘 bump：段比 epoch 新→recoverySuspect）+EIO fail-stop（不截断不复用）=红前置**→绿→Commit。
- [ ] 修正 #6 生效：shouldQuarantineSegment 时间戳栅栏显式 recoverySuspect，默认 false（时间戳栅栏不再并入整段 quarantine——据 recoverySuspect 走恢复流非静默丢段）——见「确认点①附带裁定」节

### Task 9: spool-first 写管线核心（v1.7：CollabProjectActor+所有权切换——P1 入口条件）
**Files:** collab-frame-gate.service.ts（重写 guardSyncFrame 收编）+**新建 collab-project-actor.service.ts**；collab-persistence.service.ts（降级 telemetry）；**collab-server.factory.ts+collab.gateway.ts（onStoreDocument 钩子链拆除——偏离 38①）**
- [ ] 先红：①现 apply→listener 二次 append 路径（connection-origin 双写断言）=红②ACK 时帧未 fsync（spool 先于 apply 断言——现 listener 后置）=红③重复帧拿到重复 walSeq（现无去重）=红④**pre-apply 缺席（apply 仍由库执行）=红前置**⑤**每帧触发旧防抖 store（gateway:340 onStoreDocument→storeDocumentUnlocked——gate pre-apply 的 update 事件进库 debounce）=红（双写实锤）**⑥**VIEWER 发 Update 后 doc 已变（库 readOnly 检查在 beforeSync 后）=红前置**
- [ ] **CollabProjectActor（偏离 38③）**：`submit(frame,conn)→Promise` 入队；单 drain 循环批量 ≤20ms/1MiB→一次 WAL append+fsync→逐帧 apply→逐帧 resolve（beforeSync await promise）；**准入链（actor 串行段内）**：⓪**readOnly/writeFreeze/quota 短路最先**（防 VIEWER 帧先入 doc）→每帧对照世代权威验证 generation〔偏离 36-②〕→身份/权限/格式→解码+结构权限+预算（gate-local=frame-local+ProjectDocIndex 查询）→**pending 区间预检（decodeUpdate 各 client 区间 vs encodeStateVector：起点 clock>SV 或区间有洞→4412 零 WAL 零 apply；连续覆盖=自包含 SS2 放行——禁 max-clock 单值）**→帧字节精确 copy→**SHA-256 去重 promise map（命中 inflight=await 原帧 fsync+apply 完成才放行；原帧失败重复帧同错；命中 applied=no-op）**→spool+fsync→`Y.applyUpdate(document, bytes, {source:'connection',connection,gate:true})`→appliedSeq=walSeq；**FrameEffects 收集器（per-transaction 清空/取走——afterTransaction+根 observeDeep+typeIdToNodeId；T24/T26 消费）**；毒帧=同步关项目全部连接（广播 flush 前）+停写+WAL 截断至 appliedSeq+4411+从 pgSeq 重放
- [ ] **所有权切换（偏离 38①——P1 入口条件非 T32）**：factory/gateway 的 `onStoreDocument/afterStoreDocument` 改 telemetry-only（计数器）或移除；`storeDocumentUnlocked('debounce')` 退出现役调用；**验收=一帧→恰一次 WAL append+一次 PG row+一次广播+旧 spool append 计数 0+onStoreDocument 对 connection-origin 零调用**；per-project 写入背压〔偏离 36-③〕；维护写独立 append 通道；**SS2 大帧并发信号量（全局内存预算+per-project 1）+WS maxPayload 16→9MiB+认证后 per-connection 入站排队字节上限（2×ss2FrameGate 超限 1009）**
- [ ] **P1 validator=P1 shape fixture**（root/权限/预算/通用格式——全类型最终矩阵运行时准入在 T24 激活）
- [ ] 用例：并发双连接帧串行准入+**5 连接各 2 帧→1 次 fsync+10 ACK 顺序与 walSeq 一致（actor 批验证）**；**并发同字节双连接→一个 walSeq+两 ACK 均在 fsync 后（in-flight 去重）**；**S1 九验收回归（含发送者回声 no-op/VIEWER 短路/onStoreDocument 零调用）**；SS2 大帧预算拒（WS 通道承载 8.06MiB——无 HTTP seed；recovery import 归 T25）；帧字节 copy（lib0 subarray 越界读反例）→Commit。
- [ ] 修正 #1 生效：FrameEffects 以 apply 后 actor 临界区内为准；ProjectDocIndex 由 T9 建、T24/T26 复用；NODE_CREATED/RESTORED 加 type——见「确认点①附带裁定」节
- [ ] 修正 #2 生效：pending 区间扣除 svClock 已覆盖前缀；SV 覆盖的 Skip 放行；DS-only 未知 clock → 4412——见「确认点①附带裁定」节
- [ ] 修正 #8 生效：版本门加 allowFirstConnect；首连无 historyId 放行并由 auth 下发——见「确认点①附带裁定」节

### Task 10: G2 门——applied 前缀+批量 PG+水位三元+barrier 接线（v1.6 前移）
**Files:** collab-persistence.service.ts（worker 批提交改造）；collab-server.factory.ts（**onStateless 接线——v1.6 自 T21 前移本卡**）
- [ ] 先红（G2 故障矩阵——真 PG）：①同帧重复送达零重复业务效果零重复 walSeq②PG 提交失败 WAL 保留且 pgSeq 不越失败帧③fsync 前后 kill -9 符合 ACK 等级④PG 提交成功但内存水位未更即崩→重启零重复⑤snapshot 已发布 WAL 未清时重启正确⑥WAL 达清理条件重启不误删⑦**合法帧 apply 失败（毒帧）→WAL 截断至 appliedSeq+4411+从 pgSeq 重放——不跳帧续提交**⑧**无 PG 行 walSeq>appliedSeq**⑨**fsync 失败截断复用 seq 不留洞**⑩**pending 拒绝帧不入 appliedSeq**
- [ ] **applied-driven 批量 PG**：批只从 applied 队列取（连续前缀，上界=appliedSeq）单事务多行 append（复用 512 条/8MiB+1MiB 分片；行=firstWalSeq/lastWalSeq/frameCount/updateHash〔=frameHash 列表 SHA〕/**actorRanges**）→confirm spool→**水位推进（v1.7 拆义）：CanvasDoc 行 CAS `UPDATE ... SET walCheckpointSeq=<提交时刻 spoolHeadSeq>, pgSeq=$ WHERE projectId=$ AND generation=$ AND pgSeq=$ RETURNING`（永不写 appliedSeq 口径；删 doc 写路径 advisory lock+canvas_doc_update_seq〔census⑩ 先行〕）**；崩溃恢复=从 pgSeq 重放 WAL（不依赖进程内状态）
- [ ] **save barrier 服务端接线（偏离 37⑦+38⑳）**：factory onStateless→handler **首语句同步捕获 target=appliedSeq**→flushThrough(target)→等 pgSeq>=target 有界→`connection.sendStateless({nonce,clientSeq,committedSeq})`；nonce 幂等/永不 throw（catch 回 error 回执）/maintenance 拒绝语义；**项目级 flush 节流 ≤250ms（多 barrier 合并等待——flushThrough=幂等/有界/不阻塞写/返回当前 pgSeq）**；同连接串行保证（processMessages 队列）契约测试
- [ ] **doc 卸载纪律（偏离 37⑩+38⑤）**：**beforeUnloadDocument**（正名——无 onUnloadDocument 钩子；throw=拒绝卸载）drain applied→PG 或拒绝卸载；PG 不可用=doc 常驻/fail-closed；**maxResidentDocBytes 全局驻留上界（到顶新项目 onLoad 503/4413）+doc_unload_blocked_total**；LRU+按 (projectId,generation) 清互斥/队列/去重 hash
- [ ] **G2 go/no-go 判定**（manifest+负控；不过=不进 P2）→Commit。
- [ ] 修正 #7 生效：Y1c 四码先走 resolveRecoveryAction；4406 terminal、4411/4412 resync、4413 retry，不被 backoff 吞——见「确认点①附带裁定」节

### Task 11: 快照发布+compact+WAL 清理
**Files:** canvas-doc-update.repository.ts（compact 重写）；COLLAB_ROLE worker 调度
- [ ] 先红：两 compact 并发 PK 冲突折正常 miss=红；kill 在指针发布后/purge 前不续跑=红
- [ ] **快照只从 PG 前缀生成且只到 pgSeq**（重放在 worker 进程——行锁+generation/pgSeq CAS 授权，**不拿租约**）；**跨表不变量 Snapshot.stateSeq≤pgSeq 由发布事务内行锁+条件更新验证（非 CHECK——偏离 26 v5.2）；compact 失败保留原可用快照与 WAL，不提前清理**；指针短事务+**purgeBelowSeq 同事务持久**+提交后 worker 分批删+启动续跑；保留策略（当前代 2 份+旧代最终 1 份）；snapshot 独立观测 gauge
- [ ] 交错（装载×compact×append）绿→Commit。

### Task 12: vacuum=generation++/新 docName（换代通道）
**Files:** canvas-doc-update.repository.ts:194-224（vacuumReplace）；collab-shrink.service.ts:292-347；collab-doc-registry.service.ts:628-698（rebuildVacuumDoc+preVacuumSv 播种）；registry 4410 载荷
- [x] 先红：①vacuum 后 generation/docName/缓存键**不变**（v1.3 同 name 语义反例——现设计=必须变）=红②**部分陈旧客户端复活路径**（S2 spike 语料：全 clock<pre 客户端 SS2 旧 structs apply 到新 doc）在换代语义下=auth 直接拒（不装载/不 SS1/不上行）=红前置
- [x] vacuumReplace：重放重建 fresh doc（新 clientID 重写）→**generation++→新 docName(#g)**→替换快照+水位重置预演；4410 `doc-vacuuming` 载荷 {generation, discardLocalCache:true}；离线 dirty 客户端=旧 #g auth generation mismatch→DraftEnvelope 导出→清缓存→新 name 重连导入（**导入前新 Schema/权限/图结构校验**）；**vacuumEpoch 仅遥测计数列**；**preVacuumSv 缓存播种与门退役**（registry:400,:687-696 删——偏离 27）；`schemaVersion⇒generation` 启动断言（违反拒启）
- [x] vacuum 前后 generation/docName/缓存键变化断言+换代预演+S2 语料全绿→Commit。（T12 落地批注：世代执法=admitDocNameForGeneration〔auth〔CollabAuthReason.GENERATION_STALE 第十五值·终态〕/load 双校验——E23 连带=canonical wire 名 canvasDocName 全内部寻址改道〕；I2 落定=**跨代连续 seq**〔switchGeneration 计数器/水位保留不重置+全提交旧段换代即删/含未提交帧段 sidecar 保全——vacuum ⑥ 事务提交后经 gateway.switchWalGeneration 接线〕；preVacuumSv 列随门退役 DROP〔迁移 20261024160000+EXEMPTIONS〕；generation=0 真值链播种〔DR:403 缝修复〕；schemaVersion⇒generation 断言=repo.assertSchemaGenerationDiscipline〔boot 拒启——sv≠current∧gen=0 ∨ sv>current 两类违例〕。）

### Task 13: G6a 门——单实例故障恢复（doc 平面）
**Files:** registry 恢复路径；collab-spool/persistence；观测接线
- [ ] **G6a 故障演练（doc 平面——Feed 不在本门）**：kill -9 每阶段（spool/apply/批提交/快照/毒帧/barrier flush 中）/**fsync EIO fail-stop（不截断不复用——重启+磁盘检查后才恢复）**/坏 WAL 段/PG 不可用/磁盘满/重启——恢复顺序=**段头 historyId+lastWriteAt 时间戳栅栏双校验（不匹配 quarantine）**→WAL→PG 前缀校验→重建 appliedSeq→开放写；无法证明一致=fail-closed 拒服务；ETag 不超前 pgSeq 断言；**doc 卸载×PG 故障交错误卸载=红+maxResidentDocBytes 到顶 503/4413**
- [ ] S4 决策落地验证（actor 原型管线多项目下恢复正确+完整有效前缀+**pg_dump 恢复→bump historyId→旧段禁重放实弹+忘 bump 场景靠时间戳栅栏拦截实弹**）；8MiB SS2 WS 通道恢复路径用例（无 HTTP seed）
- [ ] **G6a go/no-go 判定**+观测指标落地（wal_fsync_latency/wal_pending_bytes/doc_pg_lag_seq/doc_prefix_gap_total/doc_recovery_total/doc_frame_rejected_total）→Commit。

### Task 14: P1 出口
- [ ] G1/G2/G6a 证据汇编+verify 全绿→**用户确认点②**→Commit。

## P2：内容（T15-T20；G3 工程门）

### Task 15: 容器规则先行+Y.Text 域（含 T2 string 迁移）
**Files:** canvasIntents 写路径+collab-doc-writer；AudioConfigPanel/MultiImageConfigPanel；nodeStore:162,:175 文本域；**execution.service.ts:512 读点同卡再改**
- [ ] 先红：整串覆盖写被拒（getHTML/整串 diff 形态）=红；懒建容器掩盖结构错误=红
- [ ] 容器=结构创建时一次性建（唯一创建者=写 seam+缺=拒绝不懒建）；undo 重建合法；恢复不夹带 server 字段；nodeId 即身份（PG lifecycleSeq 预备——T26 落表）；**Y.Text 域（spec §3.1 基准）**：audioGen.prompt=**Y.Text**（content:string 同卡迁——面板 textarea 写读同改）；multiImageGen.prompt=**Y.Text**（现状死字段赋形）；textInput.prompt=**Y.Map{text:Y.Text}**（**T2 的 data.prompt:string 同卡迁移+execution.service:512 读点同卡改**）；splice 单一 seam+整串覆盖拒；image/video/imageExt prompt=XmlFragment（T16）
- [ ] IME/粘贴/选区/两端同位插入并发用例绿→Commit。

### Task 16: XmlFragment+Tiptap 双端（G3 主体）
**Files:** TextInputNode/PromptInput/**ImageExtConfigPanel+PromptEditor**/TextNodeFullscreen/TextNodeToolbar；apps/web package.json（y-prosemirror exact pin 按 S3）；**+T3 遗留：resolveNodeType 短名翻译表（canvasStore.ts:159-170）归 schema 模块派生（T15 收口转登记）**
- [ ] 先红：现 getHTML 整串写 data.content=红；两客户端格式化合并后树合法性=红
- [ ] content=嵌套 XmlFragment（容器规则=T15）；**PromptInput 三域（image/video/imageExtGen）=XmlFragment**+mention(/,@)+image PM 节点（PromptValue{text,html,referencedImageIds} 三出口）；单 editor 实例（全屏/工具栏复用）；plugin 首次事务前注册；getHTML 只读导出；**不挂 yUndoPlugin**（单 manager——T18）；ySyncPlugin origin 按 S3（≠LocalUser 则 addTrackedOrigin）；**XML 白名单 L1 同卡激活（v1.7 偏离 38⑫——不留 P2 安全窗口）：gate frame-local struct 扫描（元素名/format key 白名单=XML_ELEMENTS/MARKS/ATTRS 单表、ContentString 字节上限、字符串 URL allowlist、新子树深度上限；拒 XmlHook/嵌套 XmlFragment/未知 XmlElement）；Tiptap schema 由单表派生+G3 setEqual 测试（同源禁两份）；T24 扩全类型矩阵+L2**
- [ ] **G3 用例**：双端并发格式化/mention 插入/图片引用/粘贴/删除节点 fragment 随子树/undo 重建恢复+**XML 对抗语料（未知元素/超深/超长/外链/伪造 mention——L1 拒帧+客户端 PM 解析双验）**→**G3 go/no-go 判定**（不过=调容器或绑定，禁 JSON 垫片）→Commit。

### Task 17: 媒体列表 Y.Array 单卡
**Files:** nodeStore:716-720；canvasIntents:151-157；useImageUpload；CanvasView:261-264；ImageGenNode:189-198；读者（imageNodeApi:26 等）
- [ ] 先红：整串数组替换（并发 add/remove 丢一方反例）=红
- [ ] allImages/images=Y.Array<item>（写读同卡改道——census 清单）；并发 add/remove/reorder/undo 用例；media-refs 读侧双形态收敛维持
- [ ] 绿→Commit。

### Task 18: 单 UndoManager 收口+per-tab 缓存
**Files:** canvasUndo.ts:15-31,:41-43；local-collab-cache.ts（记录扩展）；canvasCollabRuntime.ts（savedSeq 口径）
- [ ] 先红：①200 次编辑后 undoStack>100（现状 shift 仅 undo 时截断——栈内积压）=红②两标签 dirty LWW 丢一方（构造双 tab 离线编辑语料）=红
- [ ] 单 manager=`UndoManager([nodes,edges],{trackedOrigins:[LocalUser]+S3 结论})`——**不 addToScope**（scope 父链已含嵌套——S3 实证）；不挂 yUndoPlugin；Ctrl+Z 薄 keymap 焦点路由；**栈上限>100=整栈 clear()**（唯一公开 keep 释放口；**无 keepItem 精确释放、无「shift 后字节回落」验收**——偏离 31）；500ms 合并窗口用例；doc rebuild 仅测量超标后（unsyncedChanges===0+字节阈值）
- [ ] per-tab 缓存：记录{tabId,snapshot,stateVector,savedSeq,unsyncedDirty,diverged,at}+boot mergeUpdates 并集+clean 不覆盖 dirty+同步成功删己+**generation 变更（含 vacuum 换代）清整族（换代前先保存可恢复脏草稿——禁静默丢）**+**savedSeq 只由服务端持久化回执（save barrier pgSeq）推进——不因 provider 显示同步完成即认定已保存（偏离 36）**+IDB blocked 降级
- [ ] 多标签用例+栈上限用例绿→Commit。

### Task 19: 读者改道（只改读者——写者保留；v1.6=两类型+27 fixture）
**Files:** web 全读者（census③）+api video-work-clone:33+registry rebuild:635；snapshot-filter
- [ ] 先红：改道后任一读者 broken=红（**census 门=`read-model-census.json` 索引（v1.7：id/file/fields/test 锚+readModelShapeHash——所有 readCanvas/readRecordsFromMaps 调用点在表内未分类即红；27 fixture 挂表）**——含服务端；**写者不删——data.fileId/result/status 写者与 execAligned fallback 保留至 T22/T32**，D9 顺序）；**`CanvasReadModel`（doc 内容——唯一共享读类型）与 `CanvasRenderModel=merge(CanvasReadModel, RuntimeProjection)`（渲染层专用——服务端字段读者 T22 切投影）双类型缺失=红前置**；**本卡至 T22 前=dev-only 中间态不部署 beta（双水位 UI 不上线——偏离 38⑳）**
- [ ] 全读者改道 `CanvasReadModel`（TS 编译错误=差异表——零兼容：旧字段读者仅服务端字段组（fileId/result/status）暂留旧 doc 字段直读至 T22 切投影）；**27 读者逐个 fixture（read-model-census 清单+每读者旧形状→新形状语义相等断言）**；公开快照 toPublicReadModel sanitize+缓存键 (pid,g,snapshotRev)+**ETag=read model 新鲜度=pgSeq**；position Y.Map 逐键并发断言；**exec 根 doc 侧读者本卡起零新增**（census⑤ 门）；**lint 静态门：web 侧除 DocCodec/投影层外禁 `doc.getMap('nodes')` 直读**
- [ ] G28 继承（broken reader 零——web+server）绿→Commit。

### Task 20: P2 出口
- [ ] G3 证据汇编+verify 全绿→**用户确认点③**→Commit。

## P3：业务（T21-T28；G4/G5 工程门）

### Task 21: G4 门——迁移二+ExecutionRequest 父子行+frozenDocSeq+barrier 客户端（v1.6）
**Files:** 迁移二（ExecutionRequest/ExecutionNodePlan/ExecutionInput/RuntimeEvent/RuntimeFeedCursor/NodeExecution/ExecutionOutbox/MaterializeRun/RefundObligation/NodeLifecycle(lifecycleSeq)/DeliveryFence——字段=T5b 冻结 exact DDL）；execution.controller/service；web save barrier 客户端
- [ ] 先红：①受理后改 prompt/拓扑/model/上游/节点删除→执行仍用冻结计划（重放用例）=红②paramsHash/planHash 重放一致=红③并发两请求互串=红④前缀校验失败落半行=红⑤**同 requestId 断线重试创建第二次执行**（幂等受理反例）=红⑥**frozenDocSeq 竞态（受理 flush 后读前新帧 apply——未 freeze 即读=冻结输入含未持久帧）=红前置**⑦**ExecutionInput 超限 413 落半行=红**
- [ ] **ExecutionRequest 父行+ExecutionNodePlan 子行+ExecutionInput（偏离 37⑤+38⑨⑪）**：受理校验插入前一次性（nodeIds 非空/去重/≤20/属本项目/frozenDocSeq 前缀存在且 type 与 plan 一致/拓扑无环/≥1 executable——任一失败 4xx 不落半行）；**frozenDocSeq 正确临界区（v1.7）：freeze=先拿 gate per-project mutex（非布尔 flag——已过 flag 检查的 beforeSync 不得在读后 apply）→等当前 apply 完成→flushThrough(appliedSeq)→断言 pgSeq==appliedSeq→校验 generation→只读 scope 节点+直接父节点（禁全量 readCanvas）→frozenDocSeq=pgSeq→释放；超时 2s→503 不落行；freeze 预算 500ms 超时回退 PG 前缀重建候选 doc；同 requestId 重试幂等返回原 frozenDocSeq，同键不同 body（planHash/inputHash）→409 IDEMPOTENCY_CONFLICT；historyId 不匹配→409 REQUEST_STALE；maintenanceId 非空→409/503**；planHash 只盖不可变字段+inputHash；**资金 per-item 预留（受理事务 FOR UPDATE/CAS 写 reservedCredit+expiresAt=15min+sweeper 逐 item void+部分失败逐 item 结算+重试不重复预留）**；输入预算（**raw≤8MiB ∧ stored≤2MiB 任一超限 413**+256KiB prompt+媒体 200·50——不截断不分片；**brotli/gzip（node:zlib）**；共享上游 sha256 去重）；NodeExecution=当前行 PK(projectId,nodeId)+generation 列+更新守卫+nodeVersion；客户端：save barrier（**T10 服务端已接线——本卡客户端**：发 barrier 带 clientSeq+sessionEpoch→回执 clientSeq>=lastLocalEditSeq 且 committedSeq 存在才 Durable；触发=800ms idle/5s 上限/pagehide/执行前 ensureDurable）→execute 带 docSeq（**请求不携带提示词参数**）；GenerationIntent=claim 创建关联 requestId；paramsHash/pricing 只读 request 不重算；**worker 零 doc 读（只读子行+ExecutionInput）**
- [ ] **G4 go/no-go 判定**→Commit。
- [ ] 修正 #4 生效：**execSeq（执行代际族——NodeExecution 更新守卫/GenerationIntent 代际，比较单源=compareExecSeq）与 lifecycleSeq/fenceSeq（生命周期族——NodeLifecycle/DeliveryFence）全文分离、两族序永不互换互指**（迁移二列注释+shared execution-chain.ts 头注 #4 族分离纪律已落）——见「确认点①附带裁定」节
- [ ] 修正 #11 生效：LifecycleObligation 定队列契约（state/attempts/lease+effect→obligation 映射+退款路径——shared execution-chain.ts §5 T21 解冻窗口已落；T26 观察器消费）——见「确认点①附带裁定」节

### Task 22: G5 门——同切片切交付+RuntimeEvent Feed 全量+投影 overlay+删尺寸回写链（v1.6）
**Files:** collab-document.service.ts:248-264（deliverArtifact 改 PG 写——**不变量⑦首达**）；runtime-feed.service.ts 全量（RuntimeEvent 写入+HTTP 游标端点）；web runtime store 接线+execStatusView 数据源切换+CanvasRenderModel 合成
- [ ] 先红：①serving 期服务端写 doc（deliverArtifact 现状）=红（不变量测试）②feed 漏推后状态错乱（断线语料）=红③**T22 切换后旧 UI 读 stale doc.exec**（同切片纪律——客户端 Runtime Store 与服务端停写同卡）=红前置④**服务端派生字段任何形式进 doc（display-cache 回写）=红（偏离 37③——不变量测试）**⑤**反向锁序（先拿 RuntimeFeedCursor 再取 CanvasDoc）不死锁=红**
- [ ] **同切片（D9+v1.7）**：deliverArtifact 改 PG 写+RuntimeEvent 事件写入+**node-deleted 权威=DeliveryFence（T26 已先行——deliverArtifact 弃用 data.written:false doc 观察）**+客户端 exec/media 全量切 Runtime Store **投影（IDB 持久化 {projectId,generation,feedSeq,pgSeq,projection,fetchedAt}——离线=上次已知+stale 角标+执行禁用 fail-closed）**+渲染层 `CanvasRenderModel=CanvasReadModel⊕RuntimeProjection`+**四读径（偏离 38⑬）**：公开快照=发布时服务端 projection join+缓存键加 projectionSeq/用户导出=render model（serializeCanvas 仅 doc 备份）/**复制/粘贴=typed BindMedia/CloneBinding 命令**（mediaId/fileId/artifactId 清空由目标节点重新产生；cells 格位保留媒体引用清空；跨团队 media ACL）/video-work clone=服务端 render model+**doc.exec 停写停读+尺寸回写链删除（feed 事件只带 {nodeId,mediaId}→客户端查既有 media-facts 通道；Y1b 12s/30s 补拉+pendingFacts 冗余轮询同卡删——`downscaledFrom` 按 (mediaId,factVersion) 恰一次=本地 notifiedFactVersion）**；**feedSeq 分配（v1.7）**：`RuntimeFeedCursor` **upsert** `INSERT ON CONFLICT DO UPDATE SET lastSeq=lastSeq+1 RETURNING`（genesis 同事务插行——空项目首事件用例）；**锁序简化：业务行→counter（feed 事务不锁 CanvasDoc——普通 SELECT/FOR SHARE 读 generation/docSeq）**；feedSeq 跨代不重置；**唯一交付=HTTP 游标（cursor=(historyId,generation,feedSeq) 三元——historyId 不匹配→全量快照+清投影；响应 envelope 带 historyId）**；**事件 taxonomy（偏离 38⑭）：payload v:1+EVENT_KINDS registry〔exec.status/exec.artifact/media.fact/node.deleted=FEED_TOMBSTONE/doc.vacuumed〕+payload≤64KB 超限拒写+PII 扫描+unknown kind 忽略计数**；客户端单 reducer（hint>cursor→GET after=cursor limit≤200 升序应用+(projectId,feedSeq) 去重+缺口重取+cursor<minRetainedSeq→全量；通知在业务事务提交后发）；首连 RR 快照+{snapshot,cursor,minRetainedSeq,historyId}（**snapshot=全量替换+统一 cursor——清投影重建，仅接受 nodeVersion>cursor 增量**）+心跳 15-30s latestFeedSeq+保留期 7d/100k 清理 worker+runtime_feed_bytes；docSeq 应用规则+UI unknown 不显示 idle；**事件与业务事务原子提交**+durable watermark 广播（≤1 次/秒）；**ExecutionOutbox=工作队列维持（不作 feed 日志）**
- [ ] T21 收口登记（M-1/M-7/M7——本卡解冻窗口/派发词落点，非 T21 卡面）：①#4 族分离残留两处冻结注释混用——runtime-projection.ts:14（execSeq=PG lifecycleSeq 数值）+doc-protocol.ts:541（execSeq 节点执行序〔PG lifecycleSeq〕）——本卡 runtime-projection 解冻窗口收口前者（execSeq=执行代际族 GenerationIntent/NodeExecution 守卫；lifecycleSeq=生命周期族）；doc-protocol.ts:541 无在册消费窗口、随下一次其文件解冻授权收口（登记面）。②客户端受理接线——POST /execution/requests 调用方（canvasIntents/executionApi 受理步）+requestId 消费时点（admit→execute 两步 vs 直 execute）——本卡同切片或 T28，由本卡开工时派发词定（服务端端点 T21 已落）；幂等语义=T21 二轮终裁（R-I-1）：重试复用原 requestId（nodeIds 集比对——同集即 replay 原 frozenDocSeq；意图变更换新 requestId）、docSeq 咨询性不参与幂等判定（原「docSeq 钉死」约束作废）。
- [ ] **G5 用例（六语料+交错+负控）**：断线/漏通知（仅心跳追平）/重复/乱序/旧代/游标失效全量快照+**feedSeq 提交顺序交错**+feed 不因 outbox claim/delete 出洞+**空项目首事件（cursor upsert）**+**historyId 不匹配 cursor→全量快照**+**锁序负控=静态 lint+正常序压力 N 次无 40P01+「去 counter」负控（期望重复/缺口——非制造死锁）**→**G5 go/no-go 判定**→Commit。

### Task 23: worker fencing+交付幂等+退款义务+资源回收（迁移三）+text 链外呼锚
**Files:** 迁移三（StorageReservation 状态机列+ObjectManifest claimOwner/claimUntil/GC claim）；materialize-job；team-credit；safe-remote-fetch；**api-caller.service.ts（text 链）**
- [ ] 先红：旧 run 迟到退款误命中（时序交错）=红；lease 过期在飞 reservation 被释放（oversale）=红；GC 交错误删=红；**text 链 rearm 重试无屏障重复外呼**（callTextGen 现零键零锚——api-caller:533-535/:553/:365 `kind!=='text'` 才铸键）=红
- [ ] materializeRunId/expectedExecSeq fencing（B12/B17 继承）；交付状态机（受控任务→受限 key→校验→fencing 事务终局→outbox→清理——spec §6.3）；RefundObligation（**unique(intentRowId,execSeq)+reversesId 幂等**）；StorageReservation 终态释放+upperBoundBytes 必填（无值 fail-closed）；ObjectManifest **delete-claim（claimOwner/claimUntil）**+有界 orphan；**text 生成链补外呼锚（v1.6 纪律收口）**：write-ahead providerRequestId 键复用 submit-poll 链模式（每次 attempt 先写键）；**超时/5xx→UNKNOWN 不自动重呼——用户显式「查询/重试」才开新 attempt（query-first 有查询能力则先查）；计费 at-most-once：reserve 在 UNKNOWN 期间保留、确认成功才 settle、取消才 void——资金 CAS 按 (requestId,attemptNo=1) 一个 requestId 只扣一次费；供应商重复成本平台吸收+`text_unknown_total`+人工对账；无幂等键无查询=外部 at-least-once 诚实登记（runbook+用户可见文案「可能重复生成、不会重复扣费」）**；**其余链三层防护维持不重建**〔write-ahead providerRequestId+providerTaskId 先落库+query-first resume——spec §1.7 实证〕；数据库 fencing 无法撤销已发生的外部调用，外部幂等键是唯一屏障
- [ ] 全组绿→Commit。

### Task 24: 收缩 FrameGate+最终矩阵激活（v1.6：删候选验证与 patch 路线）
**Files:** collab-frame-gate（T9 基础上扩语义面）；xml-schema.ts（T5c 白名单消费）
- [ ] 先红：①写 exec 根/未知类型/未知键/值类型错/容器替换/raw update 替换 live 现放行=红②**XML 对抗语料（未知元素/mark/属性/超深/超长/外链 URL/伪造 mention）现放行=红**③**协议版本门缺失（旧 bundle fixture 连新服务端进 DENY 无限循环）=红**
- [ ] **验证分层（偏离 37①②+38⑫⑬⑮——无候选验证/无 patch）**：DENY 面=**P2 最终矩阵运行时激活**（T3/T15/T16 冻结形状+exec 根+预算；**嵌套字段/容器对既有节点的校验经 ProjectDocIndex（T9 actor 已建——gate-local 查询非全 doc 扫描；本帧新建节点从 decodeUpdate struct 局部构建候选；无法判定归 T2 后验）**——不再声称「全部 frame-local」）+**XML L2=apply 后 changed-subtree walk（afterTransaction 触达子树；违规毒帧+per-connection 毒帧速率限制防重复重建 DoS）**+每帧世代（T9 已落）；NORMALIZE 面（悬挂边/父链环/跨组/重复边/媒体引用缺失/边引用不存在节点——读侧确定性屏蔽+graph_anomaly_total{kind}，**复用 T9/T26 同一 ProjectDocIndex 实例**）；毒帧面=Yjs apply 异常（T9 已落 4411）；业务权限归执行受理（PG）不进 gate；**clientID 绑定四元+单活跃（偏离 38⑰）**：绑定表 connectionId/lastSeenAt——同一四元组只允许一个活跃连接（旧连接活跃先 close 再纳新/僵尸超时替换/禁并发同键——同键并发=CRDT 结构性损坏）；异活跃用户拒/碰撞=可重试 close；**版本门 4406=protocolVersion+schemaVersion+historyId 三元硬门（build hash 仅遥测——偏离 38⑧）**；**origin 枚举计数器（gate|connection|load|import|maintenance|server-direct——仅 server-direct serving 写告警）**
- [ ] fuzzer（T5 语料+bit-flip+XML 对抗 L2）+B5 继承（不假 ACK——S1 契约测试回归）绿→Commit。

### Task 25: 拒帧恢复+4411+4410 三分+恢复模式
**Files:** shared collab-close-code.ts；web rejected-recovery.ts；runtime 恢复路径
- [ ] 先红：被拒后重复 apply 服务器态「修复」=红（CRDT 单调性反例）；g_client>g_server 静默 purge（现状导出→reload 缺接受路径）=红
- [ ] 4411 注册链+resolveCloseAction 档+**4412 resync-required（pending 区间拒绝）+4413 maintenance-freeze（Retry-After）+4406 client-outdated（三元硬门）**；REJECTED/DIVERGED 状态机（DraftEnvelope **三场景表〔T5c 冻结 v1.7 用户裁定式：A 同代 CRDT+boot 后异常提示/B 新增直入+修改逐字段「当前 vs 草稿」二选一默认保留当前+删除显式确认——无 journal/base 禁自动重放/C import-as-new+nodeId 稳定不重映射（冲突=跳过/替换用户选）+确认面三行含「不恢复产物·历史·计费」〕**+同代 fresh doc+多标签 BroadcastChannel）；**重复 DENY 逃生口（N 次 4411 后切 recovery 模式）**；4410 三分（generation-stale 全会话重建/doc-vacuuming=换代通道+dirty draft 导出〔T12 链〕/**server-restored 只读 recovery+草稿导出+管理员裁定接受〔historyId 不匹配/同代恢复均拦——onAuthenticate 先比 historyId〕**）；**recovery import REST（DraftEnvelope ≤8MiB：OWNER/EDITOR 且仅本人 draft+幂等键+候选 doc 全量校验（Schema/权限/图结构/XML 白名单）+单飞+限速——唯一允许 clone 场所；>8MiB=导出+fail-closed）**
- [ ] B6/B7 继承组绿→Commit。

### Task 26: 生命周期义务观察器（v1.7：**前移至 T22 之前**——P3 排序 T21→T26→T22；deliverArtifact node-deleted 权威依赖）
**Files:** collab-lifecycle-observer.service.ts（新）；NodeLifecycle/DeliveryFence（迁移二已建）
- [ ] 先红：删除节点后取消义务无持久提交点（删 A/并发 finalize 两序反例）=红；**T22 切换后 deliverArtifact 无 node-deleted 权威（doc data.written:false 弃用）=红前置**
- [ ] **genesis 行 seed（T7/T21 建）**；**义务由 actor FrameEffects 生成（T9 收集器已在——本卡消费 T5b 契约类型持久化，无第二套 Yjs update 解析器）**→**per-walSeq 义务 buffer 与对应帧前缀 PG 批事务同事务落库**（帧↔义务原子；义务可从帧前缀确定性重建）；**复用 T9/T24 同一 ProjectDocIndex 实例（edgesByNode/mediaRefsByNode——incident O(1)）**；**义务种类=closed enum（T5b 按 census⑪ 定员——必含 FEED_TOMBSTONE：删除已提交→Runtime Store 投影清理）**；交付事务写 artifact 前检查 `DeliveryFence.fenceSeq==当前 lifecycleSeq` 且 state 允许——不匹配=丢弃不退款；lifecycleSeq 数值序+当前行 partial unique；用例：delete 已删 no-op 不二次退款/undo 重建=新 lifecycleSeq/delete+restore 同帧两行/两项目同 nodeId 不互串
- [ ] B11/B12 继承组绿→Commit。
- [ ] 修正 #4 生效（T26 侧）：lifecycleSeq/fenceSeq=生命周期族单源（lifecycle.ts）——观察器/DeliveryFence 全程不经 execSeq（执行代际族——execution-chain.ts，比较单源 compareExecSeq）；义务队列转移/退款路径消费 shared execution-chain.ts §5（#11 T21 已落）——见「确认点①附带裁定」节

### Task 27: 维护窗口+世代切换（执行门；v1.6：9 段转移表+切代前置）
**Files:** collab-maintenance.service.ts（新）+REST gateway（admin guard+幂等键）+scripts/collab-rebuild-gen.mjs；MaintenanceOperation 消费
- [ ] 先红：QUIESCING 后 drain flush 被拒=红；CLI 无租约直写=红；**维护失败超时自动恢复写入**（应保持只读）=红；**check 后启动执行未被拒（行级关闸——REQUESTED 写 maintenanceId 后新执行必须 4xx）=红**；**SWITCHING 后 abort**（不可回退）=红；**T12 vacuumReplace 独立换代入口仍生效**（应委托状态机）=红
- [ ] **9 主段+2 终态转移表落卡（spec §6.6 v5.4）**：**REQUESTED=同一 PG 事务写 MaintenanceOperation+CanvasDoc.maintenanceId（行级关闸——执行受理读 IS NULL 才放行；先关入口再查/等 in-flight）**；**in-flight 判定范围=GenerationIntent/ExecutionNodePlan+ExecutionOutbox/delivery·materialize 在飞/退款义务（drain 到终态或 generation fence 拒绝）**；freeze（新帧 503/**4413 maintenance-freeze Retry-After**）→drain（spoolHeadSeq==pgSeq）→unload→export（DocCodec canonical）→fresh doc→**SWITCHING 单事务只做 DB（generation++/跨代连续 seq——水位保留不重置〔spoolHeadSeq·pgSeq 承接，T12 落定形态：switchGeneration 计数器+全提交旧段换代即删；purgeBelowSeq 清档、currentSnapshotRev 归 0 指针复位〕/插新代 Snapshot(g, rev0)〔stateSeq=旧代 maxSeq 承接非归零〕/写 stage）——提交成功后再 close 4410+切 WAL namespace+解冻（close 失败无害：重连被 generation auth 拒；事务内禁 close）**；每阶段幂等+attempt/leaseOwner/error 持久化（重启从 PG stage 继续）；**T12 vacuumReplace 委托本状态机（单换代入口——vacuum 只做 rebuild payload；「无在飞执行」前置对 vacuum 同样生效）**；空画布保头升代；归档=一份 PG dump 回滚；**世代切换首次真跑=执行门——单独请用户确认**
- [ ] 每 stage kill -9 演练+G9 继承组绿→Commit。

### Task 28: P3 出口
- [ ] G4/G5 证据汇编+增量投影（YEvent path[0] observeDeep——单节点 patch 断言）+verify 全绿→**用户确认点④**→Commit。

## P4：交付（T29-T34；T29=实体化生产前置批独立于本批交付线）

### Task 29: 生产前置批 charter（独立批实体化——owner/date 待定，**非占位**）
- [ ] charter 落 runbook+**发布自动化挂载（每项 owner/date/触发条件——偏离 38⑱：空挂=没闭环）**：PITR RPO≤5min/RTO≤30min+**`synchronous_commit=on`+有备库则同步复制验证（单机 Durable=「主库本地提交」诚实口径）**+MinIO 版本化 RPO≤15min+季度 restore drill（必含**「PITR/pg_dump 恢复后 WAL 不复活」**（bump historyId→旧段 quarantine→fail-closed→换代再开放写）与**「主备切换后 Durable 不丢」**两用例+忘 bump 时间戳栅栏拦截）+每小时 replay canary+HA 决策+SLO+`doc_append_gap_total` 告警+**生产前置四项挂 gate：HTTP seed（触发=cold p95>3s 或 loop block>50ms 实测超标）/对象存储 ExecutionInput bundle（触发=input 表>20GB 或 >2MiB 占比>5%）/逐帧审计表（合规需求确认）/ProjectErasure 跨介质擦除状态机（WAL 段/Snapshot/RuntimeEvent/ExecutionInput/DocAuditEvent/对象前缀/IDB/备份 tombstone）+ExecutionInput 30d·RuntimeEvent 7d/100k 清理 worker 常驻**——**任一未过不得开放生产流量（纳入发布自动化 gate-decision）**（本批发布说明=单机/dev-test/beta 诚实登记；Spooled≠已保存）。

### Task 30: reset-collab 工具+部署顺序
**Files:** scripts/reset-collab.mjs（新）；deploy.sh+gate-decision.mjs；collab-ops-runbook.md
- [ ] 先红：deploy 在旧消费者在线时 reset=红（顺序断言）；gate 判据缺 inflight/stranded 阻断=红
- [ ] reset 可重复执行（drop/recreate/清 spool/清本地缓存键/清公开快照缓存）+种子；**阶段状态持久化（各阶段完成态落盘——中途失败重跑感知已完成阶段，不依赖人工判断）**；**收尾必 bump historyId+旧 spool/WAL 整目录 quarantine（post-restore 步骤——T13/T29 恢复契约）**；破坏性发布流程（维护关写→drain→停全部旧 DB 消费者→reset/schema deploy→部署→就绪检查→开放写）；迁移串行校验（禁并行同 schema 状态）

### Task 30b: 旧版一次性切换演练（v1.6 新卡——T31 前实弹一次）
**Files:** collab-ops-runbook.md+deploy.sh+staging 克隆环境
- [ ] 先红：演练脚本缺失/顺序断言缺失（旧消费者在线即 reset）=红前置
- [ ] 序列落 runbook 并在 **staging 克隆重演一次（记录耗时必须<RTO）**：①公告维护+gate freeze→等 `spoolHeadSeq==pgSeq`+活跃连接 0（或强制 1012）②按序停旧消费者（**旧 API/WS+全部 scheduler/outbox poller/BullMQ worker**：feed→execution→compact——DB 连接/PID/租约三查确认无 in-flight）③DB 快照+对象存储 manifest 备份④`reset-collab --rebuild-db --confirm`（**含 SystemHistory bump+旧 spool/WAL 整目录 quarantine**）→migrate→seed⑤启动新 worker→等 ready→启动新 API→`/ready`+gate-collab⑥smoke：双端建/改/undo/保存（barrier Durable）/执行/feed 追平/查无 doc.exec⑦**回滚=一次性硬切语义：停新→恢复 DB 快照+前端 bundle 同回滚+nginx 强制旧 bundle（不支持「新客户端+旧服务端」）；「旧 bundle+新服务端→4406」「新 bundle+旧服务端→不可用」两向实弹验证**；**本地缓存清理由 generation/4410 客户端自清（服务端无此能力——口径修正）**
- [ ] 演练记录（耗时+问题清单）进 gate-evidence→Commit。
- [ ] 空库 reset→migrate→seed→双端协作全绿→Commit。

### Task 31: 故障演练矩阵
- [ ] kill -9 每阶段（spool/apply/批提交/快照/维护/毒帧/barrier flush）；PG failover；网络分区；磁盘满；OOM；时钟偏移；双浏览器/多标签/IDB blocked/断网重连/拒帧恢复/reset 后重连（B3 形态）+**vacuum 换代离线重连**（S2 语料实弹）+**feedSeq 提交顺序交错**+**世代切换时旧连接仍在发送+行级关闸后新执行被拒**+**外部生成成功后 worker 崩溃重试零重复副作用**（text 链锚验收）+**pg_dump 恢复→bump historyId→旧 WAL 段 quarantine 不复活+忘 bump 时间戳栅栏拦截**+**同代 PITR 恢复→客户端 SS2 旧内容被 historyId 握手拦截**+**fsync EIO fail-stop**+**doc 卸载×PG 故障**+**clientID 并发同键（僵尸+新连接）**
- [ ] 全部符合耐久契约（fail-closed/隔离恢复/零静默丢弃/水位不越）→Commit。

### Task 32: 删除清单执行（spec §6.7——D9 终点，删码与新路径同可编译切片）
- [ ] 删：doc.exec 读写链+writeExecStatus+applyWriteExecStatusToDoc+deleteExecOrphans+projectExecToStore doc 源+deliverArtifact doc 写面+**data.fileId/result/status 写者与 fallback**+execAligned 旧链+rebuildVacuumDoc exec 搬运+guardSyncFrame 旧面+**preVacuumSv 门与播种（T12 已停用——本卡删码）**+**appendSeq 列残留**+**zero-yjs DocLike 死引用**+transform/归档残留（若有）+provider recovery 旧档+**addToScope 死调用与 shift 字节回落旧测**+**display-cache 回写链与 valueSource/authority 死引用（T22 已停写——本卡删净）**+**Y1b 尺寸轮询定时器残留（T22 已停——本卡删净 pendingFacts 冗余路径）**+**doc 写路径 advisory lock/canvas_doc_update_seq 残留（T10 已切——本卡删净）**
- [ ] grep 零锚点断言进 verify（T0 census⑤/⑥ 清单逐项）；`doc.getMap('exec')` 写零；服务端 serving 期零业务 doc 写不变量测试常驻 CI
- [ ] 三面 tsc+全测试绿→Commit。

### Task 33: 负载基准（多项目分轴；v1.7 错误率定义+固定 runner）
- [ ] 10k 节点冷加载（服务端解码/装载/read model/首屏分轴）+8MiB 混合（传输/解码/fsync/apply/PG 批/投影分轴+**apply_replay_ms+echo_bytes（发送者回声流量）**）+**10 项目×10 连接真实并发分轴（WAL fsync 放大/批延迟/feed 负载/可见节点 culling——S4 升级序验证）+8MiB SS2×10 连接出站扇出/事件循环阻塞（OUTBOUND_BUDGET 96MiB 同口径）**；P50/P95/P99+CPU/RSS/IO/PG 锁等待；**`spoolHeadSeq-pgSeq` 积压规模与持续时间+慢项目隔离（背压验证）**；长时间持续写入+磁盘接近上限场景
- [ ] **实测转 CI 门禁并按 v1.7 口径冻结：硬 block=正确性/数据丢失不变量任一失败、错误率>0（口径=仅 5xx/未处理异常/非预期 1011/数据断言失败——预期 4411/4412/4404/4406/4413 单列不计入；负载 5xx<0.1% 无超时雪崩）、WAL fsync p95>20ms、save barrier p95>2s、10k 冷加载 p95>3s、恢复 RTO>5min、feed lag>30s——硬门固定 runner（PR 只跑 smoke，nightly/release 跑硬门）；软 warn=吞吐/CPU/RSS/IO/p99 及 1.0-1.2× 预算带、feed lag 5-30s、apply_replay_ms/echo_bytes 软预算（超限=触发 fork/patch 评审非只测不补）；发布前无 TBD 阈值**→Commit。

### Task 34: 发布门
- [ ] 发布门全绿（verify full+故障演练+负载基准+删除清单+reset 实弹+**T30b 演练记录**）+**gate-evidence manifest 校验（G1-G6a 全 manifest：skipped=0/artifact 齐/invariant 全 0/commit==HEAD——release 脚本机器判定，缺证据=不发布）**→**用户确认点⑤=全批终出口**（证据汇编：单机/dev-test/beta 限制+机损 RPO=PG 批延迟诚实登记+T29 前置条件）→Commit。

---

## 执行顺序与关键路径

- **P0（立即）**：T0（5 spike：**S1=4.6.0 pin+契约测试（v1.6 缩缴）**/S2 vacuum 离线/S3 undo origin·scope/S4 WAL 多项目+恢复扫描/**S5 feedSeq 计数行行锁**+**十一 census**）→T1/T2（两 bug 先红后绿——T2=删 :157+改 :512 读点）→T3/T4（矩阵+codec）→T5（**T5a/T5b/T5c 三段冻结**）→**确认点①**。
- **P1**：T7（G1）→T8→T9（**gate pre-apply**）→T10（G2+**barrier 服务端接线**）→T11→T12（vacuum 换代）→T13（G6a）→**确认点②**。
- **P2**：T15（容器+Y.Text 先行）→T16（G3）→T17→T18→T19（只改读者）→**确认点③**。
- **P3（v1.7 重排）**：T21（G4=父子行+frozenDocSeq+资金预留）→**T26（义务观察器+DeliveryFence——前移：deliverArtifact node-deleted 权威依赖）**→T22（G5=同切片切交付+Feed taxonomy+投影 overlay 四读径+删尺寸回写）→T23（UNKNOWN 纪律）→T24（DENY/NORMALIZE/XML L2/版本门）→T25（用户裁定式恢复）→T27（执行门：行级关闸+事务后 close）→T28（含增量投影）→**确认点④**。
- **P4**：T29（charter 含 historyId drill）→T30（reset+historyId bump）→**T30b（切换演练——T31 前实弹）**→T31→T32→T33（硬/软分档）→T34（manifest 门）→**确认点⑤**。
- 关键路径：T3/T4/T5→T7/T9/T10→T12/T13→T15/T16→T21/T22→T24/T26→T30/T30b/T32/T34。迁移×3 串行（T7→T21→T23）。

## §0 执行期偏离登记（滚动）

| # | 偏离 | 卡 | 依据 |
|---|---|---|---|
| D-1 | **媒体列表并发 replace 瞬态重复 id=known limit（不修）**：A 端 replace X‖B 端 replace 同 id 异内容 ⇒ 合并态可暂现同 id 两项（[X:v2, X:v1, K] 双端收敛）；下一全量 patch（面板写=全量 ImageItem[] 形态）经稳定 id diff 自愈；item 身份在 CRDT 结构外（item=plain JSON，非 Y 子结构）=设计已知限——item 级 Y.Map 容器为后续形态演进（非本批） | T17 双评审 Q-M-1 | 评审裁定：自愈面在+身份单源在 ns/doc 读侧（首见即用）；CRDT 内 item 身份=结构性新形态超本批 |
| D-2 | **pre-T17 plain-array 存量 doc 首次媒体写必触 container-type-mismatch（结构错误暴露不掩盖政策维持——非 bug）**：装载旧载体 doc 后首次 updatePromptImages/updateMultiImageImages 被 seam 拒（面板显示旧值不丢）；**批量迁移杠杆=vacuum 重建（toReadModel→fillDoc 物化 Y.Array）+T30/T34 硬切**——部署期若见 write_reject{reason:container-type-mismatch, via:array-domain} 集中爆量=存量面非回归，防误报回归判定 | T17 双评审 Q-M-4 | spec v5-13 硬重置（零迁移面）；fail-closed 拒优于静默双载体 |
| D-3 | **api 写原语域键守卫不对称（纵深缺口非活 bug——T24 统一收口两选一）**：applyWriteNodeDataToDoc 逐键守卫仅 textDomainOf（T15）；xml/array 域键现靠 Z108 SERVER_NODE_DATA_KEYS 白名单单层结构性不可达（数组键∉白名单实证；但 `'content'`∈白名单而 textInput.content 自 T16 起=xml 域——未来白名单扩入域键即单层穿透，且 writeBatch 调用方误用 `{content}` 无守卫拦）。**T24 统一守卫时两选一落地**：①canvas-doc-manifest SERVER_NODE_DATA_KEYS 移除 `'content'`，或 ②applyWriteNodeDataToDoc/applyDeleteNodeDataKeysToDoc 补 `isXmlDomainKey‖isMediaListDomainKey` 逐键拒（与 web seam 同尺） | T16 残余+T17 双评审 spec-I-1/Q-M-2（两评审员独立收敛） | 当前零活调用点（T15 收口已删 doc 直写腿+deliverArtifact 单键收窄）；本行=仓内可考落痕（会话级 Controller 台账不换人可溯） |

**门禁总览（v1.7：manifest+负控机器判定——spec §9.1）**：工程门 G1=T7｜G2=T10（+barrier 接线+所有权切换验收）｜**G6a=T13（doc 平面）**｜G3=T16-T20（**含 XML L1**）｜G4=T21｜**G5=T22（=Feed/G6b，含 feedSeq 交错+空项目首事件+historyId cursor；前置=T26 义务观察器）**——gate-evidence manifest 机器判定+每门负控，不过=先改再写码。**用户确认点①=T5（T5a/b/c 三段）｜②=T14｜③=T20｜④=T28｜⑤=T34；执行门=T27 世代切换首跑+T30b 切换演练（维持）**。继承验收锚：genesis 双路=T7｜前缀/装载守卫=T10/T11｜富文本并发+XML L1=T16｜undo 栈上限=T18｜broken reader 零+census.json=T19｜受理冻结/frozenDocSeq 临界区/幂等受理/资金预留=T21｜义务先行=T26｜feed 可靠+提交顺序+四读径=T22｜退款/交付 fencing/text 链锚=T23｜准入 DENY/NORMALIZE/XML L2/版本门/clientID 单活跃=T24｜拒帧恢复用户裁定三场景=T25｜维护演练/行级关闸/事务后 close=T27｜切换演练一次性硬切=T30b｜发布门 manifest=T34。

**旧任务处置映射**（v1.4→v1.5 见前注；v1.5→v1.6 见 git 存档；**v1.6→v1.7 第十轮定点修订——spec v5.4/偏离 38 为依据**）：T0=S1 验收改写（发送者回声/DirectConnection allowlist/in-flight 去重/origin 枚举九验收）+S4 actor 原型基线+census 补 withDoc 调用点；T2=+**resolvePromptText 单函数单测试（认账补落）**；T3=删 ownership 残留；T5a=+walCheckpointSeq 拆义/pending 区间/readOnly 短路/frameHash/WS 9MiB/版本门三元/4413/客户端半链/flush 节流；T5b=+SystemHistory 权威/FrameEffects·ProjectDocIndex 契约/requestId 内部 PK/historyId 列/planHash 不可变/资金预留/cursor upsert/actorRanges 单表示；T5c=+RuntimeProjection 类型 merge/用户裁定式三场景/nodeId 不重映射/四读径/census.json；T7=+SystemHistory 唯一权威（删 CanvasDoc.historyId）/walCheckpointSeq 改名/RuntimeFeedCursor genesis；T8=+段头 lastWriteAt/帧存 frameHash/EIO fail-stop；T9=**CollabProjectActor+所有权切换（onStoreDocument 链拆除）+in-flight promise map+readOnly 短路+pending 前移+入站上限**；T10=+flush 节流/beforeUnloadDocument 正名/maxResidentDocBytes/walCheckpointSeq CAS；T13=+EIO/时间戳栅栏/卸载演练；T16=+XML L1 同卡激活+PM schema 同源；T19=+census.json 索引+dev-only；T21=+frozenDocSeq 正确临界区（freeze=拿 mutex）/409 两类/资金 per-item/brotli；T22=+node-deleted 权威=DeliveryFence/taxonomy/cursor upsert/historyId cursor/四读径 BindMedia/锁序简化；T24=+XML L2/frame-local 措辞收窄（ProjectDocIndex 校验源）/clientID 单活跃；T25=+用户裁定式+nodeId 不重映射+4413；T26=**前移 T22 前**+复用同索引；T27=+行级关闸/事务后 close/T12 委托单入口；T29=+synchronous_commit/ProjectErasure/触发条件数字化挂 gate；T30/T30b=+一次性硬切+停全部 poller+本地缓存口径；T31=+EIO/同代恢复/clientID 实弹；T33=+错误率定义/echo_bytes/固定 runner；**P3 重排 T21→T26→T22**。其余任务卡（T1/T4/T11/T12/T14/T15/T17/T18/T20/T23/T28/T32/T34）维持 v1.6（T12 vacuumReplace 委托语义在 T27 落）。
