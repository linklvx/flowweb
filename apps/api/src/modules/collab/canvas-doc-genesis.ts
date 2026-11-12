// packages/api/src/modules/collab/canvas-doc-genesis.ts
// Y1c T7 ①genesis 双路共用建头 helper（Controller 裁定 4）：项目创建同一 PG 事务内建
// 头集三件=CanvasDoc 头行+CanvasDocSnapshot(g,0,0)+RuntimeFeedCursor 行；SystemHistory
// 缺失/为零=fail-closed（读取单源=requireSystemHistory——不自动建不自动修复）。
// 消费方：ProjectService.create（POST /projects）/CanvasService.create（POST /canvases）。
// Y1c T11（快照权威切换——T7 勘误切片三既定）：CanvasDoc 旧 doc 态种子退役（两列已删；
// **禁双写**——Snapshot(g,0,0) 已是权威）；Snapshot/cursor 建行由 T9/T10 写管线与新换代
// 状态机（§6.6 SWITCHING 事务）复用本形态。
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import type { Prisma } from '@prisma/client';
import { CANVAS_DOC_SCHEMA_VERSION, collectMediaIds } from '@flowweb/shared';
import { requireSystemHistory } from './canvas-doc-head';
import { createCanvasDoc } from './canvas-doc.factory';
import { toDocLike } from './doc-like.util';

/** 种子字节 SHA-256 hex（snapshot.stateHash 单源算法——Char(64)） */
export function seedStateHash(seedState: Buffer): string {
  return createHash('sha256').update(seedState).digest('hex');
}

/** C3a-6（spec §0 水位不变量/§3.2-3）：种子 doc 是否含媒体引用（collectMediaIds 聚合单源——
 *  帧级快照 collectMediaRefsForNode 同族扫描域）。零长 buffer=Y.applyUpdate 会抛（头注），折无引用。 */
function seedContainsMediaRefs(seedState: Buffer): boolean {
  if (seedState.length === 0) return false;
  const doc = createCanvasDoc();
  try {
    Y.applyUpdate(doc, new Uint8Array(seedState));
    return collectMediaIds(toDocLike(doc)).size > 0;
  } finally {
    doc.destroy();
  }
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
  //    C3a-6（spec §3.2-3「genesis 同事务置 dirty——种子 doc 含引用时」）：种子字节唯去处=
  //    Snapshot(g,0,0)（不流经 appendBatch 投影面）——含引用种子置 dirty 修 0==0 假覆盖
  //    （否则 mediaBindingSeq=0==pgSeq 非 dirty=「已覆盖」假象，binding 永不物化且 boot 不选中）；
  //    无引用种子保持默认 false（零引用=零覆盖义务）。update={} 幂等重入不抹已置 dirty。
  const seedHasMediaRefs = seedContainsMediaRefs(seedState);
  await tx.canvasDoc.upsert({
    where: { projectId },
    create: { projectId, ...(seedHasMediaRefs ? { bindingsDirty: true } : {}) },
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
