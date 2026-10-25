import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { svDominates } from './sv.util';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import * as Y from 'yjs';
import { makeSeedSeq } from '../../test-utils/canvas-doc-row';

/** Y1c T9：repo.append（nextval 单帧）退役——播种替身（单调 walSeq 单帧行，appendBatch 批行）。 */
const seedAppend = makeSeedSeq();

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

maybe('compact（真 PG——Y1c T11 快照发布形态；发布事务语义/红组/保留策略/交错在 canvas-doc-compact-publish.int.spec）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);
  const PID = 'y0a1-compact-int';

  beforeAll(async () => { await ensureProjectFixture(prisma, PID); });
  // Y0a-3（P13）：fence 落地后真库 append 需 CollabLease 行 owner 匹配（beforeEach 续 5min 窗）
  beforeEach(async () => {
    await ensureLeaseFixture(prisma, repo);
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
  });
  afterAll(async () => { await restoreLeaseRow(prisma); await cleanupProjectFixture(prisma, PID); await prisma.$disconnect(); });

  /** actor 单写者播种链（appendBatch+水位 CAS——pgSeq 权威推进，compact 授权读真值源）。
   *  行 seq 取自 seedAppend 返回（makeSeedSeq 文件级计数器跨用例连续——wm 与行 seq 同源）。 */
  async function seedWm(frames: Uint8Array[]) {
    const t0 = Date.now();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "updatedAt") VALUES ($1, 1, 3, now()) ON CONFLICT DO NOTHING`,
      PID,
    );
    let pg = 0n;
    for (const f of frames) {
      const row = seedAppend(f);
      const r = await repo.appendBatch(PID, [row], { expectedPgSeq: pg, newPgSeq: row.lastWalSeq, walCheckpointSeq: row.lastWalSeq });
      expect(r.ok).toBe(true);
      pg = row.lastWalSeq;
    }
    return { lastSeq: pg, t0 };
  }

  it('水位精确：快照 rev/stateSeq=pgSeq（=被折前缀末行 seq——禁 GREATEST）+purgeBelowSeq 同值+行清+updatedAt 前进（update 分支）', async () => {
    const { lastSeq, t0 } = await seedWm([Y.encodeStateAsUpdate(docWithNodes(5)), Y.encodeStateAsUpdate(docWithNodes(3))]);
    const rows = await prisma.canvasDocUpdate.findMany({ where: { projectId: PID }, select: { seq: true }, orderBy: { seq: 'asc' } });
    const r = await repo.compact(PID);
    expect(r).toMatchObject({ compacted: true, snapshotRev: lastSeq, stateSeq: lastSeq, purgeBelowSeq: lastSeq, deletedRows: rows.length });
    if (!r.compacted) return;
    const docRow = await prisma.canvasDoc.findUnique({ where: { projectId: PID } });
    expect(docRow!.currentSnapshotRev).toBe(lastSeq);   // 指针=被折前缀末行 seq（精确——禁 GREATEST/回退）
    expect(docRow!.purgeBelowSeq).toBeNull();   // Q-M3（T11 双评审）：④两段全成→义务衰减（boot NOT NULL 扫描稳态零命中）
    expect(docRow!.updatedAt.getTime()).toBeGreaterThanOrEqual(t0);
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(0);
    // 第二轮（update 分支）：再 append+compact 命中既有头行（指针/水位再推进）
    const r2 = await repo.appendBatch(PID, [seedAppend(Y.encodeStateAsUpdate(docWithNodes(2)))], { expectedPgSeq: lastSeq, newPgSeq: lastSeq + 1n, walCheckpointSeq: lastSeq + 1n });
    expect(r2.ok).toBe(true);
    await repo.compact(PID);
    const row2 = await prisma.canvasDoc.findUnique({ where: { projectId: PID } });
    expect(row2!.updatedAt.getTime()).toBeGreaterThan(docRow!.updatedAt.getTime());   // 两 DB 读值比较（免时钟容忍）
    expect(row2!.currentSnapshotRev).toBe(lastSeq + 1n);
  });

  it('compact 后新 Y.Doc 重放快照 ≡ 原 doc 节点集（快照权威=CanvasDocSnapshot——旧 CanvasDoc.state 断言随列退役迁移）', async () => {
    const src = docWithNodes(8);
    const { lastSeq } = await seedWm([Y.encodeStateAsUpdate(src)]);
    await repo.compact(PID);
    const snap = await prisma.canvasDocSnapshot.findUniqueOrThrow({
      where: { projectId_generation_snapshotRev: { projectId: PID, generation: 1, snapshotRev: lastSeq } },
    });
    const revived = new Y.Doc();
    Y.applyUpdate(revived, new Uint8Array(snap.state));
    expect(revived.getMap('nodes').size).toBe(src.getMap('nodes').size);
    // 装载（快照+增量尾）等价
    const h = await repo.loadForHydration(PID);
    const viaLoad = new Y.Doc();
    Y.applyUpdate(viaLoad, new Uint8Array(h.state!));
    expect(viaLoad.getMap('nodes').size).toBe(src.getMap('nodes').size);
  });

  // G2（Y0c T40/Z125-2）：重复行坍缩从实现巧合升格为契约——同一 update append ×3 产生 3 条
  // 内容相同行，compact 必须全量读行（被折集=被删集）：行数归零+deletedRows=实删数。
  it('G2（Z125-2）：append 同一 update ×3 → 幂等坍缩 1 行 → compact 折叠清源（行数 0）；声明式锚——重放页带上界 seq<=pgSeq（禁折 pgSeq 之外行）+发布事务零删除（清理只在提交后）', async () => {
    const u = Y.encodeStateAsUpdate(docWithNodes(3));
    const { lastSeq } = await seedWm([u]);
    await repo.appendBatch(PID, [seedAppend(u)]);   // 幂等重发（同 updateHash——DO NOTHING 吞行）
    await repo.appendBatch(PID, [seedAppend(u)]);
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(1);   // 幂等坍缩（重试/重组批幂等锚）
    const r = await repo.compact(PID);
    expect(r.compacted).toBe(true);
    if (r.compacted) expect(r.deletedRows).toBe(1);
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(0);
    // 声明式断言（census 源码文本风格——T11 语义迁移：旧「禁 take/LIMIT」锚辖被删集≡被重放集；
    // 新形态=重放分页有界推进（游标收尾全覆盖）+页谓词带上界 seq<=pgSeq（快照只到 pgSeq——
    // 禁折 PG 前缀之外行）；发布事务（$transaction 回调）零 DELETE（删除只在提交后=purgeBelow）。
    const src = readFileSync(join(__dirname, 'canvas-doc-update.repository.ts'), 'utf8');
    const at = src.indexOf('async compact(');
    expect(at, 'compact 方法定位失败（方法改名/换文件——同步本断言提取形态）').toBeGreaterThan(0);
    const compactSrc = src.slice(at, src.indexOf('async purgeBelow('));
    const pageAt = compactSrc.indexOf('SELECT seq, update FROM "CanvasDocUpdate"');
    expect(pageAt).toBeGreaterThan(0);
    const pageSrc = compactSrc.slice(pageAt, compactSrc.indexOf(';', pageAt));
    expect(pageSrc, '重放页谓词带上界 seq<=pgSeq（快照只到 pgSeq——卡文铁律）').toContain('seq <= ${pg}::bigint');
    expect(pageSrc).toContain('LIMIT');   // 分页有界（游标收尾全覆盖——禁 take 截断集的旧形态由「空页收尾」保证）
    const txAt = compactSrc.indexOf('const publish = await this.prisma.$transaction(');
    expect(txAt).toBeGreaterThan(0);
    const txSrc = compactSrc.slice(txAt, compactSrc.indexOf('if (!publish.ok)'));
    expect(txSrc, '发布事务零删除（compact 失败保留原可用快照与 WAL 不提前清理——卡文铁律）').not.toMatch(/DELETE FROM "CanvasDocUpdate"/);
    void lastSeq;
  });
});
