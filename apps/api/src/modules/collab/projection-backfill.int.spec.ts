// apps/api/src/modules/collab/projection-backfill.int.spec.ts
// C3a-8（plan v3 Task C3a-8——spec 2026-11-11-foundation-batch-design.md §3.2-3/§3.2-7）：
// ProjectionBackfillRunner 真 PG 红测——两族：
//   ① 恢复 replay 腿（崩溃重放形态）：spool 帧未投影（帧 1 加 M 已落 PG、binding 缺行）→replayAll
//      前置 dirty（独立 PG 写）+落定入队 runner→rebuild 定代重放→**PG doc 有 M ∧ MediaBinding 有 M**；
//      崩溃窗（dirty 已持久、rebuild 未跑）由 runner 全表枚举续跑收敛。
//   ② backfill 100 项目不惊群+断点续跑+持久状态行可查：每 tick 处理数≤BACKFILL_PROJECTS_PER_TICK、
//      重建并发恒 1（严格串行）；两轮 runner（不同 backfillEpoch）接力跑完=断点续跑；全 DONE+verifiedSeq
//      可查；重复跑零动作（幂等）。
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { CollabSpoolService } from './collab-spool.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { BindingRebuildService } from './binding-rebuild.service';
import { ProjectionBackfillRunner, BACKFILL_PROJECTS_PER_TICK } from './projection-backfill.runner';
import { createCanvasDoc } from './canvas-doc.factory';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow, FIXTURE_TEAM, FIXTURE_USER } from '../../test-utils/db-fixtures';
import { makeSpoolDir } from '../../test-utils/spool-dir';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = '0c3a8-backfill-replay';
const M1 = 'c3a8-bf-media-1';
const BF_PIDS = Array.from({ length: 100 }, (_, i) => `0c3a8-bf-${String(i).padStart(3, '0')}`);

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

maybe('C3a-8：ProjectionBackfillRunner（真 PG——恢复 replay 腿+100 项目限速/续跑/持久行）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as never);
  const rebuild = new BindingRebuildService(prisma as never, repo as never);

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID);
    await prisma.media.deleteMany({ where: { id: M1 } });
    await prisma.media.create({
      data: { id: M1, userId: FIXTURE_USER, teamId: FIXTURE_TEAM, key: `c3a8/${M1}`, originalName: 'm.png', mimeType: 'image/png', size: 1n, type: 'uploaded' },
    });
    await prisma.projectionBackfillState.deleteMany({ where: { projectId: { in: [PID, ...BF_PIDS] } } });
  });

  beforeEach(async () => { await ensureLeaseFixture(prisma, repo); });

  afterAll(async () => {
    await prisma.projectionBackfillState.deleteMany({ where: { projectId: { in: [PID, ...BF_PIDS] } } });
    await prisma.mediaBinding.deleteMany({ where: { projectId: { in: [PID, ...BF_PIDS] } } });
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: { in: [PID, ...BF_PIDS] } } });
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: { in: [PID, ...BF_PIDS] } } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: { in: [PID, ...BF_PIDS] } } });
    await prisma.canvasProject.deleteMany({ where: { id: { in: BF_PIDS } } });
    await prisma.collabOpsGate.deleteMany({ where: { projectId: { in: BF_PIDS } } });
    await prisma.media.deleteMany({ where: { id: M1 } });
    await restoreLeaseRow(prisma);
    await cleanupProjectFixture(prisma, PID);
    await prisma.$disconnect();
  });

  it('①恢复 replay 腿（崩溃重放）：replayAll 前置 dirty+落定入队→PG doc 有 M ∧ MediaBinding 有 M；崩溃窗（dirty 持久、rebuild 未跑）由 runner 续跑', async () => {
    const { dir, cleanup } = await makeSpoolDir('c3a8-bf-replay-');
    try {
      await prisma.$transaction([
        prisma.mediaBinding.deleteMany({ where: { projectId: PID } }),
        prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } }),
        prisma.canvasDocSnapshot.deleteMany({ where: { projectId: PID } }),
        prisma.canvasDoc.deleteMany({ where: { projectId: PID } }),
      ]);
      await prisma.canvasDoc.create({
        data: { projectId: PID, generation: 1, schemaVersion: 3, pgSeq: 0n, walCheckpointSeq: 0n, mediaBindingSeq: 0n, bindingsDirty: false },
      });
      // 崩溃形态：帧 1（加 M）只在 spool（未落 PG）——重启 scan 后 replayAll 重放
      const s1 = new CollabSpoolService(dir);
      s1.setOwner('c3a8-bf-owner');
      await s1.append(PID, mediaFrame('n-m1', M1));
      const s2 = new CollabSpoolService(dir);
      s2.setOwner('c3a8-bf-owner');
      await s2.scan();
      const runner = new ProjectionBackfillRunner(prisma as never, rebuild as never);
      const report = await s2.replayAll(repo, {
        projectIds: [PID],
        onPendingFrames: (pid) => runner.markDirty(pid),   // C3a-8：追加前置 dirty（防假覆盖）
        onReplayed: () => {},                              // 本阶段禁入队（先断 dirty 持久态）
      });
      expect(report.replayed).toBe(1);
      // 帧 1 已落 PG——但 binding 未投影：dirty 持久=true（崩溃窗）；rebuild 前断言
      const wm = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID }, select: { pgSeq: true, mediaBindingSeq: true, bindingsDirty: true } });
      expect(wm.pgSeq).toBe(1n);
      expect(wm.mediaBindingSeq).toBe(0n);   // 假覆盖阻断：dirty 门禁止增量推水位
      expect(wm.bindingsDirty).toBe(true);   // 崩溃窗持久态（重建未跑）
      expect(await prisma.mediaBinding.count({ where: { projectId: PID, mediaId: M1 } })).toBe(0);
      // 重启续跑：全表枚举（dirty 候选）→rebuild 定代重放 → PG doc 有 M ∧ binding 有 M
      const runner2 = new ProjectionBackfillRunner(prisma as never, rebuild as never);
      const t = await runner2.tick();
      expect(t.processed).toBeGreaterThanOrEqual(1);
      const st = await prisma.projectionBackfillState.findUnique({ where: { projectId: PID } });
      expect(st).toMatchObject({ state: 'DONE', verifiedSeq: 1n });
      expect(st?.backfillEpoch).toBe(runner2.backfillEpoch);
      expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'n-m1', targetField: 'fileId', mediaId: M1 } })).toBe(1);
      // PG doc 有 M（定代重放语义——loadForHydration 读回）
      const { state, updates } = await repo.loadForHydration(PID);
      const doc = createCanvasDoc();
      try {
        if (state) Y.applyUpdate(doc, new Uint8Array(state));
        for (const u of updates) Y.applyUpdate(doc, new Uint8Array(u));
        const node = doc.getMap('nodes').get('n-m1') as Y.Map<unknown>;
        expect(node).toBeDefined();
        expect((node.get('data') as Y.Map<unknown>).get('fileId')).toBe(M1);
      } finally { doc.destroy(); }
      const after = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID }, select: { mediaBindingSeq: true, bindingsDirty: true } });
      expect(after).toEqual({ mediaBindingSeq: 1n, bindingsDirty: false });
    } finally {
      await cleanup();
    }
  }, 60_000);

  it('②100 项目不惊群+断点续跑：每 tick≤上界、重建并发恒 1；两轮 runner（不同 epoch）接力→全 DONE+持久行可查+重复跑幂等', async () => {
    // 100 候选项目（dirty=true——空 doc：rebuild 零 delta 直接 CAS 清 dirty）
    await prisma.canvasProject.createMany({ data: BF_PIDS.map((id) => ({ id, name: 'c3a8-bf', teamId: FIXTURE_TEAM })) });
    await prisma.canvasDoc.createMany({ data: BF_PIDS.map((projectId) => ({
      projectId, generation: 1, schemaVersion: 3, pgSeq: 0n, walCheckpointSeq: 0n, mediaBindingSeq: 0n, bindingsDirty: true,
    })) });
    let inFlight = 0, maxInFlight = 0;
    const spyRebuild = {
      snapshotAnchor: (pid: string) => rebuild.snapshotAnchor(pid),
      rebuildProjectBindings: async (pid: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try { return await rebuild.rebuildProjectBindings(pid); } finally { inFlight -= 1; }
      },
    };
    const pendingDirty = async () => prisma.canvasDoc.count({ where: { projectId: { in: BF_PIDS }, bindingsDirty: true } });

    // 第一轮：恰一拍（上界断言）+ 断点（队列/游标丢弃=模拟崩溃重启）
    const runner1 = new ProjectionBackfillRunner(prisma as never, spyRebuild as never);
    const first = await runner1.tick();
    expect(first.processed).toBeLessThanOrEqual(BACKFILL_PROJECTS_PER_TICK);
    expect(first.processed).toBeGreaterThan(0);
    const doneAfterFirst = await prisma.projectionBackfillState.count({ where: { projectId: { in: BF_PIDS }, state: 'DONE' } });
    expect(doneAfterFirst).toBeGreaterThan(0);
    expect(doneAfterFirst).toBeLessThan(100);   // 断点成立（未跑完）

    // 第二轮（新 epoch——续跑）：每拍上界逐拍断言
    const runner2 = new ProjectionBackfillRunner(prisma as never, spyRebuild as never);
    expect(runner2.backfillEpoch).not.toBe(runner1.backfillEpoch);
    let ticks = 0;
    while (await pendingDirty() > 0) {
      const t = await runner2.tick();
      expect(t.processed).toBeLessThanOrEqual(BACKFILL_PROJECTS_PER_TICK);
      ticks += 1;
      if (ticks > 80) throw new Error('backfill 未在 80 拍内收敛（限速/续跑缺陷）');
    }
    expect(await prisma.canvasDoc.count({ where: { projectId: { in: BF_PIDS }, bindingsDirty: true } })).toBe(0);
    expect(maxInFlight).toBe(1);   // 不惊群：单项目串行（并发事务恒 1）
    // 持久状态行可查（跨进程 GC/erasure 面）：100 行全 DONE+verifiedSeq=0（pgSeq=0 空 doc）+两轮 epoch 均可在档
    const states = await prisma.projectionBackfillState.findMany({ where: { projectId: { in: BF_PIDS } } });
    expect(states).toHaveLength(100);
    expect(states.every((s) => s.state === 'DONE' && s.verifiedSeq === 0n)).toBe(true);
    const epochs = new Set(states.map((s) => s.backfillEpoch));
    expect(epochs.has(runner1.backfillEpoch)).toBe(true);   // 第一轮处理的行留第一轮 epoch
    expect(epochs.has(runner2.backfillEpoch)).toBe(true);
    expect(await prisma.canvasDoc.count({ where: { projectId: { in: BF_PIDS }, bindingsDirty: true } })).toBe(0);   // 本批零候选（remaining 全局含他测残留）
    // 幂等：重复跑——本批零候选（不再入列/状态行零触碰；全局队列含他测残留不在此断言）
    const snapshotBefore = await prisma.projectionBackfillState.findMany({ where: { projectId: { in: BF_PIDS } }, orderBy: { projectId: 'asc' } });
    await runner2.tick();
    expect(await prisma.canvasDoc.count({ where: { projectId: { in: BF_PIDS }, bindingsDirty: true } })).toBe(0);
    expect(await prisma.projectionBackfillState.findMany({ where: { projectId: { in: BF_PIDS } }, orderBy: { projectId: 'asc' } })).toEqual(snapshotBefore);
  }, 180_000);
});
