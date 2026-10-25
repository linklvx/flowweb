// packages/api/src/modules/collab/canvas-doc-head.ts
// Y1c T7 ②缺头三态：载体头行读取面（T8/T10/T11 消费的统一入口）。
// 契约：读 CanvasDoc/RuntimeFeedCursor/SystemHistory 头行的代码路径必须三分
// 「行存在/行缺失/值为零」——缺失=fail-closed 显式分支，**禁 `?? 0` 兜底静默默认**
// （值为零是合法态：genesis 初态全部水位 0——missing 与 zero 混同=静默谎话水位）。
// 真源：spec §4.4/§5.1（水位拆义）+§6.6（maintenanceId 行级关闸）+勘误（方案 B 过渡形态）。
import type { Prisma } from '@prisma/client';

/** 头行查找结果（判别 union——missing 无伪造行） */
export type HeadLookup<Row> = { status: 'found'; row: Row } | { status: 'missing' };

/** CanvasDoc 头行投影（v1.7 载体列——旧平面 state 列族与增量尾不在本读面：装载单源=canvas-doc-update.repository） */
export interface CanvasDocHeadRow {
  projectId: string;
  generation: number;
  schemaVersion: number;
  vacuumEpoch: number;
  currentSnapshotRev: bigint;
  walCheckpointSeq: bigint;
  /** 对外唯一「已保存」水位（spec §5.1）——wire/JSON 序列化恒 String()（BigInt 纪律） */
  pgSeq: bigint;
  purgeBelowSeq: bigint | null;
  /** 行级关闸（§6.6——执行受理读 IS NULL 才放行；stage 单源在 MaintenanceOperation） */
  maintenanceId: string | null;
}

/** RuntimeFeedCursor 行（T5b 冻结 RuntimeFeedCursorRow 同形——lastSeq/minRetainedSeq wire 恒 String()） */
export interface RuntimeFeedCursorHeadRow {
  projectId: string;
  lastSeq: bigint;
  minRetainedSeq: bigint;
}

const HEAD_SELECT = {
  projectId: true, generation: true, schemaVersion: true, vacuumEpoch: true,
  currentSnapshotRev: true, walCheckpointSeq: true, pgSeq: true,
  purgeBelowSeq: true, maintenanceId: true,
} as const;

/** 三态读（不抛）：missing/发现由调用方显式分派 */
export async function readCanvasDocHead(db: Prisma.TransactionClient, projectId: string): Promise<HeadLookup<CanvasDocHeadRow>> {
  const row = await db.canvasDoc.findUnique({ where: { projectId }, select: HEAD_SELECT });
  return row == null ? { status: 'missing' } : { status: 'found', row };
}

export async function readRuntimeFeedCursor(db: Prisma.TransactionClient, projectId: string): Promise<HeadLookup<RuntimeFeedCursorHeadRow>> {
  const row = await db.runtimeFeedCursor.findUnique({
    where: { projectId },
    select: { projectId: true, lastSeq: true, minRetainedSeq: true },
  });
  return row == null ? { status: 'missing' } : { status: 'found', row };
}

/** fail-closed 消费面（缺头=载体未初始化——显式 throw，非静默默认零水位） */
export async function requireCanvasDocHead(db: Prisma.TransactionClient, projectId: string): Promise<CanvasDocHeadRow> {
  const r = await readCanvasDocHead(db, projectId);
  if (r.status === 'missing') {
    throw Object.assign(
      new Error(`CanvasDoc 头行缺失（projectId=${projectId}——缺头三态 fail-closed：不伪造零水位，genesis 修复=重建头集）`),
      { canvasDocHeadMissing: true },
    );
  }
  return r.row;
}

export async function requireRuntimeFeedCursor(db: Prisma.TransactionClient, projectId: string): Promise<RuntimeFeedCursorHeadRow> {
  const r = await readRuntimeFeedCursor(db, projectId);
  if (r.status === 'missing') {
    throw Object.assign(
      new Error(`RuntimeFeedCursor 行缺失（projectId=${projectId}——feed 平面未初始化，禁默认 lastSeq=0 静默续读）`),
      { runtimeFeedCursorMissing: true },
    );
  }
  return r.row;
}

/** SystemHistory 全局单行权威 fail-closed 读（spec §4.4⑦勘误+Controller 裁定 3 语义）：
 *  行缺失/historyId 为零值（"0"/空串）=安装或 bump 纪律破坏——**不自动建不自动修复**
 *  （启动校验语义同源；`--adopt-wal` 窄窗=historyId 已匹配+operator 显式确认+审计，非本路径）。
 *  Y1c T13（G6a）：补 epochStartedAtMs——recoverScan 时间戳栅栏求值基准（F-S4-5 入口一次性快照
 *  契约 SystemHistoryState 两字段单源）；epochStartedAt 缺失/零值同 fail-closed（缺头三态纪律——
 *  「零值 epoch+段比 epoch 新恒真」会使时间戳栅栏语义失真，禁 `?? 0` 静默默认）。 */
export async function requireSystemHistory(db: Prisma.TransactionClient): Promise<{ historyId: string; epochStartedAtMs: number }> {
  const row = await db.systemHistory.findUnique({ where: { id: 1 }, select: { historyId: true, epochStartedAt: true } });
  if (row == null || row.historyId === '0' || row.historyId === '') {
    throw Object.assign(
      new Error('SystemHistory 缺失或为零（id=1 全局单行权威——fail-closed 不自动建不自动修复；修复=迁移引导行/restore 工具收尾 bump）'),
      { systemHistoryMissing: true },
    );
  }
  const epochStartedAtMs = row.epochStartedAt instanceof Date ? row.epochStartedAt.getTime() : 0;
  if (!Number.isFinite(epochStartedAtMs) || epochStartedAtMs <= 0) {
    throw Object.assign(
      new Error('SystemHistory.epochStartedAt 缺失或为零（时间戳栅栏求值基准失真——fail-closed 拒启动；修复=restore 工具收尾 bump 重置纪元）'),
      { systemHistoryMissing: true },
    );
  }
  return { historyId: row.historyId, epochStartedAtMs };
}
