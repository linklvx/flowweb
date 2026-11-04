import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow, LEASE_FIXTURE_OWNER } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';
import * as Y from 'yjs';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'y0a1-append-int';

maybe('appendBatch（真 PG——Y1c T9 新表形态）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);

  beforeAll(async () => { await ensureProjectFixture(prisma, PID); });
  // Y0a-3（P13）：fence 落地后真库 append 需 CollabLease 行 owner 匹配（beforeEach 续 5min 窗）
  beforeEach(async () => { await ensureLeaseFixture(prisma, repo); });
  afterAll(async () => { await restoreLeaseRow(prisma); await cleanupProjectFixture(prisma, PID); await prisma.$disconnect(); });

  it('appendBatch 返回实插行数：ok:true 且 seq（=walSeq）严格递增、行数一致（局部不变量——walSeq 由 actor/spool 单调分配，此处直接供给）', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    // 每帧载荷相异（@@unique(projectId,generation,updateHash) 幂等轴——同 payload 重发会被 DO NOTHING
    // 吞行折 fenced；walSeq 严格递增=行 seq 口径）
    const seqs: bigint[] = [];
    for (let i = 0; i < 3; i++) {
      const d = new Y.Doc(); d.getMap('nodes').set(`n${i}`, i);
      const r = await repo.appendBatch(PID, [seedRow(Y.encodeStateAsUpdate(d), BigInt(i + 1))]);
      expect(r.ok).toBe(true);          // 契约 15 承继：成功判据=ok===true
      if (r.ok) seqs.push(BigInt(i + 1));
    }
    expect(seqs[1] > seqs[0]).toBe(true);
    expect(seqs[2] > seqs[1]).toBe(true);
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(3);
  });

  it('重复 (projectId,generation,updateHash) 批重发=ON CONFLICT DO NOTHING 幂等（重试/重组批幂等锚——Y1c T9 唯一约束换轴：旧 (projectId,seq) P2002 行为锚随 nextval 退役）', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    const d = new Y.Doc(); d.getMap('nodes').set('dup', 1);
    const u = Y.encodeStateAsUpdate(d);
    const row = seedRow(u, 10n);
    const r0 = await repo.appendBatch(PID, [row]);                   // 占用该 updateHash
    expect(r0).toEqual({ ok: true, rows: 1 });
    const r1 = await repo.appendBatch(PID, [row]);                   // 同帧重发（重试路径——同 hash 同 PK）
    expect(r1).toEqual({ ok: true, rows: 0 });                       // 幂等零实插（不抛 P2002——静默吸收）
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(1);
    // 同 seq 异 updateHash 仍被 PK 拒（约束轴拆分锚）
    await expect(
      prisma.canvasDocUpdate.create({ data: { projectId: PID, generation: 1, seq: 10n, firstWalSeq: 10n, frameCount: 1, updateHash: createHash('sha256').update('other').digest('hex'), update: Buffer.from([0]) } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  // ── T30b 根修 B 红锚：重启窗 cas-miss + 同 updateHash 吞行 = 幂等 ok（红=旧 fenced）──
  // 实弹链（gate-collab S1 重连稳定红根因）：进程重启后 spool 水位三元未重建 ⇒ actor 首刷
  // expectedPgSeq=0 而 PG pgSeq>0 ⇒ CAS 恒 cas-miss；客户端重连同字节帧（空 SS2 更新恒同
  // updateHash）以新 seq INSERT 被 @@updateHash 唯一吞行（inserted=0）⇒ cas-miss 分支 PK 回查
  // （seq=新 seq）必缺行 → fencedClassify → fenced → selfIsolate → 卸载拒绝/re-listen 死锁。
  // 修=cas-miss 分支回查 hash 感知：行集 updateHash 全在档（任意 seq）=同内容幂等重发——放行
  // adopt 重定基（与 0-行两分桶「updateHash 已在=幂等 no-op」同语义，补 cas-miss 形态盲区）。
  it('T30b-B：重启窗首刷 cas-miss（expected=0 vs pgSeq>0）+同 updateHash 吞行=幂等 ok+adopt 重定基（红=旧 fenced）', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.create({
      data: { projectId: PID, generation: 1, schemaVersion: 3, pgSeq: 0n, walCheckpointSeq: 0n },
    });
    try {
      // 前任进程已落定：帧 walSeq=12（pgSeq 0→12）
      const d = new Y.Doc(); d.getMap('nodes').set('restart-dup', 1);
      const u = Y.encodeStateAsUpdate(d);
      const r0 = await repo.appendBatch(PID, [seedRow(u, 12n)], { expectedPgSeq: 0n, newPgSeq: 12n, walCheckpointSeq: 12n });
      expect(r0).toEqual({ ok: true, rows: 1 });
      // 新进程首刷：expected=0（水位未重建）⇒ cas-miss；同字节重发帧（同 updateHash、新 seq 13）⇒ INSERT 吞行
      const r1 = await repo.appendBatch(PID, [seedRow(u, 13n)], { expectedPgSeq: 0n, newPgSeq: 13n, walCheckpointSeq: 13n });
      expect(r1).toEqual({ ok: true, rows: 0 });   // 红：旧=cas-miss 分支 PK 回查缺行→fenced（S1 重连 fencing 链）
      expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(1);   // 行集不变（吞行幂等）
      expect(await repo.readWatermark(PID)).toMatchObject({ pgSeq: 13n });   // adopt 重定基（幂等水位推进——0-行桶同语义）
    } finally {
      await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
      await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    }
  });

  // ── T30b 双评审微批 B2（spec P2-2/quality P2-1 同提）：cas-miss hash 回查判据域对齐 ──
  // verifyRowsLandedByHash 补 generation 谓词——对齐 0-行两分桶与 @@unique([projectId,generation,
  // updateHash]) 约束域。现行写路径（vacuumReplace 同事务整删旧代行+seed 全删）跨代幸存结构性
  // 不可达；「旧代行幸存」形态下无谓词回查跨代命中同 hash ⇒「并发收敛」档假 ok（本代未落而放行
  // =调用方 confirm/splice 前缀后 WAL 帧副本被回收的静默丢帧窗）。布景=租约易主使 INSERT 零落。
  it('T30b-B2：cas-miss hash 回查限本代——跨代幸存行同 updateHash 不得误放行「并发收敛」档（红=旧回查无 generation 谓词）', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    try {
      // 旧代（gen=1）落定 hash H；换代+并发推进 pgSeq=30（新代账本无 H）；租约易主=INSERT 零落
      const d = new Y.Doc(); d.getMap('nodes').set('cross-gen', 1);
      const u = Y.encodeStateAsUpdate(d);
      const r0 = await repo.appendBatch(PID, [seedRow(u, 12n, 1)], { expectedPgSeq: 0n, newPgSeq: 12n, walCheckpointSeq: 12n });
      expect(r0).toEqual({ ok: true, rows: 1 });
      await prisma.canvasDoc.update({ where: { projectId: PID }, data: { generation: 2, pgSeq: 30n, walCheckpointSeq: 30n } });
      await prisma.$executeRawUnsafe(`UPDATE "CollabLease" SET owner = 't30b-b2-intruder' WHERE scope = 'primary'`);
      // gen=2 同内容重发（同 hash H）：lastWalSeq=35>30 绕 C1② tripwire；租约拦=INSERT 0 行+
      // expected=0 恒 cas-miss+PK 缺行 ⇒ hash 回查面；newPgSeq=25≤30 ⇒「并发收敛」出口即回查担保。
      // 旧回查无代谓词命中 gen=1 幸存行 ⇒ 假 ok；修复后本代无 H ⇒ fenced
      const r1 = await repo.appendBatch(PID, [seedRow(u, 35n, 2)], { expectedPgSeq: 0n, newPgSeq: 25n, walCheckpointSeq: 35n });
      expect(r1).toEqual({ ok: false, reason: 'fenced' });   // 红：旧={ok:true,rows:0}（跨代误放行）
      expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID, generation: 2 } })).toBe(0);   // 本代零落（账本未污染）
    } finally {
      await prisma.$executeRawUnsafe(`UPDATE "CollabLease" SET owner = ${JSON.stringify(LEASE_FIXTURE_OWNER)} WHERE scope = 'primary'`).catch(() => {});
      await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
      await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    }
  });

  it('C1（T10 收口）facet A 真 PG：租约易主窗 CAS 形态——INSERT/UPDATE 全被 fence 拦，pgSeq 不推进+返回 fenced（红=旧实现水位越过未插入行=恢复基线污染）', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    // 布景：CanvasDoc 行在（pgSeq=0——首帧前形态；generation=1 与 seedRow 默认一致）
    await prisma.canvasDoc.create({
      data: { projectId: PID, generation: 1, schemaVersion: 3, pgSeq: 0n, walCheckpointSeq: 0n },   // Y1c T11：零 doc 态列
    });
    // 租约易主（模拟丢失窗：repo 侧 owner 已绑 fixture owner，DB 行 owner=外来者）
    await prisma.$executeRawUnsafe(`UPDATE "CollabLease" SET owner = 'c1-intruder' WHERE scope = 'primary'`);
    try {
      const d = new Y.Doc(); d.getMap('nodes').set('c1a', 1);
      const r = await repo.appendBatch(PID, [seedRow(Y.encodeStateAsUpdate(d), 50n)], { expectedPgSeq: 0n, newPgSeq: 50n, walCheckpointSeq: 50n });
      expect(r).toEqual({ ok: false, reason: 'fenced' });
      expect(await repo.readWatermark(PID)).toMatchObject({ pgSeq: 0n });   // 红：旧实现 UPDATE 无 lease fence——pgSeq 被推到 50（水位越过未插入行）
      expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(0);   // 零行插入
      // 租约回手重试（幂等收敛档）：行+水位同步落定——fence 修复不误伤正常路径
      await ensureLeaseFixture(prisma, repo);
      const r2 = await repo.appendBatch(PID, [seedRow(Y.encodeStateAsUpdate(d), 50n)], { expectedPgSeq: 0n, newPgSeq: 50n, walCheckpointSeq: 50n });
      expect(r2).toEqual({ ok: true, rows: 1 });
      expect(await repo.readWatermark(PID)).toMatchObject({ pgSeq: 50n });
    } finally {
      await prisma.$executeRawUnsafe(`UPDATE "CollabLease" SET owner = ${JSON.stringify(LEASE_FIXTURE_OWNER)} WHERE scope = 'primary'`).catch(() => {});
      await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
      await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    }
  });
});
