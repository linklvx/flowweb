// packages/api/src/modules/collab/canvas-doc-genesis.ts
// Y1c T7 ①genesis 双路共用建头 helper（Controller 裁定 4）：项目创建同一 PG 事务内建
// 头集三件=CanvasDoc 头行+CanvasDocSnapshot(g,0,0)+RuntimeFeedCursor 行；SystemHistory
// 缺失/为零=fail-closed（读取单源=requireSystemHistory——不自动建不自动修复）。
// 消费方：ProjectService.create（POST /projects）/CanvasService.create（POST /canvases）。
// Y1c T11（快照权威切换——T7 勘误切片三既定）：CanvasDoc 旧 doc 态种子退役（两列已删；
// **禁双写**——Snapshot(g,0,0) 已是权威）；Snapshot/cursor 建行由 T9/T10 写管线与新换代
// 状态机（§6.6 SWITCHING 事务）复用本形态。
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';
import { requireSystemHistory } from './canvas-doc-head';

/** 种子字节 SHA-256 hex（snapshot.stateHash 单源算法——Char(64)） */
export function seedStateHash(seedState: Buffer): string {
  return createHash('sha256').update(seedState).digest('hex');
}

/**
 * 建头（幂等：三件均 upsert 形态——同 projectId 重入=结构性 no-op，不炸不重复）。
 * @param tx 项目创建事务（头集与项目行/Template 原子——fail-closed 抛错=整事务回滚无部分写入）
 * @param seedState Yjs update 字节（**恒 encodeStateAsUpdate 产物**——零长 buffer 旧装载
 *   `Y.applyUpdate` 会抛〔实测 Unexpected end of array〕，空 doc 编码=[0,0] 合法空 update；
 *   T11 起唯一去处=Snapshot(g,0,0).state——CanvasDoc 头行零 doc 态列）
 */
export async function ensureCanvasDocHead(tx: Prisma.TransactionClient, projectId: string, seedState: Buffer): Promise<void> {
  // ① SystemHistory fail-closed（缺失/为零=安装或 bump 纪律破坏——先于任何写）
  await requireSystemHistory(tx);

  // ② 头行：T11 纯新形态（零 doc 态列——快照权威=Snapshot；新列 vacuumEpoch/currentSnapshotRev/
  //    walCheckpointSeq/pgSeq 走 @default(0)；purgeBelowSeq/maintenanceId 可空默认 NULL）
  await tx.canvasDoc.upsert({
    where: { projectId },
    create: { projectId },
    update: {},
  });

  // ③ Snapshot(g,0,0)：state=种子字节同源；stateHash=SHA-256；跨表不变量（快照水位≤pgSeq）
  //    在 genesis 态恒真（0≤0）——运行期由快照发布事务保证（T11，非 CHECK）
  await tx.canvasDocSnapshot.upsert({
    where: { projectId_generation_snapshotRev: { projectId, generation: 0, snapshotRev: 0n } },
    create: {
      projectId,
      generation: 0,
      snapshotRev: 0n,
      stateSeq: 0n,
      state: seedState,
      stateHash: seedStateHash(seedState),
      vacuumEpoch: 0,
      schemaVersion: CANVAS_DOC_SCHEMA_VERSION,
    },
    update: {},
  });

  // ④ RuntimeFeedCursor 行（默认 0/0——T5b 冻结 upsert 契约的 genesis 插行侧；
  //    取号路径=RUNTIME_FEED_CURSOR_UPSERT_SQL ON CONFLICT，本行只初始化）
  await tx.runtimeFeedCursor.upsert({
    where: { projectId },
    create: { projectId },
    update: {},
  });
}
