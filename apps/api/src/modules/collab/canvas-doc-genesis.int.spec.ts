// Y1c T7 ①genesis（真 PG——int 池）：建头 helper 全链 + SystemHistory fail-closed 回滚 + 并发双创建。
// 头集=CanvasDoc（旧 state 种子语义逐字保留+新列默认）+CanvasDocSnapshot(g,0,0)+RuntimeFeedCursor 行，
// 与项目行同一 PG 事务（无部分写入）；SystemHistory 缺失/为零=fail-closed（事务回滚——无半建头）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';
import { ensureCanvasDocHead } from './canvas-doc-genesis';
import { readCanvasDocHead, readRuntimeFeedCursor, requireCanvasDocHead } from './canvas-doc-head';
import { createCanvasDoc } from './canvas-doc.factory';
import { ensureProjectFixture, cleanupProjectFixture } from '../../test-utils/db-fixtures';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

const PID_A = 'y1c-t7-genesis-int-a';
const PID_B = 'y1c-t7-genesis-int-b';
const PID_C = 'y1c-t7-genesis-int-c';

const sha256hex = (b: Buffer) => createHash('sha256').update(b).digest('hex');

maybe('Y1c T7 genesis 建头 helper（真 PG）', () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID_A);
    await ensureProjectFixture(prisma, PID_B);
    await ensureProjectFixture(prisma, PID_C);
  });
  afterAll(async () => {
    await cleanupProjectFixture(prisma, PID_A);
    await cleanupProjectFixture(prisma, PID_B);
    await cleanupProjectFixture(prisma, PID_C);
    await prisma.$disconnect();
  });

  /** 种子字节：非空 Yjs update（带一节点——验证 state 同源入 head 与 snapshot） */
  function seedBytes(withNode: boolean): Buffer {
    const doc = createCanvasDoc();
    if (withNode) doc.getMap('nodes').set('n1', new Y.Map([['type', 'textInput']]));
    const bytes = Buffer.from(Y.encodeStateAsUpdate(doc));
    doc.destroy();
    return bytes;
  }

  it('①头集三件同事务：head（旧 state 种子+新列默认零）+Snapshot(g,0,0)（stateHash=种子 SHA-256）+RuntimeFeedCursor(0,0)', async () => {
    const seed = seedBytes(true);
    await prisma.$transaction(async (tx) => {
      await ensureCanvasDocHead(tx, PID_A, seed);
    });

    const head = await requireCanvasDocHead(prisma, PID_A);
    expect(head.generation).toBe(0);
    expect(head.pgSeq).toBe(0n);
    expect(head.walCheckpointSeq).toBe(0n);
    expect(head.currentSnapshotRev).toBe(0n);
    expect(head.vacuumEpoch).toBe(0);
    expect(head.purgeBelowSeq).toBeNull();
    expect(head.maintenanceId).toBeNull();

    // 旧平面 state 种子语义（逐字保留——旧装载/hydration 路径依赖）
    const rawHead = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID_A } });
    expect(rawHead.state.equals(seed)).toBe(true);
    expect(rawHead.stateSeq).toBe(0n);
    expect(rawHead.schemaVersion).toBe(CANVAS_DOC_SCHEMA_VERSION);

    const snap = await prisma.canvasDocSnapshot.findUniqueOrThrow({
      where: { projectId_generation_snapshotRev: { projectId: PID_A, generation: 0, snapshotRev: 0n } },
    });
    expect(snap.state.equals(seed)).toBe(true);
    expect(snap.stateSeq).toBe(0n);
    expect(snap.stateHash).toBe(sha256hex(seed));
    expect(snap.schemaVersion).toBe(CANVAS_DOC_SCHEMA_VERSION);
    expect(snap.vacuumEpoch).toBe(0);

    const cursor = await readRuntimeFeedCursor(prisma, PID_A);
    expect(cursor).toEqual({ status: 'found', row: { projectId: PID_A, lastSeq: 0n, minRetainedSeq: 0n } });
  });

  it('①幂等重入：同 projectId 二次 ensure = no-op（upsert 形态——不炸不重复）', async () => {
    const seed = seedBytes(false);
    await prisma.$transaction(async (tx) => { await ensureCanvasDocHead(tx, PID_A, seed); });
    const snaps = await prisma.canvasDocSnapshot.count({ where: { projectId: PID_A } });
    const cursors = await prisma.runtimeFeedCursor.count({ where: { projectId: PID_A } });
    expect(snaps).toBe(1);
    expect(cursors).toBe(1);
  });

  it('①SystemHistory fail-closed：删行 → ensure 拒绝且事务回滚（无 CanvasDoc/Snapshot/Cursor 部分写入）', async () => {
    const backup = await prisma.systemHistory.findUniqueOrThrow({ where: { id: 1 } });
    await prisma.systemHistory.delete({ where: { id: 1 } });
    try {
      const seed = seedBytes(false);
      await expect(prisma.$transaction(async (tx) => {
        await tx.canvasProject.update({ where: { id: PID_B }, data: { name: 'y1c-int-partial' } });   // 同事务先行写——回滚断言锚
        await ensureCanvasDocHead(tx, PID_B, seed);
      })).rejects.toMatchObject({ systemHistoryMissing: true });
      // 回滚无部分写入：头集三件全缺+先行写未落
      expect(await prisma.canvasDoc.count({ where: { projectId: PID_B } })).toBe(0);
      expect(await prisma.canvasDocSnapshot.count({ where: { projectId: PID_B } })).toBe(0);
      expect(await prisma.runtimeFeedCursor.count({ where: { projectId: PID_B } })).toBe(0);
      expect((await prisma.canvasProject.findUniqueOrThrow({ where: { id: PID_B } })).name).not.toBe('y1c-int-partial');
    } finally {
      await prisma.systemHistory.create({ data: backup });   // 复原全局单行（id=1 原值）
    }
  });

  it('②缺头三态（真 PG）：缺头 require 拒 / read=missing；建头后 found（含零值态）', async () => {
    expect(await readCanvasDocHead(prisma, PID_C)).toEqual({ status: 'missing' });
    await expect(requireCanvasDocHead(prisma, PID_C)).rejects.toMatchObject({ canvasDocHeadMissing: true });
    expect(await readRuntimeFeedCursor(prisma, PID_C)).toEqual({ status: 'missing' });

    const seed = seedBytes(false);
    await prisma.$transaction(async (tx) => { await ensureCanvasDocHead(tx, PID_C, seed); });
    const r = await readCanvasDocHead(prisma, PID_C);
    expect(r.status).toBe('found');
    if (r.status === 'found') expect(r.row.pgSeq).toBe(0n);   // 零值=合法 found 态（≠missing）
  });

  it('交错（并发双创建）：两项目并行 ensure → 两套完整头集，无重复无缺失', async () => {
    const seedA = seedBytes(true);
    const seedB = seedBytes(false);
    // 先清 A 残留（幂等用例已建）确保本用例从零计数
    await cleanupProjectFixture(prisma, PID_A);
    await ensureProjectFixture(prisma, PID_A);
    await Promise.all([
      prisma.$transaction(async (tx) => { await ensureCanvasDocHead(tx, PID_A, seedA); }),
      prisma.$transaction(async (tx) => { await ensureCanvasDocHead(tx, PID_B, seedB); }),
    ]);
    for (const pid of [PID_A, PID_B]) {
      expect(await prisma.canvasDoc.count({ where: { projectId: pid } })).toBe(1);
      expect(await prisma.canvasDocSnapshot.count({ where: { projectId: pid, generation: 0, snapshotRev: 0n } })).toBe(1);
      expect(await prisma.runtimeFeedCursor.count({ where: { projectId: pid } })).toBe(1);
    }
  });
});
