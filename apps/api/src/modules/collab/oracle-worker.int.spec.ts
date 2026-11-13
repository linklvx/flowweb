// apps/api/src/modules/collab/oracle-worker.int.spec.ts
// C3b-2（plan v3 Task C3b-2——spec 2026-11-11-foundation-batch-design.md §3.4-1/§3.4-3）：PG oracle
// worker 红测（真 PG 5432——vitest.int.config 串行）。五红面（卡文①-⑤）+tick/指标装配面：
//  ①候选无关+JOIN 过滤：重建 doc 遍历全 Yjs 容器（Map/Array/Text/XmlElement/XmlText 五类型各一
//    用例）string 叶，UUID 形态经 INSERT..SELECT unnest JOIN "Media" ON id∧teamId 过滤写入——
//    nodeId（nodes 根键）不入表（第七轮 P1-1：UUID 形态的 node 键也不入）；未知字段 media UUID
//    仍捕获；非 UUID 形态串不采；跨队/无行 UUID 经 JOIN 滤除；DELETING 媒体照采（删除中止证人）。
//  ②短事务纪律：RR 短读锚（readRebuildAnchor）→事务外扫描→另事务 CAS 校验 pgSeq/generation 未变
//    才写行/header——锚读后并发 append 移动 pgSeq ⇒ CAS miss：无行、header 停 VERIFYING 非 COMPLETE。
//  ③header 状态机+oracle 行按 project 原子替换：VERIFYING→COMPLETE（零引用 refCount=0 也写
//    COMPLETE）/FAILED；重扫旧行整删不累积（原子替换）。
//  ④复用条件=epoch+generation+verifiedSeq 三同∧status=COMPLETE∧CanvasDoc.bindingsDirty=false
//    ——逐腿红（任一移动即不复用）。
//  ⑤单 doc 预算超时 bail-out：typed budget error→header FAILED（error 非空）+不写行+不 COMPLETE
//    （扫描中途崩溃不得 COMPLETE 的等价红面）；复跑预算恢复→COMPLETE。
//  ⑥tick 枚举（scope 隔离缝）+coverage_ratio/scan_age 指标面。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { OracleWorkerService, ORACLE_SCAN_BUDGET_MS } from './oracle-worker.service';
import { oracleCoverageRatio, oracleScanAgeSeconds } from './oracle-worker.metrics';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow, FIXTURE_TEAM, FIXTURE_USER } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID_MAIN = 'c3b2-oracle-main';
const PID_CAS = 'c3b2-oracle-cas';
const PID_ZERO = 'c3b2-oracle-zero';
const PID_REUSE = 'c3b2-oracle-reuse';
const PID_TICK = 'c3b2-oracle-tick';
const ALL_PIDS = [PID_MAIN, PID_CAS, PID_ZERO, PID_REUSE, PID_TICK];
const OTHER_TEAM = 'c3b2-oracle-other-team';

/** UUID 形态媒体（randomUUID 小写 canonical——Media.id @default(uuid()) 同形态）。 */
const U = {
  map: randomUUID(),      // Y.Map（嵌套 map）string 叶
  arr: randomUUID(),      // Y.Array 直串项 string 叶
  text: randomUUID(),     // Y.Text 内容本身
  xattr: randomUUID(),    // Y.XmlElement 属性值 string 叶
  xtext: randomUUID(),    // Y.XmlText 内容本身
  unknown: randomUUID(),  // 未知字段 media UUID（候选无关捕获面）
  deleting: randomUUID(), // DELETING 媒体（照采——删除中止证人）
  nodeKey: randomUUID(),  // nodes 根键=nodeId（UUID 形态且有 Media 行——**不入表**，P1-1）
  cross: randomUUID(),    // 跨队媒体行（JOIN teamId 滤除）
  ghost: randomUUID(),    // 无 Media 行 UUID（JOIN 滤除——nodeId/edgeId 自然滤除同族）
} as const;
/** 五容器捕获全集（①断言基准）。 */
const CAPTURED = [U.map, U.arr, U.text, U.xattr, U.xtext, U.unknown, U.deleting] as const;
/** 显式 string[]（randomUUID() 模板字面量类型与 PLAIN concat 不兼容—— widened 元素面；Prisma in 需可变数组）。 */
const ALL_MEDIA: string[] = [...CAPTURED, U.nodeKey, U.cross, U.ghost];
const PLAIN = 'c3b2-plain-media-id';   // 非 UUID 形态（regex 滤除——有 Media 行也不采）

/** 五容器全展开节点（nodes 根键=U.nodeKey——键即 UUID+有 Media 行，验证键不入表）。 */
function fiveContainerDoc(): Y.Doc {
  const doc = new Y.Doc();
  const data = new Y.Map<unknown>();
  const nested = new Y.Map<unknown>();
  nested.set('inner', U.map);
  data.set('nested', nested);
  const arr = new Y.Array<unknown>();
  arr.push([U.arr]);
  data.set('arr', arr);
  data.set('caption', new Y.Text(U.text));
  const xml = new Y.XmlElement('img');
  xml.setAttribute('src', U.xattr);
  xml.insert(0, [new Y.XmlText(U.xtext)]);
  data.set('xml', xml);
  data.set('weirdField', U.unknown);
  data.set('plainRef', PLAIN);
  data.set('ghostRef', U.ghost);
  data.set('crossRef', U.cross);
  data.set('deletingRef', U.deleting);
  const node = new Y.Map<unknown>();
  node.set('type', 'imageGen');
  node.set('data', data);
  (doc.getMap('nodes') as Y.Map<unknown>).set(U.nodeKey, node);
  return doc;
}

function encoded(doc: Y.Doc): Uint8Array {
  try { return Y.encodeStateAsUpdate(doc); } finally { doc.destroy(); }
}

/** 基态增量帧（frameOfDoc 同款：base 铺底→事务内变异→只取增量——删旧节点必须基于基态，全新 doc 的
 *  delete 是 no-op 不产删除语义）。 */
function incrementalFrame(base: Uint8Array, mutate: (src: Y.Doc) => void): Uint8Array {
  const src = new Y.Doc();
  try {
    Y.applyUpdate(src, base);
    const ups: Uint8Array[] = [];
    src.on('update', (u: Uint8Array) => { ups.push(u); });
    src.transact(() => mutate(src));
    return Y.mergeUpdates(ups);
  } finally { src.destroy(); }
}

maybe('C3b-2：PG oracle worker（候选无关+短事务+状态机+复用+bail-out）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as never);
  const svc = new OracleWorkerService(prisma as never, repo as never);
  /** 跨断言复用的 seeding 序号（appendBatch pgSeq 链）。 */
  const seqOf: Record<string, bigint> = {};
  /** PID_MAIN 基态帧（③ 增量删节点的铺底）。 */
  let mainFrame1: Uint8Array;

  beforeAll(async () => {
    for (const pid of ALL_PIDS) await ensureProjectFixture(prisma, pid);
    // 残留清扫（int 套件共享 dev 库——重跑幂等）
    for (const pid of ALL_PIDS) {
      await prisma.canvasReferenceOracle.deleteMany({ where: { projectId: pid } });
      await prisma.canvasReferenceOracleScan.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDoc.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDoc.create({ data: { projectId: pid, generation: 1, schemaVersion: 3, pgSeq: 0n, walCheckpointSeq: 0n, mediaBindingSeq: 0n, bindingsDirty: false } });
    }
    // 跨队媒体宿主 team（U.cross 行挂 OTHER_TEAM——JOIN teamId 滤除断言面；先建后挂 FK）
    await prisma.team.upsert({ where: { id: OTHER_TEAM }, update: {}, create: { id: OTHER_TEAM, name: 'c3b2-other-team', ownerId: FIXTURE_USER } });
    await prisma.media.deleteMany({ where: { id: { in: ALL_MEDIA } } });
    await prisma.media.deleteMany({ where: { id: PLAIN } });
    // U.ghost 故意无 Media 行（JOIN 行缺滤除断言——nodeId/edgeId 自然滤除同族）；其余（含跨队/UUID 键）建行
    const mediaWithRows = ALL_MEDIA.filter((id) => id !== U.ghost).concat(PLAIN);
    for (const id of mediaWithRows) {
      await prisma.media.create({
        data: { id, userId: FIXTURE_USER, teamId: id === U.cross ? OTHER_TEAM : FIXTURE_TEAM, key: `c3b2/${id}`, originalName: `${id}.png`, mimeType: 'image/png', size: 1n, type: 'uploaded' },
      });
    }
    // DELETING 形态（deletedAt≠null ∧ DELETING——oracle 照采：删除中止 recheck 证人）
    await prisma.media.update({ where: { id: U.deleting }, data: { deletionState: 'DELETING', deletedAt: new Date() } });
    await ensureLeaseFixture(prisma, repo);
    // 种子帧（各项目一帧 pgSeq=1——帧字节直供：mainFrame1 留作 ③ 增量铺底）
    const seedFrame = (pid: string, frame: Uint8Array): Promise<unknown> => {
      seqOf[pid] = 1n;
      return repo.appendBatch(pid, [seedRow(frame, 1n)], { expectedPgSeq: 0n, newPgSeq: 1n, walCheckpointSeq: 1n });
    };
    mainFrame1 = encoded(fiveContainerDoc());
    await seedFrame(PID_MAIN, mainFrame1);
    await seedFrame(PID_CAS, encoded(fiveContainerDoc()));
    await seedFrame(PID_REUSE, encoded(fiveContainerDoc()));
    await seedFrame(PID_TICK, encoded(fiveContainerDoc()));
    // 零引用项目：节点 data 无任何 UUID 形态串
    const zeroDoc = new Y.Doc();
    try {
      const node = new Y.Map<unknown>();
      const data = new Y.Map<unknown>();
      data.set('label', 'hello-world');
      node.set('type', 'text');
      node.set('data', data);
      (zeroDoc.getMap('nodes') as Y.Map<unknown>).set('n-zero', node);
      await seedFrame(PID_ZERO, Y.encodeStateAsUpdate(zeroDoc));
    } finally { zeroDoc.destroy(); }
  }, 60_000);

  afterAll(async () => {
    for (const pid of ALL_PIDS) {
      await prisma.canvasReferenceOracle.deleteMany({ where: { projectId: pid } });
      await prisma.canvasReferenceOracleScan.deleteMany({ where: { projectId: pid } });
    }
    await prisma.media.deleteMany({ where: { id: { in: ALL_MEDIA.concat(PLAIN) } } });
    await prisma.team.deleteMany({ where: { id: OTHER_TEAM } }).catch(() => undefined);
    await restoreLeaseRow(prisma);
    for (const pid of ALL_PIDS) await cleanupProjectFixture(prisma, pid);
    await prisma.$disconnect();
  }, 60_000);

  /** 追加一帧并推进 pgSeq（返回新 S——帧字节直供）。 */
  async function appendFrame(pid: string, frame: Uint8Array): Promise<bigint> {
    const prev = seqOf[pid] ?? 0n;
    const next = prev + 1n;
    const r = await repo.appendBatch(pid, [seedRow(frame, next)], { expectedPgSeq: prev, newPgSeq: next, walCheckpointSeq: next });
    expect(r).toEqual({ ok: true, rows: 1 });
    seqOf[pid] = next;
    return next;
  }

  async function mediaIdsOf(pid: string): Promise<string[]> {
    const rows = await prisma.canvasReferenceOracle.findMany({ where: { projectId: pid } });
    return rows.map((r) => r.mediaId).sort();
  }

  async function headerOf(pid: string) {
    return prisma.canvasReferenceOracleScan.findUnique({ where: { projectId: pid } });
  }

  // ── ①：候选无关+五容器+JOIN 过滤 ──
  it('①五容器 string 叶全捕获+UUID 形态过滤：Map/Array/Text/XmlElement(属性)/XmlText 各一用例；nodeId（UUID 键+有行）不入表；未知字段捕获；非 UUID/跨队/无行滤除；DELETING 照采', async () => {
    const r = await svc.scanProject(PID_MAIN);
    expect(r).toMatchObject({ outcome: 'complete', verifiedSeq: 1n, refCount: CAPTURED.length });
    expect(await mediaIdsOf(PID_MAIN)).toEqual([...CAPTURED].sort());
    // nodeId 不入表：根键 U.nodeKey 有 Media 行且 UUID 形态——仍不捕获（键非叶子值+JOIN 双保险）
    expect(await mediaIdsOf(PID_MAIN)).not.toContain(U.nodeKey);
    expect(await mediaIdsOf(PID_MAIN)).not.toContain(U.cross);   // JOIN teamId 滤除
    expect(await mediaIdsOf(PID_MAIN)).not.toContain(U.ghost);   // JOIN 行缺滤除（nodeId/edgeId 同族）
    expect(await mediaIdsOf(PID_MAIN)).not.toContain(PLAIN);     // 非 UUID 形态（regex 滤除）
    const h = await headerOf(PID_MAIN);
    expect(h).toMatchObject({ status: 'COMPLETE', verifiedSeq: 1n, generation: 1, refCount: CAPTURED.length });
    const rows = await prisma.canvasReferenceOracle.findMany({ where: { projectId: PID_MAIN } });
    expect(rows.every((x) => x.verifiedSeq === 1n)).toBe(true);
  }, 60_000);

  // ── ②：短事务纪律（锚读→事务外扫描→另事务 CAS）──
  it('②锚读后并发 append 移动 pgSeq ⇒ CAS miss：无行写入+header 停 VERIFYING 非 COMPLETE；复扫在新 pgSeq 落定', async () => {
    const anchor = await svc.snapshotScanAnchor(PID_CAS);
    expect(anchor).toMatchObject({ generation: 1, pgSeq: 1n });
    // 锚读后并发 append（pgSeq 1→2——扫描在事务外、写前 CAS 必 miss）
    const casFrame = (() => {
      const doc = new Y.Doc();
      try {
        const node = new Y.Map<unknown>();
        const data = new Y.Map<unknown>();
        data.set('extraRef', U.map);
        node.set('type', 'imageGen');
        node.set('data', data);
        (doc.getMap('nodes') as Y.Map<unknown>).set('n-cas-2', node);
        return Y.encodeStateAsUpdate(doc);
      } finally { doc.destroy(); }
    })();
    await appendFrame(PID_CAS, casFrame);
    const miss = await svc.scanProjectAt(PID_CAS, anchor!);
    expect(miss.outcome).toBe('cas-miss');
    expect(await prisma.canvasReferenceOracle.count({ where: { projectId: PID_CAS } }), 'CAS miss 不得写行').toBe(0);
    expect((await headerOf(PID_CAS))?.status, 'CAS miss 不得 COMPLETE（VERIFYING 在档=在途可观测）').toBe('VERIFYING');
    // 复扫（新锚）→complete@2
    const r2 = await svc.scanProject(PID_CAS);
    expect(r2).toMatchObject({ outcome: 'complete', verifiedSeq: 2n });
    const h2 = await headerOf(PID_CAS);
    expect(h2).toMatchObject({ status: 'COMPLETE', verifiedSeq: 2n });
  }, 60_000);

  // ── ③：header 状态机+行按 project 原子替换 ──
  it('③重扫=旧行整删不累积（原子替换）；零引用项目 COMPLETE refCount=0', async () => {
    // PID_MAIN 重扫：基态增量帧删全容器节点、只留单一引用节点 → 行集=仅 U.arr（旧 7 行整删）
    const frame2 = incrementalFrame(mainFrame1, (src) => {
      (src.getMap('nodes') as Y.Map<unknown>).delete(U.nodeKey);
      const node = new Y.Map<unknown>();
      const data = new Y.Map<unknown>();
      data.set('only', U.arr);
      node.set('type', 'imageGen');
      node.set('data', data);
      (src.getMap('nodes') as Y.Map<unknown>).set('n-only', node);
    });
    const s2 = await appendFrame(PID_MAIN, frame2);
    const r = await svc.scanProject(PID_MAIN);
    expect(r).toMatchObject({ outcome: 'complete', verifiedSeq: s2, refCount: 1 });
    expect(await mediaIdsOf(PID_MAIN)).toEqual([U.arr]);
    expect((await headerOf(PID_MAIN))?.verifiedSeq).toBe(s2);
    // 零引用：COMPLETE ∧ refCount=0 ∧ 无行
    const rz = await svc.scanProject(PID_ZERO);
    expect(rz).toMatchObject({ outcome: 'complete', refCount: 0 });
    expect(await headerOf(PID_ZERO)).toMatchObject({ status: 'COMPLETE', refCount: 0 });
    expect(await prisma.canvasReferenceOracle.count({ where: { projectId: PID_ZERO } })).toBe(0);
  }, 60_000);

  // ── ④：复用条件逐腿红 ──
  it('④复用=epoch+generation+verifiedSeq 三同∧COMPLETE∧非 dirty——逐腿红：任一移动即重扫', async () => {
    const a = await svc.scanProject(PID_REUSE);
    expect(a).toMatchObject({ outcome: 'complete', verifiedSeq: 1n });
    const before = await headerOf(PID_REUSE);
    // 腿0：全同 → reused（scannedAt 不动）
    expect(await svc.scanProject(PID_REUSE)).toMatchObject({ outcome: 'reused' });
    expect((await headerOf(PID_REUSE))?.scannedAt).toEqual(before?.scannedAt);
    // 腿1：epoch 异（新实例=新 historyEpoch）
    const svc2 = new OracleWorkerService(prisma as never, repo as never);
    expect(await svc2.scanProject(PID_REUSE)).toMatchObject({ outcome: 'complete' });
    expect((await headerOf(PID_REUSE))?.historyEpoch).toBe(svc2.historyEpoch);
    // 腿2：bindingsDirty=true
    await prisma.canvasDoc.updateMany({ where: { projectId: PID_REUSE }, data: { bindingsDirty: true } });
    expect((await svc2.scanProject(PID_REUSE)).outcome).not.toBe('reused');
    await prisma.canvasDoc.updateMany({ where: { projectId: PID_REUSE }, data: { bindingsDirty: false } });
    expect(await svc2.scanProject(PID_REUSE)).toMatchObject({ outcome: 'reused' });
    // 腿3：status≠COMPLETE（FAILED 在档）
    await prisma.canvasReferenceOracleScan.update({ where: { projectId: PID_REUSE }, data: { status: 'FAILED', error: 'test-flip' } });
    expect((await svc2.scanProject(PID_REUSE)).outcome).not.toBe('reused');
    // 腿4：verifiedSeq 移动（pgSeq 前进）
    const reuseFrame = (() => {
      const doc = new Y.Doc();
      try {
        const node = new Y.Map<unknown>();
        const data = new Y.Map<unknown>();
        data.set('r', U.map);
        node.set('type', 'imageGen');
        node.set('data', data);
        (doc.getMap('nodes') as Y.Map<unknown>).set('n-r2', node);
        return Y.encodeStateAsUpdate(doc);
      } finally { doc.destroy(); }
    })();
    await appendFrame(PID_REUSE, reuseFrame);
    expect((await svc2.scanProject(PID_REUSE)).outcome).not.toBe('reused');
    // 腿5：generation 移动
    await prisma.canvasDoc.updateMany({ where: { projectId: PID_REUSE }, data: { generation: 2 } });
    expect((await svc2.scanProject(PID_REUSE)).outcome).not.toBe('reused');
  }, 120_000);

  // ── ⑥：tick 枚举+指标面（置于 ⑤ 前——coverage 全 COMPLETE 形态）──
  it('⑥tick 枚举未扫项目（scope 缝）+coverage_ratio/scan_age 指标落位', async () => {
    const svcTick = new OracleWorkerService(prisma as never, repo as never);
    svcTick.scanScope = ALL_PIDS;
    // 两拍：新实例=新 epoch → 五项目全入候选集（批上界 4/拍）——两拍排空后全 COMPLETE
    const ticked = await svcTick.tick();
    expect(ticked.scanned).toBeGreaterThanOrEqual(1);
    await svcTick.tick();
    // PID_TICK（唯一未扫项目——NULLS FIRST 必入首批）
    expect(await headerOf(PID_TICK)).toMatchObject({ status: 'COMPLETE', verifiedSeq: 1n });
    // 指标：scope 宇宙内五项目全 COMPLETE∧verifiedSeq==pgSeq → coverage=1；scan_age 有界
    const cov = (await oracleCoverageRatio.get())?.values?.[0]?.value;
    expect(cov).toBe(1);
    const age = (await oracleScanAgeSeconds.get())?.values?.[0]?.value;
    expect(age).toBeDefined();
    expect(age!).toBeGreaterThanOrEqual(0);
    expect(age!).toBeLessThan(120);
  }, 60_000);

  // ── ⑤：单 doc 预算超时 bail-out（末位——PID_MAIN 终态 FAILED 留档）──
  it('⑤预算超时 bail-out：typed error→header FAILED（error 非空）+不写行+不 COMPLETE；扫描中断不得 COMPLETE；预算恢复→COMPLETE', async () => {
    const beforeRows = await mediaIdsOf(PID_MAIN);
    expect(beforeRows).toEqual([U.arr]);   // 前置：③ 终态在档（FAILED 不得连坐删行）
    await prisma.canvasDoc.updateMany({ where: { projectId: PID_MAIN }, data: { bindingsDirty: true } });   // 破复用（否则 reused 短路不达扫描）
    svc.scanBudgetMs = 0;                  // 零预算=首查即超（重放/遍历共用同一 deadline）
    const bail = await svc.scanProject(PID_MAIN);
    expect(bail.outcome).toBe('failed');
    expect((bail as { error: string }).error).toMatch(/budget/i);
    const h = await headerOf(PID_MAIN);
    expect(h?.status).toBe('FAILED');
    expect(h?.error).toBeTruthy();
    // 不 COMPLETE、不写行（旧行保留——原子替换只在 CAS 落定事务内发生）
    expect(await mediaIdsOf(PID_MAIN)).toEqual(beforeRows);
    // 预算恢复→COMPLETE
    svc.scanBudgetMs = ORACLE_SCAN_BUDGET_MS;
    expect(await svc.scanProject(PID_MAIN)).toMatchObject({ outcome: 'complete' });
    expect((await headerOf(PID_MAIN))?.status).toBe('COMPLETE');
  }, 60_000);
});
