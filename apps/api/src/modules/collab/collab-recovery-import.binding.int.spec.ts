// apps/api/src/modules/collab/collab-recovery-import.binding.int.spec.ts
// C3a-8（plan v3 Task C3a-8——spec 2026-11-11-foundation-batch-design.md §3.2-3 import 腿）：
// recovery import **前置独立 PG 事务置 dirty 再 apply**（apply 在内存无同事务载体，第六轮 P1-9）——
// 红测族②（真 PG）：
//   ①顺序断言：withSession → markDirty（PG 持久）→ Y.applyUpdate(origin='import')（doc update 监听器
//     实证 apply 在 markDirty 之后）；**C1 修复后 enqueue 不在 import 返回前**（归维护 flush 路径——
//     import-maintenance-coverage.int.spec 钉死）；
//   ②崩溃窗：import 返回后 dirty 已持久、rebuild 未跑（binding 缺行）——消费前 rebuild 收敛
//     （定代重放 PG 前缀→binding 有 M）；
//   ③零变更（空 commitDiff）不置 dirty（门控形态注记见文末）。
// 装置：真 PG+真 repository/rebuild；docs=Y.Doc stub（withSession 直投——import 的 doc 依赖面单点）；
// runner 假件记录调用序并真实写 dirty（生产 runner.markDirty 同式）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { rebuildCanvasDoc, serializeCanvas, CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';
import { CollabRecoveryImportService } from './collab-recovery-import.service';
import { CollabDocumentService } from './collab-document.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { BindingRebuildService } from './binding-rebuild.service';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow, FIXTURE_TEAM, FIXTURE_USER } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = '0c3a8-import-dirty';
const M = 'c3a8-import-media';
const UID = FIXTURE_USER;

/** 导入信封（imageGen 节点 data.fileId=M——canonical $yjs 形态；hash 零填充=完整性占位跳过）。 */
function envelopeOf(draftId: string) {
  const canvasDoc = rebuildCanvasDoc({
    nodes: [{ id: 'n-imp', type: 'imageGen', position: { x: 0, y: 0 }, data: { fileId: M } }],
    edges: [],
    meta: {},
  });
  const canvas = serializeCanvas(canvasDoc);
  return {
    draftId,
    projectId: PID,
    generation: 1,
    schemaVersion: CANVAS_DOC_SCHEMA_VERSION,
    historyId: 'h-c3a8',
    capturedAtMs: Date.now(),
    tabId: 'tab-c3a8',
    nodes: canvas.nodes,
    edges: canvas.edges,
    meta: {},
    hashes: { nodes: '0'.repeat(64), edges: '0'.repeat(64) },
  };
}

maybe('C3a-8：recovery import 前置 dirty + 崩溃窗 rebuild 收敛（真 PG）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as never);
  const rebuild = new BindingRebuildService(prisma as never, repo as never);

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID);
    await prisma.media.deleteMany({ where: { id: M } });
    await prisma.media.create({
      data: { id: M, userId: FIXTURE_USER, teamId: FIXTURE_TEAM, key: `c3a8/${M}`, originalName: 'm.png', mimeType: 'image/png', size: 1n, type: 'uploaded' },
    });
    await prisma.projectionBackfillState.deleteMany({ where: { projectId: PID } });
    await prisma.mediaBinding.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.create({
      data: { projectId: PID, generation: 1, schemaVersion: 3, pgSeq: 0n, walCheckpointSeq: 0n, mediaBindingSeq: 0n, bindingsDirty: false },
    });
    await ensureLeaseFixture(prisma, repo);
  });

  afterAll(async () => {
    await prisma.projectionBackfillState.deleteMany({ where: { projectId: PID } });
    await prisma.mediaBinding.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    await prisma.media.deleteMany({ where: { id: M } });
    await restoreLeaseRow(prisma);
    await cleanupProjectFixture(prisma, PID);
    await prisma.$disconnect();
  });

  it('①顺序：markDirty（PG 持久）先于 apply(origin=import)；C1 修复后 enqueue 归维护 flush（本服务不提前入队）；②崩溃窗 rebuild 收敛 binding', async () => {
    const doc = new Y.Doc();
    const calls: string[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => { calls.push(`apply:${String(origin)}`); });
    const docsStub = {
      withSession: async (_pid: string, fn: (d: Y.Doc) => unknown) => { calls.push('withSession'); return fn(doc); },
    } as unknown as CollabDocumentService;
    const runner = {
      markDirty: async (pid: string) => {
        calls.push('markDirty');
        await prisma.canvasDoc.updateMany({ where: { projectId: pid }, data: { bindingsDirty: true } });   // 生产 runner 同式
      },
      enqueue: (pid: string) => { calls.push(`enqueue:${pid}`); },
    };
    const svc = new CollabRecoveryImportService(docsStub, prisma as never, undefined, runner as never);
    const out = await svc.importEnvelope(PID, UID, envelopeOf('d-c3a8-dirty') as never);
    expect(out.dispositions.find((d) => d.nodeId === 'n-imp')?.disposition).toBe('import');
    // 顺序：withSession → markDirty → apply（apply 之后 markDirty=红）；C1 修复后**不在 import 返回前
    // enqueue**（enqueue 归 persistence 维护 flush 路径——import-maintenance-coverage.int.spec 钉死）
    expect(calls).toEqual(['withSession', 'markDirty', 'apply:import']);
    // 崩溃窗：dirty 已持久、rebuild 未跑（binding 缺行）
    const wm = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID }, select: { pgSeq: true, mediaBindingSeq: true, bindingsDirty: true } });
    expect(wm.bindingsDirty).toBe(true);
    expect(wm.pgSeq).toBe(0n);
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, mediaId: M } })).toBe(0);
    // 消费前：导入 diff 经 persistence 维护通道落 PG（无帧级投影）→ lag 形态
    await repo.appendBatch(PID, [seedRow(Y.encodeStateAsUpdate(doc), 1n)], { expectedPgSeq: 0n, newPgSeq: 1n, walCheckpointSeq: 1n });
    const lag = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID }, select: { pgSeq: true, mediaBindingSeq: true } });
    expect(lag.pgSeq).toBe(1n);
    expect(lag.mediaBindingSeq).toBe(0n);   // 导入帧未投影=水位不动
    // rebuild 收敛（消费前）：binding 有 M+dirty 清+水位推
    const r = await rebuild.rebuildProjectBindings(PID);
    expect(r).toMatchObject({ outcome: 'cleared', pgSeq: 1n });
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'n-imp', targetField: 'fileId', mediaId: M } })).toBe(1);
    expect((await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID }, select: { bindingsDirty: true } })).bindingsDirty).toBe(false);
    doc.destroy();
  }, 60_000);

  // 形态注记（C3a-8 红测族②辅助腿）：零变更 import 不置 dirty 的门控=`if (commitDiff.byteLength > 0)`——
  // canonical temp 的空 meta map 在不同 clientID 下仍产 struct（encodeStateAsUpdate 非空），「同内容重投=
  // 空 diff」在真 Yjs 形态下不可构造；本 spec 不造伪形态（门控为防御分支，生产触发面=候选与 live 零结构差异）。
});
