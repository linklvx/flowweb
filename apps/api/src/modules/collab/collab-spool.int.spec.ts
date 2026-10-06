// Y0a-2（V6）：FK 真库背书——raw 路径 FK 形状（P2010+meta.code='23503'）唯真库可证，mock-only FK 用例一律无效证据。
// 流程：ensureProjectFixture 建 fixture→spool.append 真帧（真 tmp 目录）→prisma.canvasProject.delete（真删）
// →replayAll(CanvasDocUpdateRepository 真实例)→断言 report.discarded===1+段文件回收。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdir } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { CollabSpoolService } from './collab-spool.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { ensureProjectFixture, cleanupProjectFixture } from '../../test-utils/db-fixtures';
import { makeSpoolDir } from '../../test-utils/spool-dir';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'y0a2-spool-int';

maybe('spool replayAll FK 真库背书（V6）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);
  let dir: string; let cleanup: () => Promise<void>;

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID);
    ({ dir, cleanup } = await makeSpoolDir('y0a2-spool-int-'));
  });
  afterAll(async () => { await cleanup(); await cleanupProjectFixture(prisma, PID); await prisma.$disconnect(); });

  it('项目真删后回灌：raw append FK→帧按终态丢弃+段回收（P2010+meta 23503 形状由 isFkGone 单源判别）', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    const s1 = new CollabSpoolService(dir);
    await s1.append(PID, Y.encodeStateAsUpdate(new Y.Doc()));
    const s2 = new CollabSpoolService(dir);   // 重启形态：scan 重建 index 后回灌
    await s2.scan();
    await prisma.canvasProject.delete({ where: { id: PID } });   // 真删（FK 链唯一父）
    const report = await s2.replayAll(repo);
    expect(report.discarded).toBe(1);
    expect(report.failed).toBe(0);
    expect((await readdir(dir)).filter((f) => f.endsWith('.spool'))).toHaveLength(0);
  });
});
