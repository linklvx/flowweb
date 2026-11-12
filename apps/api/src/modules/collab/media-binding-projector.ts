// apps/api/src/modules/collab/media-binding-projector.ts
// C3a-5（plan v3 Task C3a-5——spec 2026-11-11-foundation-batch-design.md §3.2-1/§3.2-2）：
// MediaBinding 帧级投影器本体——appendBatch inTx 组合闭包 SAVEPOINT 段的投影面（actor 装配=
// flushPrefixToPg；单写者纪律：bindInTx 命令面写路径 C3a-7 退役）。输入=(tx, pid, teamId,
// batchDelta 合并形态)；预检 media 行读取在投影器内（同事务 SELECT——deletionState/deletedAt/
// teamId 三判据同快照）。
//
// 预检序（spec §3.2-2 第六轮 P0-4/P0-8——逐 media 行判定，**顺序不可换**）：
//   if (!media) skip('missing');
//   if (media.teamId !== teamId) skip('cross-team');
//   if (media.deletionState === 'DELETING') writeBinding();      // 照写（忽略 deletedAt）——删除 recheck 证人
//   if (media.deletedAt != null) skipAndClearSlot('soft-deleted'); // 跳过+清该槽现存行
//   writeBinding();
// （软删先判会吞掉 DELETING 照写——DELETING 优先于软删；skip 的槽位不写→diff 清现存行=防指向
//   死 media 的永久过度保护；skipAndClearSlot 只清该 (nodeId,targetField,targetItemId) 槽现存行，
//   不删该 media 其他槽——其他 node 槽随其自身 touched/全量 rebuild 收敛。）
//
// diff 语义（spec §3.2-1——delta 值=帧边界 collectMediaRefsForNode 终态快照，非逐事件增量）：
//   null=NODE_DELETED→该 nodeId 全行删；空数组=在册零引用→全槽清；槽位值变（同槽换 mediaId）→
//   ON CONFLICT DO UPDATE（旧行条件替换）；未变更槽零 churn。写入槽位键=MediaBinding 五元组
//   （role 恒 primary 来自 MediaRef.role）。批量形态=两读（Media 预检快照+touched 节点现存行）
//   +至多两写（unnest 批 INSERT..ON CONFLICT+id 集批 DELETE）——N 槽位一轮事务落（不强制单语句）。
//
// typed error：投影内部错误（约束违约/坏数据）一律包 BindingProjectionFailedError 抛给闭包——
//   C3a-4 闭包 catch→ROLLBACK TO SAVEPOINT+updateMany 置 dirty（帧照常提交，binding 水位不进）。
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { BindingDelta } from './collab-project-actor.service';

/** 投影失败 typed error（闭包按 C3a-4 机制承接：ROLLBACK TO+dirty——spec §3.2-7 projection_failed 面）。 */
export class BindingProjectionFailedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BindingProjectionFailedError';
  }
}

/** 投影事务面（$queryRaw/$executeRaw 两原生面——advanceBindingWatermark Pick 先例，可测性窄化）。 */
type ProjectorTx = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

/** 槽位行（MediaBinding @@unique 五元组的 node 侧四元——projectId/teamId 恒投影域常量）。 */
interface SlotRow { nodeId: string; role: string; targetField: string; targetItemId: string; mediaId: string }

/** C3a-8（spec §3.2-7 write_total/skip_total 面）：投影准入跳过原因（闭集——指标 label 同源）。 */
export type BindingSkipReason = 'missing' | 'cross-team' | 'soft-deleted';

/** C3a-8：投影统计返回形（调用方**事务提交成功后**计数——rollback 不计数；written=净 upsert 行数/
 *  deleted=diff 删除行数/skipped=准入跳过槽位数）。 */
export interface ProjectionStats {
  written: number;
  deleted: number;
  skipped: Record<BindingSkipReason, number>;
}

/** 槽位键（MediaBinding @@unique 五元组单源——projector diff/rebuild stale 尾/reconcile 漂移对比同式）。 */
export const mediaBindingSlotKey = (s: { nodeId: string; role: string; targetField: string; targetItemId: string }): string =>
  `${s.nodeId}\u0000${s.role}\u0000${s.targetField}\u0000${s.targetItemId}`;

/** C3a-8（spec §3.2-2 预检序单源）：单引用准入判定——missing（行灭失）→cross-team→soft-deleted；
 *  DELETING 优先于软删（deletedAt≠null ∧ DELETING=照写、忽略软删）。调用方=projector 本体与只读
 *  reconcile 漂移检测（同一准入语义——漂移检测不得比投影更严/更松）。 */
export function admitMediaRef(
  media: { teamId: string; deletionState: string; deletedAt: Date | null } | undefined,
  teamId: string,
): BindingSkipReason | 'admitted' {
  if (!media) return 'missing';
  if (media.teamId !== teamId) return 'cross-team';
  if (media.deletionState !== 'DELETING' && media.deletedAt != null) return 'soft-deleted';
  return 'admitted';
}

const emptyStats = (): ProjectionStats => ({ written: 0, deleted: 0, skipped: { missing: 0, 'cross-team': 0, 'soft-deleted': 0 } });

/** MediaBinding 帧级投影（单事务内调用——调用方=actor 组合闭包〔C3a-5〕/rebuild〔C3a-6〕）。
 *  C3a-8：返回投影统计（调用方事务提交成功后才计数）。 */
export async function projectBindings(tx: ProjectorTx, projectId: string, teamId: string, batchDelta: BindingDelta): Promise<ProjectionStats> {
  try {
    return await project(tx, projectId, teamId, batchDelta);
  } catch (err) {
    if (err instanceof BindingProjectionFailedError) throw err;
    throw new BindingProjectionFailedError(`binding projection failed for project ${projectId}: ${(err as Error).message}`, { cause: err });
  }
}

async function project(tx: ProjectorTx, projectId: string, teamId: string, batchDelta: BindingDelta): Promise<ProjectionStats> {
  if (batchDelta.size === 0) return emptyStats();   // 空 delta=帧无 touched（C3a-4 投影跳过零开销——闭包同判直返）

  // ① touched 节点现存行（diff 基线——NODE_DELETED/空槽位集节点无 desired 槽→现存行全删；他 node 行零波及）
  const nodeIds = [...batchDelta.keys()];
  const existing = await tx.$queryRaw<Array<{ id: string; nodeId: string; mediaId: string; role: string; targetField: string; targetItemId: string }>>`
    SELECT id, "nodeId", "mediaId", role, "targetField", "targetItemId" FROM "MediaBinding"
    WHERE "projectId" = ${projectId}::text AND "nodeId" = ANY(${nodeIds}::text[])`;

  // ② desired 槽集（终态快照——同槽后写覆盖）+media 预检快照（同事务 SELECT）
  const desired = new Map<string, SlotRow>();
  const mediaIds = new Set<string>();
  for (const refs of batchDelta.values()) {
    if (refs === null) continue;   // NODE_DELETED：无 desired 槽→现存行全删（diff 自然语义）
    for (const r of refs) {
      desired.set(mediaBindingSlotKey(r), { nodeId: r.nodeId, role: r.role, targetField: r.targetField, targetItemId: r.targetItemId, mediaId: r.mediaId });
      mediaIds.add(r.mediaId);
    }
  }
  const mediaRows = mediaIds.size === 0 ? [] : await tx.$queryRaw<Array<{ id: string; teamId: string; deletionState: string; deletedAt: Date | null }>>`
    SELECT id, "teamId", "deletionState", "deletedAt" FROM "Media" WHERE id = ANY(${[...mediaIds]}::text[])`;
  const mediaById = new Map(mediaRows.map((m) => [m.id, m]));

  // ③ 预检序逐 media 行判定（顺序不可换——头注伪码）：skip 槽位不写→④ diff 清其现存行
  const writable: SlotRow[] = [];
  const skipped: Record<BindingSkipReason, number> = { missing: 0, 'cross-team': 0, 'soft-deleted': 0 };
  for (const s of desired.values()) {
    const verdict = admitMediaRef(mediaById.get(s.mediaId), teamId);
    if (verdict !== 'admitted') { skipped[verdict] += 1; continue; }
    writable.push(s);
  }

  // ④ diff：未变更槽零 churn；槽位值变=ON CONFLICT 替换（旧行条件删+新行写的等值终态）；skip/撤除槽=现存行删
  const writableKeys = new Set(writable.map(mediaBindingSlotKey));
  const deleteIds = existing.filter((r) => !writableKeys.has(mediaBindingSlotKey(r))).map((r) => r.id);
  const existingBySlot = new Map(existing.map((r) => [mediaBindingSlotKey(r), r]));
  const upserts = writable.filter((s) => existingBySlot.get(mediaBindingSlotKey(s))?.mediaId !== s.mediaId);
  if (deleteIds.length > 0) {
    await tx.$executeRaw`DELETE FROM "MediaBinding" WHERE id = ANY(${deleteIds}::text[])`;
  }
  if (upserts.length > 0) {
    await tx.$executeRaw`
      INSERT INTO "MediaBinding" (id, "mediaId", "projectId", "nodeId", "teamId", role, "targetField", "targetItemId", "createdAt")
      SELECT u.id, u."mediaId", ${projectId}::text, u."nodeId", ${teamId}::text, u.role, u."targetField", u."targetItemId", now()
      FROM unnest(
        ${upserts.map(() => randomUUID())}::text[],
        ${upserts.map((s) => s.mediaId)}::text[],
        ${upserts.map((s) => s.nodeId)}::text[],
        ${upserts.map((s) => s.role)}::text[],
        ${upserts.map((s) => s.targetField)}::text[],
        ${upserts.map((s) => s.targetItemId)}::text[]
      ) AS u(id, "mediaId", "nodeId", role, "targetField", "targetItemId")
      ON CONFLICT ("projectId", "nodeId", role, "targetField", "targetItemId") DO UPDATE SET "mediaId" = EXCLUDED."mediaId"`;
  }
  return { written: upserts.length, deleted: deleteIds.length, skipped };
}
