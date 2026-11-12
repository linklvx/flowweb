// apps/api/src/modules/media-delivery/binding-reconcile.int.spec.ts —— C3a-8（plan v3 Task C3a-8：
// spec 2026-11-11-foundation-batch-design.md §3.2-3/§3.2-7）：MediaBinding **只读漂移检测** 真 PG 红测。
// 语义变更（Y1a+Y1b T16 的 current-state upsert 写面退役）：doc 真值=PG 定代前缀（readRebuildAnchor+
// loadForHydrationAt，**禁活 doc**）；发现面=CanvasDoc 全表；漂移→置 dirty+入队 rebuild（零 MediaBinding
// 写）。族：
//   ①missing 漂移（doc 引用缺行）→drift_total{missing} 计数+dirty+enqueue，binding 行零变化（只读）；
//   ②mismatch+extra（同槽异 mediaId / 行无引用）→分类计数；行集前后逐字不变（本服务零删改）；
//   ③零漂移（rebuild 收敛后）→dirtyMarked=false+零 enqueue；读面无写；
//   ④项目/文档行缺失→跳过（ok=false，不抛）；
//   ⑤发现面=CanvasDoc 全表（含干净项目——游标轮转）——漂移可能在「水位齐」项目（手工删行）。
// 装置：真 PG+真 repository（定代读取）+假 runner（仅断 enqueue 调用）；doc 帧经 appendBatch 真落帙。
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { register } from 'prom-client';
import * as Y from 'yjs';
import { CanvasDocUpdateRepository } from '../collab/canvas-doc-update.repository';
import { BindingRebuildService } from '../collab/binding-rebuild.service';
import { BindingReconcileService } from './binding-reconcile.service';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow, FIXTURE_TEAM, FIXTURE_USER } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
// 前缀 '0' 排序最前（全表发现游标首页必含——dev 库残留项目不干扰断言）
const PID = '0c3a8-reconcile-int';
const PID_CLEAN = '0c3a8-reconcile-clean';
const M1 = 'c3a8-rec-media-1';
const M2 = 'c3a8-rec-media-2';

/** 媒体引用帧（nodeId + data.fileId）。 */
const mediaFrame = (nodeId: string, mediaId: string): Uint8Array => {
  const d = new Y.Doc();
  const node = new Y.Map<unknown>();
  const data = new Y.Map<unknown>();
  data.set('fileId', mediaId);
  node.set('type', 'image');
  node.set('data', data);
  (d.getMap('nodes') as Y.Map<unknown>).set(nodeId, node);
  return Y.encodeStateAsUpdate(d);
};

async function metricDelta(name: string, kind: string, fn: () => Promise<void>): Promise<number> {
  const metric = register.getSingleMetric(name) as { get(): Promise<{ values: Array<{ labels: Record<string, string>; value: number }> }> };
  const val = async () => (await metric.get()).values.find((v) => v.labels.kind === kind)?.value ?? 0;
  const before = await val();
  await fn();
  return (await val()) - before;
}

maybe('C3a-8：MediaBinding 只读漂移检测（真 PG——零 MediaBinding 写）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as never);
  const rebuild = new BindingRebuildService(prisma as never, repo as never);
  const enqueue = vi.fn();
  const svc = new BindingReconcileService(prisma as never, repo as never, { enqueue } as never);

  const rowsOf = () => prisma.mediaBinding.findMany({ where: { projectId: PID }, orderBy: { nodeId: 'asc' } });
  const docState = async (pid = PID) => prisma.canvasDoc.findUnique({ where: { projectId: pid }, select: { pgSeq: true, mediaBindingSeq: true, bindingsDirty: true } });

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID);
    await ensureProjectFixture(prisma, PID_CLEAN);
    await prisma.media.deleteMany({ where: { id: { in: [M1, M2] } } });
    for (const id of [M1, M2]) {
      await prisma.media.create({
        data: { id, userId: FIXTURE_USER, teamId: FIXTURE_TEAM, key: `c3a8/${id}`, originalName: `${id}.png`, mimeType: 'image/png', size: 1n, type: 'uploaded' },
      });
    }
    await prisma.$transaction([
      prisma.mediaBinding.deleteMany({ where: { projectId: PID } }),
      prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } }),
      prisma.canvasDocSnapshot.deleteMany({ where: { projectId: PID } }),
      prisma.canvasDoc.deleteMany({ where: { projectId: PID } }),
    ]);
    await prisma.canvasDoc.create({
      data: { projectId: PID, generation: 1, schemaVersion: 3, pgSeq: 0n, walCheckpointSeq: 0n, mediaBindingSeq: 0n, bindingsDirty: false },
    });
    // doc@pgSeq=10：含 node n1→M1（无帧级投影——lag 形态：mediaBindingSeq 留 0）
    await ensureLeaseFixture(prisma, repo);
    const r = await repo.appendBatch(PID, [seedRow(mediaFrame('n1', M1), 10n)], { expectedPgSeq: 0n, newPgSeq: 10n, walCheckpointSeq: 10n });
    expect(r.ok).toBe(true);
    // 干净项目行（发现面扩全表断言用）
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID_CLEAN } });
    await prisma.canvasDoc.create({
      data: { projectId: PID_CLEAN, generation: 1, schemaVersion: 3, pgSeq: 0n, walCheckpointSeq: 0n, mediaBindingSeq: 0n, bindingsDirty: false },
    });
  });

  beforeEach(() => { enqueue.mockClear(); });

  afterAll(async () => {
    await prisma.mediaBinding.deleteMany({ where: { projectId: { in: [PID, PID_CLEAN] } } });
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: { in: [PID, PID_CLEAN] } } });
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: { in: [PID, PID_CLEAN] } } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: { in: [PID, PID_CLEAN] } } });
    await prisma.media.deleteMany({ where: { id: { in: [M1, M2] } } });
    await restoreLeaseRow(prisma);
    await cleanupProjectFixture(prisma, PID);
    await cleanupProjectFixture(prisma, PID_CLEAN);
    await prisma.$disconnect();
    svc.onApplicationShutdown();
  });

  it('①missing 漂移：doc 引用缺行→drift_total{missing} 计数+置 dirty+enqueue；MediaBinding 行零变化（只读）', async () => {
    await prisma.canvasDoc.update({ where: { projectId: PID }, data: { bindingsDirty: false } });
    const rowsBefore = await rowsOf();
    const delta = await metricDelta('media_binding_drift_total', 'missing', async () => {
      const s = await svc.reconcileProject(PID);
      expect(s.ok).toBe(true);
      expect(s.scanned).toBe(1);
      expect(s.drift).toEqual({ missing: 1, extra: 0, mismatch: 0 });
      expect(s.dirtyMarked).toBe(true);
    });
    expect(delta).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(PID);
    expect((await docState())?.bindingsDirty).toBe(true);
    expect(await rowsOf()).toEqual(rowsBefore);   // 只读：零 MediaBinding 写
  });

  it('②mismatch+extra：同槽异 mediaId/行无引用→分类计数；行集前后逐字不变（零删改）', async () => {
    // 布景：n1 槽指 M2（mismatch——doc 期望 M1）+ ghost 行（extra）
    await prisma.mediaBinding.deleteMany({ where: { projectId: PID } });
    await prisma.mediaBinding.createMany({ data: [
      { mediaId: M2, projectId: PID, nodeId: 'n1', teamId: FIXTURE_TEAM, role: 'primary', targetField: 'fileId', targetItemId: '' },
      { mediaId: M2, projectId: PID, nodeId: 'ghost', teamId: FIXTURE_TEAM, role: 'primary', targetField: 'fileId', targetItemId: '' },
    ] });
    await prisma.canvasDoc.update({ where: { projectId: PID }, data: { bindingsDirty: false } });
    const rowsBefore = await rowsOf();
    let summary: import('./binding-reconcile.service').ReconcileSummary | undefined;
    const dMismatch = await metricDelta('media_binding_drift_total', 'mismatch', async () => {
      summary = await svc.reconcileProject(PID);
    });
    expect(summary!.drift).toEqual({ missing: 0, extra: 1, mismatch: 1 });
    expect(dMismatch).toBe(1);
    expect((await docState())?.bindingsDirty).toBe(true);
    expect(await rowsOf()).toEqual(rowsBefore);   // 只读：错行/多余行均未删改（修复归 rebuild）
    // extra 计数独立断言（二次检测——dirty 已 true 不影响只读检测）
    const dExtra = await metricDelta('media_binding_drift_total', 'extra', async () => { await svc.reconcileProject(PID); });
    expect(dExtra).toBe(1);
  });

  it('③零漂移：rebuild 收敛后 reconcile=零漂移零动作（dirtyMarked=false+零 enqueue）', async () => {
    await prisma.canvasDoc.update({ where: { projectId: PID }, data: { bindingsDirty: true } });
    const out = await rebuild.rebuildProjectBindings(PID);
    expect(out).toMatchObject({ outcome: 'cleared', pgSeq: 10n });
    const rowsBefore = await rowsOf();
    const s = await svc.reconcileProject(PID);
    expect(s.drift).toEqual({ missing: 0, extra: 0, mismatch: 0 });
    expect(s.dirtyMarked).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    expect((await docState())?.bindingsDirty).toBe(false);
    expect(await rowsOf()).toEqual(rowsBefore);
  });

  it('④项目/文档行缺失→跳过（ok=false 不抛；清理归 erasure/FK cascade）', async () => {
    const s = await svc.reconcileProject('0c3a8-reconcile-missing');
    expect(s.ok).toBe(false);
    expect(s.dirtyMarked).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('⑤发现面=CanvasDoc 全表（干净项目也入列——漂移可在「水位齐」项目）', async () => {
    const n = await svc.discover();
    expect(n).toBeGreaterThanOrEqual(2);
    const queue = (svc as unknown as { queue: Set<string> }).queue;
    expect(queue.has(PID)).toBe(true);
    expect(queue.has(PID_CLEAN)).toBe(true);   // 干净项目（dirty=false 且 seq 齐）仍在发现面
    // 排水（budget=8/轮——本批两项目在页首，本轮必排水）：干净项目零漂移零动作
    await svc.drain();
    expect((svc as unknown as { queue: Set<string> }).queue.has(PID)).toBe(false);
    expect((svc as unknown as { queue: Set<string> }).queue.has(PID_CLEAN)).toBe(false);
  });
});
