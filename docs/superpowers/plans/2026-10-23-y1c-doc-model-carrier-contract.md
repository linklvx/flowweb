# Y1c：doc 模型 v4·四平面架构 Implementation Plan（P0 契约 / P1 载体 / P2 内容 / P3 业务与恢复 / P4 交付）

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

<!-- plan v1.5（2026-10-24）：依据 **spec v5.2（f8fd2bc0——第八轮外审采纳+用户两项重裁：勘误精化版）** 对 v1.4（c68087e3）**主体保留+12 卡定点修订**（第八轮外审：「不建议重写全部 34 张任务卡，保留主体修订依赖与少数核心契约」）。**v1.5 收口要点**：①`spoolSeq` 别名删除——CanvasDoc 持久列=`walSeq/pgSeq`，不变量 `0≤pgSeq≤appliedSeq≤walSeq`；②跨表 CHECK 勘误（Snapshot.stateSeq≤pgSeq 由快照发布事务行锁+条件更新保证——T11 机制）；③RuntimeEvent=**per-project feedSeq+同项目行锁内分配且同事务提交**（分配序≡提交序——裸 sequence 分配序≠提交序漏事件洞；S5 实验锚）；④T2=删 :157+**改 execution.service:512 执行读点**（string 直读腿——读链断供实证：`data?.prompt?.text` 只匹配 PromptValue、TextNodeData.prompt:string 恒 miss、textInput 执行 prompt 现状独占依赖 :157 覆盖；上游注入恢复正文语义）+**无 promptText 请求参数**（prompt 权威=doc 单源→T21 服务端从 PG 一致前缀冻结）+同 requestId 断线重试幂等受理；⑤候选文档验证（对照活动 doc 现状增量语义验证——禁全扫）；⑥每帧对照世代权威验证 generation；⑦per-project 写入背压；⑧text 生成链外呼锚（其余链三层防护已在）；⑨ACK 三档+UI 四态映射；⑩savedSeq 只由持久化回执推进；⑪reset 阶段状态持久化；⑫测试三补+性能分轴两补。**架构/门结构/纪律不变**：四平面；六项 go/no-go=工程门（G1@T7/G2@T10/G6a@T13/G3@T16-T20/G4@T21/G5@T22）；用户确认点①=T5/②=T14/③=T20/④=T28/⑤=T34+执行门 T27（**第八轮外审建议取消确认点——用户 2026-10-24 驳回，维持**）；每卡先红→绿→commit；迁移×3 串行（T7→T21→T23）。 -->

**Goal:** 落地 doc 模型 v4 四平面架构——P0 契约冻结（全类型矩阵+DocCodec 真 Yjs 双出口+两现行 bug〔含执行读点改向〕+水位 walSeq/appliedSeq/pgSeq+ExecutionRequest/RuntimeEvent per-project feedSeq/WAL 帧协议收口）→P1 载体垂直切片（spool-first 写管线+applied 前缀批量 PG+快照/vacuum 换代+G6a doc 平面故障恢复）→P2 内容（容器规则+Y.Text/XmlFragment/媒体数组+Tiptap 双端+单 UndoManager 收口+读者改道〔只改读者〕）→P3 业务（ExecutionRequest 全计划+PG 权威执行态+RuntimeEvent Feed 全量+同切片切交付+收缩 FrameGate〔候选验证〕+维护窗口）→P4 交付（reset 工具+故障演练+多项目负载+删除清单+发布门）。

**Architecture:** 见 spec v5.2 §2-§7。核心不变量：①客户端帧由 gate 拥有持久化（listener 禁 connection-origin 二次 append）；②ACK 前帧已 WAL fsync；③snapshot 只从 PG 前缀（≤pgSeq）生成（跨表一致性=发布事务行锁）；④barrier committedSeq=pgSeq；⑤**PG 只提交已 apply 帧（上界=appliedSeq）**；⑥业务输赢由 PG 事务+fencing 裁定；⑦服务端 serving 期零业务 doc 写。

**Tech Stack:** TypeScript strict / Yjs exact 13.6.32（shared 亦直用——T4）/ @hocuspocus/server（**S1 双版本实测：4.6.0+4.7.0/4.7.1——4.7.x 已发布但 changelog 无 errorHandler 修复〔Context 支持/maxAttemptsFailed〕；验收=完整顺序契约非仅 errorHandler 被调用；可升级则升级〔shared csv 版本门〕，不可升级 patch-package 固定版**；不 patch y-protocols）/ y-prosemirror（本库现未用——T16 按 v4-4.3 引入 ySyncPlugin 直绑嵌套 fragment；exact pin+事务 origin 由 S3 spike 定，按需 addTrackedOrigin）/ @tiptap/react 2.10.0 / NestJS / Prisma / vitest+node:test / CI postgres。

**执行纪律：** 每卡先红→绿→commit；写码前 grep 实证；行号=c68087e3 快照；三面 tsc；文档 diff 随卡；迁移串行不并行；每阶段出口用户确认。

## 文件结构（触碰面全景）

| 文件 | 动作 | 责任 | 阶段 |
|---|---|---|---|
| packages/shared/package.json+src/canvas/doc-schema-v4.ts | **建/改** | shared 增 yjs@13.6.32 依赖；全类型树形矩阵+meta 白名单+DataKeySpec 三元（T3/T4） | P0 |
| packages/shared/src/canvas/doc-codec.ts | **建** | canonical+toReadModel+toPublicReadModel——**真 Yjs 类型直用**（T4） | P0 |
| packages/shared/src/canvas/docShape.ts+canvas-doc-manifest.ts | 改 | 键分类/准入面共用；re-export 删除（T4/T19） | P0/P2 |
| packages/shared/src/collab/{draft-envelope,runtime-event,doc-protocol}.ts | **建** | DraftEnvelope(+merge policy)/RuntimeEvent per-project feedSeq DDL+游标语义/水位三元 walSeq·appliedSeq·pgSeq+WAL 帧协议+ACK 四态 UI 映射+Hocuspocus 方案契约（T5） | P0 |
| apps/web/src/stores/nodeStore.ts:20,:225,:719,:725+AddNodeMenu:92+canvasStore:159-166 | 改 | bug① textInput 单源+nodeTypeMap 收口（T1） | P0 |
| nodes/TextConfigPanel.tsx:157+**apps/api execution.service.ts:512（执行读点改向）** | 改 | bug② 修=删 :157 覆盖写+改 :512 string 直读腿——**无请求参数**（T2） | P0 |
| scripts/check-collab-cjs.mjs 扩+ADR-01 单实例 | **建** | census 静态门（未分类字段红/服务端读者/裸构造/doc.exec 触碰零增长）+单实例 ADR（T5/T8） | P0/P1 |
| apps/api/prisma/schema.prisma+迁移×3 | 改 | P1 载体族（CanvasDoc 水位双列 walSeq/pgSeq+同行 CHECK/Snapshot〔跨表走发布事务〕/Update 批行形状/MaintenanceOperation 扩展——删 appendSeq/admissionCutoff/@@unique([maintenanceId])/DocWriteAudit）→P3 业务族（ExecutionRequest 全字段/RuntimeEvent per-project feedSeq/NodeExecution+generation 列/ExecutionOutbox/MaterializeRun/RefundObligation/NodeLifecycle(lifecycleSeq)/DeliveryFence）→P3 资源族（StorageReservation/ObjectManifest claim）（T7/T21/T23） | P1/P3 |
| collab-frame-gate.service.ts（重写现 guardSyncFrame） | 改/**建** | beforeSync 准入（每帧世代+候选验证）+SHA-256 去重+spool-first+帧字节精确 copy+毒帧路径（T9/T24） | P1/P3 |
| collab-spool.service.ts+collab-persistence.service.ts | 改 | 帧协议升级（帧带 generation）+applied 前缀批量 PG+水位三元+背压（T8-T11） | P1 |
| collab-doc-registry.service.ts:628-698（rebuildVacuumDoc/guardSyncFrame preVacuumSv 分支） | 改/**删** | vacuum=generation++/新 docName+preVacuumSv 门退役（T12/T24/T32） | P1/P3/P4 |
| collab-document.service.ts:194-224,:248-264,:307-326（vacuumReplace/deliverArtifact/writeExecStatus） | 改/**删** | vacuum 换代（T12）/deliverArtifact 改 PG 写+doc 写零化+doc.exec 停写停读（T22）/writeExecStatus 退役（T32） | P1/P3/P4 |
| apps/api runtime-feed.service.ts（新）+web runtime store | **建** | RuntimeEvent 快照+per-project feedSeq 游标（行锁分配）+心跳+续传（T22/G5） | P3 |
| canvasUndo.ts | 改 | 单 manager 收口：不 addToScope/栈上限 100+整栈 clear（T18） | P2 |
| TextInputNode/PromptInput/ImageExtConfigPanel/PromptEditor/TextNodeFullscreen/TextNodeToolbar+canvasIntents | 改 | XmlFragment 双端（含 imageExtGen 域）+容器唯一创建+Y.Text 域（T15/T16） | P2 |
| AudioConfigPanel/MultiImageConfigPanel+nodeStore:162,:175 | 改 | audioGen content→prompt Y.Text 迁移+multiImageGen prompt 死字段赋形（T15） | P2 |
| nodeStore:716-720/useImageUpload/CanvasView/ImageGenNode | 改 | 媒体列表 Y.Array 单卡（T17） | P2 |
| execution.service/generation-intent/materialize/team-credit+**api-caller.service.ts（text 链外呼锚）** | 改 | ExecutionRequest 全计划+docSeq=pgSeq+PG 一致前缀读（promptText 服务端冻结）+幂等受理+worker 零 doc 读+fencing+退款+text 链锚（T21-T23） | P3 |
| collab-server.factory.ts | 改 | onStateless 接线（save barrier——现状未接）+apply errorHandler patch/升级挂载（T21/T24） | P3 |
| collab-lifecycle-observer.service.ts（新） | **建** | 只读观察+per-walSeq 义务 buffer 与 PG 批同事务+反向索引（T26） | P3 |
| collab-maintenance.service.ts+REST gateway+rebuild 脚本 | **建** | 维护窗口+stage enum+水位重置+WAL 切代+admin guard（T27） | P3 |
| packages/shared/src/constants/collab-close-code.ts+web recovery | 改/**建** | 4411+4410 三分（doc-vacuuming 换代+dirty draft 导出）+server-restored 接受路径（T25） | P3 |
| apps/web 全读者~27 处/14 文件+api video-work-clone:33+registry rebuild:635 | 改 | read model 改道（**只改读者——写者保留至 T22/T32**）+ETag=pgSeq（T19） | P2 |
| canvasCollabRuntime.ts+local-collab-cache.ts | 改 | per-tab 缓存 mergeUpdates（savedSeq 只由持久化回执推进）+增量投影+save barrier 客户端（T18/T21/T28 前移项） | P2/P3 |
| deploy.sh+scripts/reset-collab.mjs+collab-ops-runbook+T29 charter | 改/**建** | reset 工具（阶段状态持久化）+发布门+生产硬门 charter（T29/T30/T34） | P4 |

**不动红线**：NODE_ENVELOPE_KEYS；ecosystem 双进程（compact=COLLAB_ROLE worker 真进程隔离）；yjs 私有 API 禁令（不做 struct adapter/不 keepItem/不 doc.store——incarnation=PG lifecycleSeq）；四平面职责边界（业务状态禁回 doc）；**ExecutionOutbox 禁作 feed 日志**。

---

## P0：契约（T0-T6——除两 bug 外零生产代码变更）

### Task 0: 基线 spike+census 固化
**Files:** spike/census 产出记入本卡（零生产代码）
- [ ] **五个 spike**：**S1 Hocuspocus apply 真相化（双版本）**——4.6.0 与 4.7.0/4.7.1 双版本真实 SyncStep2/Update 路径行为实测（malformed update→apply 失败→SyncStatus 是否 true；**验收=完整顺序契约**：准入→fsync→apply→ACK 顺序，非仅 errorHandler 被调用）；可升级则升级（版本门 shared csv），不可升级 patch-package 验证（固定版+上游 diff 回归）。**S2 vacuum 离线重连推演**——旧缓存/旧 SV（全 clock<pre 部分陈旧客户端）/dirty draft 三形态对「旧 #g auth 拒绝→DraftEnvelope 导出→清缓存→新 name 重连导入（新 Schema/权限/图结构校验）」全链。**S3 undo origin/scope**——`UndoManager([nodes,edges])` 对嵌套 Y.Text/XmlFragment 变更捕获实证（changedParentTypes 父链）+y-prosemirror exact pin 调研（@tiptap/react 2.10.0 ProseMirror 矩阵）+ySyncPlugin 事务 origin 实测（≠LocalUser 则 T16 addTrackedOrigin）——**证明 addToScope 不需要**。**S4 WAL 多项目 fsync 放大+恢复扫描**——10 项目×10 连接基线（per-project owner 分段现状），p95>20ms 即定全局/shard；**恢复扫描验证**（坏段尾部截断/隔离后完整有效前缀重建 walSeq/appliedSeq）。**S5 feedSeq 提交顺序实验**——PG 裸 sequence 分配序≠提交序复现（事务 A 取号未提交/B 先提交→游标漏 A）+per-project 行锁分配方案验证（分配序≡提交序——与 canvas_doc_update_seq advisory lock 先例〔repository:61-62〕对照，定行锁形态：advisory lock 键族 vs 专用计数行 FOR UPDATE）
- [ ] **census 固化**：①节点类型全集（真实创建/保存/加载/执行/导入/导出路径——group/videoEdit 必入册）②全类型字段路径 census（envelope+data 键树——**现状基准：audioGen prompt 住 content:string〔AudioConfigPanel textarea〕；multiImageGen.prompt=零写点死字段；textInput data.prompt:string 每键击落 doc；执行读点 :512 现状 `.text` miss string**）③readRecordsFromMaps 全调用点（web+server）④textInput prompt 全消费面（含 execution.service:512+topology:83-84 上游注入）⑤doc.exec 全触碰面清单（P3/P4 删除输入）⑥服务端写 doc 全路径清单（不变量验收输入）⑦39 裸 `project:${pid}` ⑧per-tab 缓存现状与 IDB 键面
- [ ] Commit（spike 结论〔S1 版本决策/S3 origin 结论/S4 WAL 拓扑决策/S5 行锁形态〕+census 清单）。

### Task 1: bug① isTextNode 统一+创建链单源
**Files:** nodeStore.ts:20,:225,:719,:725；AddNodeMenu.tsx:92；canvasStore.ts:159-166；TextInputNode.test.tsx:84,:91；nodeStore.test.ts:543
- [ ] 先红：夹具改生产名 `'textInput'`+删 isTextNode mock→重挂载断言正文保留→**红**
- [ ] 绿：isTextNode 判 NODE_TYPES.TEXT；删 :613-621 幽灵兜底；:719/:725 裸字面量全清；AddNodeMenu:92+nodeTypeMap 翻译链收口；创建类型断言（resolvedType∈值集）
- [ ] 全仓 grep 节点 type 裸字面量清零；web tsc+测试绿→Commit。

### Task 2: bug② 修——删 :157 覆盖写+改 :512 执行读点（无请求参数）
**Files:** nodes/TextConfigPanel.tsx:157；**apps/api/src/modules/execution/execution.service.ts:512（执行读点）**；回归+E2E
- [ ] 先红：①「生成后正文不被覆盖」（现 :157 用 prompt 覆盖 content）→**红**②**textInput 无上游文本时执行 prompt 读 `data.prompt:string`**（改前 `data?.prompt?.text` 对 string 恒 miss→落 content 正文/'Hello' 兜底——面板 prompt 执行链断供实证）→**红**③E2E「输入 prompt→取消选中→重新选中→prompt 仍在→生成使用该值」→**红**
- [ ] 绿：**:157 删覆盖写（仅此一行——onChange :204-212 每键击写 data.prompt:string 的现状持久化保留**，不写过渡形状不删持久化）；**:512 执行读点加 string 直读腿**（`typeof data?.prompt==='string' ? data.prompt : data?.prompt?.text` 或等价——textInput prompt 直读，image/video PromptValue 读法不变）；**上游注入恢复正文语义**（topology:83-84 读上游 textInput content=tiptap 正文——:157 删除后语义自动归正，测试锚明示）；**无 promptText 请求参数**（prompt 权威=doc 单源；T21 服务端从 PG 一致前缀冻结 ExecutionRequest.promptText）；终形 prompt=Y.Map{text:Y.Text} 待 T15 迁移（读点同卡再改）
- [ ] 测试绿（含 audioGen content 现状不动——T15 迁）→Commit。

### Task 3: DOC_SCHEMA_V4 全类型树形矩阵+DataKeySpec 三元
**Files:** packages/shared/src/canvas/doc-schema-v4.ts（新）+schema-contract.spec.ts（新）
- [ ] 表形（树形+全类型+容器语义——spec §3.1 矩阵冻结为唯一基准）：

```ts
export type YFieldType = 'text' | 'xml' | 'map' | 'array' | 'lww-array' | 'lww' | 'server-forbidden';
export interface DataKeySpec {
  yType: YFieldType;
  writer: 'user' | 'server';            // 谁可写（权限矩阵）
  valueSource?: 'user' | 'server-feed'; // 值来源（尺寸等=feed 下发客户端代写）
  authority?: 'content' | 'display-cache'; // 权威性（display-cache=非执行/计费输入）
  reader: string[]; permission: 'free' | 'protected'; undo: boolean; mediaRef: boolean;
  importExport: boolean; maxBytes?: number; items?: DataKeySpec; children?: Record<string, DataKeySpec>;
  canCreate: boolean; canWrite: boolean; canDelete: boolean; // 三操作矩阵
  inExecutionPlan: boolean; // 是否参与执行计划冻结（v5.2——偏离 36 注记）
}
export const DOC_SCHEMA_V4: Record<string /*nodeType 全集含 group/videoEdit*/, { envelope: readonly string[]; data: Record<string, DataKeySpec>; }>;
export const META_WHITELIST: readonly string[];
// 未知类型=显式 schema 错误（写拒+读侧只读保真策略标注）；exec 根不在 schema——写入即 DENY
// 矩阵基准：textInput{content:xml, prompt:map{text}}；audioGen/multiImageGen{prompt:text}；imageGen/videoGen/imageExtGen{prompt:xml}；allImages/images=array
```

- [ ] 先红：schema-contract.spec——「census①全集逐类型 envelope+data 全路径穷举」「组合合法性（writer=server⇒ownership=server；valueSource=server-feed⇒authority=display-cache+白名单登记）」「键集与 canvas-doc-manifest 现键零漂移」「META_WHITELIST ⊆ meta 现键」（现无类型维度=红前置）
- [ ] 绿+断言族全绿→Commit。

### Task 4: DocCodec 双出口——真 Yjs 类型直用（删 zero-yjs）
**Files:** packages/shared/package.json（+yjs@13.6.32）；packages/shared/src/canvas/doc-codec.ts（新）+round-trip 属性测试
- [ ] 接口：`serializeCanvas(doc: Y.Doc): CanvasDocument`（canonical——备份/重建/semanticEqual）+`toReadModel(doc: Y.Doc): CanvasReadModel`（plain JSON——REST/执行/导出；文本显式 string，富文本 PM JSON/HTML）+`toPublicReadModel(readModel, policy)`（公开快照 sanitize+URL allowlist）；readCanvas 只返回 read model——禁止共享类型逃逸；**无 transformV3ToV4Draft**（硬重置——spec v5-13）
- [ ] **DocLike fake 镜像不建**（zero-yjs 废止——偏离 33；shared 直用真 Y.Doc/Y.Map/Y.Text/Y.XmlFragment/Y.Array）；readRecordsFromMaps 收编唯一 import；docShape re-export 删除——调用点（census③含服务端）全量改道
- [ ] 先红：round-trip 属性测试（含 XmlFragment/mention/image PM 节点/Y.Array 媒体/position Y.Map 逐键——语义相等非字节相等）→绿+census 门→Commit。

### Task 5: 协议契约冻结收口
**Files:** packages/shared/src/collab/{draft-envelope,runtime-event,doc-protocol}.ts（新）+耐久常量+runbook 草节+fixture
- [ ] 冻结清单：**水位状态机（D1 v5.2）**——walSeq/appliedSeq/pgSeq 定义+不变量 `0≤pgSeq≤appliedSeq≤walSeq`+CanvasDoc 同行 CHECK（pgSeq≤walSeq）+**跨表不变量（Snapshot.stateSeq≤pgSeq）=快照发布事务行锁+条件更新（非 CHECK）**+ETag/docSeq/committedSeq=pgSeq；**Hocuspocus apply 方案（D3 v5.2）**——S1 双版本结论落契（升级版本或 patch diff+上游差分回归）+post-check=encodeStateVector decode per-client clock 上界（**不用 doc.store**）+毒帧协议（隔离/停写/WAL 截断至 appliedSeq/4411/pgSeq 重放）；**ExecutionRequest 全字段（D4 v5.2）**——spec §6.1 全列+docSeq=pgSeq+等待上限+PII 256KB 上限+**promptText 等冻结字段由服务端从 PG 一致前缀恢复 doc 冻结（客户端请求不携带提示词参数）+同 requestId 断线重试幂等受理**；**RuntimeEvent（D5 v5.2）**——per-project feedSeq DDL（`@@unique([projectId,feedSeq])`）+**行锁分配纪律（同一项目行锁/advisory lock 键族内分配且同事务提交——分配序≡提交序，S5 实验锚）**+kind/payload 形+游标语义+心跳 15-30s+docSeq 应用规则；**Undo 策略（D6）**——栈上限 100+整栈 clear+rebuild 逃生口（不 addToScope/不 keepItem/无 shift 字节回落验收）；**WAL 帧协议**——SHA-256 帧去重（先于 walSeq 分配）/单调序号/**帧内一律携带 generation**/CRC 边界/坏段四档分类码/换代 namespace 切段；**ACK 三档+耐久五档+UI 四态映射**（Local 编辑中/Spooled 已接收正在保存/Applied 已同步等待数据库提交/Durable 已保存——Durable 必须对应 pgSeq 回执，不因 WebSocket 连接自动显示）；**候选验证契约**（对照活动 doc 现状增量语义验证——引用闭包/跨节点关系，禁全扫）；**版本维度表**（含 per-project feedSeq）；**4410 三分载荷**（generation-stale/doc-vacuuming=换代通道+discardLocalCache/server-restored）+4411；**DraftEnvelope（含 merge policy 算法）**；nodeId 语法+slot 编码；**save barrier 协议**（onStateless {nonce,...}→{nonce,committedSeq=pgSeq}+首语句同步捕获纪律）；**迁移二/三表 exact DDL**（MaterializeRun/RefundObligation〔unique+reversesId〕/ObjectManifest〔claimOwner/claimUntil〕）
- [ ] fixture：双端并发语料（每类型典型+边界）+WAL 故障语料（坏 CRC/截断/缺号/重复）+feed 故障语料（乱序/缺口/旧代/游标失效/**feedSeq 提交顺序交错——事务 A 取号未提交/B 先提交，游标不漏 A**）
- [ ] census 静态门进 verify fast（check-collab-census 扩：未分类新字段红+服务端读者清单+裸构造门+doc.exec 触碰面零增长）
- [ ] **P0 出口=用户确认点①**→Commit。

## P1：载体（T7-T14——最小可恢复协作垂直切片；G1/G2/G6a 三工程门）

### Task 7: G1 门——迁移一载体族+genesis 双路+缺头三态
**Files:** schema.prisma+迁移一；project.service.ts:45-108；canvas.service.ts:37-53
- [ ] 表形（BigInt 默认 0 非 0n；relation 双侧全补+onDelete: Cascade；先 reset 再 migrate 豁免登记）：

```prisma
model CanvasDoc { projectId String @id  generation Int @default(0)  schemaVersion Int  vacuumEpoch Int @default(0) /* 遥测 */
  currentSnapshotRev BigInt @default(0)  walSeq BigInt @default(0)  pgSeq BigInt @default(0)
  purgeBelowSeq BigInt?  maintenanceId String? /* stage 单源在 MaintenanceOperation——本表不存 lifecycle/stage 裸 string */
  project CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade) }
// raw SQL: CHECK (pgSeq <= walSeq) —— 同行约束（v5.2：spoolSeq 别名删除统一 walSeq）
// 跨表不变量 Snapshot.stateSeq <= pgSeq：非 CHECK——由快照发布事务行锁+条件更新保证（T11）
// 无 appendSeq/admissionCutoff/@@unique([maintenanceId])/DocWriteAudit（v1.2 残留全删；审计=CanvasDocUpdate 批行 actor 字段）
model CanvasDocSnapshot { projectId String  generation Int  snapshotRev BigInt  stateSeq BigInt  state Bytes
  stateHash String @db.Char(64)  vacuumEpoch Int  schemaVersion Int  createdAt DateTime @default(now())
  @@id([projectId, generation, snapshotRev])  project CanvasProject @relation(...) }
// raw SQL: CHECK (octet_length(state) <= 16MiB)
model CanvasDocUpdate { projectId String  generation Int  seq BigInt /* =批 lastWalSeq */  firstWalSeq BigInt  frameCount Int
  updateHash String @db.Char(64)  actor String?  update Bytes  createdAt DateTime @default(now())
  @@id([projectId, generation, seq])  @@unique([projectId, generation, updateHash])  project CanvasProject @relation(...) }
// raw SQL: CHECK (octet_length(update) <= 16MiB)——不存单 frameId（批量形状——偏离 33）
model MaintenanceOperation { maintenanceId String @id  projectId String
  stage MaintenanceStage /* Prisma enum——非裸 string */  status MaintenanceStatus
  sourceGeneration Int  targetGeneration Int  schemaVersion Int  cutoffPgSeq BigInt  drainedAt DateTime?
  error String?  idempotencyKey String @unique  leaseOwner String?  createdAt  updatedAt
  @@index([projectId, status]) }
// raw SQL: 活跃维护 partial unique（一项目一活跃）——唯一性在此不在 CanvasDoc
```

- [ ] 先红：①genesis 双路（POST /canvases 建头+Snapshot(g,0,0)）②缺头三态（missing 非 `?? 0`）③`prisma validate`（空 model/单侧 relation/缺 opposite 三形态红实测——本卡真绿）
- [ ] G1 证据：prisma validate+migrate diff+SQL dry-run（行锁/水位 UPDATE RETURNING/去重 no-op/CHECK 生效/快照发布事务验证跨表不变量）→**G1 go/no-go 判定**（不过=修表形重跑，禁绕过）
- [ ] 交错（并发双创建）绿→Commit。

### Task 8: 单实例 ADR+WAL 帧协议升级
**Files:** docs/superpowers/adr/ADR-01-single-instance.md（新）；collab-spool.service.ts
- [ ] ADR-01：instances:1 复杂度边界（非 HA）/单写者/重启恢复顺序（WAL→PG 前缀校验→重建 appliedSeq→开放写）/扩容=独立批前置条件（共享耐久日志/所有权租约/fencing）
- [ ] spool 帧协议升级：**SHA-256 帧去重+walSeq 单调序号（per project）+帧内一律携带 generation**（即使 per-project 文件维持——换代切段后扫描器识别段属代；全局/shard 时另带 projectId）+水位字段+坏段分类码（crc/truncated/missing-seq/dup-hash 四档）；磁盘上限+背压+故障停收（fail-closed）；拓扑按 S4 决策落地；**换代=段 namespace 切代+旧段 quarantine**；**恢复扫描=完整有效前缀，截断/隔离无效尾部（S4 验证锚）**
- [ ] 先红：坏段分类用例（构造坏 CRC/截断/缺号/重复 hash→分档隔离告警=现无分类红）→绿→Commit。

### Task 9: spool-first 写管线核心
**Files:** collab-frame-gate.service.ts（重写 guardSyncFrame 收编）；collab-persistence.service.ts（listener 改造）
- [ ] 先红：①现 apply→listener 二次 append 路径（connection-origin 双写断言）=红②ACK 时帧未 fsync（spool 先于 apply 断言——现 listener 后置）=红③重复帧拿到重复 walSeq（现无去重）=红
- [ ] beforeSync 准入（**每帧对照世代权威（DB/同步失效缓存）验证 generation——非连接建立时缓存**〔偏离 36-②〕→身份/权限/格式→解码+结构权限+预算+图约束+**对照活动 doc 现状增量语义验证（引用闭包/跨节点关系——「字段类型合法≠值/业务关系合法」；禁全文档扫描——增量触碰子树+引用闭包，毒帧路径兜底〔偏离 36-①〕）**→帧字节精确 copy 独立 buffer）→**SHA-256 去重（重复帧=no-op 确认，不分配 walSeq）**→spool.putBatch+fsync（group commit ≤20ms 批窗）→放行 apply→广播；**update listener 禁 connection-origin 二次 append**（gate 拥有持久化）；**per-project mutex 跨 spool→apply**（串行——appliedSeq 无竞态）；**per-project 写入背压（慢项目不拖垮其他项目——队列隔离+限流+观测〔偏离 36-③〕）**；维护写独立 append 通道（现状维持）
- [ ] **P1 validator=P1 shape fixture**（root/权限/预算/通用格式——全类型最终矩阵运行时准入在 T24 激活，非 validator 返工）；毒帧路径首达（apply 失败→隔离 doc+停写+WAL 截断至 appliedSeq+close 4411——spec §4.3）
- [ ] 用例：并发双连接帧串行准入；SS2 大帧预算拒（**8MiB=HTTP seed 端点+受控 recovery import——鉴权/ETag/因果**）；帧字节 copy（lib0 subarray 越界读反例）→Commit。

### Task 10: G2 门——applied 前缀+批量 PG+水位三元
**Files:** collab-persistence.service.ts（worker 批提交改造）
- [ ] 先红（G2 故障矩阵——真 PG）：①同帧重复送达零重复业务效果零重复 walSeq②PG 提交失败 WAL 保留且 pgSeq 不越失败帧③fsync 前后 kill -9 符合 ACK 等级④PG 提交成功但内存水位未更即崩→重启零重复⑤snapshot 已发布 WAL 未清时重启正确⑥WAL 达清理条件重启不误删⑦**合法帧 apply 失败（毒帧）→WAL 截断至 appliedSeq+4411+从 pgSeq 重放——不跳帧续提交**⑧**无 PG 行 walSeq>appliedSeq**
- [ ] **applied-driven 批量 PG**：批只从 applied 队列取（连续前缀，上界=appliedSeq）单事务多行 append（复用 512 条/8MiB+1MiB 分片；行=firstWalSeq/lastWalSeq/frameCount/updateHash）→confirm spool→pgSeq/walSeq 水位推进；崩溃恢复=从 pgSeq 重放 WAL（不依赖进程内状态）
- [ ] **G2 go/no-go 判定**（不过=不进 P2）→Commit。

### Task 11: 快照发布+compact+WAL 清理
**Files:** canvas-doc-update.repository.ts（compact 重写）；COLLAB_ROLE worker 调度
- [ ] 先红：两 compact 并发 PK 冲突折正常 miss=红；kill 在指针发布后/purge 前不续跑=红
- [ ] **快照只从 PG 前缀生成且只到 pgSeq**（重放在 worker 进程——行锁+generation/pgSeq CAS 授权，**不拿租约**）；**跨表不变量 Snapshot.stateSeq≤pgSeq 由发布事务内行锁+条件更新验证（非 CHECK——偏离 26 v5.2）；compact 失败保留原可用快照与 WAL，不提前清理**；指针短事务+**purgeBelowSeq 同事务持久**+提交后 worker 分批删+启动续跑；保留策略（当前代 2 份+旧代最终 1 份）；snapshot 独立观测 gauge
- [ ] 交错（装载×compact×append）绿→Commit。

### Task 12: vacuum=generation++/新 docName（换代通道）
**Files:** canvas-doc-update.repository.ts:194-224（vacuumReplace）；collab-shrink.service.ts:292-347；collab-doc-registry.service.ts:628-698（rebuildVacuumDoc+preVacuumSv 播种）；registry 4410 载荷
- [ ] 先红：①vacuum 后 generation/docName/缓存键**不变**（v1.3 同 name 语义反例——现设计=必须变）=红②**部分陈旧客户端复活路径**（S2 spike 语料：全 clock<pre 客户端 SS2 旧 structs apply 到新 doc）在换代语义下=auth 直接拒（不装载/不 SS1/不上行）=红前置
- [ ] vacuumReplace：重放重建 fresh doc（新 clientID 重写）→**generation++→新 docName(#g)**→替换快照+水位重置预演；4410 `doc-vacuuming` 载荷 {generation, discardLocalCache:true}；离线 dirty 客户端=旧 #g auth generation mismatch→DraftEnvelope 导出→清缓存→新 name 重连导入（**导入前新 Schema/权限/图结构校验**）；**vacuumEpoch 仅遥测计数列**；**preVacuumSv 缓存播种与门退役**（registry:400,:687-696 删——偏离 27）；`schemaVersion⇒generation` 启动断言（违反拒启）
- [ ] vacuum 前后 generation/docName/缓存键变化断言+换代预演+S2 语料全绿→Commit。

### Task 13: G6a 门——单实例故障恢复（doc 平面）
**Files:** registry 恢复路径；collab-spool/persistence；观测接线
- [ ] **G6a 故障演练（doc 平面——Feed 不在本门）**：kill -9 每阶段（spool/apply/批提交/快照/毒帧）/坏 WAL 段/PG 不可用/磁盘满/重启——恢复顺序=WAL→PG 前缀校验→重建 appliedSeq→开放写；无法证明一致=fail-closed 拒服务；ETag 不超前 pgSeq 断言
- [ ] S4 决策落地验证（WAL 拓扑多项目下恢复正确+恢复扫描完整有效前缀）；8MiB HTTP seed 端点恢复路径用例
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
**Files:** TextInputNode/PromptInput/**ImageExtConfigPanel+PromptEditor**/TextNodeFullscreen/TextNodeToolbar；apps/web package.json（y-prosemirror exact pin 按 S3）
- [ ] 先红：现 getHTML 整串写 data.content=红；两客户端格式化合并后树合法性=红
- [ ] content=嵌套 XmlFragment（容器规则=T15）；**PromptInput 三域（image/video/imageExtGen）=XmlFragment**+mention(/,@)+image PM 节点（PromptValue{text,html,referencedImageIds} 三出口）；单 editor 实例（全屏/工具栏复用）；plugin 首次事务前注册；getHTML 只读导出；**不挂 yUndoPlugin**（单 manager——T18）；ySyncPlugin origin 按 S3（≠LocalUser 则 addTrackedOrigin）
- [ ] **G3 用例**：双端并发格式化/mention 插入/图片引用/粘贴/删除节点 fragment 随子树/undo 重建恢复→**G3 go/no-go 判定**（不过=调容器或绑定，禁 JSON 垫片）→Commit。

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

### Task 19: 读者改道（只改读者——写者保留）
**Files:** web 全读者（census③）+api video-work-clone:33+registry rebuild:635；snapshot-filter
- [ ] 先红：改道后任一读者 broken=红（census 门——含服务端；**写者不删——data.fileId/result/status 写者与 execAligned fallback 保留至 T22/T32**，D9 顺序）
- [ ] 全读者投影合成改道 DocCodec read model；公开快照 toPublicReadModel sanitize+缓存键 (pid,g,snapshotRev)+**ETag=read model 新鲜度=pgSeq**；position Y.Map 逐键并发断言；**exec 根 doc 侧读者本卡起零新增**（census⑤ 门）
- [ ] G28 继承（broken reader 零——web+server）绿→Commit。

### Task 20: P2 出口
- [ ] G3 证据汇编+verify 全绿→**用户确认点③**→Commit。

## P3：业务（T21-T28；G4/G5 工程门）

### Task 21: G4 门——迁移二+ExecutionRequest 全计划+docSeq=pgSeq+save barrier
**Files:** 迁移二（ExecutionRequest 全字段/RuntimeEvent per-project feedSeq/NodeExecution/ExecutionOutbox/MaterializeRun/RefundObligation/NodeLifecycle(lifecycleSeq)/DeliveryFence——字段=T5 冻结 exact DDL）；execution.controller/service；collab-server.factory.ts（onStateless 接线）；web save barrier 客户端
- [ ] 先红：①受理后改 prompt/拓扑/model/上游/节点删除→执行仍用冻结计划（重放用例）=红②paramsHash 重放一致=红③并发两请求互串=红④前缀校验失败落半行=红⑤**同 requestId 断线重试创建第二次执行**（幂等受理反例）=红
- [ ] **ExecutionRequest 全计划**（spec §6.1：scopeNodeIds/plan Json 每节点 type/model/resolution/style/pricingRuleId/creditCost/paramsHash/teamId/kind/pricing/requestId@unique/state）；NodeExecution=当前行 PK(projectId,nodeId)+**generation 列+更新守卫（generation 匹配且 execSeq 单调）**+projected 元组；RuntimeEvent 表（T5 DDL——per-project feedSeq）；客户端：save barrier（**factory onStateless 接线——现状未接**；onStateless {nonce,...}→**处理器首语句同步捕获 pgSeq**→flush applied→PG→回执 {nonce,committedSeq=pgSeq}）→execute 带 docSeq（**请求不携带提示词参数**）；服务端：**受理读=PG 一致前缀**（gate→flush applied→PG→读 live doc，或 snapshot+updates at pgSeq 重建）→**promptText 等冻结字段从恢复的 doc 内容冻结**→等 `pgSeq>=docSeq`（上限+明确超时）→受理事务冻结全字段（256KB+PII）；**幂等受理：同 requestId 重试返回原请求（PG 已提交但客户端未收到响应的断线重试不创建第二次执行）**；GenerationIntent=claim 创建关联 requestId；paramsHash/pricing 只读 request 不重算；worker 零 doc 读
- [ ] **G4 go/no-go 判定**→Commit。

### Task 22: G5 门——同切片切交付+RuntimeEvent Feed 全量+doc.exec 停写停读
**Files:** collab-document.service.ts:248-264（deliverArtifact 改 PG 写——**不变量⑦首达**）；runtime-feed.service.ts 全量（RuntimeEvent 写入+游标）；web runtime store 接线+execStatusView 数据源切换；尺寸模式接线
- [ ] 先红：①serving 期服务端写 doc（deliverArtifact 现状）=红（不变量测试）②feed 漏推后状态错乱（断线语料）=红③**T22 切换后旧 UI 读 stale doc.exec**（同切片纪律——客户端 Runtime Store 与服务端停写同卡）=红前置
- [ ] **同切片（D9）**：deliverArtifact 改 PG 写+RuntimeEvent 事件写入+客户端 exec/media 全量切 Runtime Store+**doc.exec 停写停读**（本卡即切读者——不留 T32 窗口）；**feedSeq 分配纪律（D5 v5.2）**：同一项目的 RuntimeEvent 写入事务先取该项目行锁/advisory lock（S5 定形态——与 canvas_doc_update_seq 先例同构），锁内分配下一 feedSeq 并同事务提交（**分配序=提交序——事务 A 取号未提交/B 先提交，游标不漏 A**）；**尺寸模式**：服务端计算→PG 记录→feed 下发→客户端用户域 origin+白名单写 doc（valueSource=server-feed/authority=display-cache）；**Feed 全量（G5=G6b）**：首连 RR 快照+{snapshot,cursor}→feedSeq 续传+stateless 通知+**心跳 15-30s latestFeedSeq（仅心跳也能追平）**+缺口对账+旧 generation 隔离+docSeq 应用规则（>已同步 pgSeq 则 buffer/节点已删忽略）+UI unknown 不显示 idle；**事件与业务事务原子提交**（执行状态变更与 RuntimeEvent 同一 PG 事务）；**ExecutionOutbox=工作队列维持（不作 feed 日志）**
- [ ] **G5 用例（六语料+交错）**：断线/漏通知（仅心跳追平）/重复/乱序/旧代/游标失效全量快照+**feedSeq 提交顺序交错**+feed 不因 outbox claim/delete 出洞→**G5 go/no-go 判定**→Commit。

### Task 23: worker fencing+交付幂等+退款义务+资源回收（迁移三）+text 链外呼锚
**Files:** 迁移三（StorageReservation 状态机列+ObjectManifest claimOwner/claimUntil/GC claim）；materialize-job；team-credit；safe-remote-fetch；**api-caller.service.ts（text 链）**
- [ ] 先红：旧 run 迟到退款误命中（时序交错）=红；lease 过期在飞 reservation 被释放（oversale）=红；GC 交错误删=红；**text 链 rearm 重试无屏障重复外呼**（callTextGen 现零键零锚——api-caller:533-535/:553/:365 `kind!=='text'` 才铸键）=红
- [ ] materializeRunId/expectedExecSeq fencing（B12/B17 继承）；交付状态机（受控任务→受限 key→校验→fencing 事务终局→outbox→清理——spec §6.3）；RefundObligation（**unique(intentRowId,execSeq)+reversesId 幂等**）；StorageReservation 终态释放+upperBoundBytes 必填（无值 fail-closed）；ObjectManifest **delete-claim（claimOwner/claimUntil）**+有界 orphan；**text 生成链补外呼锚**（write-ahead providerRequestId 键复用 submit-poll 链模式；若 text 供应商无任务查询能力则登记外部 at-least-once+资金 execSeq CAS 兜底——**其余链三层防护维持不重建**〔write-ahead providerRequestId+providerTaskId 先落库+query-first resume——spec §1.7 实证〕；数据库 fencing 无法撤销已发生的外部调用，外部幂等键是唯一屏障）
- [ ] 全组绿→Commit。

### Task 24: 收缩 FrameGate+Hocuspocus apply 真相化+最终矩阵激活
**Files:** collab-frame-gate（T9 基础上扩语义面）；@hocuspocus/server（**S1 决策落地：升级或 patch-package**）；collab-server.factory.ts 挂载
- [ ] 先红：①写 exec 根/未知类型/未知键/值类型错/容器替换/raw update 替换 live 现放行=红②apply 抛错后假 ACK（esm:277-281 现状）=红
- [ ] **apply errorHandler（D3）**：SyncStep2/Update 两处传 errorHandler（apply 成功才 ACK）——S1 双版本结论落地（升级或 patch 固定版+上游差分回归）；post-check=encodeStateVector decode per-client clock 上界（**不用 doc.store**）；毒帧→隔离+4411+WAL 截断至 appliedSeq；DENY 面（**P2 最终矩阵运行时激活**——T3/T15/T16 冻结形状+exec 根+预算+**候选文档验证完整面：对照活动 doc 现状的增量语义验证——引用闭包/媒体引用存在性/边引用存在性/业务权限语义授权**）；NORMALIZE 面（悬挂边/父链环/跨组/重复边——读侧屏蔽+graph_anomaly_total）；**clientID 绑定四元 (projectId,generation,userId,clientId)**：同用户重连放行/一连接多 clientID 放行/异活跃用户拒/碰撞=可重试 close（clientID=CRDT 结构标识非身份凭证——身份始终由已验证会话提供）
- [ ] fuzzer（T5 语料+bit-flip）+B5 继承（不假 ACK/receipt 不一致隔离重载）绿→Commit。

### Task 25: 拒帧恢复+4411+4410 三分+恢复模式
**Files:** shared collab-close-code.ts；web rejected-recovery.ts；runtime 恢复路径
- [ ] 先红：被拒后重复 apply 服务器态「修复」=红（CRDT 单调性反例）；g_client>g_server 静默 purge（现状导出→reload 缺接受路径）=红
- [ ] 4411 注册链+resolveCloseAction 档；REJECTED/DIVERGED 状态机（DraftEnvelope+merge policy+同代 fresh doc+TypedDraft+多标签 BroadcastChannel）；4410 三分（generation-stale 全会话重建/**doc-vacuuming=换代通道+dirty draft 导出**〔T12 链〕/**server-restored 只读 recovery+草稿导出+管理员裁定接受**）
- [ ] B6/B7 继承组绿→Commit。

### Task 26: 生命周期义务观察器
**Files:** collab-lifecycle-observer.service.ts（新）；NodeLifecycle/DeliveryFence（迁移二已建）
- [ ] 先红：删除节点后取消义务无持久提交点（删 A/并发 finalize 两序反例）=红
- [ ] **genesis 行 seed（T7/T21 建）**；只读观察已受理帧事务→**per-walSeq 义务 buffer 与对应帧前缀 PG 批事务同事务落库**（帧↔义务原子；**义务可从帧前缀确定性重建——崩溃后重放前缀恢复，不依赖进程内状态**）；反向索引（edgesByNode/mediaRefsByNode 装载建+增量维护——incident O(1)）；lifecycleSeq 数值序+当前行 partial unique；用例：delete 已删 no-op 不二次退款/undo 重建=新 lifecycleSeq/delete+restore 同帧两行/两项目同 nodeId 不互串
- [ ] B11/B12 继承组绿→Commit。

### Task 27: 维护窗口+世代切换（执行门）
**Files:** collab-maintenance.service.ts（新）+REST gateway（admin guard+幂等键）+scripts/collab-rebuild-gen.mjs；MaintenanceOperation 消费
- [ ] 先红：QUIESCING 后 drain flush 被拒=红；CLI 无租约直写=红；**维护失败超时自动恢复写入**（应保持只读——人工/显式裁定恢复）=红
- [ ] freeze（gate 停收标志）→drain（全部已受理帧至 PG——单串行口无需 epoch）→unload→export（DocCodec canonical）→fresh doc→**generation++**→snapshot0→**水位重置（walSeq/pgSeq/snapshotRev/purgeBelowSeq）+WAL 段 namespace 切代+旧段 quarantine**；stage=MaintenanceStage enum 单源（MaintenanceOperation——CanvasDoc 只存 maintenanceId）；**每阶段可重入可恢复的状态转移（重启从 PG 记录的阶段继续——不据本地临时文件猜测；破坏性步骤定义前置/后置条件）**；空画布保头升代；归档=一份 PG dump 回滚；**世代切换首次真跑=执行门——单独请用户确认**
- [ ] 每 stage kill -9 演练+G9 继承组绿→Commit。

### Task 28: P3 出口
- [ ] G4/G5 证据汇编+增量投影（YEvent path[0] observeDeep——单节点 patch 断言）+verify 全绿→**用户确认点④**→Commit。

## P4：交付（T29-T34；T29=实体化生产前置批独立于本批交付线）

### Task 29: 生产前置批 charter（独立批实体化——owner/date 待定，**非占位**）
- [ ] charter 落 runbook+**发布自动化挂载**：PITR RPO≤5min/RTO≤30min+MinIO 版本化 RPO≤15min+季度 restore drill+每小时 replay canary（snapshot+updates 重放 fresh doc semanticEqual/SV 对比，不一致告警并冻结 compact）+HA 决策+SLO+`doc_append_gap_total` 告警——**任一未过不得开放生产流量（前置条件纳入发布自动化 gate-decision，非仅 runbook 登记）**（本批发布说明=单机/dev-test/beta 诚实登记；Spooled≠已保存）。

### Task 30: reset-collab 工具+部署顺序
**Files:** scripts/reset-collab.mjs（新）；deploy.sh+gate-decision.mjs；collab-ops-runbook.md
- [ ] 先红：deploy 在旧消费者在线时 reset=红（顺序断言）；gate 判据缺 inflight/stranded 阻断=红
- [ ] reset 可重复执行（drop/recreate/清 spool/清本地缓存键/清公开快照缓存）+种子；**阶段状态持久化（各阶段完成态落盘——中途失败重跑感知已完成阶段，不依赖人工判断）**；破坏性发布流程（维护关写→drain→停全部旧 DB 消费者→reset/schema deploy→部署→就绪检查→开放写）；迁移串行校验（禁并行同 schema 状态）
- [ ] 空库 reset→migrate→seed→双端协作全绿→Commit。

### Task 31: 故障演练矩阵
- [ ] kill -9 每阶段（spool/apply/批提交/快照/维护/毒帧）；PG failover；网络分区；磁盘满；OOM；时钟偏移；双浏览器/多标签/IDB blocked/断网重连/拒帧恢复/reset 后重连（B3 形态：内容根恢复+exec 从 PG 派生断言）+**vacuum 换代离线重连**（S2 语料实弹）+**feedSeq 提交顺序交错**（T22 用例实弹）+**世代切换时旧连接仍在发送**（旧世代不写入新文档/不影响新水位）+**外部生成成功后 worker 崩溃重试零重复副作用**（text 链锚验收）
- [ ] 全部符合耐久契约（fail-closed/隔离恢复/零静默丢弃/水位不越）→Commit。

### Task 32: 删除清单执行（spec §6.7——D9 终点，删码与新路径同可编译切片）
- [ ] 删：doc.exec 读写链+writeExecStatus+applyWriteExecStatusToDoc+deleteExecOrphans+projectExecToStore doc 源+deliverArtifact doc 写面+**data.fileId/result/status 写者与 fallback**+execAligned 旧链+rebuildVacuumDoc exec 搬运+guardSyncFrame 旧面+**preVacuumSv 门与播种（T12 已停用——本卡删码）**+**appendSeq 列残留**+**zero-yjs DocLike 死引用**+transform/归档残留（若有）+provider recovery 旧档+**addToScope 死调用与 shift 字节回落旧测**
- [ ] grep 零锚点断言进 verify（T0 census⑤/⑥ 清单逐项）；`doc.getMap('exec')` 写零；服务端 serving 期零业务 doc 写不变量测试常驻 CI
- [ ] 三面 tsc+全测试绿→Commit。

### Task 33: 负载基准（多项目分轴）
- [ ] 10k 节点冷加载（服务端解码/装载/read model/首屏分轴）+8MiB 混合（传输/解码/fsync/apply/PG 批/投影分轴）+**10 项目×10 连接真实并发分轴（WAL fsync 放大/批延迟/feed 负载/可见节点 culling——S4 决策验证）**；P50/P95/P99+CPU/RSS/IO/PG 锁等待；**`walSeq-pgSeq` 积压规模与持续时间（时段分布非仅瞬时值）+慢项目对其他项目的隔离影响（背压验证——偏离 36）**；长时间持续写入+磁盘接近上限场景
- [ ] **实测转 CI 性能门禁**（不预声称指标——先基准后门禁）→Commit。

### Task 34: 发布门
- [ ] 发布门全绿（verify full+故障演练+负载基准+删除清单+reset 实弹）→**用户确认点⑤=全批终出口**（证据汇编：单机/dev-test/beta 限制+机损 RPO=PG 批延迟诚实登记+T29 前置条件）→Commit。

---

## 执行顺序与关键路径

- **P0（立即）**：T0（5 spike：S1 Hocuspocus 双版本/S2 vacuum 离线/S3 undo origin·scope/S4 WAL 多项目+恢复扫描/**S5 feedSeq 提交顺序**+八 census）→T1/T2（两 bug 先红后绿——T2=删 :157+改 :512 读点）→T3/T4（矩阵+codec）→T5（协议冻结）→**确认点①**。
- **P1**：T7（G1）→T8→T9→T10（G2）→T11→T12（vacuum 换代）→T13（G6a）→**确认点②**。
- **P2**：T15（容器+Y.Text 先行）→T16（G3）→T17→T18→T19（只改读者）→**确认点③**。
- **P3**：T21（G4）→T22（G5=同切片切交付+Feed per-project feedSeq）→T23→T24→T25→T26→T27（执行门）→T28（含增量投影）→**确认点④**。
- **P4**：T29（charter）→T30→T31→T32→T33→T34（**确认点⑤**）。
- 关键路径：T3/T4/T5→T7/T9/T10→T12/T13→T15/T16→T21/T22→T24/T26→T30/T32/T34。迁移×3 串行（T7→T21→T23）。

## §0 执行期偏离登记（滚动）

| # | 偏离 | 卡 | 依据 |
|---|---|---|---|
| （执行期填写） | | | |

**旧任务处置映射**（v1.3→v1.4：见 v1.4 存档；v1.4→v1.5 定点修订 12 卡）：T0=+S5 feedSeq 提交顺序实验+S1 双版本+S4 恢复扫描+census 补 ：512 现状；T2=删 :157+**改 execution.service:512 读点（string 直读腿）**+无 promptText 请求参数+上游注入正文语义锚；T5=walSeq 命名+per-project feedSeq 行锁+ACK 四态 UI+候选验证契约+feedSeq 交错 fixture；T7=spoolSeq→walSeq+CHECK 勘误（跨表走 T11 发布事务）；T8=帧内一律带 generation+恢复扫描完整有效前缀；T9=每帧世代验证+候选验证+per-project 背压；T10/T11/T27=spoolSeq 字样改 walSeq+跨表一致性+compact 失败保留；T15=execution.service:512 读点同卡再改；T18=savedSeq 只由持久化回执推进+换代前先存脏草稿；T21=promptText 服务端冻结（无请求参数）+同 requestId 幂等受理；T22=feedSeq 行锁分配纪律+事件业务同事务；T23=+text 链外呼锚（其余链三层防护维持）；T24=候选验证完整面；T30=阶段状态持久化；T31=+feedSeq 交错/世代切换旧连接/worker 崩溃三实弹；T33=积压时序+慢项目隔离+长时写入。其余任务卡维持 v1.4。

**门禁总览**：工程门 G1=T7｜G2=T10｜**G6a=T13（doc 平面）**｜G3=T16-T20｜G4=T21｜**G5=T22（=Feed/G6b，含 feedSeq 交错）**——按证据自判，不过=先改再写码。**用户确认点①=T5｜②=T14｜③=T20｜④=T28｜⑤=T34；执行门=T27 世代切换首跑（第八轮外审建议取消确认点——用户 2026-10-24 驳回，维持）**。继承验收锚（v4 语义存续）：genesis 双路=T7｜前缀/装载守卫=T10/T11｜富文本并发=T16｜undo 栈上限=T18｜broken reader 零=T19｜受理冻结/前缀一致/幂等受理=T21｜feed 可靠+提交顺序=T22｜退款/交付 fencing/text 链锚=T23｜准入 DENY/NORMALIZE/候选验证=T24｜拒帧恢复=T25｜生命周期义务=T26｜维护演练=T27｜发布门=T34。
