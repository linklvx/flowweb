// apps/api/src/modules/collab/collab-t13-g6a.int.spec.ts
// Y1c T13：G6a 门——单实例故障恢复（doc 平面）· 真 PG 实弹（vitest.int 池）。
// 覆盖：I1 pg_dump 实弹（真 pg_dump 工具产出 dump 文件→delete→psql 灌回真恢复→bump historyId→
// 旧段禁重放+fail-closed violation）；I2 忘 bump+restore.lock（F-S4-5 信号①——时间戳栅栏拦截实弹）；
// I3 8MiB SS2 恢复路径（WS 通道口径 submit kind='ss2'——无 HTTP seed）；I4 多项目 actor 原型管线
// 恢复（S4 决策落地验证）+ETag 不超前 pgSeq。
// kill -9 语义=进程内 seam（FaultRepo 故障注入）+服务重实例化+**生产 boot 路径已接线**（T13 落地——
// 与 T10 g2 套件「直调函数」形态的差异面）；真子进程 spawn+SIGKILL 物理形态见
// collab-t13-kill9.process.spec.ts。
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as Y from 'yjs';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollabProjectActorService } from './collab-project-actor.service';
import { CollabSpoolService } from './collab-spool.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { formatDocETag, type SystemHistoryState } from '@flowweb/shared';
import type { Logger } from '@nestjs/common';

const execFileP = promisify(execFile);
const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

/** pg 工具探测（实弹工具链）：PG_BIN_DIR 显式覆盖→常见安装路径同步探测；缺=I1 显式 it.skip（登记）。
 *  M2（T13 收口）：①二进制名按平台（win=.exe/unix 无后缀——旧硬编码 'pg_dump.exe' 使 Linux CI 恒
 *  miss）；②缺工具改 it.skip（旧形态 console.error+return=vitest 判 pass 的假绿——显式 skip 进
 *  skipped 计数=CI 面诚实显式化；本机实弹工具在位时 skipped=0 语义实然不变）。 */
const PG_DUMP_BIN = process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump';
const PSQL_BIN = process.platform === 'win32' ? 'psql.exe' : 'psql';
const PG_BIN_CANDIDATES: string[] = process.platform === 'win32'
  ? ['D:/programfiles/PostgreSQL/16/bin', 'C:/Program Files/PostgreSQL/16/bin', 'C:/Program Files/PostgreSQL/15/bin']
  : ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/lib/postgresql/14/bin', '/usr/local/bin', '/usr/bin'];
const PG_BIN_DIR: string | null = process.env.PG_BIN_DIR
  || PG_BIN_CANDIDATES.find((c) => existsSync(join(c, PG_DUMP_BIN))) || null;

const DB_URL = (process.env.DATABASE_URL ?? '').replace(/^"|"$/g, '');
const PIDS = ['y1c-t13-a', 'y1c-t13-b', 'y1c-t13-c'];

const frameOf = (key: string, val: unknown, big?: Uint8Array) => {
  const d = new Y.Doc();
  const m = d.getMap('nodes') as Y.Map<unknown>;
  if (big) m.set(key, big); else m.set(key, val);
  return Y.encodeStateAsUpdate(d);
};

/** 8MiB 级 SS2 帧（63×128KiB≈7.7MiB<8.06MiB 帧闸——WS maxPayload 9MiB 通道口径）。 */
function ss2BigFrame(): Uint8Array {
  const d = new Y.Doc();
  const m = d.getMap('nodes') as Y.Map<unknown>;
  for (let i = 0; i < 63; i++) m.set('big-' + i, new Uint8Array(128 * 1024).fill(1 + i));
  return Y.encodeStateAsUpdate(d);
}

function makeConn(userId = 'u-t13') {
  return { socketId: 's-' + Math.random().toString(36).slice(2, 8), readOnly: false, context: { user: { id: userId } } } as never;
}

async function historyState(prisma: PrismaClient): Promise<SystemHistoryState> {
  const h = await prisma.systemHistory.findUnique({ where: { id: 1 } });
  if (!h) throw new Error('SystemHistory 引导行缺失（T7 迁移 INSERT）——int 池前置不满足');
  return { historyId: h.historyId, epochStartedAtMs: h.epochStartedAt.getTime() };
}

const noopLogger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} } as unknown as Logger;

maybe('Y1c T13 G6a 实弹（真 PG+真 spool+真 actor 管线——boot 生产恢复路径）', () => {
  const prisma = new PrismaClient();
  let repo: CanvasDocUpdateRepository;
  let spool: CollabSpoolService;
  let actor: CollabProjectActorService;
  let spoolDirPath = '';
  let cleanupSpool: () => Promise<void> = async () => {};
  const documents = new Map<string, Y.Doc>();
  let savedHistoryId = '';
  let savedEpoch: Date;

  const buildActor = (r: CanvasDocUpdateRepository = repo) => {
    const a = new CollabProjectActorService(spool, r);
    a.bindHost({
      logger: noopLogger,
      documents: () => documents,
      hardClose: () => {},
      isQuotaFrozen: () => false,
      generationOf: () => 0,   // 裸名寻址（t10 g2 kit 同款——documents map key=project:<pid>）
      noteReadOnlyDrop: () => false,
      onFencedByWrite: async () => {},
    });
    return a;
  };

  /** 「重启」=服务重实例化+**生产 boot 恢复顺序**（T13 接线形态：SystemHistory 快照→restore.lock 门控→
   *  recoverScan→violation/suspect fail-closed→播种→replayAll——与 gateway startCollabAfterLease 同序）。 */
  const restartBoot = async (dbUrl: string = DB_URL) => {
    const p = new PrismaClient({ datasources: { db: { url: dbUrl } } } as never);
    const r = new CanvasDocUpdateRepository(p as never);
    r.setLeaseOwner('int-test-lease');   // 契约 16：单写者 PG 腿 fail-closed 门（ensureLeaseFixture 行 owner——重启=租约重持同 owner）
    const hist = await historyState(p);
    const floors = await r.pgSeqFloors();
    const pgSeqOf = new Map(floors.map((f) => [f.projectId, f.pgSeq] as const));
    const s = new CollabSpoolService(spoolDirPath);
    s.setOwner('t13-owner');
    const evaluateTimestampFence = await s.restoreLockPresent();
    const report = await s.recoverScan({
      systemHistory: hist,
      pgSeq: (pid) => pgSeqOf.get(pid) ?? 0n,
      evaluateTimestampFence,
    });
    return { prisma: p, repo: r, spool: s, report, hist };
  };

  beforeAll(async () => {
    for (const pid of PIDS) await ensureProjectFixture(prisma, pid);
    repo = new CanvasDocUpdateRepository(prisma as never);
    repo.setLeaseOwner('t13-owner');   // 契约 16：PG 腿单写者门（与 spool owner 同体）
  });
  beforeEach(async () => {
    await ensureLeaseFixture(prisma, repo);
    for (const pid of PIDS) {
      await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDoc.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDoc.create({ data: { projectId: pid, generation: 1 } });
      documents.set(`project:${pid}`, new Y.Doc());
    }
    const h = await historyState(prisma);
    savedHistoryId = h.historyId;
    savedEpoch = new Date(h.epochStartedAtMs);
    const d = await makeSpoolDir('t13-g6a-');
    spoolDirPath = d.dir;
    const prev = cleanupSpool;
    cleanupSpool = d.cleanup;
    await prev();
    spool = new CollabSpoolService(spoolDirPath);
    spool.setOwner('t13-owner');
    spool.setWalHistory(savedHistoryId);
    actor = buildActor();
  });
  afterAll(async () => {
    await restoreLeaseRow(prisma);
    await cleanupSpool();
    for (const pid of PIDS) await cleanupProjectFixture(prisma, pid);
    await prisma.$disconnect();
  });

  const i1It = PG_BIN_DIR ? it : it.skip;   // M2：缺实弹工具=显式 skip（旧 console.error+return=假绿）
  i1It('I1 pg_dump 实弹：dump 工具产出→delete→psql 灌回真恢复→bump historyId→旧段全 quarantine 禁重放+PG pgSeq 残留=violation（fail-closed 拒开放写）', async () => {
    const binDir = PG_BIN_DIR!;
    const pid = PIDS[0]!;
    // NoConfirm seam（T10 g2 R4 同形态）：PG CAS 落定但 confirm 静默（kill -9 等价）——段留盘
    //（全 confirm 段会即时回收=目录空；「忘 bump 场景段在」是恢复拦截的物理前提）。
    class NoConfirmSpool extends CollabSpoolService {
      override async confirm(): Promise<void> { /* kill -9：内存 confirm 未达 */ }
    }
    const ncSpool = new NoConfirmSpool(spoolDirPath);
    ncSpool.setOwner('t13-owner');
    ncSpool.setWalHistory(savedHistoryId);
    const ncActor = (() => { const a = new CollabProjectActorService(ncSpool, repo); a.bindHost({
      logger: noopLogger, documents: () => documents, hardClose: () => {}, isQuotaFrozen: () => false,
      generationOf: () => 0, noteReadOnlyDrop: () => false, onFencedByWrite: async () => {},
    }); return a; })();
    const r1 = await ncActor.submit(pid, frameOf('i1-a', 1), makeConn(), 'update');
    const r2 = await ncActor.submit(pid, frameOf('i1-b', 2), makeConn(), 'update');
    await ncActor.flushThrough(pid, r2.walSeq);
    const cd = await prisma.canvasDoc.findUnique({ where: { projectId: pid }, select: { pgSeq: true } });
    expect(cd!.pgSeq).toBe(2n);   // dump 点：两帧已落 PG（confirm 静默=段留盘）

    // ①真 pg_dump 工具产出 dump 文件（--data-only --column-inserts 单表——含本项目两行）
    const dumpPath = join(tmpdir(), `t13-drill-${randomUUID()}.sql`);
    await execFileP(join(binDir, PG_DUMP_BIN), [
      '-d', DB_URL, '--data-only', '--column-inserts', '--no-owner', '--no-privileges',
      '--table=public."CanvasDocUpdate"', '-f', dumpPath,   // Prisma model 名=物理表名（PascalCase 大小写敏感）
    ]);
    // ②灾后模拟+真恢复：delete 本项目行→psql 灌回（dump 文件——ON_ERROR_STOP=0：其他项目残留行冲突无害）
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } });
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: pid } })).toBe(0);
    try { await execFileP(join(binDir, PSQL_BIN), ['-v', 'ON_ERROR_STOP=0', '-d', DB_URL, '-f', dumpPath]); } catch { /* 其他行冲突=预期 */ }
    const restored = await prisma.canvasDocUpdate.count({ where: { projectId: pid } });
    expect(restored, 'psql 灌回=从 dump 文件恢复出本项目行（实弹）').toBe(2);
    await unlink(dumpPath).catch(() => {});

    // ③恢复收尾 bump（T13/T30 恢复契约：post-restore 步骤）——旧段（bump 前写入）禁重放
    await prisma.systemHistory.update({ where: { id: 1 }, data: { historyId: 'drill-bumped-' + randomUUID() } });
    try {
      const boot = await restartBoot();
      try {
        const rep = boot.report.projects.find((p) => p.projectId === pid)!;
        expect(rep.quarantined.some((q) => q.reason === 'history-mismatch'), 'bump 后旧段全 history-mismatch quarantine').toBe(true);
        expect(rep.pgPrefixViolation.length, 'PG pgSeq=2 残留+可证链尾=0→violation（fail-closed 拒开放写）').toBe(1);
        expect(await boot.spool.peek(pid), '旧段零帧重放（禁复活）').toHaveLength(0);
      } finally { await boot.prisma.$disconnect(); }
    } finally {
      // 测试隔离：SystemHistory 恢复原值（共享库纪律）
      await prisma.systemHistory.update({ where: { id: 1 }, data: { historyId: savedHistoryId, epochStartedAt: savedEpoch } });
    }
    void r1;
  }, 60_000);

  it('I2 忘 bump+restore.lock 实弹（F-S4-5 定形面）：historyId 未 bump+marker 在位→时间戳栅栏求值→recoverySuspect 零重放+fail-closed；清 marker（恢复流处置）→正常恢复开放', async () => {
    const pid = PIDS[0]!;
    class NoConfirmSpool extends CollabSpoolService {
      override async confirm(): Promise<void> { /* kill -9：内存 confirm 未达（段留盘） */ }
    }
    const ncSpool = new NoConfirmSpool(spoolDirPath);
    ncSpool.setOwner('t13-owner');
    ncSpool.setWalHistory(savedHistoryId);
    const ncActor = (() => { const a = new CollabProjectActorService(ncSpool, repo); a.bindHost({
      logger: noopLogger, documents: () => documents, hardClose: () => {}, isQuotaFrozen: () => false,
      generationOf: () => 0, noteReadOnlyDrop: () => false, onFencedByWrite: async () => {},
    }); return a; })();
    await ncActor.submit(pid, frameOf('i2', 1), makeConn(), 'update');
    await ncActor.flushThrough(pid, 1n);
    const lockPath = join(spoolDirPath, 'restore.lock');
    await writeFile(lockPath, 'restored-at ' + new Date().toISOString());
    try {
      const boot = await restartBoot();
      try {
        const rep = boot.report.projects.find((p) => p.projectId === pid)!;
        expect(rep.recoverySuspect.length, '忘 bump：段比 epoch 新（长命 epoch 常态）+marker 在位=时间戳栅栏触发').toBe(1);
        expect(await boot.spool.peek(pid), '怀疑段零帧重放（重放归恢复流裁定——修正 #6）').toHaveLength(0);
        expect(rep.pgPrefixViolation.length, 'PG pgSeq=1 残留+链断→violation（fail-closed）').toBe(1);
      } finally { await boot.prisma.$disconnect(); }

      // 恢复流处置等价物：bump（收尾）+清 marker→重启=正常恢复（历史不复活：bump 后旧段 quarantine）
      await prisma.systemHistory.update({ where: { id: 1 }, data: { historyId: 'drill2-' + randomUUID() } });
      try {
        await unlink(lockPath);
        const boot2 = await restartBoot();
        try {
          const rep2 = boot2.report.projects.find((p) => p.projectId === pid)!;
          expect(rep2.quarantined.some((q) => q.reason === 'history-mismatch'), 'bump 后=history-mismatch 档（时间戳栅栏不再触发）').toBe(true);
          expect(rep2.recoverySuspect.length).toBe(0);
        } finally { await boot2.prisma.$disconnect(); }
      } finally {
        await prisma.systemHistory.update({ where: { id: 1 }, data: { historyId: savedHistoryId, epochStartedAt: savedEpoch } });
      }
    } finally {
      await unlink(lockPath).catch(() => {});
    }
  }, 30_000);

  it('I3 8MiB SS2 恢复路径（WS 通道口径——无 HTTP seed）：submit kind=ss2→PG 批提交前 kill（FaultRepo seam）→重启 recoverScan+replayAll→8MiB 帧落 PG+装载重放内容等价', async () => {
    const pid = PIDS[0]!;
    class FailOnceRepo extends CanvasDocUpdateRepository {
      failed = false;
      async appendBatch(...args: Parameters<CanvasDocUpdateRepository['appendBatch']>): ReturnType<CanvasDocUpdateRepository['appendBatch']> {
        if (this.failed) throw new Error('injected pg failure (t13 i3 kill seam)');
        return super.appendBatch(...args);
      }
    }
    const faultRepo = new FailOnceRepo(prisma as never);
    const faultActor = buildActor(faultRepo);
    faultRepo.failed = true;
    const big = ss2BigFrame();
    expect(big.byteLength, '装置：SS2 级帧（<8.06MiB 帧闸）').toBeGreaterThan(7 * 1024 * 1024);
    const r = await faultActor.submit(pid, big, makeConn(), 'ss2');   // WS 通道服务端入口（beforeSync→submit）——无 HTTP seed 路径
    await new Promise((res) => setTimeout(res, 150));                  // flush 失败（帧 WAL 安全留队）
    faultRepo.failed = false;
    void r;

    // 重启（生产 boot 顺序）：恢复扫描→播种→replayAll→8MiB 帧落 PG
    const boot = await restartBoot();
    try {
      const rep = boot.report.projects.find((p) => p.projectId === pid)!;
      expect(rep.pgPrefixViolation).toHaveLength(0);
      expect(rep.replayPrefix).toContain(1n);
      const replay = await boot.spool.replayAll(boot.repo);
      expect(replay.replayed).toBe(1);
      const row = await boot.prisma.$queryRaw<{ n: number }[]>`SELECT octet_length("update") AS n FROM "CanvasDocUpdate" WHERE "projectId" = ${pid}::text AND "firstWalSeq" = 1::bigint`;
      expect(Number(row[0]!.n), '8MiB 帧整帧落 PG（无 HTTP seed——WAL 前缀重放）').toBeGreaterThan(7 * 1024 * 1024);
      // 装载重放：hydrate updates→内容等价（big-0 在）
      const fresh = new Y.Doc();
      const rows = await boot.repo.loadForHydration(pid);
      for (const u of rows.updates) Y.applyUpdate(fresh, u as Uint8Array);
      expect((fresh.getMap('nodes') as Y.Map<unknown>).get('big-0')).toBeDefined();
    } finally { await boot.prisma.$disconnect(); }
  }, 60_000);

  it('I4 多项目 actor 原型管线恢复（S4 决策落地验证）+ETag 不超前 pgSeq：A 落定/B·C 批提交前 kill→重启 per-project 前缀正确互不干扰+ETag=pgSeq 真值', async () => {
    class FailRepo extends CanvasDocUpdateRepository {
      fail = false;
      async appendBatch(...args: Parameters<CanvasDocUpdateRepository['appendBatch']>): ReturnType<CanvasDocUpdateRepository['appendBatch']> {
        if (this.fail) throw new Error('injected pg failure (t13 i4 kill seam)');
        return super.appendBatch(...args);
      }
    }
    const faultRepo = new FailRepo(prisma as never);
    const faultActor = buildActor(faultRepo);
    // A：两帧全落定（flushThrough）
    const a1 = await faultActor.submit(PIDS[0]!, frameOf('a1', 1), makeConn(), 'update');
    const a2 = await faultActor.submit(PIDS[0]!, frameOf('a2', 2), makeConn(), 'update');
    await faultActor.flushThrough(PIDS[0]!, a2.walSeq);
    // B/C：批提交前 kill（fail seam——帧已 apply+fsync 留 WAL）
    faultRepo.fail = true;
    const b1 = await faultActor.submit(PIDS[1]!, frameOf('b1', 1), makeConn(), 'update');
    const c1 = await faultActor.submit(PIDS[2]!, frameOf('c1', 1), makeConn(), 'update');
    await new Promise((res) => setTimeout(res, 150));
    faultRepo.fail = false;
    void b1; void c1; void a1;

    const boot = await restartBoot();
    try {
      for (const pid of PIDS) {
        const rep = boot.report.projects.find((p) => p.projectId === pid);
        expect(rep?.pgPrefixViolation ?? [], `${pid} 零 violation`).toHaveLength(0);
      }
      const replay = await boot.spool.replayAll(boot.repo);
      // A 段幸存帧（已落定 ≤pgSeq 的幂等重放残帧——ADR-01 §3.2 常态）与 B/C 未落定帧一并重放=4；
      // 零重复由 updateHash 幂等（ON CONFLICT DO NOTHING）+CRDT 双防线吸收——下行行数断言即证明。
      expect(replay.replayed).toBe(4);
      const rowsA = await boot.prisma.canvasDocUpdate.count({ where: { projectId: PIDS[0]! } });
      const rowsB = await boot.prisma.canvasDocUpdate.count({ where: { projectId: PIDS[1]! } });
      const rowsC = await boot.prisma.canvasDocUpdate.count({ where: { projectId: PIDS[2]! } });
      expect({ rowsA, rowsB, rowsC }).toEqual({ rowsA: 2, rowsB: 1, rowsC: 1 });
      // ETag 不超前 pgSeq（恢复后 read model 新鲜度=pgSeq 真值——formatDocETag 契约分量为 DB 行值）
      for (const pid of PIDS) {
        const cd = await boot.prisma.canvasDoc.findUnique({ where: { projectId: pid }, select: { generation: true, pgSeq: true } });
        const rows = await boot.prisma.canvasDocUpdate.findMany({ where: { projectId: pid }, orderBy: { seq: 'desc' }, take: 1 });
        const maxRowSeq = rows[0]?.seq ?? 0n;
        expect(cd!.pgSeq >= maxRowSeq, `${pid} pgSeq 覆盖全部已提交行`).toBe(true);
        const etag = formatDocETag({ generation: cd!.generation, pgSeq: cd!.pgSeq });
        expect(etag).toBe(`${cd!.generation}:${cd!.pgSeq}`);   // ETag=pgSeq 口径（不超前——派生自真值）
      }
    } finally { await boot.prisma.$disconnect(); }
  }, 60_000);
});
