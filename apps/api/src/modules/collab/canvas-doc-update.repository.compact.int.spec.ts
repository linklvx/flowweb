import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { svDominates } from './sv.util';
import { ensureProjectFixture, cleanupProjectFixture } from '../../test-utils/db-fixtures';
import * as Y from 'yjs';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

function docWithNodes(count: number): Y.Doc {
  const doc = new Y.Doc();
  for (let i = 0; i < count; i++) doc.getMap('nodes').set(`n${i}`, new Y.Map([['x', i]]));
  return doc;
}

describe('svDominates 纯函数锚（无需 DB）', () => {
  it('阴性对照：row clock 超前 snap → false', () => {
    const a = new Y.Doc(); a.getMap('nodes').set('k', new Y.Map([['x', 1]]));
    const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); b.getMap('nodes').set('m', new Y.Map([['x', 2]]));
    const svA = Y.encodeStateVector(a);                 // 只含 a 的 clock
    const lateOnly = Y.diffUpdate(Y.encodeStateAsUpdate(b), svA); // 只含 b 后写部分
    expect(svDominates(Y.encodeStateVectorFromUpdate(lateOnly), svA)).toBe(false); // late clock ⊄ snap
  });
  it('阳性对照：row ⊆ snap → true；空 SV（DS-only）→ true', () => {
    const a = new Y.Doc(); a.getMap('nodes').set('k', new Y.Map([['x', 1]]));
    const u = Y.encodeStateAsUpdate(a);
    expect(svDominates(Y.encodeStateVectorFromUpdate(u), Y.encodeStateVector(a))).toBe(true);
    expect(svDominates(new Uint8Array([0, 0]), Y.encodeStateVector(a))).toBe(true); // 空 SV 天然被支配
  });
});

maybe('compact（真 PG）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);
  const PID = 'y0a1-compact-int';

  beforeAll(async () => { await ensureProjectFixture(prisma, PID); });
  afterAll(async () => { await cleanupProjectFixture(prisma, PID); await prisma.$disconnect(); });

  it('stateSeq 恒等于被删行最大 seq（精确赋值——禁 GREATEST；注释口径：精确 = 依赖 advisory lock 串行，去锁并发化必须先落 Y1c-1 CAS 形态）', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    expect(await repo.compact(PID)).toEqual({ compacted: false, reason: 'empty' });   // 返回契约：无行=empty（spec §1.3 v2.4）
    await repo.append(PID, Y.encodeStateAsUpdate(docWithNodes(5)));
    await repo.append(PID, Y.encodeStateAsUpdate(docWithNodes(3)));
    const rows = await prisma.canvasDocUpdate.findMany({ where: { projectId: PID }, select: { seq: true }, orderBy: { seq: 'asc' } });
    const t0 = Date.now();
    expect(await repo.compact(PID)).toEqual({ compacted: true });                      // 返回契约：成功
    const docRow = await prisma.canvasDoc.findUnique({ where: { projectId: PID } });
    expect(docRow!.stateSeq).toBe(rows[rows.length - 1].seq);        // 精确 =
    expect(docRow!.updatedAt.getTime()).toBeGreaterThanOrEqual(t0);  // updatedAt create 分支（@updatedAt 只在 Client 层生效——防未来改裸 SQL）
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(0);
    // update 分支（v3）：库已清空⇒首次 compact 走 upsert.create；再 append+compact 命中 update 分支
    await repo.append(PID, Y.encodeStateAsUpdate(docWithNodes(2)));
    const t1 = Date.now() - 5;                                       // 容忍时钟粒度
    await repo.compact(PID);
    const row2 = await prisma.canvasDoc.findUnique({ where: { projectId: PID } });
    expect(row2!.updatedAt.getTime()).toBeGreaterThanOrEqual(t1);    // update 分支 updatedAt 前进
  });

  it('compact 后新 Y.Doc 重放 state ≡ 原 doc 节点集', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    const src = docWithNodes(8);
    await repo.append(PID, Y.encodeStateAsUpdate(src));
    await repo.compact(PID);
    const row = await prisma.canvasDoc.findUnique({ where: { projectId: PID } });
    const revived = new Y.Doc();
    Y.applyUpdate(revived, new Uint8Array(row!.state));
    expect(revived.getMap('nodes').size).toBe(src.getMap('nodes').size);
  });
});
