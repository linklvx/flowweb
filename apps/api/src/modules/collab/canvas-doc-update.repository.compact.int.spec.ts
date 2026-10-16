import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { svDominates } from './sv.util';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
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
  // Y0a-3（P13）：fence 落地后真库 append/compact 需 CollabLease 行 owner 匹配（beforeEach 续 5min 窗）
  beforeEach(async () => { await ensureLeaseFixture(prisma, repo); });
  afterAll(async () => { await restoreLeaseRow(prisma); await cleanupProjectFixture(prisma, PID); await prisma.$disconnect(); });

  it('stateSeq 恒等于被删行最大 seq（精确赋值——禁 GREATEST；注释口径：精确 = 依赖 advisory lock 串行，去锁并发化必须先落 Y1c-1 CAS 形态）', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    expect(await repo.compact(PID)).toEqual({ compacted: false, reason: 'empty' });   // 返回契约：无行=empty（spec §1.3 v2.4）
    await repo.append(PID, Y.encodeStateAsUpdate(docWithNodes(5)));
    await repo.append(PID, Y.encodeStateAsUpdate(docWithNodes(3)));
    const rows = await prisma.canvasDocUpdate.findMany({ where: { projectId: PID }, select: { seq: true }, orderBy: { seq: 'asc' } });
    const t0 = Date.now();
    expect(await repo.compact(PID)).toEqual({ compacted: true, snapshotBytes: expect.any(Number), deletedRows: rows.length, tombstoneBytes: expect.any(Number) });   // 返回契约：成功（Y0b-4 T3 snapshotBytes+Y0b-5 T10 deletedRows〔=被删行数〕/tombstoneBytes）
    const docRow = await prisma.canvasDoc.findUnique({ where: { projectId: PID } });
    expect(docRow!.stateSeq).toBe(rows[rows.length - 1].seq);        // 精确 =
    expect(docRow!.updatedAt.getTime()).toBeGreaterThanOrEqual(t0);  // updatedAt create 分支（@updatedAt 只在 Client 层生效——防未来改裸 SQL）
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(0);
    // update 分支（v3）：库已清空⇒首次 compact 走 upsert.create；再 append+compact 命中 update 分支
    await repo.append(PID, Y.encodeStateAsUpdate(docWithNodes(2)));
    await repo.compact(PID);
    const row2 = await prisma.canvasDoc.findUnique({ where: { projectId: PID } });
    expect(row2!.updatedAt.getTime()).toBeGreaterThan(docRow!.updatedAt.getTime());   // update 分支 updatedAt 前进（两 DB 读值比较——免时钟容忍，堵快速机 <5ms roundtrip 的 vacuous-pass 窗口）
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

  // G2（Y0c T40/Z125-2）：重复行坍缩从实现巧合升格为契约——同一 update append ×3 产生 3 条
  // 内容相同行，compact 必须全量读行（被删集≡被重放集，契约 §1.3）：行数归零+deletedRows=3。
  // 判别力（TEMP-RED 实证）：compact 读方法注入 take: 1 ⇒ 只删 1 行留 2 行 ⇒ 两断言即红。
  it('G2（Z125-2）：append 同一 update ×3 → compact → 重复行全坍缩（deletedRows=3+行数 0）+读行覆盖全部行禁 LIMIT（声明式）', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    const u = Y.encodeStateAsUpdate(docWithNodes(3));
    await repo.append(PID, u);
    await repo.append(PID, u);
    await repo.append(PID, u);
    const r = await repo.compact(PID);
    expect(r).toEqual({ compacted: true, snapshotBytes: expect.any(Number), deletedRows: 3, tombstoneBytes: expect.any(Number) });
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(0);
    // 声明式断言（census 源码文本风格）：compact 读行方法禁 take:/LIMIT——分页/限行读会把
    // 「被删集≡被重放集」破成「删了没重放的行」或「重放没删的行」两类撕裂（readConsistent 的
    // 分页 LIMIT 是装载读路径、游标推进全覆盖，不在本断言面——本断言只辖 compact 方法体）。
    // 提取形态：compact 是文件末方法（写死本断言时成立；后接新方法时改花括号平衡提取）。
    const src = readFileSync(join(__dirname, 'canvas-doc-update.repository.ts'), 'utf8');
    const at = src.indexOf('async compact(');
    expect(at, 'compact 方法定位失败（方法改名/换文件——同步本断言提取形态）').toBeGreaterThan(0);
    const compactSrc = src.slice(at);
    expect(compactSrc, 'compact 读行禁 take:（限行读破被删集≡被重放集契约）').not.toMatch(/take\s*:/);
    expect(compactSrc, 'compact 读行禁 LIMIT（同上——raw SQL 改写形态兜底）').not.toMatch(/\bLIMIT\b/i);
  });
});
