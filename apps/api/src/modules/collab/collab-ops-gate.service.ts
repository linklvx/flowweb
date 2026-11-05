// apps/api/src/modules/collab/collab-ops-gate.service.ts
// C2-1（plan Task C2-1——生产就绪收尾批，spec v5 §3 C2/R9）：OpsGate compact 门单源——三档语义+
// 两阶段读+freeze+解冻 ack+frozen_age gauge 维护面。
//
// ═══ 三档语义（红①——两行 state 组合）══════════════════════════════════════════
//   全局哨兵行 ('compact',projectId='') FROZEN → 拒（frozen-global）；
//   两行全 OPEN → open；任一行缺（<2）∨闭集外 state 值 → fail-closed；查询异常 → fail-closed。
//   fail-closed 与 frozen 同为拒（compact/vacuum 停摆方向），语义分档仅入 compact_gate_skip_total
//   {result} 闭集——冻结=刻意停（canary 证实不一致），fail-closed=接线破洞（governance 漏接/哨兵丢失）。
//
// ═══ 两阶段读 ═════════════════════════════════════════════════════════════════
//   第一面「授权读」readOpsGateCompact：非事务快速判定（消费面=repo compact ①——重放内存工作前
//   早退；api maybeCompact 与 worker tick 两触发面经 repo.compact 统一被守）。
//   第二面「发布事务内 FOR SHARE 两行校验」checkOpsGateCompactForShare：正确性承载面（与
//   fenceProject FOR SHARE 同族行锁语义）——compact ③ 发布事务首语句+vacuumReplace 前置
//   （lockProject advisory 后）：授权读 pass 后 freeze 到达（UPDATE 已提交）⇒ FOR SHARE 读见
//   FROZEN ⇒ 拒零写（红③）；反之发布事务持 FOR SHARE 未提交 ⇒ freeze UPDATE 阻塞至提交——
//   检查与冻结串行化，无「发布穿越冻结」中间态。行数≠2（IN ('',pid) 恰两行）即 fail-closed。
//   查询异常（②面）：tx 内 throw=事务中止零写（fail-closed by construction——错误逸出归调用方
//   catch 域，本函数不吞）。
//
// ═══ 锁序（与 project-lock.ts 单源序相容）════════════════════════════════════
//   advisory xact（lockProject）→ OpsGate 行（FOR SHARE/UPDATE——本文件）→ CanvasProject/CanvasDoc
//   行 → 业务行。vacuumReplace=advisory→gate→doc 行；compact ③ 发布事务无 advisory=gate→doc 行；
//   freeze=单语句 gate 行 UPDATE——与 doc 行锁无环。
//
// 形态裁定（free-function 非 @Injectable）：消费方全在 collab 域内且各持 prisma 面直构
// （repo this.prisma/poller this.prisma）——free function 接 (client|tx, ...) 与 project-lock.ts/
// project-governance.service.ts 同族先例；@Injectable 需 worker.module+collab.module 双注册+repo
// 构造器改签名（30+ 直构 spec 面破坏）不采纳。freeze 调用方=C2-2 canary fail 面（本任务建方法+红②
// 直调验证）；解冻 ack=人工通道 service 方法（HTTP 端点+runbook 操作序归 C2-3）。
import { OPS_GATE_COMPACT } from './project-governance.service';
import { collabOpsGateFrozenAge } from './collab-ops-gate.metrics';

/** 门拒档（compact_gate_skip_total{result} 闭集——红① 三档拒半边）。 */
export type OpsGateCompactReject = 'frozen-global' | 'frozen-project' | 'fail-closed';

/** 授权读结果：open=两行 OPEN 放行；拒携闭集档。 */
export type OpsGateCompactRead = { open: true } | { open: false; result: OpsGateCompactReject };

/** 读/聚合事务客户端最小结构面（$queryRaw 泛型语义锚——PrismaService/TransactionClient/stub
 *  三面可赋，与 project-lock.ts FenceTx 同族局部命名）。 */
export type OpsGateReadClient = { $queryRaw: <T = unknown>(q: TemplateStringsArray, ...values: unknown[]) => Promise<T> };

/** 解冻 ack 事务客户端（gate UPDATE+AuditLog 同事务原子——auditLog.create 面）。 */
export type OpsGateUnfreezeTx = {
  $queryRaw: <T = unknown>(q: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
  auditLog: { create(args: unknown): Promise<unknown> };
};

/** 两行 state 组合判档（IN ('',pid) 恰两行闭集校验——<2=fail-closed 红③ 兜底半边）。 */
function classifyGateRows(pid: string, rows: ReadonlyArray<{ projectId: string; state: string }>): OpsGateCompactRead {
  if (rows.length !== 2) return { open: false, result: 'fail-closed' };
  const global = rows.find((r) => r.projectId === '')?.state;
  const project = rows.find((r) => r.projectId === pid)?.state;
  if (global == null || project == null) return { open: false, result: 'fail-closed' };   // 不可达防御（IN 谓词外值）
  if (global === 'FROZEN') return { open: false, result: 'frozen-global' };
  if (project === 'FROZEN') return { open: false, result: 'frozen-project' };
  if (global !== 'OPEN' || project !== 'OPEN') return { open: false, result: 'fail-closed' };   // 闭集外值
  return { open: true };
}

/**
 * 授权读（两阶段读第一面——非事务快速判定）：plain SELECT 两行 state。查询异常→fail-closed
 * （catch 折拒——消费面 compact ① 早退零重放，不 throw 逸出污染 compact 失败告警线）。
 */
export async function readOpsGateCompact(client: OpsGateReadClient, projectId: string): Promise<OpsGateCompactRead> {
  let rows: Array<{ projectId: string; state: string }>;
  try {
    rows = await client.$queryRaw<{ projectId: string; state: string }[]>`
      SELECT "projectId", state FROM "CollabOpsGate"
      WHERE "gate" = ${OPS_GATE_COMPACT} AND "projectId" IN ('', ${projectId})`;
  } catch {
    return { open: false, result: 'fail-closed' };
  }
  return classifyGateRows(projectId, rows);
}

/**
 * 发布事务两行校验（两阶段读第二面——正确性承载）：FOR SHARE 行锁读两行（与 freeze UPDATE 互斥；
 * fenceProject FOR SHARE 同族）。行数≠2 或任一非 OPEN ⇒ {ok:false,result}——调用方拒零写返回。
 * 查询异常不吞（tx throw=事务中止零写 fail-closed by construction）。
 */
export async function checkOpsGateCompactForShare(
  tx: OpsGateReadClient,
  projectId: string,
): Promise<{ ok: true } | { ok: false; result: OpsGateCompactReject }> {
  const rows = await tx.$queryRaw<{ projectId: string; state: string }[]>`
    SELECT "projectId", state FROM "CollabOpsGate"
    WHERE "gate" = ${OPS_GATE_COMPACT} AND "projectId" IN ('', ${projectId})
    FOR SHARE`;
  const v = classifyGateRows(projectId, rows);
  return v.open ? { ok: true } : { ok: false, result: v.result };
}

/** refresh 的 gauge 最后已知值（error 路不回 0 掩盖——观测面保持最后真值，下轮 tick 重试）。 */
let lastKnownFrozenAgeSeconds = 0;

/**
 * frozen_age gauge 维护面：FROZEN 行 MIN(frozenAt) 聚合（全局 max 年龄——禁 projectId 标签）。
 * 永不 throw（观测面 best-effort——调用面=poller boot/tick/freeze 后；失败保持最后值下轮重试）。
 * FROZEN 行 frozenAt NULL（手工写库形态）被 MIN 忽略——聚合低估方向（闭集执法=freeze/unfreeze 单源）。
 */
export async function refreshOpsGateFrozenAgeGauge(client: OpsGateReadClient): Promise<number> {
  try {
    const rows = await client.$queryRaw<{ age: number }[]>`
      SELECT COALESCE(EXTRACT(EPOCH FROM (now() - MIN("frozenAt"))), 0)::float8 AS age
      FROM "CollabOpsGate" WHERE "gate" = ${OPS_GATE_COMPACT} AND "state" = 'FROZEN'`;
    lastKnownFrozenAgeSeconds = rows[0]?.age ?? 0;
  } catch {
    /* 保持最后值 */
  }
  collabOpsGateFrozenAge.set(lastKnownFrozenAgeSeconds);
  return lastKnownFrozenAgeSeconds;
}

/**
 * freeze（canary fail 面——C2-2 接线；红② 直调验证）：项目行 OPEN→FROZEN+version+1+frozenAt/
 * frozenBy/reason（unfrozenAt 清档）。幂等：已 FROZEN 0 行（重复 canary fail 不虚 bump version）。
 * 落定后 best-effort 刷 frozen_age gauge（freeze 是安全动作必须先落——观测面失败不回滚冻结）。
 * 行缺（governance 破洞）0 行返回 frozen:false——该形态 compact 本就 fail-closed（读面拒）。
 */
export async function freezeOpsGateCompact(
  client: OpsGateReadClient,
  args: { projectId: string; frozenBy: string; reason: string },
): Promise<{ frozen: boolean; version: bigint | null }> {
  const rows = await client.$queryRaw<{ version: bigint }[]>`
    UPDATE "CollabOpsGate" SET "state" = 'FROZEN', "version" = "version" + 1, "frozenAt" = now(),
      "frozenBy" = ${args.frozenBy}, "reason" = ${args.reason}, "unfrozenAt" = NULL
    WHERE "gate" = ${OPS_GATE_COMPACT} AND "projectId" = ${args.projectId} AND "state" = 'OPEN'
    RETURNING "version"`;
  const out = rows.length > 0 ? { frozen: true, version: rows[0]!.version } : { frozen: false, version: null };
  await refreshOpsGateFrozenAgeGauge(client).catch(() => undefined);
  return out;
}

/**
 * 解冻 ack（人工通道——spec v5 R9「人工 ack」；HTTP 端点+runbook §14 操作序归 C2-3）：FROZEN→OPEN+
 * unfrozenAt+version+1+AuditLog **同事务**落痕（ack 凭证与状态翻转原子——审计行丢=无痕解冻，drain
 * 先例的「审计旁路」不采纳：那是无状态内存动作，本处审计即 ack 本身）。幂等：已 OPEN 0 行零审计行。
 * targetType='PROJECT'（AuditTargetType 既有值——gate 行 project 维；projectId='' 全局行解冻同方法）；
 * BigInt 恒十进制字符串（JSON 落库契约纪律）。tx.auditLog.create 映射循 AuditService.buildData 先例
 * （free-function 无 DI——AuditService 注入面归 C2-3 端点接线）。
 */
export async function unfreezeOpsGateCompact(
  tx: OpsGateUnfreezeTx,
  args: { projectId: string; operatorId: string; operatorName: string; remark?: string },
): Promise<{ unfrozen: boolean; version: bigint | null }> {
  const rows = await tx.$queryRaw<{ version: bigint }[]>`
    UPDATE "CollabOpsGate" SET "state" = 'OPEN', "version" = "version" + 1, "unfrozenAt" = now()
    WHERE "gate" = ${OPS_GATE_COMPACT} AND "projectId" = ${args.projectId} AND "state" = 'FROZEN'
    RETURNING "version"`;
  if (rows.length === 0) return { unfrozen: false, version: null };
  const version = rows[0]!.version;
  await tx.auditLog.create({
    data: {
      operatorId: args.operatorId,
      operatorName: args.operatorName,
      teamId: null,
      targetType: 'PROJECT',
      targetId: args.projectId,
      action: 'collab_ops_gate_unfreeze',
      beforeValue: { state: 'FROZEN', version: (version - 1n).toString() },
      afterValue: { state: 'OPEN', version: version.toString() },
      remark: args.remark ?? null,
    },
  });
  return { unfrozen: true, version };
}
