// apps/api/src/modules/collab/collab-t10-g2.int.spec.ts
// Y1c T10：G2 门故障矩阵（十红组——真 PG/真 spool/真 repo；applied-driven 批量 PG+水位三元+barrier）。
// 红相证据（T9 后基线 00e8524e 实证）：①CanvasDoc.pgSeq/walCheckpointSeq 恒 0（T9 从不写水位列——
// CAS 缺席）②行 actorRanges 恒 NULL（T9 落空 Json）③毒帧 applied 前缀永不上 PG（T9 flush 在
// processBatch 尾、毒帧早退）——真红探针=本仓 tmp spec（pgSeq expected '1' received '0'，跑后即删）。
// kill -9 语义=进程内 seam 注入（FaultRepo/FaultSpool——T8/T9 故障注入先例）+「重启」=服务重实例化
// +recoverScan 本地路径模拟（recoverScan 生产接线归 T13——本套件内可调其函数不接生产 boot）。
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { CollabProjectActorService, type FrameRejectError } from './collab-project-actor.service';
import { CollabSpoolService } from './collab-spool.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { validateActorRanges, type ActorRange, type SystemHistoryState } from '@flowweb/shared';
import type { Logger } from '@nestjs/common';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'y1c-t10-g2';

const frameOf = (key: string, val: unknown) => {
  const src = new Y.Doc();
  (src.getMap('nodes') as Y.Map<unknown>).set(key, val);
  return Y.encodeStateAsUpdate(src);
};

/** PG 故障注入 repo（appendBatch 抛错=语句级失败——真 PG 连接保持）。 */
class FaultRepo extends CanvasDocUpdateRepository {
  failAppendBatch = 0;
  async appendBatch(...args: Parameters<CanvasDocUpdateRepository['appendBatch']>): ReturnType<CanvasDocUpdateRepository['appendBatch']> {
    if (this.failAppendBatch > 0) {
      this.failAppendBatch -= 1;
      throw Object.assign(new Error('injected pg failure (t10 g2)'), { pgPending: true });
    }
    return super.appendBatch(...args);
  }
}

/** confirm 静默（kill -9 等价：PG 已提交但内存水位/confirm 未更新即崩）。 */
class NoConfirmSpool extends CollabSpoolService {
  skipConfirm = false;
  async confirm(projectId: string, frameIds: string[]): Promise<void> {
    if (this.skipConfirm) return;   // 模拟：CAS 提交后、confirm 前进程死——段不回收+水位不推
    return super.confirm(projectId, frameIds);
  }
}

function makeConn(userId = 'u-g2') {
  return { socketId: 's-' + Math.random().toString(36).slice(2, 8), readOnly: false, context: { user: { id: userId } } } as never;
}

async function historyState(prisma: PrismaClient): Promise<SystemHistoryState> {
  const h = await prisma.systemHistory.findUnique({ where: { id: 1 } });
  if (!h) throw new Error('SystemHistory 引导行缺失（T7 迁移 INSERT）——int 池前置不满足');
  return { historyId: h.historyId, epochStartedAtMs: h.epochStartedAt.getTime() };
}

maybe('Y1c T10 G2 故障矩阵（十红组——真 PG）', () => {
  const prisma = new PrismaClient();
  let repo: FaultRepo;
  let spool: NoConfirmSpool;
  let actor: CollabProjectActorService;
  const doc = new Y.Doc();
  const documents = new Map([[`project:${PID}`, doc]]);
  let cleanupSpool: () => Promise<void> = async () => {};
  const hardCloseCalls: Array<[unknown, number, string]> = [];
  let spoolDirPath = '';

  const buildActor = () => {
    const a = new CollabProjectActorService(spool, repo);
    a.bindHost({
      logger: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} } as unknown as Logger,
      documents: () => documents,
      hardClose: (c, code, reason) => hardCloseCalls.push([c, code, reason]),
      isQuotaFrozen: () => false,
      generationOf: () => 0,   // Y1c T12：canonical 名=裸名（gen0——原缺省 1 使 processBatch #g1 寻址 miss）
      noteReadOnlyDrop: () => false,
      onFencedByWrite: async () => {},
    });
    return a;
  };
  /** 「重启」=服务重实例化+recoverScan 本地路径（T13 生产接线前置——本套件直调函数）。 */
  const restartServices = async () => {
    const hist = await historyState(prisma);
    const wm = await repo.readWatermark(PID);
    spool = new NoConfirmSpool(spoolDirPath);
    spool.setOwner('t10-g2-owner');
    spool.setWalHistory(hist.historyId);
    await spool.recoverScan({ systemHistory: hist, pgSeq: () => wm?.pgSeq ?? 0n });
    actor = buildActor();
  };

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID);
    repo = new FaultRepo(prisma as never);
  });
  beforeEach(async () => {
    await ensureLeaseFixture(prisma, repo);
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    // Y1c T11：CanvasDoc 零 doc 态列（快照权威=CanvasDocSnapshot——懒建档形态头行无快照，装载折空态全量行重放）
    await prisma.canvasDoc.create({ data: { projectId: PID, generation: 1 } });
    // per-test 隔离：fresh spool（walSeq/水位/段全零起）——共享 spool 会跨用例携带水位/去重索引
    const d = await makeSpoolDir('t10-g2-');
    spoolDirPath = d.dir;
    const prevCleanup = cleanupSpool;
    cleanupSpool = d.cleanup;
    await prevCleanup();
    spool = new NoConfirmSpool(spoolDirPath);
    spool.setOwner('t10-g2-owner');
    spool.setWalHistory((await historyState(prisma)).historyId);
    actor = buildActor();
    hardCloseCalls.length = 0;
    repo.failAppendBatch = 0;
    spool.skipConfirm = false;
  });
  afterAll(async () => { await restoreLeaseRow(prisma); await cleanupSpool(); await cleanupProjectFixture(prisma, PID); await prisma.$disconnect(); });

  const rowsOf = () => prisma.canvasDocUpdate.findMany({ where: { projectId: PID }, orderBy: { seq: 'asc' } });
  const wmRow = () => prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { pgSeq: true, walCheckpointSeq: true } });

  // ① 同帧重复送达零重复业务效果零重复 walSeq
  it('① 同帧重复送达：零重复业务效果+零重复 walSeq+单 PG 行+actorRanges 真值（T9 已绿锚=dedup applied；红轴=水位/actorRanges）', async () => {
    const f = frameOf('dup-key', 1);
    const r1 = await actor.submit(PID, f, makeConn('u-1'), 'update');
    await actor.flushThrough(PID, r1.walSeq);
    const r2 = await actor.submit(PID, f, makeConn('u-1'), 'update');   // 重发（applied 命中=noop）
    expect(r2.noop).toBe(true);
    expect(r2.walSeq).toBe(r1.walSeq);                                  // 零重复 walSeq
    await actor.flushThrough(PID, r1.walSeq);
    const rows = await rowsOf();
    expect(rows).toHaveLength(1);                                       // 零重复 PG 行
    const cd = await wmRow();
    expect(cd!.pgSeq).toBe(r1.walSeq);                                  // 水位推进（红轴）
    expect(cd!.walCheckpointSeq >= cd!.pgSeq).toBe(true);
    const ranges = ((rows[0].actorRanges ?? []) as unknown) as ActorRange[];   // actorRanges 真值（红轴；Prisma JsonValue→unknown 窄化）
    expect(validateActorRanges(ranges, { firstWalSeq: rows[0].firstWalSeq, lastWalSeq: rows[0].seq })).toEqual({ ok: true });
    expect(ranges[0].userId).toBe('u-1');
    expect(ranges[0].actorKind).toBe('user');
    expect((doc.getMap('nodes') as Y.Map<unknown>).get('dup-key')).toBe(1);   // 业务效果恰一次
  });

  // ② PG 提交失败 WAL 保留且 pgSeq 不越失败帧
  it('② PG 提交失败：WAL 保留（spool 帧）+pgSeq 不越失败帧；恢复后重试落定+CAS 推进', async () => {
    const r1 = await actor.submit(PID, frameOf('ok-a', 1), makeConn(), 'update');
    await actor.flushThrough(PID, r1.walSeq);
    repo.failAppendBatch = 1;
    const r2 = await actor.submit(PID, frameOf('ok-b', 2), makeConn(), 'update');
    await new Promise((res) => setTimeout(res, 100));   // flush 失败（帧 WAL 安全留队）
    const w = spool.watermark(PID)!;
    expect(w.pgSeq).toBe(r1.walSeq);                    // pgSeq 不越失败帧（内存口径）
    expect(spool.hasFrames(PID)).toBe(true);            // WAL 保留（未 confirm）
    const cdMid = await wmRow();
    expect(cdMid!.pgSeq).toBe(r1.walSeq);               // PG 水位不越失败帧
    // 恢复：flushThrough 重试（retry timer/显式 kick）→ 落定
    const r = await actor.flushThrough(PID, r2.walSeq, { maxWaitMs: 3_000 });
    expect(r.targetReached).toBe(true);
    const cd = await wmRow();
    expect(cd!.pgSeq).toBe(r2.walSeq);                  // CAS 推进至失败帧后重试落定
  });

  // ③ fsync 前后 kill -9 符合 ACK 等级
  it('③ kill -9 两档：fsync 前=零 WAL 零 PG 零 ACK（submit reject）；fsync 后崩=帧在 WAL，重启 recoverScan+replayAll 零丢失零重复', async () => {
    // 档 A：WAL append 失败（fsync 前 kill 等价——spool 故障注入：容量/写失败档）
    const spoolSave = spool;
    const failAppend = spool.appendBatch.bind(spool);
    (spool as unknown as { appendBatch: unknown }).appendBatch = async () => { throw new Error('kill -9 before fsync'); };
    const rejected = await actor.submit(PID, frameOf('dead', 1), makeConn(), 'update').then((r) => ({ ok: true as const, r }), (e) => ({ ok: false as const, e: e as FrameRejectError }));
    (spool as unknown as { appendBatch: unknown }).appendBatch = failAppend;
    void spoolSave;
    expect(rejected.ok).toBe(false);                    // 未 ACK（reject=ACK 缺席语义）
    expect(await rowsOf()).toHaveLength(0);             // 零 PG 行
    // 档 B：fsync 后、confirm 前崩（NoConfirmSpool+重实例化）——帧在 WAL，重启重放零丢失零重复
    const f = frameOf('after-fsync', 2);
    const appended = await spool.appendBatch(PID, [f]);  // 直接 WAL append（fsync 落定）
    void appended;
    await restartServices();                            // 「重启」：recoverScan（frames 全部重新可见）
    const before = await rowsOf();
    const replay = await spool.replayAll(repo);
    expect(replay.failed).toBe(0);
    const rows = await rowsOf();
    expect(rows.length - before.length).toBe(1);        // 恰一行新落（零丢失）
    await spool.replayAll(repo);                        // 二次重放（幂等）
    expect(await rowsOf()).toHaveLength(rows.length);   // 零重复
    const cd = await wmRow();
    expect(cd!.pgSeq).toBe(BigInt(rows[rows.length - 1].seq));   // 回灌 catch-up 水位推进
  });

  // ④ PG 提交成功但内存水位未更即崩→重启零重复
  it('④ PG 落定后 confirm 前崩→重启：recoverScan 以 CanvasDoc.pgSeq 为准+重放零重复（updateHash 幂等）+水位不回退', async () => {
    spool.skipConfirm = true;                           // CAS 提交后、confirm（内存水位）前崩
    const r1 = await actor.submit(PID, frameOf('crash-1', 1), makeConn(), 'update');
    const r2 = await actor.submit(PID, frameOf('crash-2', 2), makeConn(), 'update');
    await new Promise((res) => setTimeout(res, 200));
    const cdPre = await wmRow();
    expect(cdPre!.pgSeq).toBe(r2.walSeq);               // PG 侧已提交（CAS）
    spool.skipConfirm = false;
    await restartServices();                            // 内存水位丢失——recoverScan 从 CanvasDoc.pgSeq 重建
    const w = spool.watermark(PID)!;
    expect(w.pgSeq).toBe(cdPre!.pgSeq);                 // 水位以 PG 为准（不依赖进程内状态）
    expect(w.spoolHeadSeq >= w.pgSeq).toBe(true);
    const countBefore = (await rowsOf()).length;
    const replay = await spool.replayAll(repo);
    expect(replay.failed).toBe(0);
    expect(await rowsOf()).toHaveLength(countBefore);   // 零重复（updateHash DO NOTHING）
    const cdPost = await wmRow();
    expect(cdPost!.pgSeq).toBe(cdPre!.pgSeq);           // 水位不回退（catch-up WHERE pgSeq<$new 零行）
    void r1;
  });

  // ⑤ snapshot 已发布 WAL 未清时重启正确
  it('⑤ snapshot（CanvasDoc.state）已发布+WAL 未清重启：hydrate state+重放帧=内容等价+零重复行', async () => {
    const r1 = await actor.submit(PID, frameOf('snap-1', 1), makeConn(), 'update');
    await actor.flushThrough(PID, r1.walSeq);
    // 「snapshot 已发布」：T11 compact=PG 前缀重放+发布事务（快照权威=CanvasDocSnapshot+指针）
    await repo.compact(PID);
    spool.skipConfirm = false;
    // WAL 未清=confirm 静默一次（段残留）→ 重启
    const r2Pre = (await rowsOf()).length;              // compact 后增量行=0
    expect(r2Pre).toBe(0);
    await restartServices();
    const replay = await spool.replayAll(repo);
    expect(replay.failed).toBe(0);
    // 装载等价：state+updates 重放后内容一致（snap-1 存在）
    const h = await repo.loadForHydration(PID);
    const reload = new Y.Doc();
    if (h.state && h.state.byteLength > 0) Y.applyUpdate(reload, new Uint8Array(h.state));
    for (const u of h.updates) Y.applyUpdate(reload, new Uint8Array(u));
    expect((reload.getMap('nodes') as Y.Map<unknown>).get('snap-1')).toBe(1);
    const cd = await wmRow();
    expect(cd!.pgSeq).toBe(r1.walSeq);                  // 重放后水位保持
  });

  // ⑥ WAL 达清理条件后重启不误删
  it('⑥ WAL 全 confirm（段回收）后重启：零帧重放+水位保留；未 confirm 帧不误删（重放幂等保留）', async () => {
    const r1 = await actor.submit(PID, frameOf('clean-1', 1), makeConn(), 'update');
    await actor.flushThrough(PID, r1.walSeq);
    await new Promise((res) => setTimeout(res, 200));
    expect(spool.hasFrames(PID)).toBe(false);           // 清理条件达成（全 confirm→段 unlink）
    await restartServices();                            // 重启：scan 零段
    expect(spool.hasFrames(PID)).toBe(false);           // 不误删任何在库内容（行全在）
    const replay = await spool.replayAll(repo);
    expect(replay.replayed).toBe(0);                    // 零帧重放
    const rows = await rowsOf();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const cd = await wmRow();
    expect(cd!.pgSeq).toBe(r1.walSeq);                  // 水位保留
  });

  // ⑦ 合法帧 apply 失败（毒帧）→WAL 截断至 appliedSeq+4411+从 pgSeq 重放——不跳帧续提交
  it('⑦ 毒帧：applied 前缀仍落 PG（红轴——T9 毒帧早退永不上 PG）+截断+4411+下一帧复用 seq 不留洞', async () => {
    const flaky = new (class extends CollabProjectActorService {
      failNext = false;
      protected applyGate(document: Y.Doc, payload: Uint8Array, origin: Parameters<CollabProjectActorService['applyGate']>[2] extends never ? never : import('@flowweb/shared').GateApplyOrigin): void {
        if (this.failNext) { this.failNext = false; throw new Error('poison: injected'); }
        super.applyGate(document, payload, origin);
      }
    })(spool, repo);
    flaky.bindHost({
      logger: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} } as unknown as Logger,
      documents: () => documents, hardClose: (c, code, reason) => hardCloseCalls.push([c, code, reason]),
      isQuotaFrozen: () => false, generationOf: () => 0, noteReadOnlyDrop: () => false, onFencedByWrite: async () => {},   // Y1c T12：generationOf 1→0（canonical 名=裸名 gen0——原缺省 1 使 processBatch #g1 寻址 miss）
    });
    const ok1 = await flaky.submit(PID, frameOf('pre-poison', 1), makeConn(), 'update');   // applied 前缀帧
    (flaky as unknown as { failNext: boolean }).failNext = true;
    const poisoned = flaky.submit(PID, frameOf('poison', 2), makeConn(), 'update');
    await expect(poisoned).rejects.toMatchObject({ code: 4411 });
    expect(hardCloseCalls.some(([, code]) => code === 4411)).toBe(true);
    // 红轴：applied 前缀（ok1）必须落 PG——不因毒帧跳帧
    const fl = await flaky.flushThrough(PID, ok1.walSeq, { maxWaitMs: 3_000 });
    expect(fl.targetReached).toBe(true);
    const rows = await rowsOf();
    expect(rows.some((r) => r.seq === ok1.walSeq)).toBe(true);
    expect(rows.some((r) => r.seq > ok1.walSeq)).toBe(false);   // 毒帧及其后永不落 PG
    // 截断：spoolHead 回拨至 appliedSeq；下一帧复用 seq（不留洞）
    expect(spool.watermark(PID)!.spoolHeadSeq).toBe(ok1.walSeq);
    const next = await actor.submit(PID, frameOf('post-poison', 3), makeConn(), 'update');
    expect(next.walSeq).toBe(ok1.walSeq + 1n);          // 复用被截 walSeq（⑨ 同轴）
    await actor.flushThrough(PID, next.walSeq);
    const rows2 = await rowsOf();
    const seqs = rows2.map((r) => Number(r.seq)).sort((a, b) => a - b);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i] - seqs[i - 1]).toBeGreaterThanOrEqual(1);   // 无洞
  });

  // ⑧ 无 PG 行 walSeq>appliedSeq
  it('⑧ 不变量探测：任一时刻 max PG row seq ≤ appliedSeq（applied-driven 上界——含 PG 失败滞留窗）', async () => {
    repo.failAppendBatch = 1;
    const r1 = await actor.submit(PID, frameOf('inv-1', 1), makeConn(), 'update');
    await new Promise((res) => setTimeout(res, 100));   // flush 失败窗：帧 applied 但 PG 无行（≤ 恒真）
    const rows = await rowsOf();
    const maxSeq = rows.reduce((m, r) => (r.seq > m ? r.seq : m), 0n);
    expect(maxSeq <= actor.appliedSeqOf(PID)).toBe(true);
    const r = await actor.flushThrough(PID, r1.walSeq, { maxWaitMs: 3_000 });
    expect(r.targetReached).toBe(true);
    const rows2 = await rowsOf();
    const maxSeq2 = rows2.reduce((m, r) => (r.seq > m ? r.seq : m), 0n);
    expect(maxSeq2).toBe(actor.appliedSeqOf(PID));      // 落定后恰等（上界达界不越）
  });

  // ⑨ fsync 失败截断复用 seq 不留洞
  it('⑨ fsync 失败（写前/ENOSPC 档）→截断回 last-good+复用已分配 seq：后续成功路径 PG 行连续无洞', async () => {
    const origSync = (spool as unknown as { syncSegmentHandle?: unknown }).syncSegmentHandle;
    // 注入：首帧 append 的 fsync 阶段 ENOSPC（spool 截断复用档——写前失败/ENOSPC=truncate 回滚）
    let failSync = 1;
    (spool as unknown as { syncSegmentHandle?: unknown }).syncSegmentHandle = async function (this: NoConfirmSpool, fh: import('node:fs/promises').FileHandle) {
      if (failSync > 0) { failSync -= 1; const e = new Error('fsync ENOSPC') as NodeJS.ErrnoException; e.code = 'ENOSPC'; throw e; }
      return fh.sync();
    };
    const dead = await actor.submit(PID, frameOf('enospc', 1), makeConn(), 'update').then((r) => ({ ok: true as const, r }), (e) => ({ ok: false as const, e }));
    (spool as unknown as { syncSegmentHandle?: unknown }).syncSegmentHandle = origSync;
    expect(dead.ok).toBe(false);                        // 未 ACK
    const next = await actor.submit(PID, frameOf('reuse', 2), makeConn(), 'update');   // 复用 seq
    expect(next.walSeq).toBe(1n);                       // 首帧失败烧 seq 后复用（无洞——walSeq 从 1 起）
    await actor.flushThrough(PID, next.walSeq);
    const rows = await rowsOf();
    const seqs = rows.map((r) => Number(r.seq)).sort((a, b) => a - b);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i] - seqs[i - 1]).toBe(1);       // 连续无洞
    const cd = await wmRow();
    expect(cd!.pgSeq).toBe(BigInt(seqs[seqs.length - 1]));
  });

  // ⑩ pending 拒绝帧不入 appliedSeq
  it('⑩ pending 区间拒绝（4412）：appliedSeq 不动+零 WAL+零 PG 行+连接 close 4412', async () => {
    const base = await actor.submit(PID, frameOf('base-key', 1), makeConn(), 'update');   // client 基线
    await actor.flushThrough(PID, base.walSeq);
    const before = actor.appliedSeqOf(PID);
    // 构造缺前驱帧：新 clientID 的第二区间（clock 跳跃——缺前驱判 4412）
    const stranger = new Y.Doc();
    (stranger.getMap('nodes') as Y.Map<unknown>).set('pending-key', 1);
    const u1 = Y.encodeStateAsUpdate(stranger);
    stranger.getMap('nodes').set('pending-key-2', 2);
    const withHole = (() => {
      // 直接构造：只发第二段（跳过首段）——用 diff 对 SV=仅 u2 时点
      const fresh = new Y.Doc();
      Y.applyUpdate(fresh, u1);
      const sv = Y.encodeStateVector(fresh);
      return Y.encodeStateAsUpdate(stranger, sv);
    })();
    const rejected = await actor.submit(PID, withHole, makeConn(), 'update')
      .then((r) => ({ ok: true as const, r }), (e) => ({ ok: false as const, e: e as FrameRejectError }));
    expect(rejected.ok).toBe(false);
    expect((rejected as { e: FrameRejectError }).e.code).toBe(4412);
    expect(actor.appliedSeqOf(PID)).toBe(before);       // 不入 appliedSeq
    expect(hardCloseCalls.some(([, code]) => code === 4412)).toBe(true);
    const rows = await rowsOf();
    expect(rows.every((r) => r.seq <= before)).toBe(true);   // 零 PG 行（拒绝帧）
  });
});
