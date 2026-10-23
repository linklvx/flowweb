# Y1c：doc 模型 v3·载体与契约 Implementation Plan（Phase 0 / 0.5 / -1a / -2a / -1b / -2b / -3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

<!-- plan v1.2（2026-10-24）：依据 spec v4（99ff0dbc）+第四轮终裁全采（v1.1）+第五轮「plan v1.1 复审终裁」全采（9 P0+P1×15+Phase 0.5 升级 go/no-go 八项；T0-T28 骨架/七确认点/T10 执行门/四项 plan 期定案不变）。**v1.2 承重定案变更**（详§0 偏离登记 26-35，实证锚点在登记内）：candidate=full clone/持久 shadow（shard 禁作 apply 目标——pendingStructs 实测；clone 无法复用 live clientID——yjs「Changed the client-id」重写实测）；provenance 授权边界=struct 区间成员资格（updateHash 仅 exact-replay fast path——整帧 hash 会 DENY 破坏性 reset 恢复帧，实测）；NodeExecution=当前行 PK(projectId,nodeId)+projected 元组（执行历史留 GenerationIntent）；保存屏障=beforeHandleMessage+Stateless（y-protocols 帧无元数据槽——no-op 帧方案废弃；零 patch）；admissionEpoch=懒 per-project 块 ≥1e6+80% 预留先于越界+PG 不可用 fail-closed（全局租约行上 +10000 不可执行）；T6 表形三修（空 model/单侧 relation/缺 opposite——validate 三红实测；MaintenanceOperation 补建）；outbox 唯一键+generation+businessKey；T17 B5=方案 A 文案+FrameApplyReceipt（struct 数+DS 区间+clock max）；LifecycleIndex（edgesByNode/mediaRefsByNode）；帧字节精确 copy（lib0 subarray 越界读实测）；G17a 真调用面=fillDoc live 误用守卫；T2 连带 TextNodeData.prompt 类型+:31 读点；T9 compact 移 COLLAB_ROLE worker 进程+purgeBelowSeq 持久水位；transformV3ToV4Draft 前移 T4；4411 进 shared 注册链。**执行门**：世代切换首次执行（T10 维护演练首次真跑）前单独请用户确认；每阶段出口=用户确认点①-⑦。**纪律**：每卡先红（真实变红+真 PG 并发用例）→绿→commit；写码前 grep 实证（行号=12fa3e8e 快照）；三面 tsc；偏离滚动登记本文件 §0；门禁映射 requires 规则——任何 gate 依赖后序任务=评审红；**Phase 0.5=go/no-go 硬门（②③④⑥任一失败→对应任务先改再写码，禁「按默认写红了再改」）**。 -->

**Goal:** 落地 doc 模型 v4——Phase 0 契约冻结（树形 per-node-type schema+DocCodec 双出口+两现行 bug 首修）→Phase 0.5 承重契约八项 go/no-go（零生产代码）→-1a 载体（appendSeq 行锁+{owner,epoch,g} 围栏+genesis 双路+维护状态机 admissionEpoch 懒块分配+世代 DocKey 化）→-2a 内容（Y.Text 分型+嵌套 XmlFragment+y-prosemirror+inputSnapshot 受理冻结+RetentionCoordinator+incarnation）→-1b 准入（三档 FrameGate+decode/父链/provenance 区间授权+拒帧恢复+LifecycleIndex 候选态+clone/shadow candidate-first+beforeHandleMessage 保存屏障）→-2b exec（扁平组件键+NodeExecution 当前行/ExecutionOutbox 单表+物化 run fence）→-3 门禁（读者改道同单元+reservation 状态机+GC delete-claim+客户端增量投影）；批末 v4 单发布（dev/test 诚实登记；生产耐久性=T29 独立前置批）。

**Architecture:** 载体=CanvasDoc 头+maintenance 族（advisory shared 锁〔hashtextextended 键单源〕+appendSeq 行内取号+owner/epoch 自 CollabLease 显式传入+提交前缀构造保证）+CanvasDocSnapshot(g,rev) 追加+CanvasDocUpdate(g,seq)+CanvasDocProvenance（服务器写区间——validator 按 struct 区间授权+每代内存缓存全 clientID，updateHash 仅 fast path）；准入=FrameGate 串行窗（beforeSync 令牌跨到 apply+三档 DENY/NORMALIZE/ACCEPT+decode 父链判定，无全量索引，有界队列背压，帧字节精确 copy）；server 写=shadow doc（稳定 clientID，高频 exec 投影）/full clone（低频 lifecycle）candidate-first（PG 事务→live apply→广播）；exec=doc 扁平组件键（execution:<nodeId>/artifact:<nodeId>:<slot> 服务器专写）+PG NodeExecution 当前行（projectedExecSeq/projectedEventVersion per-node 元组）/ExecutionOutbox 单表（generation+businessKey 唯一+generation CAS）；内容=嵌套 Y.XmlFragment（y-prosemirror 直绑）+Y.Text+DocCodec 双出口（canonical+read model，zero-yjs DocLike 注入）；恢复=REJECTED/DIVERGED（4411）+同代 fresh doc+DraftEnvelope（类型 T5 冻结）；资源=reservation 终态释放+GC delete-claim。

**Tech Stack:** TypeScript strict / Yjs exact 13.6.32 / Hocuspocus 4.6.0（含 y-protocols patch fork——server+web 双侧回归）/ y-prosemirror（T0 pin——与 @tiptap/react 2.10.0 ProseMirror 矩阵匹配 exact 版）/ @tiptap/react 2.10.0 / NestJS / Prisma / vitest+node:test / CI postgres。

**执行纪律：** 每卡先红（含真 PG 并发/交错用例——mock 测不出代际/锁序）→绿→commit；写码前 grep 实证；行号=12fa3e8e；三面 tsc；文档 diff 随卡；每阶段出口用户确认；迁移×4 顺序执行不并行（T6→T20→T23→T26）。

## 文件结构（触碰面全景）

| 文件 | 动作 | 责任 | 阶段 |
|---|---|---|---|
| packages/shared/src/canvas/doc-schema-v4.ts | **建** | 树形 per-node-type 表+EXEC_SCHEMA 独立+array 语义（T3） | P0 |
| packages/shared/src/canvas/doc-codec.ts | **建** | encode/decode+serializeCanvas(canonical)+toReadModel 双出口+transformV3ToV4Draft——zero-yjs（DocLike 注入）（T4） | P0 |
| packages/shared/src/canvas/docShape.ts+canvas-doc-manifest.ts | 改 | 键分类二分/运行时准入面共用（T3/T25）——re-export 删除（T4） | P0/-3 |
| packages/shared/src/collab/draft-envelope.ts | **建** | DraftEnvelope/CanvasReadModel 纯类型（T5 冻结——T15 消费/T18 实现协议） | P0 |
| apps/web/src/stores/nodeStore.ts:20,:107-110,:225,:719,:725+AddNodeMenu.tsx:92+canvasStore.ts:159-166 | 改 | bug① textInput 统一单源+nodeTypeMap 翻译链收口（T1） | P0 |
| apps/web/src/pages/canvas/components/nodes/TextConfigPanel.tsx:31,:157 | 改 | bug② prompt 统一 {text}（写点+类型+读点）（T2） | P0 |
| apps/api/prisma/schema.prisma+迁移×4 | 改 | T6 载体全族（含 DocWriteAudit/ObjectManifest/MaintenanceOperation/purgeBelowSeq/inputSnapshot 扩列）/T20 exec 单表+ArtifactProjection 退役/T23 退款物化/T26 reservation·GC 扩 | -1a/-2b/-3 |
| apps/api/src/modules/collab/canvas-doc-update.repository.ts | **重写** | appendSeq 行锁+advisory 键单源+装载 RR+compact 分批（T7-T9） | -1a |
| collab-lease.service.ts / collab-persistence.service.ts / collab-doc-registry.service.ts | 改 | advisory 键单源/错误模型/DocKey 升维/装载三态（T7/T8/T11） | -1a |
| collab-maintenance.service.ts+collab-maintenance.gateway（REST——admin guard+幂等键）+scripts/collab-rebuild-gen.mjs | **建** | 维护状态机+admissionEpoch 懒块分配+DRAINED 可查询（T10） | -1a |
| packages/shared/src/collab/doc-name.ts+scripts/check-collab-census.mjs | **建/改** | buildDocName 唯一构造器+裸构造静态门（T11） | -1a |
| apps/api/src/modules/canvas/canvas.service.ts:37-47+project/project.service.ts:100-107 | 改 | genesis 双路+缺头三态（T6） | -1a |
| execution.service.ts:512+topology.service.ts:83 | 改 | read model 改道+inputSnapshot 受理冻结（T12/T13） | -2a |
| apps/web/src/stores/canvasCollabRuntime.ts | 改 | 增量投影/4411 全会话/拒帧恢复（T18/T27） | -1b/-3 |
| apps/web/src/stores/canvasUndo.ts+retention-coordinator.ts | 改/**建** | RetentionCoordinator 条件触发+shift 修复（T15） | -2a |
| TextInputNode.tsx+TextNodeFullscreen/TextNodeToolbar/prompt-input/PromptInput | 改 | 嵌套 XmlFragment+y-prosemirror 四面（T13） | -2a |
| packages/shared/src/constants/collab-close-code.ts | 改 | 4411 注册链+resolveCloseAction 档（T18） | -1b |
| collab-frame-gate.service.ts+collab-admission/（decoder/parent-chain/provenance/policy） | **建** | 串行窗+三档判定器+provenance 区间授权缓存（T16） | -1b |
| patches/y-protocols+pnpm patch | **建** | 重抛+ACK 后置 fork+FrameApplyReceipt（T17） | -1b |
| collab-lifecycle-admission.service.ts（LifecycleIndex）+collab-doc-writer.service.ts（ServerDocWrite+shadow doc） | **建** | 候选态+candidate-first+beforeHandleMessage 保存屏障（T19） | -1b |
| collab-document.service.ts+media-delivery/projection-outbox.poller.ts | 改 | 扁平组件键/ArtifactProjection 退役单表 claim/per-node 元组 watermark（T20-T22） | -2b |
| materialize-job.service.ts+team-credit.service.ts | 改 | materializeRunId 裁定+expectedExecSeq（T23） | -2b |
| media/safe-remote-fetch.service.ts+media-gc.service.ts+storage-* | 改 | cap 必填/delete-claim/reservation 状态机（T26） | -3 |
| apps/web 全读者 ~27 处/14 文件+apps/api video-work-clone.service.ts:33 | 改 | 改道+fallback 删除（T24） | -3 |
| deploy.sh:134-159+scripts/lib/gate-decision.mjs | 改 | 破坏性发布流程+inflight 判据（T28） | 批末 |

**不动红线**：NODE_ENVELOPE_KEYS；ecosystem 双进程（compact 执行体移 COLLAB_ROLE=worker 进程——真进程隔离）；锁序契约 §2.10（T19/T23 全按此核对——生命周期帧先按稳定主键预取 NodeLifecycle/DeliveryFence/GenerationIntent 再锁 CanvasDoc）；四根 doc 顶层集合（meta/nodes/edges/exec）；**yjs 私有 API 禁令**（nodes._map 等——T14 incarnation 用解码 struct adapter）。

---

## Phase 0：契约冻结（T0-T5——除两 bug 外零生产代码变更）

### Task 0: 依赖 pin 调研+四 spike+census 基线
**Files:** 调研/spike 产出记入本卡（零生产代码）；census 清单固化为后续卡输入
- [ ] y-prosemirror exact 版本调研（与 @tiptap/react 2.10.0 依赖的 prosemirror-* 版本矩阵匹配——`pnpm why prosemirror-model` 实证；锁定 exact 写入 apps/web/package.json 于 T13 落地）
- [ ] **四个功能 spike**（产出=结论文档+定案写入对应卡/Phase 0.5）：①嵌套 XmlFragment+y-prosemirror+Tiptap 双端绑定可行性（root fragment 删除/undo/rebuild 三坏反例复核——T13/Phase 0.5⑦ 输入）②decode/父链/provenance 伪造探针（自造 server clientID+区间内 clock+异内容的实际拦截面——Yjs 重复 ID 丢弃语义验证+跨代/压缩后 clientID 复用窗口——T16/Phase 0.5③ 输入）③保存屏障探针（beforeHandleMessage 拦截 Stateless+sendStateless 回执路径验证——T19/Phase 0.5④ 输入）④8MiB SS2 传输预测量（crossws/ws permessage-deflate vs HTTP seed 鉴权/缓存/竞态——T27 选型输入）
- [ ] census 固化：①裸 `project:${pid}` 39 处清单（grep 产出入 T11）②创建路径全集（POST /canvases+POST /api/projects+seed 脚本+测试装置）③data.fileId/status 读者 27 处/14 文件复核 ④Tiptap 四面清单复核（TextInputNode/PromptInput/TextNodeFullscreen/TextNodeToolbar）⑤readRecordsFromMaps 全调用点（T4 改道清单——**含服务端**：video-work-clone:33/registry rebuild:635）⑥textInput prompt 全消费面（nodeStore 类型/TextConfigPanel:31/execution:512/topology/snapshot-filter）
- [ ] Commit（census+spike 结论文档）。

### Task 1: bug① isTextNode 统一+创建链单源（PC2 前半）
**Files:** apps/web/src/stores/nodeStore.ts:20,:225,:719,:725；AddNodeMenu.tsx:92；canvasStore.ts:159-166（nodeTypeMap）；TextInputNode.test.tsx:84,:91；nodeStore.test.ts:543
- [ ] 先红：TextInputNode.test 夹具 type 改生产名 `'textInput'`+删 isTextNode mock（用真守卫）→重挂载用例断言正文保留→**红**（真守卫判 'text' 恒 false）
- [ ] 绿：isTextNode 判 `node.type === NODE_TYPES.TEXT`（单源引用）；删 :613-621 `type:'text'` 幽灵兜底分支（缺节点 else 改显式拒绝/忽略）；**:719（`!== 'text'`）与 :725（`=== 'text'`）两处裸字面量全改 NODE_TYPES.TEXT**；AddNodeMenu:92 改 NODE_TYPES.TEXT+nodeTypeMap 翻译链收口（T0 census 定位全部 `type:'text'` 入口）；nodeStore.test 手写 'text' 夹具全改 NODE_TYPES.TEXT；**创建类型断言**（addNode 出口断言 resolvedType ∈ NODE_TYPES 值集——防再引入幽灵类型名）
- [ ] 全仓 grep `'text'`（节点 type 判定/创建处）清零；web tsc+相关测试绿→Commit（fixbug 前置——注明 PC2）。

### Task 2: bug② TextConfigPanel 覆盖写修复+prompt 形统一（写点+类型+读点）（PC2 后半）
**Files:** apps/web/src/pages/canvas/components/nodes/TextConfigPanel.tsx:31,:157（实际路径=nodes/ 目录）；nodeStore.ts:107-110（TextNodeData）；apps/web 回归测试+API 侧 E2E
- [ ] 先红：①「生成后 textInput 正文不被 prompt 覆盖」（模拟 handleGenerate→断言 data.content 不变、data.prompt 更新）→**红**（现 :157 写 content）②E2E「panel prompt → callTextGen 收到 panel 值」——无上游 textInput 经 execution.service:512 `data?.prompt?.text` 命中→**红**③**类型面**——TextNodeData.prompt 现为 `string`（:107-110）且 :31 按 string 消费（`nodeData?.prompt || ''`），写 {text} 对象后 useState 直接持有对象→UI 断言 textarea 值=字符串→**红**
- [ ] 绿：:157 改 `applyNodeDataPatch(nodeId, { prompt: { text: prompt } })`；**TextNodeData.prompt?: { text: string }（T3 冻结形）**；:31 改 `nodeData?.prompt?.text ?? ''`；**T0 census⑥ 全消费面同卡改**（snapshot-filter 等按 read model 出口）；audioGen 的 content=prompt 义维持现状（物理迁键=T12）
- [ ] 测试绿→Commit。

### Task 3: docSchemaV4 树形表+EXEC_SCHEMA 独立+array 语义（PC1）
**Files:** packages/shared/src/canvas/doc-schema-v4.ts（新）+schema-contract.spec.ts（新）
- [ ] 表形（TS 单源，**树形**——平表无法表达 prompt.text/allImages 嵌套；doc.exec 根独立表；**array 键必须定容器语义**）：

```ts
export type YFieldType = 'text' | 'xml' | 'array' | 'lww-array' | 'lww' | 'server-only';
// array=Y.Array（并发追加/undo 语义——allImages/refs）；lww-array=整串 LWW 替换（默认禁，登记理由才可用）
export interface DataKeySpec { yType: YFieldType; writer: 'user' | 'server' | 'both-creating-only';
  reader: string[]; ownership: 'user' | 'server'; undo: boolean; permission: 'free' | 'protected';
  mediaRef: boolean; importExport: boolean; maxBytes?: number; children?: Record<string, DataKeySpec>; }
export const DOC_SCHEMA_V4: Record<string /*nodeType*/,
  { envelope: readonly string[]; data: Record<string, DataKeySpec>; }>;
export const EXEC_SCHEMA_V4: { roots: readonly string[]; components: Record<'execution' | 'artifact', DataKeySpec> };
// 覆盖：textInput{content:xml·user·undo, prompt:{text:text·user}} / audioGen{prompt:text}
// imageGen|videoGen{prompt:{text:text}, allImages:array·mediaRef·Y.Array} / multiImageGen{prompt:{text}}
// 通用{position/size/config:lww·user} / 未知类型=空表+ DENY
```

- [ ] 先红：schema-contract.spec——「每个 NODE_TYPES 成员在表内有 envelope+data 全键（树形全路径穷举）」「SERVER_WRITABLE 与 ownership:server 键集一致」「**DataKeySpec 组合合法性**（writer=server⇒ownership=server⇒permission=protected；yType=array⇒Y.Array 语义+undo 可用；lww-array 必须登记理由——非法组合即红）」「键集与 canvas-doc-manifest 现键零漂移 diff」（现 manifest 无类型维度=红前置）
- [ ] 绿+断言族全绿→Commit。

### Task 4: DocCodec 双出口+transform+zero-yjs（PC1）
**Files:** packages/shared/src/canvas/doc-codec.ts（新）+round-trip 属性测试
- [ ] 接口（**codec 纯结构——DocLike 结构接口+工厂注入，shared 零 yjs 依赖**，API/web 各自适配；doc codec 与 wire 编码分离）：`encodeNode(type, yNodeLike|data): CodecNode` / `decodeNode(type, codec): {data, texts}` / **双出口**：`serializeCanvas(docLike): CanvasDocument`（canonical——备份/重建/语义比较）+ `toReadModel(docLike): CanvasReadModel`（plain JSON——REST/执行/导出；文本显式 string，富文本 PM JSON/HTML）；`readCanvas` 只返回 read model——**禁止共享类型逃逸**；`semanticEqual(a,b)`（canonical：类型/稳定 ID/引用/排序/文本内容——XML 归一化比较）；**`transformV3ToV4Draft(v3): CanvasDocument` 纯函数**（v3 现形→v4-draft：audioGen content→prompt/textInput prompt 对象化/分键——T12 消费；自 T15b 前移）
- [ ] readRecordsFromMaps 收编：codec 内唯一 import 点；**docShape re-export 删除**——全部调用点改道 codec/read model（含服务端 video-work-clone/registry——无兼容层=根修纪律；调用面清单=T0 census ⑤）
- [ ] 先红：round-trip 属性测试（随机 text/marks/嵌套 XML/array/lww 组合+transformV3ToV4Draft 语义 fixture——语义相等非字节相等；现无 codec=红）
- [ ] 绿+census 门（eslint rule 或 check-collab-census：`readRecordsFromMaps` 仅 doc-codec.ts 可 import）→Commit。

### Task 5: 契约冻结收口（PC1/PC3）
**Files:** shared 耐久性契约常量+docs（collab-ops-runbook 草节）+fixture 语料+packages/shared/src/collab/draft-envelope.ts（新——纯类型）
- [ ] content 分键契约定稿（textInput.prompt=Y.Text/audioGen.prompt 迁移目标形——物理迁移 T12）；创建路径双路 census 报告（含种子事务形）；执行输入快照契约（`GenerationIntent.inputSnapshot Json?`={promptText,promptHtml?,upstreamMediaIds,paramsHash}——**受理冻结=T12**，T6 扩列；**256KB 上限（超限=受理拒绝）+PII 策略**：promptHtml 仅存储不渲染/媒体引用白名单校验/日志禁整 payload 输出）；耐久性契约表（`local/synced/durable/archived` 四档常量+UI 文案映射——只有 durable 承诺不丢；RPO/RTO 数字：dev/test RPO=24h 诚实登记+生产门=PITR RPO≤5min/RTO≤30min+MinIO 版本化 RPO≤15min）；**T29 charter stub**（owner/date 待定+四验收：PITR/MinIO 版本化/季度 restore drill/每小时 replay canary——独立批立项时填）
- [ ] **类型冻结进清单**：DraftEnvelope（typed/versioned/project/generation/schema/checksum——T15 消费类型/T18 实现协议）+CanvasReadModel（T4 出口形状）+**nodeId 语法**（URL-safe 字符集、**禁 `:`**——T21 扁平键前提）+**exec slot 编码**（固定枚举白名单，禁用户输入透传）+**watermark 粒度=per-node 元组 (projectedExecSeq,projectedEventVersion)+artifact per-slot rev**+paramsHash 形状
- [ ] fixture 冻结：-2a 语义比对语料（每类型典型+边界）+-1b fuzz 种子语料（含部分应用 bit-flip 变异集+**reset 恢复帧语料**——B3 形态）
- [ ] PC1-PC3 全绿+**Phase 0 出口=用户确认点①**→Commit。

## Phase 0.5：承重契约八项 go/no-go（T6 前必须全过——零生产代码；任一失败=对应任务先改再写码，禁「按默认写红了再改」）

### Task 5.5: 八项 go/no-go（每项=默认方案/失败模式/必须证明/失败回退）
- [ ] ①**schema/append**：默认=T6 表形+T7 SQL；失败模式=relation/空 model/复合 FK 不合法；证=`prisma validate`+`prisma migrate diff`+PG dry-run（取号/围栏/去重 no-op 全路径）；回退=修表形（不得跳验证）
- [ ] ②**candidate 载体**：默认=shadow doc（高频 exec 投影）/full clone（低频 lifecycle）；失败模式=shard 缺依赖进 pendingStructs（实测复现）；证=create/delete/edge/undo 帧在 candidate apply 后 diff 完整+clone clientID 重写实测复核+shadow 稳定 clientID 写身份；回退=换载体并改 T19
- [ ] ③**provenance**：默认=struct 区间授权+updateHash 仅 fast path；失败模式=merged/backup/reset 恢复帧被误拒（B3 形态）；证=merged SS2+backup import+**reset 恢复帧（旧 server structs 全量上行）**+旧代缓存均放行；伪造新 clock 拒；伪造同 clock 异内容（GC 后窗口）拒或降级；回退=per-struct hash/bitmap
- [ ] ④**保存屏障**：默认=beforeHandleMessage 拦截 Stateless+sendStateless 回执；失败模式=帧解析/顺序错；证=wire format（解析先跳 documentName varString）+frameSeq 绑定顺序证明+并发帧不插入 marker 前缀；回退=方案 B patch MessageReceiver statelessCallback await（T17 扩 patch 范围）
- [ ] ⑤**apply/PG/广播**：默认=candidate-first；失败模式=PG 失败 live 已变/observer 抛错后广播半态；证=PG 失败 live 零变更+observer 抛错隔离重载+B5 文案统一+**帧字节精确 copy 纪律**（lib0 subarray 越界读实测复核——FrameGate 入口 copy 至精确尺寸 buffer）；回退=patch Document 延迟广播或显式改 B5
- [ ] ⑥**admissionEpoch**：默认=懒 per-project 块 ≥1e6+80% 预留先于越界；失败模式=块耗尽/重启重叠/全局租约行不可执行；证=连续受理>block size+kill/restart 不重叠+旧 spool 帧 epoch 恒小于新 cutoff+维护 cutoff 不误收新帧；回退=PG sequence 每帧直取
- [ ] ⑦**PromptInput Y.Text**：默认=Y.Text+mention chips；失败模式=Tiptap 无标准 Y.Text 绑定；证=双端输入/mention/undo 用例；回退=plain textarea 或改 XmlFragment（联动改 T3 冻结形）
- [ ] ⑧**incarnation 权威源**：默认=PG NodeLifecycle 最新行（genesis/换代 seed 初始行）；失败模式=live Item 身份不可公开取；证=genesis/undo/reload 三态一致；回退=解码 adapter+conformance 或加 current 指针列
- [ ] **八结论 go/no-go 呈报用户（本段出口=硬门——②③④⑥任一 no-go 的对应任务〔T16/T19/T20/T22〕修订后重过）**→Commit（spike 结论文档）。

## 片 -1a：载体（T6-T11）

### Task 6: Prisma 迁移一（载体全族）+genesis 双路+缺头三态（G1/B3）
**Files:** schema.prisma+migration `y1c1_carrier_v4`；project.service.ts:45-108；canvas.service.ts:37-53
- [ ] 先红：①双路种子测试——POST /canvases 后查 CanvasDoc+Snapshot(g,0,0) 存在（现懒建=红）②缺头三态——project.service 缺头返回 `missing` 非 generation=0（现 `?? 0`=红）③`prisma validate` 对本卡表形（Phase 0.5① 终稿——空 model/单侧 relation/缺 opposite 三形态实测必红，本卡必须真绿）
- [ ] schema（核心——**owner/epoch 只存 CollabLease 不入 CanvasDoc**；BigInt 默认值=`@default(0)`；**不建 CanvasDoc 侧子表列表 relation**〔单侧 relation 红实测——子表经 project FK 到 CanvasProject 级联〕；**CanvasProject 补全部 opposite 字段**；指针复合 FK/DEFERRABLE 与 maintenanceId partial unique 用 migration raw SQL）：

```prisma
model CanvasDoc {
  projectId String @id  generation Int @default(0)  schemaVersion Int  lifecycle String @default("SERVING")
  currentSnapshotRev BigInt @default(0)  appendSeq BigInt @default(0)
  admissionEpoch BigInt @default(0)  purgeBelowSeq BigInt? // T9 purge 持久水位（启动续跑）
  maintenanceId String?  maintenanceStage String?  maintenanceError?
  admissionCutoff BigInt?  maintenanceSourceGeneration Int?  maintenanceTargetGeneration Int?
  targetSchemaVersion Int?
  project CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@unique([maintenanceId]) // migration SQL 写 partial: WHERE "maintenanceId" IS NOT NULL
}
model CanvasDocSnapshot { projectId String  generation Int  snapshotRev BigInt  stateSeq BigInt
  state Bytes  stateHash String  schemaVersion Int  createdAt DateTime @default(now())
  @@id([projectId, generation, snapshotRev])
  project CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade) }
model CanvasDocUpdate { projectId String  generation Int  seq BigInt  update Bytes
  updateHash String  createdAt DateTime @default(now())  @@id([projectId, generation, seq])
  @@index([projectId, generation, updateHash])
  project CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade) }
model CanvasDocProvenance { projectId String  generation Int  clientId BigInt  batchId BigInt
  clockStart BigInt  clockEnd BigInt  updateHash String  createdAt DateTime @default(now())
  @@id([projectId, generation, clientId, batchId])  @@index([projectId, generation, clockStart])
  project CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade) }
model NodeLifecycle { projectId String  nodeId String  incarnationId String // canonical "clientId:clock" 十进制串
  generation Int  nodeType String  exists Boolean  createdAt DateTime @default(now())  deletedAt DateTime?
  @@id([projectId, nodeId, incarnationId, generation])
  @@index([projectId, nodeId, generation, createdAt])  @@index([projectId, generation, exists])
  project CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade) }
model DeliveryFence { projectId String  nodeId String  incarnationId String  generation Int
  execSeq BigInt?  state String  reason String?  updatedAt DateTime @updatedAt
  @@unique([projectId, nodeId, incarnationId, generation])
  project CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade) }
model DocWriteAudit { id String @id @default(cuid())  projectId String  generation Int  actor String
  command String  origin String?  nodeId String?  updateHash String  receipt Json?  meta Json?
  createdAt DateTime @default(now())  @@index([projectId, generation, createdAt])
  project CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade) }
model ObjectManifest { id String @id @default(cuid())  projectId String  mediaId String?  objectKey String
  objectVersion String?  state String  deleteClaimedAt DateTime?  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt  @@unique([projectId, objectKey])  @@index([projectId, mediaId])
  project CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade) }
model MaintenanceOperation { maintenanceId String @id  projectId String  stage String  status String
  error String?  idempotencyKey String @unique  leaseOwner String?
  createdAt DateTime @default(now())  updatedAt DateTime @updatedAt  @@index([projectId, status])
  project CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade) }
// CanvasProject 补 opposite：canvasDocSnapshots/canvasDocProvenances/nodeLifecycles/deliveryFences/
// docWriteAudits/objectManifests/maintenanceOperations（docUpdates 已有；maintenance 消费=T10）
```

- [ ] GenerationIntent 扩列 `inputSnapshot Json?`（T12 受理冻结用——paramsHash 列已在）；**迁移策略=先 reset 再 migrate**（dev 无存量纪律——deploy 测试 reset runbook 已有；不写 backfill）
- [ ] 迁移后旧 state/stateSeq/preVacuumSv 列删除（硬切豁免登记）；种子双路同事务（project+doc 头+snapshot0+**NodeLifecycle genesis 初始行**——incarnation 权威源 seeding，Phase 0.5⑧ 定案）；缺头=missing/present/corrupt 三态判别函数
- [ ] additive 门豁免登记→交错用例（并发双创建）绿→Commit。

### Task 7: appendSeq 行锁+{owner,epoch,g} 围栏+advisory 键单源+错误模型（G2/G4/B1/B4）
**Files:** canvas-doc-update.repository.ts（重写）；collab-lease.service.ts；collab-persistence.service.ts:356-365；pg-error.util.ts:4-7；packages/shared advisory-key helper（新）
- [ ] 先红（真 PG 并发）：①ABA——同 owner 捕获 epoch=7、另一连接重获 epoch=9 后提交旧操作→现 owner-only EXISTS 放行=红②FK 误分类——注入内部 FK 错（snapshot 悬空）→现全 23503 终态丢批=红
- [ ] append SQL（**owner/epoch 自 CollabLease 读——CanvasDoc 不存**；advisory 键=hashtextextended 单源 helper——**shared（append）与 exclusive（takeover）同源同种子**，否则不互斥）：

```sql
SELECT pg_advisory_xact_lock_shared(hashtextextended('collab-lease:' || ${scope}, 0));
SELECT owner, epoch FROM "CollabLease" WHERE scope = 'primary';
SELECT generation, lifecycle, "appendSeq" FROM "CanvasDoc" WHERE "projectId"=${pid} FOR UPDATE;
-- 校验 owner=$capturedOwner ∧ epoch=$capturedEpoch ∧ generation=$expectedGeneration ∧ lifecycle 允许
UPDATE "CanvasDoc" SET "appendSeq"="appendSeq"+1 WHERE "projectId"=${pid} RETURNING "appendSeq";
INSERT INTO "CanvasDocUpdate"(...) VALUES (...${seq}...);
```

- [ ] `append(projectId, update, {owner,epoch,generation})` 显式传捕获值；**updateHash 去重语义**：同 (projectId,generation,updateHash) 已存在→返回原 seq no-op（幂等重放不耗号）
- [ ] 错误模型重写：约束级判别（P2003 meta→constraint 名白名单→仅 project FK+DB 复核 CanvasProject 缺失才终态丢弃；内部 FK=fail-closed 保留+告警计数 yjs_persist_fk_internal_total）
- [ ] G2 前缀交错组绿；心跳并发 append 不受阻（3s 心跳 ping 用例）→Commit。

### Task 8: 装载 RR+前缀连续+读侧守卫（G5）
**Files:** canvas-doc-update.repository.ts（readConsistent 改新表形）；collab-doc-registry.service.ts 装载路径
- [ ] 先红：删增量整行/删指针行/改字节→分档 reason 拒载（现无守卫=红）
- [ ] 装载=单 RR 事务（头+Snapshot(R)+S<seq<=N 全增量+连续+计数+SHA-256 校验）→事务外 apply（失败拒载不返回半文档）；yjs_doc_incomplete_total{reason=missing|corrupt|prefix-gap|hash|replay}；readCanvas 出口同判据
- [ ] 交错（装载×compact×append 三方）用例绿→Commit。

### Task 9: compact v4+purge 持久水位（G3/B2 部分）
**Files:** canvas-doc-update.repository.ts compact（调度入 COLLAB_ROLE=worker 进程）；CanvasDoc.purgeBelowSeq（T6 列）
- [ ] 先红：两 compact 并发 PK 冲突被折成正常 miss=红；单事务全量 deleteMany=红（断言分批）；**kill 在指针发布后/purge 前→重启后 purge 不续跑（无持久水位）=红**
- [ ] 事务外重放（**compact 执行体=COLLAB_ROLE=worker 进程——真进程隔离**；worker_threads 共享 RSS 非进程隔离——不采；调度经 worker 角色队列+RSS 上限+显式 timeout）→**指针前移=短事务**（advisory+FOR UPDATE 头+四元组 (g,R,epoch,lifecycle) 比对——epoch 自 CollabLease 显式传入+INSERT Snapshot(R+1)+指针前移+**purgeBelowSeq 同事务持久**）→**提交后 worker 分批 deleteMany（1k/批按 seq 升序，水位先持久）——启动续跑从 purgeBelowSeq**；PK 冲突=回滚实查分类；积压（pending updates 行数）+快照量两个 gauge
- [ ] 调度（1,000 行/2MiB/60s+30s 间隔+全局并发 1）；**保留策略**（当前代留最近 2 份+最近两旧代各最终 1 份——检查点语义；禁删当前指针引用行）→三方交错绿→Commit。

### Task 10: 维护状态机+admissionEpoch 懒块分配+REST 控制面（G9/B2/B3——含执行门）
**Files:** collab-maintenance.service.ts（新）；collab-maintenance.gateway（新——REST）；collab-persistence.service.ts（drain 授权档+spool 标签）；collab-spool.service.ts（帧头受理标签）；scripts/collab-rebuild-gen.mjs（新）；MaintenanceOperation 表（T6 建，本卡消费）；registry/residency 接线
- [ ] 先红：①QUIESCING 后 drain flush 被 SERVING-only 拒=红②Promise.race 超时被当排空完成=红③CLI 无租约直写 CanvasDoc=红④重启后 admissionEpoch 回退（旧 spool 帧误判 cutoff 后）=红⑤**块耗尽后内存 epoch 越过高水位、重启重叠**=红
- [ ] **admissionEpoch 懒块分配+持久化**（Phase 0.5⑥ 定案）：`CanvasDoc.admissionEpoch`=高水位；**首次受理/首次装载时懒分配 per-project 块**（全局租约行无项目上下文——不在租约处遍历）；**块=1,000,000**；内存 base=highWater-block，受理帧 ++；**80% 消耗时 PG `UPDATE ... SET "admissionEpoch"="admissionEpoch"+1000000 RETURNING` 预留下一块——先于越界（旧块不重用由此保证）**；PG 不可用=fail-closed 停止受理（不回退内存自增）；崩溃重启从 PG 高水位续块；spool 帧头持久 `{maintenanceId?,admissionEpoch,generation,frameVersion}`；**旧格式段 quarantine**；维护 cutoff=当前 epoch；drain 只接受 epoch≤cutoff 且 maintenanceId 匹配/为空
- [ ] **DRAINED 六元组=可查询计数器**（admission/spool/append 各路径内存计数器+GET 端点暴露）：pendingBatches/spoolCurrentGen/admissionInFlight/appendTxInFlight/writeWindowIdle/producerPaused（任一不可观测=阻断保持封闭；producerPaused 由 lifecycle!=SERVING 派生，poller 跳过 claim）
- [ ] **REST 控制面**：POST /api/collab/maintenance（admin guard+maintenanceId 服务端生成+幂等键落 MaintenanceOperation）+GET 状态；CLI 只调 REST/轮询，无租约拒绝；**租约丢失=中止**；maintenanceStage 表（stage→允许动作/幂等键/超时——MaintenanceOperation 落库）+每 stage kill -9 演练；空画布保头升代（互斥判据）；归档窗口 7 天；类型化导出重建=DocCodec serializeCanvas→fresh doc（identity -1a）
- [ ] 用例：连续受理>block size；块耗尽 kill/restart 不重叠；旧 spool 帧 epoch 恒小于新 cutoff。**世代切换首次真跑=执行门——单独请用户确认后执行**；G9+B2/B3 绿→Commit。

### Task 11: 世代通道接线+DocKey 升维+csv→4+闩锁删除（G6/G7/G8/B1 部分）
**Files:** packages/shared/src/collab/doc-name.ts（新 buildDocName）；39 处改道；check-collab-census.mjs（裸构造门）；registry+persistence 内存表全清单升维；canvasCollabRuntime.ts:1601+4410 消费链；snapshot-doc-cache.ts；collab-protocol.ts csv=4；Y1b §3.3 闩锁 census
- [ ] 先红：①isValidDocName 翻转（要求段）——现拒带段=红②裸构造静态门红（39 处）③4410 后 provider-only recovery 同 doc 复用=红（G7）
- [ ] buildDocName(pid,g) 唯一构造器+全部改道+census 门进 verify fast；DocKey={pid,g}（documentName 承载）覆盖 registry 12+persistence 10 张表（清单=Phase 0 census）；spool 段键 `.g${N}.`；三层 fencing（onAuthenticate 段 vs DB 列 hardClose 4410 携 g/onLoadDocument 再核/append 已 T7）；4410 消费=完整新会话（拆 observers/UndoManager/cache writer/provider→destroy→新 doc）；**公开快照缓存键=(pid,g,snapshotRev)**（appendSeq 只做 ETag）；csv=4（shared 单源——65accbe7 纪律）
- [ ] 闩锁删除（census 定位 Y1b §3.3 resync 域→删→Y1b 只读域回归全绿 G11）
- [ ] G6-G8+B1 世代维度用例+两浏览器换代预演→**-1a 出口=用户确认点②**（G1-G11+B1-B4+verify 全绿+世代切换演练证据）→Commit。

## 片 -2a：内容（T12-T15b）

### Task 12: 纯文本 Y.Text 分型+content 分键物理迁移+inputSnapshot 受理冻结（G15）
**Files:** docShape/canvasIntents canApplyIntent seam；audioGen 读写面（AudioConfigPanel 等）；nodeStore 文本域；execution.service.ts:512+topology.service.ts:83（读者改道）
- [ ] 先红：整串覆盖写被拒（现 getHTML/整串 diff 形态=红）；audioGen doc 键 content→prompt 迁移（现无=红）；claim 时活读 doc（改 prompt 后执行内容漂移——重放用例）=红
- [ ] Y.Text 域（audioGen.prompt/imageGen·videoGen.prompt.text/multiImageGen.prompt=text 类型）：splice 单一 seam（canApplyIntent 前置——整串覆盖拒绝）；audioGen content→prompt 键迁移（**DocCodec transformV3ToV4Draft——T4 已冻结，本卡消费**；读者同卡改道）；结构上限（节点数/data 字节/文本长度——字节计不分类型）+单键 256KB 间隔门
- [ ] **inputSnapshot 受理冻结**：受理事务写 `GenerationIntent.inputSnapshot={promptText,promptHtml?,upstreamMediaIds,paramsHash}`（列已 T6 扩；**256KB 上限+PII 策略=T5 契约**）；topology/execution 读者同卡改道 read model/快照；PromptValue 模型=T3 冻结形
- [ ] IME composition/粘贴/选区/两端同位插入并发用例（双 client 真并发）绿→Commit。

### Task 13: 嵌套 XmlFragment+y-prosemirror 绑定（G16——容器规则=T14 先行）
**Files:** TextInputNode.tsx+TextNodeFullscreen/TextNodeToolbar/prompt-input/PromptInput；apps/web package.json（y-prosemirror exact pin=T0 调研版）
- [ ] 先红：现 getHTML 整串写 data.content=红（tree 有效性断言：两客户端格式化合并后树合法）
- [ ] `nodes[id].data.content`=嵌套 Y.XmlFragment（**容器=null 占位+结构创建时一次性建——规则=T14 先行落卡**；**缺容器=拒绝不懒建**）；`editor.registerPlugin(ySyncPlugin(fragment))+yUndoPlugin`（StarterKit `history:false`；**plugin 首次事务前注册**）；快捷键归属（文本焦点内 Ctrl+Z=编辑器协作历史——focus 判定）；**全屏/工具栏复用同一 editor 实例**；PromptInput 面定案（**Phase 0.5⑦ 结论**——Y.Text 域不走 XmlFragment）；HTML 仅渲染/导出（getHTML 只读）
- [ ] 并发格式化/删除节点 fragment 随子树/undo 重建 fragment 恢复用例绿→Commit。

### Task 14: 唯一创建者+incarnation 权威源（G17a/B10 写路径——先于 T13 落地）
**Files:** canvasIntents 写路径+collab-doc-writer（fillDoc 守卫）；NodeLifecycle 写接点（表已 T6）
- [ ] 先红：两副本并发同 key 建容器→旧路径败者字段不可见=红；**fillDoc 对 live doc 重放已有 id（无条件 nodes.set 新容器——collab-document.service.ts:366-373，现仅注释约束）=红**
- [ ] 容器创建规则：结构创建时一次性建（叶子只取现有；缺=拒绝/等待）；**服务端不懒建 data**；undo 重建合法（incarnation=Item(clientID,clock)——**提取器=解码 struct adapter（YjsWireAdapter）**，禁 `nodes._map`；exact pin+conformance）；恢复不得夹带服务器字段（服务端键集校验）
- [ ] **G17a 真调用面=fillDoc live 误用守卫**（fillDoc 仅种子/export-fresh 白名单——live doc 上重放已有 id 拒绝；**不发明 replaceNodeContainer op**——无调用方=死代码）；canvasIntents addNode 幂等守卫维持；**current incarnation 权威=NodeLifecycle 最新行**（按 createdAt/incarnationId 序；genesis fillDoc/换代 seed 写初始行——T6 已 seeding；T14/T19 写；不读 doc 私有字段——Phase 0.5⑧ 定案）
- [ ] B10 用例（delete→undo→re-delete 新 incarnation/delete→refund→undo 不继承取消/fillDoc live 误用拒）绿→Commit。**G17b（对抗面：raw update 替换 live/undo 恢复夹带 server 字段/并发同 key 建容器）→T16 FrameGate DENY**

### Task 15: RetentionCoordinator 条件触发+bounded undo（G19/B16）
**Files:** apps/web/src/collab/retention-coordinator.ts（新）；canvasUndo.ts:13,:41-42
- [ ] 先红：**shift 泄漏**（STACK_LIMIT 截断后 encodeStateAsUpdate 字节不回落=红）；清一个管理器后另一个 undo 恢复空（多管理器用例=红——探针语料入测试）
- [ ] 文档级协调器：登记画布+每编辑器管理器 undo/redo/popped/redone/祖先依赖（**Tiptap 集成经 yUndoPluginKey.getState() 取 UndoManager**）；挂 afterTransaction **条件触发**重建 keep 并集（Transaction.js:313-325 时序；**触发集合=stack-item-added/popped/cleared/updated+redo 侧 added/cleared+transaction.deleteSet 非空——其余事务早退**，否则每击键 O(undo stack)；500ms 合并窗口用例）；drop 算祖先闭包 keepItem(false)；gcFilter 与显式 tryGc 同判定；fail-closed 保留；预算单管理器 100 项/4MiB+文档级 16MiB 去重计费；**origin 分离**（编辑器 undo 与画布 undo 的 transaction origin 区分登记）；**TypedDraft（DraftEnvelope 消费端——类型已 T5 冻结**：结构/文本类型化草稿重生成；协议/状态机=T18）
- [ ] B16 全组+G19 绿→Commit。

### Task 15b: 完整重建序列化+时间轴（G18）
**Files:** doc-codec（全类型 encodeNode 扩 XmlFragment/嵌套）+rebuild 路径（registry rebuildVacuumDoc 换 DocCodec）+VideoProject.data 时间轴迁移
- [ ] 先红：rebuildVacuumDoc 非 Map 根降级=红；时间轴域双写=红
- [ ] DocCodec 全类型 round-trip（语义 fixture=Phase 0 冻结语料；transformV3ToV4Draft 已在 T4）；时间轴真实消费者迁移（未迁移功能留原真源）→G18 绿→**-2a 出口=用户确认点③**→Commit。

## 片 -1b：准入（T16-T19）

### Task 16: FrameGate 串行窗+三档判定器+provenance 区间授权（G12/B5/B8/B9+G17b）
**Files:** collab-frame-gate.service.ts（新）；collab-admission/{decoder,parent-chain,provenance,policy}.ts（新）；collab-server.factory.ts:59-63（afterHandleMessage 接线）；registry guardSyncFrame 收编
- [ ] 先红：①A.check/B.check/A.apply/B.apply 交错（两连接并发写受保护根——现各连接独立排队=红）②SS2 全量帧写 exec=红③伪造 server clientID（provenance 未命中）=红④部分应用语料（Phase 0 bit-flip 集——先 decode 拒）⑤**G17b 对抗面**（两客户端并发同 key 建容器/raw update 替换 live 容器/undo 恢复夹带 server 字段——现放行=红）⑥**合法恢复帧被误拒**（B3 形态 reset 恢复语料——整帧 hash 方案红）
- [ ] 三档 policy（TS 单源）：

```ts
type Verdict = { tier: 'DENY'; reason: string } | { tier: 'NORMALIZE'; anomalies: GraphAnomaly[] } | { tier: 'ACCEPT' };
// DENY 面（DOC_SCHEMA_V4 权限/预算）：写 exec/meta/服务器字段·替换 live 容器（G17b）·重复创建 live nodes[id]
// ·DS 删 live 受保护·provenance 未命中·未知类型/键/值类型·超预算(maxStructs/maxDsRanges/maxFrameBytes)
// NORMALIZE 面：悬挂边/父链环/跨组 parent/重复边（读侧规则=renderCanvas 收编 shared 单源；只读不写回；graph_anomaly_total 告警）
```

- [ ] beforeSync 获取 {project,g} 令牌（覆盖 SS2+Update——SS2 独立字节/struct 预算；awareness/stateless 不过闸；有界等待队列+满则拒帧=背压）→decode structs+DS→父链上溯→受保护判定→**provenance 区间授权**→持令牌到 apply 完成→afterHandleMessage 幂等令牌匹配释放；beforeHandleMessage 抛错自释放；候选帧校验受影响节点（运行时 manifest 准入面——键/值类型/字节/nodeId 语法/每节点键数）；每帧 trace 五段耗时
- [ ] **provenance 授权边界（Phase 0.5③ 定案）**：授权=struct 身份 (clientId,clock) 落在已知区间（命中即按 server struct 授权；**新 clock 一律按客户端写**）；**updateHash 仅 exact-replay fast path**（幂等重放短路——不做通用准入条件）；per-struct/per-range contentHash=可选加固（spike 定夺——GC 后窗口）；缓存=装载时按 (pid,g) 加载**全 clientID**（含 shadow/clone 历代写身份——不假设单 server clientID）+服务器写追加+代归档清理+provenance_rows gauge+按时间窗裁剪；**reset 恢复帧政策**：破坏性 reset 后 client 全量上行携带旧 server structs（B3 形态）——内容根 ACCEPT、exec 键换代后从 PG 派生（T22）——**不得 DENY 合法恢复**
- [ ] **帧字节纪律**：FrameGate 入口将帧字节 copy 至精确尺寸 buffer（**禁 subarray 共享 buffer 直解——lib0 解码越界读实测**）
- [ ] fuzzer（Phase 0 语料+CI corpus+reset 恢复语料）+B5/B8/B9 全组绿→Commit。

### Task 17: y-protocols patch fork+FrameApplyReceipt+广播方案 A（G12/B5 部分）
**Files:** patches/y-protocols@1.0.7/（pnpm patch）；collab-frame-gate（receipt 对比）；web 回归用例
- [ ] 先红：apply 抛错后客户端收到 success ACK=红（现 sync.js:82-89 吞错）
- [ ] **patch 范围=只改 readSyncStep2/readUpdate**：apply 异常重抛（错误对象携 frameId）；**FrameApplyReceipt**（patch 返回 {appliedStructs,dsRanges,clientClockMax,pending}——gate 精确比对，非模糊 SV；no-op/pending 帧不误判不误重载）；Hocuspocus MessageReceiver 路径 ACK 在 apply 成功后（gate 包裹）；patch 校验和进 CI+上游 PR 留证；**广播方案 A（正文与验收同口径）**：不假 ACK+PG 失败不 apply 不广播+后置校验 receipt 不一致=隔离重载共享文档及全部相关连接；**广播可能包含异常部分更新，由隔离重载收敛**（不承诺零半成品）；残余风险注记：decode 阶段抛错=原子（struct 区实测）；尾部 DS 受损/subarray 越界=已应用后抛错（实测形态）——由 receipt 兜底；**patch 影响面=server+web 双侧**——验收加 client 正常同步 web 回归+**差分测试**（patched vs upstream 在语料集上行为一致除重抛外）
- [ ] B5 用例（不假 ACK/receipt 不一致隔离重载/PG 重载）绿→Commit。

### Task 18: 拒帧恢复协议+4411 注册链（G12d/B6/B7）
**Files:** apps/web/src/collab/rejected-recovery.ts（新）；canvasCollabRuntime.ts（diverged 通路扩展 :1743-1761+incarnation fence）；packages/shared/src/constants/collab-close-code.ts；DraftEnvelope 类型（T5 已冻结）
- [ ] 先红：①被拒后重复 apply 服务器态到旧 doc「修复」=红（CRDT 单调性反例语料）②旧 tab 迟到写覆盖 diverged 缓存=红③**4411 未注册**（shared collab-close-code.ts 现无——resolveCloseAction 不识别=红）
- [ ] **4411 注册链**：shared collab-close-code.ts 加 `REJECTED_OR_RESYNC: 4411`+resolveCloseAction 加终态/专用档（4410 GENERATION_SUPERSEDED 双 reason terminal 语义不动——不复用）；web resolveCloseAction 消费用例
- [ ] REJECTED/DIVERGED 状态机：停上传+DraftEnvelope 草稿（类型=T5 冻结形）→持久 diverged（复用 bootRecord.diverged）+incarnation/version fence（**多标签 BroadcastChannel 通知**）→同代 authoritative fresh Y.Doc（全拆卸——**复用 4410 重建机械但 close code=4411**）→语义差异 UI+新 struct 身份重生成（TypedDraft）→完成/放弃后切缓存 incarnation；RESYNC_REQUIRED 先 pull-only 再重放；pending 因果分档（clean 补依赖/diverged 只 rebase）
- [ ] B6（三档语义）/B7（多标签/重启/IDB blocked）绿→Commit。

### Task 19: LifecycleIndex 候选态+clone/shadow candidate-first+beforeHandleMessage 保存屏障（G13/G14/B11/B12）
**Files:** collab-lifecycle-admission.service.ts（新：LifecycleIndex+候选态）；collab-doc-writer.service.ts（ServerDocWrite 统一+shadow doc 管理）；collab-server.factory.ts（beforeHandleMessage barrier 拦截）；collab.gateway（save-barrier 客户端协议）；DocWriteAudit（T6 建，本卡写）
- [ ] 先红：①删除节点后取消义务无持久提交点（删 A/并发 finalize 两序反例）=红②Sync ACK 后 PG 前 kill 界面称已保存=红③服务端写零审计=红④**PG 失败后 live doc 已变更**（apply 先于 PG）=红⑤**删节点找关联边 O(E) 全扫断言**（LifecycleIndex 缺失=红）
- [ ] **LifecycleIndex（T19 专用轻量反向索引）**：`nodes: Map<nodeId,{exists,incarnationId,nodeType,containerIds}>`+`edgesByNode: Map<nodeId,Set<edgeId>>`+`mediaRefsByNode: Map<nodeId,Set<mediaId>>`——装载时构建+afterTransaction 增量维护；删节点 O(1) 取 incident edges/media（现役 O(E) 三处实证——server 侧本卡换道；web 侧留 T24）；超 maxLifecycleNodes→bounded full（worker/限流）或整帧拒绝
- [ ] **candidate=full clone/持久 shadow（Phase 0.5② 定案）**：**shadow doc**=每项目一份第二 Y.Doc、**稳定 clientID**、所有 authoritative update 同步 apply——shadow 自写 struct 即 server 写身份（provenance 记 shadow clientID）；用于高频 server 写（exec 投影）；**full clone**=与 live 同 gc/gcFilter 选项（clone 无法复用 live clientID——yjs 重写实测，写身份=clone 实际 clientID 记 provenance）；用于低频 lifecycle；**shard 禁作 apply 目标**（缺依赖 struct 进 pendingStructs 实测——仅配 LifecycleIndex 读前态）；candidate→PG→live apply 全程持项目 gate 令牌（并发客户端帧不能插入 candidate 与 live 之间）；maxServerWriteCloneBytes 超限→worker/限流或拆 ops；shadow 与 live 不一致→从 PG 重建 shadow
- [ ] **candidate-first（回归 spec §2.7-e）**：WriteContext{actor,command,g,epoch}→candidate（shadow/clone）apply→捕获 update+lifecycle diff（前态=LifecycleIndex）→同 PG 事务（append+DocWriteAudit+lifecycle/DeliveryFence/outbox 义务）→live apply→广播；live apply 失败=隔离+从 PG 重载共享 doc+关闭相关连接；PG 失败=live doc 零变更；**锁序=先按稳定主键预取 NodeLifecycle/DeliveryFence/GenerationIntent 再锁 CanvasDoc+append**（§2.10）；commit token 防 listener 二次排队；媒体引用核验未入删除 claim（ObjectManifest 已 T6）；用例：delete 已删=no-op 不二次退款/create 重复 live=DENY/undo 重建=新 incarnation+restored/delete+restore 同帧两行/两项目同 nodeId 不互串
- [ ] **保存屏障=beforeHandleMessage+Stateless（Phase 0.5④ 定案）**：客户端发普通 Stateless 消息 payload=`{type:'save-barrier',nonce,sessionEpoch,g,editWatermark}`；**collab 层 beforeHandleMessage 每帧被 await（esm:457）拦截**（解析：readVarString 跳过 documentName→readVarUint type=Stateless→readVarString payload→JSON 识别）→获取 FrameGate 令牌定义前缀（**marker 绑 frameSeq 非 appendSeq**——marker 后的帧不被提前确认）→强制 flush→等前缀进 PG→`connection.sendStateless({nonce,g,committedSeq})` 回执（esm:404-407）→该帧 statelessCallback 走空回调；hook 抛错=关连接（拒帧连接屏障不可成功）；断线新 nonce；**barrier forces flush**；本地缓存单快照+savedSeq/stateVector
- [ ] B11/B12（两序事务赢者裁定）+G13/G14 绿+8MiB clone P99 基准→**-1b 出口=用户确认点④**→Commit。

## 片 -2b：exec（T20-T23）

### Task 20: NodeExecution 当前行+ExecutionOutbox 单表+ArtifactProjection 退役+claim 切快照（G24/B14）
**Files:** schema.prisma 迁移二；projection-outbox.poller.ts；collab-document.service.ts（writeExecStatus 族退役）；execution.service.ts:183,:512（claim 输入读快照——读者已 T12 改道，本卡切 claim 全链路）
- [ ] 先红：①无 artifact 的 loading 事件无法落表（现 ArtifactProjection 形状）=红②claim 时活读 doc（重放用例——T12 已冻结快照，本卡断言 claim 链路零 doc 读）=红③**旧代已投影行 dedup 新代重投影**（唯一键无 generation）=红
- [ ] 表形：**NodeExecution=当前行表**：`PK=(projectId,nodeId)`；列 `execSeq BigInt/eventVersion Int/status/artifact 槽位…/projectedExecSeq BigInt @default(0)/projectedEventVersion Int @default(0)`（**执行历史留 GenerationIntent——不在此表堆行**；per-node watermark 元组唯一可取）；artifact 每 (nodeId,slot) projectedArtifactRev（本卡列/子表定形）；`ExecutionOutbox` **单表**（kind=runtime|artifact；复用六终态；**partial unique 加 generation**：runtime `UNIQUE(projectId,generation,intentRowId,execSeq,eventVersion,kind) WHERE artifactId IS NULL`+**businessKey String**（`node:<nodeId>:exec:<execSeq>:v:<eventVersion>:<kind>`——**null intentRowId 以 businessKey 去重**）；artifact 同理加 generation）；eventVersion 与状态/outbox 同事务；mark CAS=generation+runId+期望状态；**ArtifactProjection 显式退役**（dev 无存量=drop 表；poller 改单表 claim——kind 维度分流）；writer API 迁移表（claim loading/skipped/error/deliver/replace/clear/sweepOrphan→分派）
- [ ] 用例：新代同一 intent/exec 重投影不被旧行 dedup；无 intent 的 loading/error 只落一行；两 kind 同版本共存。B14+kill 恢复 30s 锚绿→Commit。

### Task 21: doc.exec 扁平组件键+单展示源（G21/G22/G27/B13）
**Files:** collab-document.service.ts（投影写者重写——经 shadow doc）；web execStatusView/读面
- [ ] 先红：现嵌套 Y.Map 形状（new Y.Map() 建）=红（断言扁平键）；旧 done 整条覆盖回滚已清槽位/新 loading 吞旧槽位（B13 两反例）=红
- [ ] `execution:<nodeId>`/`artifact:<nodeId>:<slot>` plain object 整条原子替换（Y.Map 顶层键——无嵌套共享类型；**nodeId 语法=T5 冻结（禁 `:`）+slot=固定枚举白名单**；删节点按前缀清=O(exec keys) 显式清单）；**BigInt wire 显式 String()+bigint-json gate**（BigInt toJSON 守卫进 verify）；**单服务端写者=shadow doc**（dispatcher 读 PG 快照+commit-time fence：GI 代际+eventVersion+每槽位 rev+节点围栏+doc g/epoch+outbox runId）；execution 按 (execSeq,eventVersion) **数值序**（BigInt 解析比较——string 字典序禁）；读取前缀合成；**单展示源=doc.exec**（冷装载前服务器对账回投；stateless 仅 wake-up）；attempts→execSeq 守卫切换（applyWriteExecStatusToDoc:307-325 重写）
- [ ] G21/G22/G27+B13（数值 10/9/旧 done/新 loading）绿→Commit。

### Task 22: 换代/恢复重投影+per-node 元组 watermark（G26/B15）
**Files:** projection-outbox.poller.ts（g 维度+per-node 元组）；registry（冷装载对账）
- [ ] 先红：mark 无 generation 维度=红；换代后 exec 照搬旧代=红；**A=10/B=1 项目级/单值 watermark 跳过 B 或 B slot rev 缺失**=红；**低版本 pending 行被 watermark 过滤**=红
- [ ] **watermark=per-node 元组 (projectedExecSeq,projectedEventVersion)**（NodeExecution 当前行内）+artifact per-(nodeId,slot) projectedArtifactRev；mark 与 watermark 同事务同行；冷装载按节点元组字典序比较只补更大者；**pending outbox 行不按 watermark 过滤**（直接处理——低版本未投影行正是待办）；冷装载/换代/恢复/人工修复=**全量对账**（watermark 只做增量追赶）；mark 验证 g+runId；换代重建复制用户内容+**exec 从 PG 派生**（B3 reset 政策消费端）；读侧先查 node 存在后取 exec；恢复三态（已退款=已取消需重新生成/在飞=真实 loading/完成=当前槽位）
- [ ] 用例：A=10/B=1+B slot rev 缺失只补 B；rearm 新 execSeq 不被旧元组吞；B 的旧 mark 不吞 A 的新事件。B15 绿→Commit。

### Task 23: 退款代际+物化 run fence（G25/B12/B17）
**Files:** schema.prisma 迁移三（MaterializeRun+RefundObligation——字段清单本卡）；materialize-job.service.ts:175-197,:441-482；team-credit.service.ts:257-284
- [ ] 先红：旧 run 读 lease 通过后新 run 接管完成→旧 run 仍退款（时序交错用例）=红；rollback CAS 仅 status 维度（rearm 后旧代迟到退款误命中）=红
- [ ] 表形：`MaterializeRun(runId String @id/mediaId/execSeq/artifactId/state/leaseUntil/createdAt)`+`RefundObligation(id/intentRowId/execSeq/ledgerRowId/state/attempts/reversesId/createdAt+@@unique([intentRowId,execSeq]))`；materializeRunId/epoch claim（leaseUntil 只控接管）；终态失败事务同校验 runId+status+execSeq+产物身份→持久 RefundObligation（只有裁定赢者安排冲销）；完成事务同 run fence+终态互斥；退款异步重试引用 exact settle row+幂等 reversesId；rollback 族全补 expectedExecSeq+精确 ledger 行身份
- [ ] B12/B17（两序赢者/退款失败可重扫）绿→**-2b 出口=用户确认点⑤**→Commit。

## 片 -3：门禁（T24-T27）

### Task 24: 读者改道+字段删除同单元（G28）
**Files:** web 全读者（Phase 0 census 27 处/14 文件）+**apps/api video-work-clone.service.ts:33**（readCanvas 全 doc——buildFilteredSnapshot content/prompt/status 同步改道）+media-refs.ts:70-89（随迁+exec 扫描增补）+snapshot-filter util:133+execAligned/data.status fallback 删除
- [ ] 先红：改道后删 data.fileId/result/status 写者→任一读者 broken=红（census 门——含服务端读者）
- [ ] 全读者投影合成改道（经 DocCodec read model）；execAligned 与 data.status fallback 删除（execStatusView 收单源）；collectMediaRefs 增补 exec 前缀扫描（**服务端消费 LifecycleIndex 化前留全扫、web 侧维持**——按 Phase 0 census 分流）；公开快照缓存键 (pid,g,snapshotRev)+doc-saved 失效+服务端 sanitize+URL allowlist+exec 产物按分享策略过滤；陈旧注释清理（video-work-clone:46 template.service 引用——当前 HEAD 无 doc 读）
- [ ] G28（broken reader 零——web+server）绿→Commit。

### Task 25: E68 执法+manifest 断言族（G29/G32）
**Files:** shared 不变量表（五条三列）；check-collab-census 扩（新字段未分类红+运行时面共用）
- [ ] 先红：不变量缺口（环/悬空边读侧未屏蔽——NORMALIZE 规则未收编）=红；未分类新字段=红
- [ ] 五条三列落地（读侧全函数+NORMALIZE 单源 shared/写侧业务写拒绝/禁修复写回）；静态断言族（DOC_SCHEMA_V4 与运行时 policy 共表）；execute topology 数量断言
- [ ] G29/G32 绿→Commit。

### Task 26: reservation 状态机+GC delete-claim（G30/G31/B18/B19）
**Files:** schema.prisma 迁移四（StorageReservation 状态机列+ObjectManifest 扩状态机——最小表已 T6）；safe-remote-fetch.service.ts:91-94（cap 必填参数化）；media-gc.service.ts:113-194（claim 化）；storage-quota.service.ts
- [ ] 先红：①lease 过期但 provider/UNKNOWN 在飞→reservation 被释放（oversale）=红②GC 扫描与新引用交错误删=红③付款后超 cap 删已付产物=红
- [ ] StorageReservation 状态机（operationId 唯一+state+leaseUntil——终态 NO_SUBMIT/CANCELED/FAILED 赢得后条件 release；**upperBoundBytes=必填参数传入 fetch/materialize（无值 fail-closed；grep 清零全局 env 兜底）**；付款后超 cap=持久失败+精确退款；套餐降级不压缩既有）；ObjectManifest staged/committed/delete-claimed/deleted——GC PG 条件事务 claim+引用创建/finalize/重试 put 核验尊重 claim+在飞 PUT 排空或版本 fence+晚到补偿；重复 confirm 零副作用；G31 改有界 orphan
- [ ] B18/B19 全组绿→Commit。

### Task 27: 客户端增量投影+规模化（G33/G33b/B20 部分）
**Files:** canvasCollabRuntime.ts:1958-1990,:1308-1358（增量）；不变量检查迁移；provider/ws 压缩或 HTTP seed（T0 spike④ 选型实现）
- [ ] 先红：远端单节点变更触发全量 setState（性能断言：changed-node patch 计数）=红；10k/8MiB 冷开>3s（基准红——记录基线）
- [ ] **增量投影 observer 挂点**：`doc.getMap('nodes').observeDeep`（YEvent path[0]=nodeId）+edges/exec **各自单独 observer**；只 patch 变更（未变保引用；结构变更才 reconcile）；不变量检查出热路径（采样/批量/worker）；**传输形态=T0 spike④ 实测选定**；**规模化双轴拆分**：服务端 doc 10k 节点（结构/装载轴）vs 可见渲染节点 ≤N（DOM 轴——viewport culling，不承诺 10k DOM P99≤50ms）；双负载验收（10k 短节点+8MiB 混合+10 连接真实并发——均按可见节点口径）
- [ ] G33/G33b 绿→**-3 出口=用户确认点⑥**→Commit。

## 批末：发布（T28）

### Task 28: v4 发布单元（B20/发布门——dev/test 诚实登记）
**Files:** docShape.ts（docSchema=4 置位——批末一次性）；deploy.sh:134-159+gate-decision.mjs:15-35；collab-ops-runbook.md
- [ ] 先红：gate 判据不含 storeInFlight/stranded 阻断=红；deploy 在旧消费者在线时 reset=红（顺序断言）
- [ ] docSchema→4+CANVAS_DOC_SCHEMA_VERSION 同刻；破坏性发布流程（外层维护关写→严格 drain 六元组→**停全部旧 api/worker DB 消费者**→allowlist 测试 reset/schema deploy→部署→种子/准入/投影就绪检查→启动 worker→开放写）；gate 扩 storeInFlight+stranded 阻断+无法观测=阻断；两浏览器换代+多标签 IDB blocked+kill 每 stage 演练+B20 双负载实弹+**reset 恢复路径演练**（B3 形态：旧 client 全量上行重连——内容根 ACCEPT/exec 从 PG 派生断言）；**耐久性=诚实登记不做门**：本批=dev/test（RPO=24h 已知限制+单机拓扑不声称 HA）；**T29=独立生产前置批**（charter stub=T5：owner/date 待定+四验收——PITR RPO≤5min/RTO≤30min+MinIO 版本化 RPO≤15min+季度 restore drill+每小时 replay canary〔snapshot+updates 重放 fresh doc，semanticEqual/SV 对比，不一致告警并冻结 compact〕+doc_append_gap_total 告警）——**T29 未绿不得生产发布**
- [ ] 发布门全绿→**全批终出口=用户确认点⑦（证据汇编呈报）**→Commit。

---

## 执行顺序与关键路径

- Phase 0（立即）：T0（4 spike+census ①-⑥）→T1/T2（T2 连同类型+读点）→T3/T4（树形/双出口/transform/zero-yjs）→T5（DraftEnvelope/CanvasReadModel/nodeId/slot/paramsHash/RPO-RTO/charter stub）。
- **Phase 0.5：八项 go/no-go（硬门）——T6 不得在结论前开工；②③④⑥任一失败→T16/T19/T20/T22 对应任务先改再写码。**
- -1a：T6→T7→T8；T9/T10/T11 在 T6/T7 后并行（T11 依赖 T7/T10）。
- -2a：T12（transform 已 T4）→**T14 先行**（容器创建规则+incarnation 权威源）→T13（XmlFragment 消费容器规则+Phase 0.5⑦ 结论）→T15→T15b。
- -1b：T16→T17；T18/T19 并行（T19 依赖 T6 最小 ObjectManifest+Phase 0.5②④）。
- -2b：T20→T21/T22/T23（T21/T22 在 T19 后并行——T21 经 shadow doc）。
- -3：T24/T26 依赖 T21/T22；T25/T27；T28。T29 独立批。
- 执行门不变：T10 世代切换首次真跑前单独请用户确认；每阶段出口用户确认点①-⑦；迁移×4（T6→T20→T23→T26）顺序执行不并行。

## §0 执行期偏离登记（滚动）

| # | 偏离 | 卡 | 依据 |
|---|---|---|---|
| 16 | G17 拆 G17a（-2a 写路径守卫）/G17b（-1b FrameGate DENY）——spec §6 阶段表依赖倒置修正 | T14/T16 | 第四轮终裁 P0-7 |
| 17 | DraftEnvelope/CanvasReadModel 类型前移 T5 冻结 | T5/T15/T18 | 同上 |
| 18 | inputSnapshot 扩列进 T6+受理冻结进 T12（+paramsHash） | T6/T12/T20 | 第四轮终裁 P0-5 |
| 19 | provenance 表形加 batchId/updateHash（v4-7「区间命中」表形扩展；授权语义 v1.2 再收——见 27） | T6/T16 | 第四轮终裁 P0-3 |
| 20 | ~~watermark=NodeExecution.projectedEventVersion per-node~~（v1.2 被 28 取代——元组形） | T20/T22 | 第四轮终裁 P0-6 |
| 21 | 单表 ExecutionOutbox——ArtifactProjection 显式退役 | T20 | 第四轮终裁 P0-6 |
| 22 | admissionEpoch=CanvasDoc 高水位列+块分配 | T6/T10 | 第四轮终裁 P0-8（机制 v1.2 修正——见 30） |
| 23 | ~~保存屏障方案 A=no-op 帧走 beforeSync~~（v1.2 被 29 取代——协议层无元数据槽实测） | T19 | 第四轮终裁 P0-4 |
| 24 | advisory 键=hashtextextended 单源；owner/epoch 只存 CollabLease 显式传捕获值 | T6/T7 | 第四轮终裁 P0-1 |
| 25 | NodeLifecycle fence Json? 删除；先 reset 再 migrate；迁移台账×4 顺序不并行 | T6 | 第四轮终裁 P0-1/P1-13 |
| 26 | **candidate 载体=full clone/持久 shadow doc**：shard 禁作 apply 目标（缺依赖 struct 进 pendingStructs 实测）；clone 无法复用 live clientID（yjs 13.6.32「Changed the client-id」重写实测——yjs.cjs:3379-3382）；shadow=每项目第二 Y.Doc 稳定 clientID 随 authoritative update 同步（高频 exec 投影）/clone（低频 lifecycle）；provenance 记 candidate 实际 clientID——「server clientID 重启不变」作废 | T19/T21/T16 | 第五轮终裁 P0-1+B1/B4 实测 |
| 27 | **provenance 授权边界=struct 区间成员资格**（updateHash 仅 exact-replay fast path；per-struct hash 可选加固；缓存按 (pid,g) 全 clientID+代归档 GC+gauge）——整帧 hash 会 DENY 破坏性 reset 恢复帧（B3 实测：client 全量上行携带旧 server structs） | T16 | 第五轮终裁 P0-2+B3 实测 |
| 28 | **NodeExecution=当前行表 PK(projectId,nodeId)+projectedExecSeq/projectedEventVersion 元组**（执行历史留 GenerationIntent；artifact per-slot rev；pending 行不过滤） | T20/T22 | 第五轮终裁 P0-3 |
| 29 | **保存屏障=beforeHandleMessage 拦截 Stateless+sendStateless 回执**（零 patch——esm:457 每帧 await+esm:404 实证；解析先跳 documentName varString；marker 绑 frameSeq） | T19 | 第五轮终裁 P0-4+A1/A2 实测 |
| 30 | **admissionEpoch=懒 per-project 块分配**（块≥1e6；80% 消耗 PG 预留先于越界；PG 不可用 fail-closed）——全局租约行无项目上下文（CollabLease 单行实证） | T10 | 第五轮终裁 P0-5+C6 实测 |
| 31 | **T6 表形三修**：DocWriteAudit/ObjectManifest/MaintenanceOperation 补全字段（空 model=P1012 红实测）；删 CanvasDoc 侧子表列表（单侧 relation 红实测）；CanvasProject 补全部 opposite | T6 | 第五轮终裁 P0-6+C8 实弹 |
| 32 | **ExecutionOutbox 唯一键加 generation+businessKey**（旧代行 dedup 新代重投影/NULL intentRowId 不去重） | T20 | 第五轮终裁 P0-7 |
| 33 | **T17 B5=方案 A 文案+FrameApplyReceipt**（struct 数+DS 区间+clock max——尾部 DS 受损=全量应用后抛错实测形态；正文与验收同口径） | T17 | 第五轮终裁 P0-8+B2 实测 |
| 34 | **LifecycleIndex**（edgesByNode/mediaRefsByNode T19 专用轻量索引——incident-edge 反查现役 O(E) 全扫×3 处实证） | T19 | 第五轮终裁 P0-9+C3 实测 |
| 35 | **Phase 0.5 升级 go/no-go 硬门（八项含⑦PromptInput Y.Text⑧incarnation 权威源）**+P1×15 落卡：帧字节精确 copy（lib0 subarray 越界读实测→T16）；G17a 真调用面=fillDoc live 误用守卫（不发明 replaceNodeContainer）；T2 连带 TextNodeData.prompt 类型+:31 读点（string 消费实证）；T9 compact 移 COLLAB_ROLE worker 进程+purgeBelowSeq 持久水位；transformV3ToV4Draft 前移 T4；4411 进 shared collab-close-code.ts 注册链；T23 MaterializeRun/RefundObligation 字段清单；T24 加 video-work-clone:33 服务端读者（template.service 当前无 doc 读——陈旧注释清理）；T3 array 语义定案（array/lww-array）；T15 条件补 stack-item-updated/redo/cleared；incarnation 权威=NodeLifecycle 最新行+genesis seed；inputSnapshot 256KB+PII；T29 charter stub | 多卡 | 第五轮终裁 P1×15+我方 4 新发现 |
| （执行期续填） | | | |

**门禁→任务映射总览**（requires 规则：任何 gate 依赖后序任务=评审红）：PC1=T3/T4/T5｜PC2=T1/T2｜PC3=T5｜G1=T6｜G2/B1(世代)=T7｜G3=T9｜G4=T7/T11｜G5/B4=T6/T7/T8｜G6-G8=T11｜G9/B2/B3=T6/T10｜G10=T10/T15b｜G11=T11｜G12/B5/B8/B9=T16/T17｜G12b/B6=T16/T18｜G13=T19｜G14=T19｜G15=T12｜G16=T13｜**G17a/B10(写路径)=T14｜G17b(对抗面)=T16**｜G18=T15b｜G19/B16=T15｜G20=T12｜G21-G22/B13=T21｜G23/B11=T19/T23｜G24/B14=T20｜G25/B12/B17=T23｜G26/B15=T22｜G27=T21｜G28=T24｜G29/G32=T25｜G30/B18=T26｜G31/B19=T26｜G33/G33b=T27｜B7=T18｜B20=T28。
