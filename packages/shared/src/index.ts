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
// O0a-1（Spec B）：docShape 出口接入——doc 读写单源（fillDoc/readRecordsFromMaps/applyRecordToYMap/
// stripDerivedKeys）+ C0-1 类型骨架出口随本分片落地（census 守卫使命完成拆除）。
export * from './canvas/docShape';
// Y1a T1（plan v11.2 片 S0）：collab-doc-ops 出口——doc 写原语（setDocPosition/applyRecordToYMap）
// +关联类型（DocMapLike/StoredNodeRecord）自 docShape 抽离单源（零行为变更纯机械迁移）。
export * from './canvas/collab-doc-ops';
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
