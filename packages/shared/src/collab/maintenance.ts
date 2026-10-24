// packages/shared/src/collab/maintenance.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段——spec v5.4 §6.6 维护窗口 T10-lite+genesis）：
// MaintenanceOperation 9 主段+2 终态转移表+行级关闸/in-flight 范围契约冻结。**CONTRACT-FREEZE**——
// 类型+常量+纯函数；消费方=T27（维护执行——执行门单独请用户确认）/T12（vacuumReplace 委托单换代入口）。
// DDL（Prisma enum 非裸 string）+活跃维护 partial unique 迁移归 T7。契约测试=maintenance.spec.ts（TDD 红先行）。

// ═══ §1 阶段 11 值（9 主段+2 终态——v5.4 措辞修正）══════════════════════════════════════════

/** 九主段（次序冻结——REQUESTED→FREEZING→DRAINING→DRAINED→EXPORTING→REBUILDING→SWITCHING→VERIFYING→COMPLETED；
 *  **SWITCHING=唯一不可回退点**） */
export const MAINTENANCE_MAIN_STAGES = [
  'REQUESTED', 'FREEZING', 'DRAINING', 'DRAINED', 'EXPORTING', 'REBUILDING',
  'SWITCHING', 'VERIFYING', 'COMPLETED',
] as const;
export type MaintenanceMainStage = typeof MAINTENANCE_MAIN_STAGES[number];

/** 两终态（FAILED/ABORTED） */
export const MAINTENANCE_TERMINAL_STAGES = ['FAILED', 'ABORTED'] as const;
export type MaintenanceTerminalStage = typeof MAINTENANCE_TERMINAL_STAGES[number];

/** 全值 11 个（Prisma enum 值域——非裸 string） */
export const MAINTENANCE_STAGES = [
  ...MAINTENANCE_MAIN_STAGES, ...MAINTENANCE_TERMINAL_STAGES,
] as const;
export type MaintenanceStage = MaintenanceMainStage | MaintenanceTerminalStage;

// ═══ §2 转移表（纯函数——spec §6.6 表+图）════════════════════════════════════════════════════

/** 转移表判定（纯函数——11×11 真值表由测试手写矩阵双向冻结）：
 *  - forward 单步 ✓（主链 8 条边）；跳步 ✗；回退 ✗；自环 ✗（幂等重入是动作面语义非转移表边）
 *  - FAILED 自任意非终态 ✓（任意阶段：保持只读+告警+**人工显式 resume**——不自动恢复写；
 *    resume=操作面动作〔重开 attempt/新 operation 行〕，转移表内 FAILED 无出边）
 *  - ABORTED 仅 SWITCHING（第七段）之前 ✓（前六段 REQUESTED..REBUILDING——解冻恢复）；
 *    SWITCHING 起 ✗（**事务已提交=只许 roll-forward**；事务未提交失败=stage 留前段幂等重试）
 *  - 终态无出边：FAILED/ABORTED/COMPLETED 全 false */
export function canTransitionMaintenanceStage(from: MaintenanceStage, to: MaintenanceStage): boolean {
  /** 主段序号（终态值不在主段表→-1；cast 因入参值域=11 值超主段表 9 值） */
  const idx = (stage: MaintenanceStage): number =>
    (MAINTENANCE_MAIN_STAGES as readonly string[]).indexOf(stage);
  if (from === 'FAILED' || from === 'ABORTED' || from === 'COMPLETED') return false;   // 终态无出边
  if (to === 'FAILED') return true;                                                    // 任意非终态可 FAILED
  if (to === 'ABORTED') {
    return idx(from) < idx('SWITCHING');                                               // 仅 SWITCHING 前
  }
  const fromIdx = idx(from);
  const toIdx = idx(to);
  return fromIdx !== -1 && toIdx !== -1 && toIdx === fromIdx + 1;                      // 单步 forward 唯一通边
}

// ═══ §3 行级关闸+in-flight 范围+SWITCHING 纪律（v5.4⑯）══════════════════════════════════════

/** 行级关闸（spec §6.6 REQUESTED 行——**非 check-then-act**：先关入口再查/等 in-flight）：
 *  REQUESTED=同一 PG 事务写 MaintenanceOperation+CanvasDoc.maintenanceId+admin 鉴权+幂等键；
 *  执行受理读 CanvasDoc.maintenanceId **IS NULL** 才放行。 */
export const MAINTENANCE_ROW_GATE_CONTRACT = {
  requestedTx: 'REQUESTED=同一 PG 事务写 MaintenanceOperation+CanvasDoc.maintenanceId（行级关闸——先关入口再查/等 in-flight）',
  admissionRead: '执行受理读 CanvasDoc.maintenanceId IS NULL 才放行（非 check-then-act）',
  /** SWITCHING 单 PG 事务**只做 DB 变更**：generation++/水位重置/插 Snapshot(g,0,0)/写 stage——
   *  提交成功后由维护服务 close 4410+切 WAL namespace+解冻（close 失败无害：旧客户端重连被
   *  generation auth 拒；事务内禁 close——网络关闭非事务性） */
  switchingTx: 'SWITCHING 单 PG 事务只做 DB 变更（generation++/水位重置/插 Snapshot(g,0,0)/写 stage）',
  switchingClose: 'SWITCHING 事务提交成功后 close 4410+切 WAL namespace+解冻（事务内禁 close——网络关闭非事务性）',
  failedPolicy: 'FAILED=保持只读+告警+人工显式 resume（不自动恢复写；resume=操作面动作非转移表边）',
  vacuumDelegation: 'T12 vacuumReplace 委托本状态机（单换代入口——vacuum 只做 rebuild payload）；切代前置=无在飞执行（两入口只一个生效）',
} as const;

/** in-flight 判定范围（v5.4⑯——五面；drain 到终态或 generation fence 显式拒绝） */
export const MAINTENANCE_IN_FLIGHT_SCOPE = [
  'GenerationIntent', 'ExecutionNodePlan', 'ExecutionOutbox', 'delivery/materialize 在飞', '退款义务',
] as const;

// ═══ §4 MaintenanceOperation 行（stage 单源在本表）════════════════════════════════════════════

/** MaintenanceOperation 行（spec §6.6 DDL——`idempotencyKey String @unique`+`@@index([projectId, status])`；
 *  每阶段持久化 stage/status/attempt/leaseOwner/error——重启从 PG 读 stage 继续不猜本地文件；
 *  **stage 单源在本表**（CanvasDoc 不存 stage 副本只存 maintenanceId）；活跃维护唯一性=partial unique
 *  （一项目一活跃——migration 归 T7）；维护执行者=租约持有者；REST 控制面 admin guard） */
export interface MaintenanceOperationRow {
  maintenanceId: string;
  projectId: string;
  stage: MaintenanceStage;
  status: string;
  attempt: number;
  sourceGeneration: number;
  targetGeneration: number;
  schemaVersion: number;
  cutoffPgSeq: bigint;
  drainedAtMs?: number;
  error?: string;
  idempotencyKey: string;
  leaseOwner?: string;
  createdAtMs: number;
  updatedAtMs: number;
}
