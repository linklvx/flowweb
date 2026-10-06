import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { ensureProjectFixture, cleanupProjectFixture } from '../../test-utils/db-fixtures';
import * as Y from 'yjs';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'y0a1-append-int';

maybe('append（真 PG）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);

  beforeAll(async () => { await ensureProjectFixture(prisma, PID); });
  afterAll(async () => { await cleanupProjectFixture(prisma, PID); await prisma.$disconnect(); });

  it('append 返回 AppendResult：ok:true 且 seq 严格递增、行数一致（局部不变量——不读全局序列 last_value：vitest 并行 worker 下它反映所有会话取号，跨文件干扰必红）', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    const u = Y.encodeStateAsUpdate(new Y.Doc());
    const seqs: bigint[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await repo.append(PID, u);
      expect(r.ok).toBe(true);          // 契约 15：成功判据=ok===true（本批恒 true；fence 断言 Y0a-3 才追加）
      if (r.ok) seqs.push(r.seq);
    }
    expect(seqs[1] > seqs[0]).toBe(true);
    expect(seqs[2] > seqs[1]).toBe(true);
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(3);
  });

  it('重复 (projectId,seq) 被唯一约束拒绝（P2002 行为锚——对未迁移库此用例红=Task 1 红相的运行时面）', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    const u = Y.encodeStateAsUpdate(new Y.Doc());
    const r0 = await repo.append(PID, u);                          // 占用该 seq
    if (!r0.ok) throw new Error('expected ok');
    await expect(
      prisma.canvasDocUpdate.create({ data: { projectId: PID, seq: r0.seq, update: Buffer.from([0]) } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
