export { type ContentCard } from './types/models';
export { NavActionKey } from './types/nav';
export * from './types/material-library';
export * from './types/lighting.types';
export * from './types/angle3d.types';
export * from './types/subscription.types';
export { SubscriptionError } from './constants/subscription-error';
export type { SubscriptionErrorCode } from './constants/subscription-error';
export { CollabAuthReason, isTerminalReason, COLLAB_AUTH_REASONS, COLLAB_VERSION_TERMINAL_REASONS } from './constants/collab-auth-reason';
export type { CollabAuthReasonCode } from './constants/collab-auth-reason';
// Y0b-3 T0：close code 分配表（(code,reason) 双键分型单源）+客户端协议版本（精确相等协商）。
export { CollabCloseCode, resolveCloseAction, MESSAGE_TOO_BIG_TERMINAL_REASON, DOC_OVER_QUOTA_TERMINAL_REASON, DOC_VACUUMING_TERMINAL_REASON, DOC_GENERATION_STALE_TERMINAL_REASON, SS2_OVER_LIMIT_TERMINAL_REASON, TEAM_DISBANDED_TERMINAL_REASON } from './constants/collab-close-code';
// Y1c T5a：4410 三分第三档+4411/4412/4413/4406/1011-EIO reason 字面量单源（载荷类型住 collab/doc-protocol.ts）。
export { SERVER_RESTORED_TERMINAL_REASON, FRAME_MALFORMED_REASON, RESYNC_REQUIRED_REASON, MAINTENANCE_FREEZE_REASON, CLIENT_OUTDATED_REASON, WAL_FSYNC_EIO_REASON } from './constants/collab-close-code';
export type { CloseAction, CloseActionKind } from './constants/collab-close-code';
// Y0b-5 T0：退避纯函数（spec §5.2 v2.2——route 三路由分流+jitter 入参零 Math.random；T3 删 web RECOVER_BACKOFF_MS 改 import 本表单源）。
export { TRANSIENT_BACKOFF_STEPS_MS, resolveBackoffPlan } from './constants/collab-close-code';
export type { BackoffRoute, BackoffPlan } from './constants/collab-close-code';
// Y0b-5 T0（spec §5.6 冻结契约 11）：遥测白名单 12 值+detail 逐 type 受控 schema（键域唯一来源=TELEMETRY_DETAIL_SCHEMA——
// 四键白名单常量禁复活）+QuotaRejectReason 上移单源（web canvasIntents re-export）。
export { COLLAB_TELEMETRY_EVENT_TYPES, isKnownTelemetryType, sanitizeTelemetryDetail, TELEMETRY_DETAIL_SCHEMA,
         MAX_TELEMETRY_EVENTS_PER_BATCH, MAX_TELEMETRY_EVENT_BYTES, QUOTA_REJECT_REASONS } from './constants/collab-telemetry';
export type { CollabTelemetryEventType, CollabTelemetryEvent, TelemetryDetailKeySpec, QuotaRejectReason } from './constants/collab-telemetry';
export { CLIENT_PROTOCOL_VERSION, negotiateClientVersion } from './constants/collab-protocol';
// T17 质评 Minor#8：只读命令拒写节流窗单源（web 两消费面共用）
export { EDIT_COMMAND_DENY_THROTTLE_MS } from './constants/edit-gate';
export type { ClientProtocolVersion, VersionVerdict } from './constants/collab-protocol';
// Y0b-4 T1：画布配额常量+doc-status/conn-status 快照类型（T5 服务端产生/T10 客户端消费——键集逐字一致）
// +utf8Bytes 单源（web/api 两端字节量纲一致）。
export { QUOTA_DEFAULTS, DOC_STATUS_REV_SEED, FRAME_ALLOWANCE_BYTES, isCollabDocStatusPayload, isCollabConnStatusPayload } from './constants/collab-quota';
export type { CollabDocStatusPayload, CollabConnStatusPayload } from './constants/collab-quota';
export { utf8Bytes } from './utils/utf8-bytes';
export { COLLAB_READY_REASONS } from './constants/collab-ready';
export type { CollabReadyReason, CollabReadyResponse, CollabReadyPending, CollabReadyDegraded, CollabReadyWorkers, CollabReadyWorkerPresence } from './constants/collab-ready';
// Y0b-3 T7（P-L）：collab identity 配色单源——服务端 awareness 注入 user.color 与客户端消费面同源。
export { COLLAB_USER_COLORS, userColorOfUserId } from './constants/collab-identity-color';
// Y0b-2 T2（Z80/Z101/Z117①）：provider adapter 注册表+executable/ready 双谓词——api（execution/provider-adapters 再导出）
// 与 admin web（ModelsPage adapter 下拉+ready 标记）双端单源。
export { ADAPTERS, executableModel, readyModel } from './constants/provider-adapters';
export type { ProviderAdapter } from './constants/provider-adapters';
export * from './types/home.types';
export * from './types/role.types';
export * from './types/video-project';
export * from './types/video-work';
export * from './types/group';
export * from './types/stitch';
export * from './canvas/nodeEnvelope';
// O0a-1（Spec B）→Y1c T4：docShape 出口——doc 读写单源（fillDoc/stripDerivedKeys/toDocRecords/
// C0-1 类型骨架）。readRecordsFromMaps 自 Y1c T4 起收编 doc-codec 内部（唯一 import=doc-codec——
// 外部读出口=doc-codec.toReadModel；index 再导出删除，doc-shape-single-source.guard 执法）。
export { fillDoc, stripDerivedKeys, stripAuthorState, toDocRecords, normalizeSize, frameMode, isCollapsed, isValidStoredFrame,
         CANVAS_DOC_SCHEMA_VERSION, EPHEMERAL_DATA_KEYS, CANVAS_BRIDGE_KEYS, SERVER_TRANSACT_ORIGIN } from './canvas/docShape';
export type { DocLike, DocEdgeRecord, MinimalCSNode, Rect, RenderNode, DragSession, FrameMode } from './canvas/docShape';
// Y1c T4（plan v1.7）：DocCodec 双出口——serializeCanvas（canonical 备份/重建/semanticEqual）+
// toReadModel（plain JSON read model——REST/执行/导出唯一共享读类型）+toPublicReadModel（公开快照
// sanitize+URL allowlist）+rebuildCanvasDoc/semanticEqual；真 Yjs 类型直用（zero-yjs 废止）。
export * from './canvas/doc-codec';
// Y1a T1（plan v11.2 片 S0）：collab-doc-ops 出口——doc 写原语（setDocPosition/applyRecordToYMap）
// +关联类型（DocMapLike/StoredNodeRecord）自 docShape 抽离单源（零行为变更纯机械迁移）。
export * from './canvas/collab-doc-ops';
// Y1c T2（bug② 后半）：节点 data prompt 解析单源（resolvePromptText）——执行读点
// （execution.service nodeClaimPack）唯一入口：string 直读 > PromptValue.text > content 回落。
// T15 终形 prompt=Y.Map{text:Y.Text} 迁移时只改函数实现与单测，执行读点永不再改。
export * from './canvas/promptText';
// Y1c T15：Y.Text 域单源（TEXT_DOMAINS 词表自 DOC_SCHEMA_V4 派生+splice 单一 seam
// writeTextDomainValue+创建 seam materialize/ensureTextDomainDefaults+容器规则拒写词表）。
export * from './canvas/text-domains';
// Y1c T3：doc 模型 v4 全类型树形矩阵（DOC_SCHEMA_V4 8 类型+DataKeySpec 二元+META_WHITELIST）——
// spec §3.1 矩阵冻结唯一基准；键集=census ② 实测精确冻结；运行时准入 T24 激活。
export * from './canvas/doc-schema-v4';
// Y1a T3（plan v11.2 片 S0）：media 事实域出口——compareExecSeq 单源（execSeq BigInt string 化
// 比较——T9 代际围栏/T15 投影 recheck 消费前置；T8 续入 resolveUpstreamMediaUrl）。
export * from './canvas/media-fact';
// Y1a+Y1b T16：doc 媒体引用七键扫描单源（collectMediaRefs/collectMediaIds）——api
// binding-reconcile 惰性 reconcile/GC 引用图与 web pendingFacts/fileId 到达判定共用
// （DocLike 结构入参，fillDoc 同款零 yjs 纪律）。
export * from './canvas/media-refs';
// C0-2（Spec B）：geometryWriterRegistry=纯常量零依赖（写者类别+归类账本）——
// geometryTrap 写者上下文校验与 B7-1 census 引用源。assertions/C0-1 类型骨架 stub 出口仍归 O0a。
export * from './canvas/geometryWriterRegistry';
export * from './canvas/geometry';
// T17（plan v11.2 S5 片·spec Z12''/Z4''-v14/Z17''）：序域三新单源出口——单一有界 order 键域
// （自实现分数索引，禁第三方库）+placement 复合单键判别（DOC_NODE_KEYS 契约表/deriveStoryboardCells）
// +读序单源（层序遍历+同层 (order,id)/(slot,id) 双 tie-break）。sortNodesByPosition/sortForArrange
// 空间序读面收编本域（读序单实现）。
export * from './canvas/order-key';
export * from './canvas/placement';
export * from './canvas/order-records';
// T18（plan v11.2 S5 片·spec Z4''-v14）：order 域病理计数单源（soft/hard/重复键/缺键四档扫描
// 纯函数）——api 装载档挂点+CLI renumber-layer --dry-run 报告共用（禁两份判定）。
export * from './canvas/order-pathology';
// T18（Z4''-v14）：CLI renumber-layer 规划单源（按层现序带间隙整键重排——幂等；scripts/
// collab-renumber-layer.mjs 消费 dist，判定禁在 CLI 本地重实现）。
export * from './canvas/renumber-layer';
// T17（spec Z5'' 维持 v10）：applyIntrinsicFit 尺寸域收口纯函数（EXIF 5-8 display 契约/
// imageRotation 用户变换交换/分镜跳过/sizeMode/clamp）——ImageGen 内容事件消费单源。
export * from './canvas/intrinsicFit';
export * from './canvas/storyboardConfig';
// O0c-3（终裁 88②）：展开帧单源模块整删——toggleCollapse 展开档消费已随 O0b-5 单意图化消失，
// 折叠恢复唯一来源=doc 帧三键密封（reconcile 写域①）/auto 重派生 bbox。
export * from './canvas/validateParentGraph';
export * from './canvas/arrangeSelection';
export * from './canvas/copyPlan';
// O0c-2（Spec B）：第 4 渲染面唯一写者——records(abs)→RenderNode(rel+派生帧)（ProcessSnapshot/分享）。
export * from './canvas/renderCanvas';
// O0b-2（Spec B）：assertions 出口接入——六条模型断言+membership 写侧断言真实实现（C0-2 骨架
// O0b-1 转实），web 侧 applyDocToStore 尾挂消费（assertDocAbsMatchesCsRel/assertStoryboardMembership）。
export * from './canvas/assertions';
// Y0c T4（Z108/Z148①）：doc schema manifest TS 单源=执行期校验表（E38 四层+DocWriteOp 六 op 五面
// 校验——A1 DocWriter 进门/T27 端点 body 共此一口）。
export * from './canvas/canvas-doc-manifest';
// Y0c T4（E68）：不变量登记表——五条三列+现状标注（登记非执法；缺口移交 Y1c-3）。
export * from './canvas/canvas-invariants';
// B6-1（Spec B）：handle 可用性单源谓词——imageGen/imageExtGen 编辑中（含 transformMode）双侧无，
// videoGen 现状保留无门双侧；web 节点组件消费（删组件内 !editMode 直判）。
export * from './canvas/handles';
// Y0a-1（E70 最小版）：对抗 DocLike 语料工厂（FakeMap 全量嵌套——读者全函数 E68 测试消费）。
export * from './testing/adversarial-doc';
// Y1c T5a（plan v1.7）：协议契约冻结——载体/协议段（水位三元/准入链/pending 区间法/save barrier/
// WAL 段头+帧记录/ACK 三档+UI 四态+版本门/帧闸数字单源派生/版本维度表/客户端半链）+三语料
// （双端并发/WAL 故障声明式/barrier）——T8/T9/T10/T13 消费；契约测试=collab/doc-protocol.spec.ts。
export * from './collab/doc-protocol';
export * from './testing/y1c-concurrent-corpus';
export * from './testing/y1c-wal-fault-corpus';
export * from './testing/y1c-barrier-corpus';
// Y1c T5b（plan v1.7）：业务平面 DDL 契约冻结——ExecutionRequest 父子行/ExecutionInput 受理预算+
// planHash 不可变字段（§6.1）、RuntimeEvent taxonomy+RuntimeFeedCursor+锁序（§7）、FrameEffects+
// ProjectDocIndex（§6.5 解 T24↔T26 循环）、执行链五表（§6.2/§6.3）、生命周期义务 closed enum（census⑪）、
// 维护 9 主段+2 终态转移表+行级关闸（§6.6）、SystemHistory 单行权威+actorRanges+DocAuditEvent、
// Undo 策略（D6）+feed 故障语料——T7/T9/T10/T16/T21/T22/T23/T26/T27/T31 消费；契约测试=collab/*.spec.ts。
export * from './collab/execution-request';
export * from './collab/runtime-event';
export * from './collab/frame-effects';
export * from './collab/lifecycle';
export * from './collab/execution-chain';
export * from './collab/maintenance';
export * from './collab/system-history';
export * from './collab/undo-policy';
export * from './testing/y1c-feed-fault-corpus';
// Y1c T5c（plan v1.7 Task 5 客户端/恢复段）：客户端/恢复契约冻结——DraftEnvelope 类型+三场景表
// （B=用户裁定式，§4.5）、4410/4411/4412/4413/4406 恢复动作+重复 DENY 逃生口+historyId 半链消费
// （§8.1）、saved 四态驱动（§4.2）、RuntimeProjection 契约+mergeRuntimeProjection 唯一 merge+
// composeRenderModel+四读径+Runtime Store 离线语义（§6.4/§7）、XML_ELEMENTS/MARKS/ATTRS 单表
// （§3.2 L1——PromptInput PM schema 实测派生+web parity setEqual 执法锚）、T19 census 形态
// （read-model-census.json）——T10/T16/T19/T22/T24/T25 消费；契约测试=collab/*.spec.ts。
export * from './collab/draft-envelope';
export * from './collab/recovery-flow';
export * from './collab/save-driver';
export * from './collab/runtime-projection';
// Y1c T16：xml-schema 单表+L1 扫描器自 collab/ 迁 canvas/ 同族（Controller 指令——非冻结区；
// 与 text-domains/doc-schema-v4 同族——XML 域词表/L1 扫描共用 DOC_SCHEMA_V4 单源）。
export * from './canvas/xml-schema';
// Y1c T24：DENY 矩阵 frame-local/L2 事件级执法+NORMALIZE 读侧屏蔽词表+origin 枚举分类器
// （frame-deny/graph-normalize/doc-update-origin——xml-schema 同族非冻结区，DOC_SCHEMA_V4 单源）。
export * from './canvas/frame-deny';
export * from './canvas/graph-normalize';
export * from './canvas/doc-update-origin';
// Y1c T17：媒体列表 Y.Array 域单源（allImages/images——text/xml-domains 同族第三域；
// 词表自 DOC_SCHEMA_V4 派生+创建/写 seam+稳定 id 结构操作 diff——canvasIntents/canvasStore 消费）。
export * from './canvas/array-domains';
export * from './collab/read-model-census';
