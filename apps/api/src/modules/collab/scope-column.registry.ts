// apps/api/src/modules/collab/scope-column.registry.ts
// C4-b（plan Task C4-2——生产就绪收尾批·project-erasure）：写路径 census=schema 闭包+scope-alias-registry 单源。
// **新增表/列未登记=CI 红**（scripts/check-collab-census.mjs ㊲——schema.prisma 解析闭包 vs 本 registry diff：
// schema 模型含 projectId/teamId 列而不在清单=红；registry 条目在 schema 无对应模型/列=stale 红）。
//
// 闭包语义（R15 fence census 的数据面）：
//  - 字面列闭包：含 `projectId`/`teamId` 列的模型全集（列名扫描可达面）；
//  - 别名登记：引用 CanvasProject/桥表但列名不含 projectId 的关联列（plan ㉓ 五项+grep 补全——
//    ExecutionNodePlan.requestId 经 ExecutionRequest 桥、AuditLog.targetId 经 targetType 谓词等）。
//
// ═══ fence 接线分档（census 清单 → 写点处置——非全量 fence，按写面性质三档）═══════════════
//  A 档·in-tx fence（写事务首句 lockProject→fenceProject / lockScope→fenceTeam）：
//    画布载体族（appendBatch/vacuumReplace/compact 发布/maintenance 关闸/genesis 创建）、admit 受理、
//    intent claim、项目改名/成员写、VideoProject CRUD（workflowId 别名维）——用户内容写面。
//  B 档·入口边界门（HTTP 层 TeamGuard/perm.resolve 链——读路径过滤 Proxy 先行 404）：team 维资金/成员
//    面已由 C4-a 红⑥-a 全路径拦截（DISBANDING 403）+claimTx Z26 in-tx Team FOR SHARE；不逐资金
//    事务加 lockScope（ledger 单写者纪律独立——加锁改变资金域串行化面）。
//    **C4-c1 资金域 gate 评审裁定（2026-11-05，钉死「登记 C4-c 评审后定」悬项）=不入 A 档/gate**，实证：
//    ①tombstone 后入口门已拒新写——claim 事务首句 Team FOR SHARE ∧ status≠ACTIVE 拒
//    （generation-intent.service.ts :154-155，DISBANDING 含）；admit 事务 lockProject→fenceProject
//    （execution-request.service.ts :437-441，DELETING 拒——C4-b 接线）；②资金行=allowlist 计费行保留
//    （PURGING_DB：GenerationIntent 只 scrub 内容列〔resultText/gestureKey/resultRef→null〕计费列原样、
//    ExecutionRequest 整行保留——project-erasure.stages.ts allowlist 单源）；③ledger 单写者纪律不变
//    ——ledger_guard 触发器仅辖 TeamBalance/TeamCreditTransaction（迁移 20261009140100 :1433-1436），
//    project 维擦除零触碰该两表；team 维删 Team 行走 ledgerTx 通行证（poller 会合分支既有）；
//    ④请求侧资金门（TeamFundsGateService.assertSettled 扩查三面——C4-a）保证擦除开始时资金已清算。
//  C 档·scope 扫除面（不 fence——行集由 erasure worker 按 scope 批删/C4-c 列级断言核销）：执行完成面
//    （NodeExecution/ExecutionOutbox/MaterializeRun/DeliveryFence/NodeLifecycle 在飞完成写）、feed 面
//    （RuntimeEvent/RuntimeFeedCursor——observability 7d retention+sweeper join ACTIVE）、retention/canary
//    面（CanaryPin/CollabCanaryCursor——擦除跳过面）。在飞完成写落行后随 scope 批删=零残留由 C4-c 断言承载。
import { registerGuardedWriteModels } from './project-lock';

/** 字面 projectId 列模型闭包（CI ㊲ diff 面。CanvasProject 自身=fence 行本体非引用列——id 即键，
 *  写点分档注释见 GUARDED_WRITE_MODELS）。 */
export const PROJECT_COLUMN_MODELS = [
  'Template',
  'Media',
  'LightingTask',
  'CanvasDoc',
  'RuntimeFeedCursor',   // C 档（feed 面）
  'CanvasDocSnapshot',
  'DocAuditEvent',
  'MaintenanceOperation',
  'ExecutionRequest',
  'RuntimeEvent',   // C 档（feed 面）
  'NodeExecution',   // C 档（执行完成面）
  'ExecutionOutbox',   // C 档
  'MaterializeRun',   // C 档
  'NodeLifecycle',   // C 档
  'DeliveryFence',   // C 档
  'LifecycleObligation',   // C 档（sweeper——擦除跳过面归 C4-c）
  'ProjectMember',
  'CanvasDocUpdate',
  'CanvasDocCoalesced',
  'GenerationIntent',
  'NodeArtifact',   // C 档（产物权威——C4-c 引用图消费）
  'ArtifactProjection',   // C 档
  'MediaBinding',   // C 档（C4-c 引用图消费）
  'MediaFactOutbox',   // C 档（C2-4 断流暂留——表/模型本体暂留至 C1 物删：㊲ 门=schema 双向 diff，除名须与模型删除同批〔提前除名=census 持续红〕；erasure 批删/断言由本 registry 驱动，条目在=擦除项目仍清该表残留行）
  'CanaryPin',   // C 档（canary 面）
  'CollabCanaryCursor',   // C 档
  'CollabOpsGate',   // C 档（compact 哨兵行——A 档发布事务带 gate FOR SHARE；擦除归 C4-c）
  'ProjectionBackfillState',   // C 档（C3a-2 backfill 持久状态行——projectId @id 独立状态行无 FK〔spec §0
  //   钉形〕，项目删除清行=本 registry 批删承载；零写点期=空集批删幂等，runner 写点归 C3a-8）
] as const;

/** 字面 teamId 列模型闭包（同 CI ㊲ diff 面。Team 自身=fence 行本体非引用列）。 */
export const TEAM_COLUMN_MODELS = [
  'Template',
  'CanvasProject',
  'Folder',
  'Media',
  'MaterialFolder',
  'LightingTask',
  'VideoTrimTask',
  'VideoSeparateTask',
  'VideoProject',
  'AuditLog',
  'TeamMember',
  'TeamBalance',
  'TeamCreditTransaction',
  'TeamSubscription',
  'TeamRechargeOrder',
  'TeamJoinRequest',
  'ExecutionRequest',
  'StorageReservation',
  'GenerationIntent',
  'NodeArtifact',
  'MediaBinding',
  'ProjectErasureRun',   // teamId 冗余索引列（team run→子 run 会合查询面）
] as const;

/** 别名列（列名扫描找不到的项目关联列——plan ㉓：registry 与 schema 列存在性 CI diff；
 *  via=关联路径（直 FK/桥表/谓词），C4-c 介质 manifest/列级断言消费面）。 */
export const PROJECT_SCOPE_ALIASES = [
  { model: 'VideoProject', column: 'workflowId', via: 'CanvasProject.id（FK Cascade schema :493）' },
  { model: 'VideoWork', column: 'canvasProjectId', via: 'CanvasProject.id（可空——C4-c worker detach 置 NULL）' },
  { model: 'VideoTrimTask', column: 'workflowId', via: 'CanvasProject.id（无 FK 纯列——video-trim.service :94 derivedWorkflowId=media.projectId??workflowId 实证）' },
  { model: 'VideoSeparateTask', column: 'workflowId', via: 'CanvasProject.id（无 FK 纯列——video-separate.service :81 同族）' },
  { model: 'ExecutionNodePlan', column: 'requestId', via: 'ExecutionRequest.id 桥→projectId（@@id 键成员）' },
  { model: 'ExecutionInput', column: 'requestId', via: 'ExecutionRequest.id 桥→projectId（@id）' },
  { model: 'RefundObligation', column: 'intentRowId', via: 'GenerationIntent.id 桥→projectId' },
  { model: 'ReconcileAction', column: 'intentRowId', via: 'GenerationIntent.id 桥→projectId' },
  { model: 'AuditLog', column: 'targetId', via: '谓词 targetType∈{PROJECT,PROJECT_MEMBER}（㉒ C4-c 擦除谓词——targetId 多态列）' },
] as const;

/** 写锁门禁 registry 填充清单（C1-0 机制·本卡填——**登记=该模型全部 delegate 写点已 A 档接线**：
 *  测试态无锁写入抛 WriteLockRequiredError。closure≠gate：C 档模型与「资金/完成面多写点模型」
 *  （ExecutionRequest 族经 team-credit void/settle、GenerationIntent 经 finalize/reconcile 族——
 *  写点横跨资金域 ledger 纪律）不入 gate（登记即要求全部写点加锁=改资金域串行化面）——
 *  **C4-c1 资金域评审裁定（2026-11-05）=维持不入**：tombstone 后入口门已拒新写（claim Team FOR SHARE
 *  generation-intent.service :154/admit fenceProject execution-request.service :441）+擦除侧资金行
 *  =allowlist 计费行保留（stages allowlist）+ledger_guard 仅辖 TeamBalance/TeamCreditTransaction
 *  （project 维零触碰）——见上方 B 档注释四点实证；
 *  raw SQL 写点（$executeRaw）不经 delegate=门禁不可见（fence 正确性由行锁承担，census 为覆盖检查）。
 *  新模型接 A 档 fence 时同批登记此处+接线写点。 */
export const GUARDED_WRITE_MODELS = [
  'CanvasProject',   // 创建两路径/delete/updateName/tombstone（openProjectErasure）——本卡全 A 档
  'CanvasDoc',   // appendBatch 水位/vacuumReplace/maintenance 关闸与终态推进/genesis 创建
  'CanvasDocUpdate',   // appendBatch/vacuumReplace/compact（prune/purge=DELETE 豁免面）
  'CanvasDocSnapshot',   // vacuumReplace/compact/genesis
  'CanvasDocCoalesced',   // appendBatch 吞行侧表
  'MaintenanceOperation',   // maintenance 请求/终态推进事务
  'DocAuditEvent',   // admit 受理/maintenance audit 族（export 单点同批接线）
  'ProjectMember',   // 成员授予/改角/移除
  'VideoProject',   // workflowId 别名维 CRUD（upsert/patch/delete）
] as const;

/** 门禁填充（PrismaService 构造器消费——幂等 Set.add；仅测试态生效——writeGateActive 判据单源）。
 *  键形转换：Prisma delegate 属性名=camelCase（canvasDocUpdate），registry 清单=PascalCase 模型名
 *  （与 schema 闭包同域）——fill 处单点转换。 */
export function fillWriteGateRegistry(): void {
  registerGuardedWriteModels(GUARDED_WRITE_MODELS.map((m) => m[0]!.toLowerCase() + m.slice(1)));
}
