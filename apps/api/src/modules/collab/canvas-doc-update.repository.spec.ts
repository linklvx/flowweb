import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import * as Y from 'yjs';
import { CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { seedRow } from '../../test-utils/canvas-doc-row';
import { yjsCompactAbandonedTotal, yjsCompactPurgeDeferredTotal } from './store.metrics';

describe('CanvasDocUpdateRepository', () => {
  let repo: CanvasDocUpdateRepository;
  let prisma: { $transaction: Mock; $queryRaw: Mock; $executeRaw: Mock; canvasDocUpdate: any; canvasDoc: any };

  beforeEach(async () => {
    prisma = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([{ seq: 1n }]),
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      canvasDocUpdate: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        deleteMany: vi.fn(),
      },
      canvasDoc: { findUnique: vi.fn(), upsert: vi.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        CanvasDocUpdateRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    repo = mod.get(CanvasDocUpdateRepository);
    repo.setLeaseOwner('spec-owner');   // Y0a-3 契约 16：append/compact fail-closed——既有用例默认持有人
  });

  it('appendBatch（Y1c T9 新表形态）：锁内多行 INSERT ON CONFLICT DO NOTHING，返回实插行数；不经 canvasDocUpdate.create；V8 事务上界 5s/1s', async () => {
    // mock $transaction 直接执行回调（tx 即 prisma 自身——同 compact 三例先例）
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([{ seq: 7n }]);
    const r = await repo.appendBatch('p1', [seedRow(new Uint8Array([1, 2]), 7n), seedRow(new Uint8Array([3]), 8n)]);
    expect(r).toEqual({ ok: true, rows: 2 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);   // C1② tripwire 前置 SELECT pgSeq（docPg=undefined 缝跳过）+每行一条 INSERT（同事务）
    expect(prisma.canvasDocUpdate.create).not.toHaveBeenCalled();
    // V8（Y0a-2 复审 I-1）：append 批交互式事务——5s 上界/maxWait 1s（挂起的 PG append 不得无上界持 actor drain）
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 5_000, maxWait: 1_000 });
  });

  // ══ Y1c T11 compact 重写（快照发布管线）unit 面：词法 PG sim（SQL 形状应答——C1 buildSim 同族） ══
  /** 最小词法 sim：head 读/重放页/发布事务（FOR UPDATE 行锁+INSERT 快照+条件 UPDATE 指针）/
   *  提交后批删（$executeRaw）按 SQL 形状应答；before 钩可逐语句改写状态（漂移注入）。 */
  function buildCompactSim(
    st: {
      head: { generation: number; pgSeq: bigint; currentSnapshotRev: bigint };
      locked?: { generation: number; pgSeq: bigint; currentSnapshotRev: bigint };
      snapshot: { state: Buffer | null; stateSeq: bigint } | null;
      pages: { seq: bigint; update: Buffer }[][];   // 逐页应答（空页收尾）
      insertSnapshot?: 'conflict' | bigint;
      purged?: number;
    },
    before?: (sql: string, st2: typeof st) => void,
  ) {
    const calls: string[] = [];
    const txSql: string[] = [];   // 发布事务内语句形状（断言 INSERT/UPDATE 同事务）
    let insertVals: unknown[] = [];   // INSERT INTO CanvasDocSnapshot 绑定值（第 5 位=state 字节）
    let pageIndex = 0;
    const respond = async (strings: string[], ...vals: unknown[]): Promise<unknown[]> => {
      const sql = strings.join('?');
      calls.push(sql);
      before?.(sql, st);
      if (sql.includes('FOR UPDATE')) { txSql.push(sql); return [st.locked ?? st.head]; }
      if (sql.includes('INSERT INTO "CanvasDocSnapshot"')) {
        txSql.push(sql);
        insertVals = vals;
        return st.insertSnapshot === 'conflict' ? [] : [{ snapshotRev: st.insertSnapshot ?? st.head.pgSeq }];
      }
      if (sql.includes('UPDATE "CanvasDoc" SET "currentSnapshotRev"')) {
        txSql.push(sql);
        return (st.locked ?? st.head).currentSnapshotRev === st.head.currentSnapshotRev ? [{ currentSnapshotRev: st.head.pgSeq }] : [];
      }
      if (sql.includes('SELECT generation, "pgSeq", "currentSnapshotRev" FROM "CanvasDoc"')) return [st.head];
      if (sql.includes('SELECT seq, update FROM "CanvasDocUpdate"')) {
        const page = st.pages[pageIndex] ?? [];
        pageIndex += 1;
        return page;
      }
      return [];
    };
    const execRespond = async (strings: string[], ..._vals: unknown[]): Promise<unknown> => {
      const sql = strings.join('?');
      calls.push(sql);
      return [];
    };
    const prisma = {
      $queryRaw: vi.fn((s: string[], ...v: unknown[]) => respond(s, ...v)),
      $executeRaw: vi.fn((s: string[], ...v: unknown[]) => execRespond(s, ...v)),
      canvasDocSnapshot: {
        findUnique: vi.fn(async () => (st.snapshot ? { state: st.snapshot.state, stateSeq: st.snapshot.stateSeq } : null)),
      },
      canvasDoc: {
        findUnique: vi.fn(async () => ({ schemaVersion: 3, vacuumEpoch: 0 })),
      },
      $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn({
        $queryRaw: (s: string[], ...v: unknown[]) => respond(s, ...v),
        $executeRaw: (s: string[], ...v: unknown[]) => execRespond(s, ...v),
      })),
    };
    const repo = new CanvasDocUpdateRepository(prisma as any);
    return { repo, calls, txSql, prisma, insertVals: () => insertVals };
  }

  const docBytes = (key: string, n: number) => {
    const d = new Y.Doc();
    d.getMap('nodes').set(key, new Y.Map([['x', n]]));
    return Buffer.from(Y.encodeStateAsUpdate(d));
  };

  it('compact：empty 契约——指针快照已覆盖 pgSeq（pg≤stateSeq0）→ {compacted:false,reason:"empty"} 零写零删', async () => {
    const { repo, calls } = buildCompactSim({
      head: { generation: 1, pgSeq: 5n, currentSnapshotRev: 5n },
      snapshot: { state: docBytes('a', 1), stateSeq: 5n },
      pages: [],
    });
    await expect(repo.compact('p1')).resolves.toEqual({ compacted: false, reason: 'empty' });
    expect(calls.filter((c) => c.includes('INSERT') || c.includes('DELETE') || c.includes('UPDATE'))).toEqual([]);
  });

  it('compact：CanvasDoc 行缺失（懒建档前）→ empty 零写', async () => {
    const { repo } = buildCompactSim({ head: { generation: 1, pgSeq: 0n, currentSnapshotRev: 0n }, snapshot: null, pages: [] });
    // head 查询空行：$queryRaw 默认应答逐形状——本用例以空 pages+pg=0 直达 empty（行缺失同折 empty 面由 int 池覆盖）
    await expect(repo.compact('p1')).resolves.toEqual({ compacted: false, reason: 'empty' });
  });

  it('compact 成功：发布事务=行锁+三元组 CAS+INSERT 快照+指针/purgeBelowSeq 同事务；提交后批删+保留策略；快照=指针态+增量尾重放（内容等价）', async () => {
    const oldSnap = docBytes('old', 1);
    const sim = buildCompactSim({
      head: { generation: 1, pgSeq: 2n, currentSnapshotRev: 0n },
      snapshot: { state: oldSnap, stateSeq: 0n },
      pages: [[{ seq: 1n, update: docBytes('r1', 1) }, { seq: 2n, update: docBytes('r2', 2) }]],
    });
    const r = await sim.repo.compact('p1');
    expect(r).toMatchObject({ compacted: true, snapshotRev: 2n, stateSeq: 2n, purgeBelowSeq: 2n, tombstoneBytes: expect.any(Number) });
    if (!r.compacted) return;
    expect(r.snapshotBytes).toBeGreaterThan(0);
    // 发布事务三语句同事务（行锁复核+INSERT+条件 UPDATE）——指针/purgeBelowSeq 与快照原子
    expect(sim.txSql.filter((x) => x.includes('FOR UPDATE'))).toHaveLength(1);
    expect(sim.txSql.filter((x) => x.includes('INSERT INTO "CanvasDocSnapshot"'))).toHaveLength(1);
    expect(sim.txSql.filter((x) => x.includes('UPDATE "CanvasDoc" SET "currentSnapshotRev"'))).toHaveLength(1);
    // 形状锚：条件 UPDATE 的 WHERE 含三元组 CAS（generation+pgSeq+currentSnapshotRev）=跨表不变量
    // Snapshot.stateSeq≤pgSeq 的发布事务内验证（偏离 26 v5.2 非 CHECK）
    const moved = sim.txSql.find((x) => x.includes('UPDATE "CanvasDoc" SET "currentSnapshotRev"'))!;
    expect(moved).toContain('generation = ?::int');
    expect(moved).toContain('"pgSeq" = ?::bigint');
    expect(moved).toContain('"currentSnapshotRev" = ?::bigint');
    expect(moved).toContain('"purgeBelowSeq" = GREATEST(COALESCE("purgeBelowSeq", 0), ?::bigint)');
    // INSERT 的快照字节=指针态+增量尾重放产物（canonical 编码——内容等价断言）
    const snapState = sim.insertVals()[4] as Buffer;   // INSERT 绑定第 5 位=state 字节
    const revived = new Y.Doc();
    Y.applyUpdate(revived, new Uint8Array(snapState));
    expect(revived.getMap('nodes').has('old')).toBe(true);
    expect(revived.getMap('nodes').has('r1')).toBe(true);
    expect(revived.getMap('nodes').has('r2')).toBe(true);
    // 提交后分批删+保留策略（purgeBelow/pruneSnapshots 两面）
    expect(sim.calls.some((c) => c.includes('DELETE FROM "CanvasDocUpdate"') && c.includes('seq <= ?::bigint'))).toBe(true);
    expect(sim.calls.some((c) => c.includes('DELETE FROM "CanvasDocSnapshot"'))).toBe(true);
  });

  it('Q-M5（T11 双评审）TOCTOU 收口：schemaVersion/vacuumEpoch 读入 ③ 锁内（随 FOR UPDATE 行锁同读）——INSERT 绑定值=锁内行值', async () => {
    const oldSnap = docBytes('old', 1);
    const sim = buildCompactSim({
      head: { generation: 1, pgSeq: 2n, currentSnapshotRev: 0n },
      // 锁内行携带版本对（与锁前 head 不同的值——证明 INSERT 取锁内读非锁前读）
      locked: { generation: 1, pgSeq: 2n, currentSnapshotRev: 0n, schemaVersion: 7, vacuumEpoch: 4 } as never,
      snapshot: { state: oldSnap, stateSeq: 0n },
      pages: [[{ seq: 1n, update: docBytes('m1', 1) }, { seq: 2n, update: docBytes('m2', 2) }]],
    });
    const r = await sim.repo.compact('p1');
    expect(r.compacted).toBe(true);
    // INSERT 列序：projectId, generation, snapshotRev, stateSeq, state, stateHash, vacuumEpoch(6), schemaVersion(7)
    expect(sim.insertVals()[6]).toBe(4);   // vacuumEpoch=锁内行值（非锁前缺省 0）
    expect(sim.insertVals()[7]).toBe(7);   // schemaVersion=锁内行值（非锁前缺省 CANVAS_DOC_SCHEMA_VERSION）
  });

  it('Q-M4（T11 双评审）：④清理段抛错不以 throw 逸出 compact()——发布已落定仍返回 compacted:true+deletedRows=0+独立计数（义务由 purgeBelowSeq 持久承载）', async () => {
    const oldSnap = docBytes('old', 1);
    const sim = buildCompactSim({
      head: { generation: 1, pgSeq: 2n, currentSnapshotRev: 0n },
      snapshot: { state: oldSnap, stateSeq: 0n },
      pages: [[{ seq: 1n, update: docBytes('d1', 1) }, { seq: 2n, update: docBytes('d2', 2) }]],
    }, (sql) => { if (sql.includes('DELETE FROM "CanvasDocUpdate"')) throw new Error('purge io boom'); });   // ④分批删 IO 故障
    const incSpy = vi.spyOn(yjsCompactPurgeDeferredTotal, 'inc');
    try {
      const r = await sim.repo.compact('p1');
      expect(r, '发布已落定——throw 逸出会被 maybeCompact/hydrate 两路 catch 计入 compact_failure 污染告警线').toMatchObject({ compacted: true, deletedRows: 0 });
      expect(incSpy).toHaveBeenCalledTimes(1);
      // 义务未衰减（Q-M3 discharge 在同一 try 尾——④失败即保留 purgeBelowSeq 供 boot/tick 续跑）
      expect(sim.calls.some((c) => c.includes('SET "purgeBelowSeq" = NULL'))).toBe(false);
    } finally {
      incSpy.mockRestore();
    }
  });

  it('compact：pendingStructs 非空放弃本次——返回 abandoned、零发布零删除、P0 计数+1（禁 throw）', async () => {
    // A7b 同款构造：lateOnly=前置 clock 缺失的增量（apply 后 pendingStructs 悬置）
    const a = new Y.Doc();
    a.getMap('nodes').set('k', new Y.Map([['x', 1]]));
    const svA = Y.encodeStateVector(a);
    a.getMap('nodes').set('m', new Y.Map([['x', 2]]));
    const lateOnly = Y.diffUpdate(Y.encodeStateAsUpdate(a), svA);
    const { repo, calls } = buildCompactSim({
      head: { generation: 1, pgSeq: 1n, currentSnapshotRev: 0n },
      snapshot: null,
      pages: [[{ seq: 1n, update: Buffer.from(lateOnly) }]],
    });
    const incSpy = vi.spyOn(yjsCompactAbandonedTotal, 'inc');
    try {
      await expect(repo.compact('p1')).resolves.toEqual({ compacted: false, reason: 'abandoned' });
      expect(calls.filter((c) => c.includes('INSERT INTO "CanvasDocSnapshot"') || c.includes('DELETE') || c.includes('UPDATE "CanvasDoc"'))).toEqual([]);   // 原可用快照与 WAL 全保留（不提前清理）
      expect(incSpy).toHaveBeenCalledTimes(1);
    } finally {
      incSpy.mockRestore();
    }
  });

  it('compact：授权 CAS miss——锁内三元组漂移（写入方推进 pgSeq）→ {compacted:false,reason:"miss"} 正常折返+零快照写（并发败者不 throw）', async () => {
    const { repo, calls } = buildCompactSim({
      head: { generation: 1, pgSeq: 2n, currentSnapshotRev: 0n },   // 授权读捕获
      locked: { generation: 1, pgSeq: 3n, currentSnapshotRev: 0n }, // 锁内复核=写入方已推进
      snapshot: null,
      pages: [[{ seq: 1n, update: docBytes('m1', 1) }]],
    });
    await expect(repo.compact('p1')).resolves.toEqual({ compacted: false, reason: 'miss' });
    expect(calls.some((c) => c.includes('INSERT INTO "CanvasDocSnapshot"'))).toBe(false);
    expect(calls.some((c) => c.includes('DELETE FROM "CanvasDocUpdate"'))).toBe(false);
  });

  it('compact：并发败者二档——锁内 rev 漂移（他 compact 已发布）→ miss；同 rev 冲突 INSERT 0 行 → miss（PK 冲突折正常 miss——红组① unit 锚）', async () => {
    // 档一：currentSnapshotRev 漂移
    const s1 = buildCompactSim({
      head: { generation: 1, pgSeq: 2n, currentSnapshotRev: 0n },
      locked: { generation: 1, pgSeq: 2n, currentSnapshotRev: 2n },
      snapshot: null,
      pages: [[{ seq: 1n, update: docBytes('c1', 1) }]],
    });
    await expect(s1.repo.compact('p1')).resolves.toEqual({ compacted: false, reason: 'miss' });
    // 档二：同 rev 快照已在（并发发布者先到——ON CONFLICT DO NOTHING 0 行折 miss 非 P2002 throw）
    const s2 = buildCompactSim({
      head: { generation: 1, pgSeq: 2n, currentSnapshotRev: 0n },
      snapshot: null,
      pages: [[{ seq: 1n, update: docBytes('c2', 1) }]],
      insertSnapshot: 'conflict',
    });
    await expect(s2.repo.compact('p1')).resolves.toEqual({ compacted: false, reason: 'miss' });
  });

  it('compact：跨两轮——第一轮发布快照作第二轮指针态重放，内容等价+每轮 rev/stateSeq=该轮 pgSeq', async () => {
    const firstState = docBytes('round1', 1);
    // 第一轮：无快照（stateSeq0=0）+一行 → 发布 rev=1
    const s1 = buildCompactSim({
      head: { generation: 1, pgSeq: 1n, currentSnapshotRev: 0n },
      snapshot: null,
      pages: [[{ seq: 1n, update: firstState }]],
    });
    const r1 = await s1.repo.compact('p1');
    expect(r1).toMatchObject({ compacted: true, snapshotRev: 1n, stateSeq: 1n });
    // 第二轮：指针态=第一轮产物+新删除增量（tombstone 跨轮保持——重建不复活）
    const after = new Y.Doc();
    Y.applyUpdate(after, firstState);
    const dels: Buffer[] = [];
    after.on('update', (u: Uint8Array) => dels.push(Buffer.from(u)));
    after.getMap('nodes').delete('round1');
    const secondSnapshotState = Buffer.from(Y.encodeStateAsUpdate(after));   // 第二轮指针态（含墓碑）
    const s2 = buildCompactSim({
      head: { generation: 1, pgSeq: 2n, currentSnapshotRev: 1n },
      snapshot: { state: secondSnapshotState, stateSeq: 1n },
      pages: [[{ seq: 2n, update: dels[0] }]],
    });
    const r2 = await s2.repo.compact('p1');
    expect(r2).toMatchObject({ compacted: true, snapshotRev: 2n, stateSeq: 2n });
    if (!r2.compacted) return;
    const revived = new Y.Doc();
    Y.applyUpdate(revived, s2.insertVals()[4] as Buffer);
    expect(revived.getMap('nodes').has('round1')).toBe(false);   // 跨轮快照/增量边界不丢删除
  });

  it('compact：删除行入增量（tombstone 进快照）——重建不复活（恢复路径取证）', async () => {
    const src = new Y.Doc();
    const ups: Buffer[] = [];
    src.on('update', (u: Uint8Array) => ups.push(Buffer.from(u)));
    src.getMap('nodes').set('n1', new Y.Map());   // 插入行
    src.getMap('nodes').delete('n1');             // 删除行
    const sim = buildCompactSim({
      head: { generation: 1, pgSeq: 2n, currentSnapshotRev: 0n },
      snapshot: null,
      pages: [[{ seq: 1n, update: ups[0] }, { seq: 2n, update: ups[1] }]],
    });
    const r = await sim.repo.compact('p1');
    expect(r.compacted).toBe(true);
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, sim.insertVals()[4] as Buffer);
    expect(fresh.getMap('nodes').has('n1')).toBe(false);
  });

  it('compact 授权换轴（Y1c T11）：零 CollabLease 交互——leaseOwner 未设（worker 进程形态）照常发布（旧 not-owner 语义退役）', async () => {
    const { repo, calls } = buildCompactSim({
      head: { generation: 1, pgSeq: 1n, currentSnapshotRev: 0n },
      snapshot: null,
      pages: [[{ seq: 1n, update: docBytes('no-lease', 1) }]],
    });
    // 不 setLeaseOwner（owner=null——worker 进程无租约；授权=行锁+generation/pgSeq CAS 与写入方 lease 正交）
    const r = await repo.compact('p1');
    expect(r.compacted).toBe(true);
    expect(calls.some((c) => c.includes('CollabLease'))).toBe(false);   // 零租约面交互
  });
});

describe('Y0a-3 fence 下沉（契约 2/15/16——owner-only SV1+advisory lock SV3）', () => {
  // B14：Prisma tagged template 传 mock 的第一参是字符串数组、插值在后续参——断言一律
  // `call[0].join('?')` 看形状 + `call.slice(1)` 看值（仓内惯例 video-work.service.spec:351）；
  // 文本断言永不红=诱导 $queryRawUnsafe 内插（注入面）。
  const shape = (c: any[]) => (c[0] as string[]).join('?');

  function buildRepo(opts: {
    query?: ReturnType<typeof vi.fn>;        // 事务外 $queryRaw（二次查）
    txQuery?: ReturnType<typeof vi.fn>;      // 事务内 $queryRaw（INSERT/fence/页查询）
    txExec?: ReturnType<typeof vi.fn>;       // 事务内 $executeRaw（advisory lock）
    docRow?: { stateSeq: bigint } | null;    // canvasDoc.findUnique 返回（cursor 判别性）
    snapFindUnique?: ReturnType<typeof vi.fn>;   // canvasDocSnapshot.findUnique（T11 指针快照行）
  } = {}) {
    const query = opts.query ?? vi.fn().mockResolvedValue([]);
    const txq = opts.txQuery ?? vi.fn().mockResolvedValue([]);
    const exec = opts.txExec ?? vi.fn().mockResolvedValue([]);
    const snapFindUnique = opts.snapFindUnique ?? vi.fn().mockResolvedValue(null);
    const prisma = {
      $queryRaw: query,
      canvasDocSnapshot: { findUnique: snapFindUnique },
      $transaction: vi.fn((fn: any) => fn({
        $queryRaw: txq,
        $executeRaw: exec,
        canvasDocUpdate: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
        canvasDoc: { findUnique: vi.fn().mockResolvedValue(opts.docRow ?? null), upsert: vi.fn() },
        canvasDocSnapshot: { findUnique: snapFindUnique },
      })),
    };
    return { repo: new CanvasDocUpdateRepository(prisma as any), prisma, txq, exec, query };
  }

  it('appendBatch：Y1c T10 去锁（census⑩）+owner-only EXISTS（形状无 TTL 项）+ON CONFLICT DO NOTHING（updateHash 幂等）+水位 CAS 同事务', async () => {
    const txq = vi.fn().mockResolvedValue([{ seq: 1n }]);
    const exec = vi.fn().mockResolvedValue([]);
    const { repo, exec: e } = buildRepo({ txQuery: txq, txExec: exec });
    repo.setLeaseOwner('me');
    const r = await repo.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n)], { expectedPgSeq: 0n, newPgSeq: 1n, walCheckpointSeq: 1n });
    expect(r).toEqual({ ok: true, rows: 1 });
    expect(e.mock.calls.length).toBe(0);                              // Y1c T10：锁语句退役（actor 单写者+WAL walSeq 构造性保证 seq 序≡提交序）
    const insert = txq.mock.calls[0];
    expect(shape(insert)).toContain('EXISTS (SELECT 1 FROM "CollabLease"');
    expect(shape(insert)).not.toContain('"expiresAt" >= now()');      // SV1：fence 去 TTL
    expect(shape(insert)).toContain('ON CONFLICT DO NOTHING');        // Y1c T9：重试/重组批幂等
    expect(insert.slice(1)).toEqual(expect.arrayContaining(['p1', 'me']));   // owner=绑定值
    // Y1c T10 水位 CAS（同事务）：UPDATE CanvasDoc SET walCheckpointSeq/pgSeq WHERE pgSeq=$expected RETURNING
    const cas = txq.mock.calls.find((c: any[]) => shape(c).includes('UPDATE "CanvasDoc"')) as unknown as any[];
    expect(cas, '水位 CAS 与行插入同事务').toBeDefined();
    expect(shape(cas)).toContain('RETURNING "pgSeq"');
    expect(shape(cas)).toContain('"pgSeq" = ?::bigint');   // CAS 谓词（expected 绑定——永不写 appliedSeq 口径）
  });

  it('owner=null 显式 throw lease-owner-not-set（P7：配置错误不伪装 fenced）', async () => {
    const { repo } = buildRepo();
    await expect(repo.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n)])).rejects.toThrow('lease owner not set');
  });

  it('fenced=0 行且行不存在（全新行被 EXISTS 拦）→{ok:false,reason:"fenced"}；行已存在（updateHash 幂等命中）→{ok:true,rows:0}（Y1c T9 幂等轴两分——契约 15 承继）', async () => {
    const txq = vi.fn().mockResolvedValue([]);                       // INSERT 0 行（两形态共面）
    const query = vi.fn()
      .mockResolvedValueOnce([])                                     // C1② tripwire 前置 SELECT pgSeq（行缺失=懒建档——跳过；无 wm 形同查）
      .mockResolvedValueOnce([])                                     // 幂等探查：行不存在（fenced 档）
      .mockResolvedValue([{ owner: 'other' }]);                      // 二次查（fenced 分型确认）
    const { repo } = buildRepo({ query, txQuery: txq });
    repo.setLeaseOwner('me');
    await expect(repo.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n)])).resolves.toEqual({ ok: false, reason: 'fenced' });
    // 幂等命中档：行已在（探查命中）→ ok rows:0（DO NOTHING 吞行=正确 no-op——重试/重组批幂等）
    const query2 = vi.fn().mockResolvedValue([{ seq: 1n }]);         // 幂等探查命中
    const { repo: repo2 } = buildRepo({ query: query2, txQuery: vi.fn().mockResolvedValue([]) });
    repo2.setLeaseOwner('me');
    await expect(repo2.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n)])).resolves.toEqual({ ok: true, rows: 0 });
  });

  it('leaseRowMissing：二次查空行→throw（不伪装 fenced/不进重试语义）', async () => {
    const txq = vi.fn().mockResolvedValue([]);
    const query = vi.fn().mockResolvedValue([]);                     // 二次查空
    const { repo } = buildRepo({ query, txQuery: txq });
    repo.setLeaseOwner('me');
    await expect(repo.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n)])).rejects.toMatchObject({ leaseRowMissing: true });
  });

  it('readSnapshotOnly=第二出口（契约 1"一个实现、两出口"）——同 readConsistent 事务形态', async () => {
    const { repo } = buildRepo({ docRow: null });
    const r = await repo.readSnapshotOnly('p1');
    expect(r).toEqual({ state: null, updates: [], stateSeq: 0n, generation: 0, schemaVersion: null, pgSeq: null, currentSnapshotRev: null });   // T9a 代际列+T18 schemaVersion 行值随行+T11 C1① pgSeq 随行（装载/快照两出口同一列门判据——行缺失=null 懒建档）；Y1c T12：preVacuumSv 随 SV 代际门退役删除；Y1c T19：currentSnapshotRev 随行（公开快照缓存键 rev 维）
  });

  it('readConsistent 游标=指针快照 stateSeq（Y1c T11 快照权威——旧「恒 0n 全量」SV3 双保险随单写者构造性保证退役）', async () => {
    const txq = vi.fn().mockResolvedValue([]);   // 增量页空（首页即止）
    const snapFindUnique = vi.fn().mockResolvedValue({ state: Buffer.from([0, 0]), stateSeq: 42n });
    const { repo, txq: q } = buildRepo({ txQuery: txq, docRow: { stateSeq: 42n }, snapFindUnique });
    await repo.loadForHydration('p1');
    const page = q.mock.calls.find((c) => shape(c).includes('seq >'))!;
    expect(shape(page)).toContain('seq > ?::bigint');            // 谓词保留（去谓词=满页死循环——W15）
    expect(page.slice(1)).toEqual(['p1', 42n, 500]);             // 游标=指针快照 stateSeq+页大小绑定值
    expect(snapFindUnique).toHaveBeenCalled();                   // 指针行装载（快照权威）
  });
});

// ══ C1（T10 收口 Critical）：水位 CAS UPDATE 缺 lease fence——两 facet 红→绿 ══
//  装置=最小词法 PG sim：按 SQL 形状+绑定值应答（CollabLease.owner / CanvasDoc.pgSeq / 行集）。
//  UPDATE 应答模型=fence 子句**在场且**租约易主才拦——红相（旧代码 SQL 无 fence 子句）与绿相（新
//  代码）同一装置判别：旧代码无子句=模拟 PG 放行（水位推进）——正是缺陷形态本身。
describe('C1 水位 UPDATE lease fence（全 fenced/部分 fenced 两 facet）', () => {
  const shapeOf = (c: unknown[]) => (c[0] as string[]).join('?');

  function buildSim(
    initial: { leaseOwner: string | null; docPgSeq: bigint | null },
    before?: (sql: string, st: { leaseOwner: string | null }) => void,
  ) {
    const st = {
      leaseOwner: initial.leaseOwner as string | null,
      docRow: initial.docPgSeq === null ? null : { pgSeq: initial.docPgSeq },
      rows: new Set<string>(),          // 键 `${pid}:${gen}:${seq}` 与 `${pid}:${gen}:${hash}` 双唯一面
      pgSeqAdvanced: 0,                 // 观测面：UPDATE 实际推水位次数
    };
    const respond = async (strings: string[], ...vals: unknown[]): Promise<unknown[]> => {
      const sql = strings.join('?');
      before?.(sql, st);
      if (sql.includes('INSERT INTO "CanvasDocUpdate"')) {
        if (st.leaseOwner !== 'me') return [];                          // INSERT fence（既有——T9 已在）
        const key = `${vals[0]}:${Number(vals[1])}:${vals[2]}`;
        const hashKey = `${vals[0]}:${Number(vals[1])}:${vals[5]}`;
        if (st.rows.has(key) || st.rows.has(hashKey)) return [];        // PK/updateHash 双唯一幂等
        st.rows.add(key); st.rows.add(hashKey);
        return [{ seq: vals[2] }];
      }
      if (sql.includes('INSERT INTO "CanvasDoc"')) {
        // 懒建档（INSERT..SELECT..WHERE EXISTS fence）——租约不在我手禁建行推水位
        if (sql.includes('EXISTS (SELECT 1 FROM "CollabLease"') && st.leaseOwner !== 'me') return [];
        if (st.docRow) return [];                                       // ON CONFLICT DO NOTHING
        st.docRow = { pgSeq: vals[3] as bigint };
        return [];
      }
      if (sql.includes('UPDATE "CanvasDoc"')) {
        if (!st.docRow) return [];
        if (sql.includes('EXISTS (SELECT 1 FROM "CollabLease"') && st.leaseOwner !== 'me') return [];   // C1 fence：在场且易主=拦
        const newPg = vals[1] as bigint;                                // SET 第二参=newPgSeq（CAS/catch-up/adopt 三形态同位）
        if (newPg > st.docRow.pgSeq) { st.docRow.pgSeq = newPg; st.pgSeqAdvanced += 1; }
        return [{ pgSeq: st.docRow.pgSeq }];
      }
      if (sql.includes('SELECT "pgSeq" FROM "CanvasDoc"')) return st.docRow ? [{ pgSeq: st.docRow.pgSeq }] : [];
      if (sql.includes('SELECT owner FROM "CollabLease"')) return st.leaseOwner == null ? [] : [{ owner: st.leaseOwner }];
      if (sql.includes('AND seq = ')) {                                  // C1 按 PK 回查（verifyRowsLanded）
        return st.rows.has(`${vals[0]}:${Number(vals[1])}:${vals[2]}`) ? [{ seq: vals[2] }] : [];
      }
      if (sql.includes('"updateHash" = ')) {                             // 0 行两分幂等探查（既有）
        return st.rows.has(`${vals[0]}:${Number(vals[1])}:${vals[2]}`) ? [{ seq: 1n }] : [];
      }
      return [];
    };
    const prisma = {
      $queryRaw: vi.fn((strings: string[], ...vals: unknown[]) => respond(strings, ...vals)),
      $executeRaw: vi.fn((strings: string[], ...vals: unknown[]) => respond(strings, ...vals)),
      $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn({
        $queryRaw: (strings: string[], ...vals: unknown[]) => respond(strings, ...vals),
        $executeRaw: (strings: string[], ...vals: unknown[]) => respond(strings, ...vals),
      })),
    };
    const repo = new CanvasDocUpdateRepository(prisma as any);
    repo.setLeaseOwner('me');
    return { repo, st };
  }

  it('facet A 全 fenced（租约丢失窗 CAS expected 恰匹配）：INSERT 0 行+UPDATE 亦被 fence 拦——pgSeq 不推进+返回 fenced（红=旧实现水位越过未插入行）', async () => {
    const { repo, st } = buildSim({ leaseOwner: 'intruder', docPgSeq: 0n });   // 租约已易主；CanvasDoc 行在 pgSeq=0
    const r = await repo.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n)], { expectedPgSeq: 0n, newPgSeq: 1n, walCheckpointSeq: 1n });
    expect(r).toEqual({ ok: false, reason: 'fenced' });
    expect(st.docRow!.pgSeq).toBe(0n);          // 红：旧实现 UPDATE 无 fence——pgSeq 被推到 1（恢复基线被污染）
    expect(st.rows.size).toBe(0);               // 零行插入（fence 拦）
    expect(st.pgSeqAdvanced).toBe(0);           // 水位零推进（红：旧实现=1）
  });

  it('facet B 部分 fenced（RC 批内两 INSERT 之间租约易主，inserted>0 但<rows.length）：缺行=按 fenced 档（禁 ok 短路吞缺口）+水位不越过缺行', async () => {
    let insertSeen = 0;
    const { repo, st } = buildSim({ leaseOwner: 'me', docPgSeq: 0n }, (sql, st2) => {
      if (sql.includes('INSERT INTO "CanvasDocUpdate"')) { insertSeen += 1; if (insertSeen === 2) st2.leaseOwner = 'intruder'; }   // 批内第 2 条 INSERT 前易主（RC 每语句新快照）
    });
    const r = await repo.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n), seedRow(new Uint8Array([2]), 2n)], { expectedPgSeq: 0n, newPgSeq: 2n, walCheckpointSeq: 2n });
    expect(r).toEqual({ ok: false, reason: 'fenced' });   // 红：旧实现 UPDATE 无 fence=advanced→inserted=1>0 短路 {ok:true,rows:1}（吞缺口——调用方将 confirm 全前缀=缺行帧 WAL 副本被段回收=不可恢复丢失）
    expect(st.docRow!.pgSeq).toBe(0n);                    // 水位不越过缺行（红：旧实现=2n）
    expect(st.rows.has('p1:1:1')).toBe(true);             // 行1 已插（inserted=1）
    expect(st.rows.has('p1:1:2')).toBe(false);            // 行2 缺（红断言面：缺行实体）
  });

  it('facet B 变体（lease 失而复得——UPDATE 窗租约回手，watermark=advanced 仍缺行）：inserted<rows.length 短路禁用——按 PK 回查缺行=fenced', async () => {
    let insertSeen = 0;
    const { repo, st } = buildSim({ leaseOwner: 'me', docPgSeq: 0n }, (sql, st2) => {
      if (sql.includes('INSERT INTO "CanvasDocUpdate"')) { insertSeen += 1; if (insertSeen === 2) st2.leaseOwner = 'intruder'; }
      if (sql.includes('UPDATE "CanvasDoc"')) st2.leaseOwner = 'me';     // UPDATE 窗租约回手——fence 放行（watermark=advanced）
    });
    const r = await repo.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n), seedRow(new Uint8Array([2]), 2n)], { expectedPgSeq: 0n, newPgSeq: 2n, walCheckpointSeq: 2n });
    expect(r).toEqual({ ok: false, reason: 'fenced' });   // 红：旧实现 inserted=1>0 即 ok（缺行静默吞——锚定短路修复）
    expect(st.rows.has('p1:1:2')).toBe(false);            // 行2 缺
  });

  // ══ T10 Minor 移交（Y1c T11——双评审复核收口）：lease「批内失→adopt/建档前复得」翻覆窗 ══
  //  缺陷形态：cas-miss 分支的 adopt UPDATE 与懒建档 INSERT 在 partialOk 回查**之前**执行并提交——
  //  翻覆窗下（批内第 2 INSERT 被 fence 拦 ⇒ 缺行；cas-miss 二次查时租约已复得 ⇒ adopt/建档放行）
  //  水位先越过缺行落定，partialOk 事后才折 fenced 返回——DB 恢复基线已被污染（重启从 pgSeq 起放
  //  将跳过缺行）。根修=adopt/建档**前**先 verifyRowsLanded，行全在才提交水位。
  it('T10 Minor 翻覆窗 facet A（懒建档）：批内失→建档前复得——缺行禁随建档 INSERT 落水位（红=旧实现建档 pgSeq=new 越过缺行）', async () => {
    let insertSeen = 0;
    const { repo, st } = buildSim({ leaseOwner: 'me', docPgSeq: null }, (sql, st2) => {
      if (sql.includes('INSERT INTO "CanvasDocUpdate"')) { insertSeen += 1; if (insertSeen === 2) st2.leaseOwner = 'intruder'; }   // 批内第 2 INSERT 前易主（行 2 缺）
      if (sql.includes('SELECT "pgSeq" FROM "CanvasDoc"')) st2.leaseOwner = 'me';   // cas-miss 二次查时复得——建档 INSERT 放行（翻覆窗合口）
    });
    const r = await repo.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n), seedRow(new Uint8Array([2]), 2n)], { expectedPgSeq: 0n, newPgSeq: 2n, walCheckpointSeq: 2n });
    expect(r).toEqual({ ok: false, reason: 'fenced' });
    expect(st.rows.has('p1:1:2')).toBe(false);          // 行 2 缺（翻覆窗上游）
    expect(st.docRow, '缺行在=禁建档推水位（红：旧实现建行 pgSeq=2——恢复基线越过缺行）').toBeNull();
    expect(st.pgSeqAdvanced).toBe(0);
  });

  it('T10 Minor 翻覆窗 facet B（adopt）：批内失→adopt 前复得——缺行禁随 adopt UPDATE 落水位（红=旧实现 pgSeq 被推过缺行）', async () => {
    let insertSeen = 0;
    const { repo, st } = buildSim({ leaseOwner: 'me', docPgSeq: 0n }, (sql, st2) => {
      if (sql.includes('INSERT INTO "CanvasDocUpdate"')) { insertSeen += 1; if (insertSeen === 2) st2.leaseOwner = 'intruder'; }
      if (sql.includes('SELECT "pgSeq" FROM "CanvasDoc"')) st2.leaseOwner = 'me';   // adopt 窗复得——adopt UPDATE 放行
    });
    const r = await repo.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n), seedRow(new Uint8Array([2]), 2n)], { expectedPgSeq: 0n, newPgSeq: 2n, walCheckpointSeq: 2n });
    expect(r).toEqual({ ok: false, reason: 'fenced' });
    expect(st.rows.has('p1:1:2')).toBe(false);          // 行 2 缺
    expect(st.docRow!.pgSeq, '水位不越过缺行（红：旧实现 adopt 推 pgSeq=2）').toBe(0n);
    expect(st.pgSeqAdvanced).toBe(0);
  });

  it('T10 Minor 根修正例：行全在（无缺行）的 cas-miss→adopt 照常收敛（翻覆窗修复不误伤 G2 ④ 收敛路径）', async () => {
    // CAS expected 故意滞后（5≠0）→ cas-miss；行全插（租约恒我）→ adopt 前回查全在 → adopt 收敛 ok
    const { repo, st } = buildSim({ leaseOwner: 'me', docPgSeq: 0n });
    const r = await repo.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n), seedRow(new Uint8Array([2]), 2n)], { expectedPgSeq: 5n, newPgSeq: 2n, walCheckpointSeq: 2n });
    expect(r).toEqual({ ok: true, rows: 2 });
    expect(st.docRow!.pgSeq).toBe(2n);                  // 行全在 ⇒ adopt 推水位合法
  });

  it('形状锚：CAS/adopt 两 UPDATE 的 WHERE 均含 CollabLease EXISTS fence+adopt 补 generation 谓词（Q-M8）', async () => {
    const txq = vi.fn()
      .mockResolvedValueOnce([{ seq: 1n }])   // INSERT → 1 行
      .mockResolvedValueOnce([]);             // UPDATE CAS → 0 行（cas-miss）
    const query = vi.fn()
      .mockResolvedValueOnce([{ pgSeq: 0n }]) // C1② tripwire 前置 SELECT pgSeq（0<lastWalSeq=1——放行）
      .mockResolvedValueOnce([{ pgSeq: 0n }]) // cas-miss 二次查（0<new→adopt 档）
      .mockResolvedValue([{ pgSeq: 1n }]);    // adopt UPDATE → 成功（G2 ④ 收敛）
    const prisma = { $queryRaw: query, $transaction: vi.fn((fn: any) => fn({ $queryRaw: txq, $executeRaw: vi.fn().mockResolvedValue([]) })) };
    const repo = new CanvasDocUpdateRepository(prisma as any);
    repo.setLeaseOwner('me');
    const r = await repo.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n)], { expectedPgSeq: 5n, newPgSeq: 1n, walCheckpointSeq: 1n });
    expect(r).toEqual({ ok: true, rows: 1 });
    const cas = txq.mock.calls.find((c: any[]) => shapeOf(c).includes('UPDATE "CanvasDoc"'))!;
    expect(shapeOf(cas)).toContain('EXISTS (SELECT 1 FROM "CollabLease"');
    const adopt = query.mock.calls.find((c: any[]) => shapeOf(c).includes('UPDATE "CanvasDoc"'))!;
    expect(shapeOf(adopt)).toContain('EXISTS (SELECT 1 FROM "CollabLease"');
    expect(shapeOf(adopt)).toContain('generation = ?::int');   // Q-M8：adopt 谓词补 generation（T12 换代窗口防陈旧 adopt）
  });
});

// ══ I1.2（T12 双评审收口）：vacuumReplace 锁内 generation 复核——头注「锁内实读复核漂移即中止」缺落实装 ══
//  布景=expectedGeneration 滞后于 DB（并发窗）：调用方（vacuumCore）传 ④ 装载读行值
//  （复核残留 I1.2 修——era 投影源退役；④ 读后⑥ 前的 DB 推进=真漂移窗），锁内实读 generation
//  ≠ 该值 ⇒ 整体中止 DB 零变更（返回 aborted 档——先于任何写）。repository 直测形态
//  （expectedGeneration 显式传错值→aborted——漂移档守卫面单点钉死）。
describe('I1.2 vacuumReplace 锁内 generation 复核（expectedGeneration——vacuumCore ④ 装载读行值）', () => {
  const shape = (c: any[]) => (c[0] as string[]).join('?');

  function buildVacuumSim(liveDoc: { generation: number; schemaVersion: number; vacuumEpoch: number; currentSnapshotRev: bigint } | null) {
    const writes = { upsertSnap: 0, upsertDoc: 0, deleteMany: 0 };
    const prisma = {
      $transaction: vi.fn((fn: any) => fn({
        $executeRaw: vi.fn().mockResolvedValue([]),   // advisory lock
        canvasDocUpdate: {
          findMany: vi.fn().mockResolvedValue([]),    // 锁内实读行集（expectedRowCount=0 对齐）
          deleteMany: vi.fn(async () => { writes.deleteMany += 1; }),
        },
        canvasDoc: {
          findUnique: vi.fn().mockResolvedValue(liveDoc),   // 锁内实读 generation（漂移注入位）
          upsert: vi.fn(async () => { writes.upsertDoc += 1; }),
        },
        canvasDocSnapshot: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn(async () => { writes.upsertSnap += 1; }),
        },
      })),
    };
    return { repo: new CanvasDocUpdateRepository(prisma as any), writes };
  }
  const liveDocAt = (generation: number) => ({ generation, schemaVersion: 3, vacuumEpoch: 0, currentSnapshotRev: 0n });

  it('投影滞后于 DB（expected=1，锁内实读 generation=2——并发换代窗）⇒ aborted 档返回+DB 零变更（upsert/deleteMany 零调用；红=旧实现照常换代提交）', async () => {
    const { repo, writes } = buildVacuumSim(liveDocAt(2));
    const r = await repo.vacuumReplace('p1', Buffer.from([0, 0]), 0, 1);
    expect(r).toEqual({ aborted: 'generation-drift', dbGeneration: 2 });
    expect(writes.upsertSnap).toBe(0);   // 新代快照未写（红：旧实现=1）
    expect(writes.upsertDoc).toBe(0);    // 头行未推进（红：旧实现=1）
    expect(writes.deleteMany).toBe(0);   // 旧代行未删（红：旧实现=1）
  });

  it('投影对齐（expected=锁内实读）⇒ 照常换代（守卫不误伤主路径——generation++ 提交）', async () => {
    const { repo, writes } = buildVacuumSim(liveDocAt(2));
    const r = await repo.vacuumReplace('p1', Buffer.from([0, 0]), 0, 2);
    expect(r).toEqual({ generation: 3 });
    expect(writes.upsertSnap).toBe(1);
    expect(writes.upsertDoc).toBe(1);
    expect(writes.deleteMany).toBe(1);
  });

  it('行缺失（懒建档形态）：锁内折 0 与 expected=0 对齐 ⇒ 放行（create 档不受守卫误伤）', async () => {
    const { repo, writes } = buildVacuumSim(null);
    const r = await repo.vacuumReplace('p1', Buffer.from([0, 0]), 0, 0);
    expect(r).toEqual({ generation: 1 });
    expect(writes.upsertDoc).toBe(1);
  });
});

// ══ M4（T12 双评审收口）：懒建档 raw INSERT schemaVersion 绑定 CANVAS_DOC_SCHEMA_VERSION 常量参数 ══
//  三源（raw INSERT 字面量 3 / @default(3) / CANVAS_DOC_SCHEMA_VERSION）→ 单源化：INSERT 绑常量参数
//  （@default 保留为 DDL 兜底）。断言=绑定值（常量改值场景随行）+词法（SQL 无内联字面量）。
describe('M4 懒建档 INSERT schemaVersion 绑定常量（appendBatch cas-miss→行缺失布景）', () => {
  const shape = (c: any[]) => (c[0] as string[]).join('?');

  it('schemaVersion 位=绑定参数且绑定值=CANVAS_DOC_SCHEMA_VERSION（红=旧实现 SQL 内联字面量 3 无绑定）', async () => {
    const execCalls: any[][] = [];
    const txRespond = async (strings: string[], ...vals: unknown[]): Promise<unknown[]> => {
      const sql = strings.join('?');
      if (sql.includes('INSERT INTO "CanvasDocUpdate"')) return [{ seq: vals[2] }];   // 批行全插
      if (sql.includes('UPDATE "CanvasDoc"')) return [];                              // CAS → 0 行（cas-miss）
      return [];
    };
    const query = vi.fn(async (strings: string[], ...vals: unknown[]): Promise<unknown[]> => {
      const sql = strings.join('?');
      if (sql.includes('SELECT "pgSeq" FROM "CanvasDoc"')) return [];   // tripwire 前置+cas-miss 二次查均=行缺失
      if (sql.includes('AND seq = ')) return [{ seq: vals[2] }];        // verifyRowsLanded 全在
      return txRespond(strings, ...vals);
    });
    const prisma = {
      $queryRaw: query,
      $executeRaw: vi.fn(async (strings: string[], ...vals: unknown[]) => { execCalls.push([strings, ...vals]); return []; }),
      $transaction: vi.fn((fn: any) => fn({ $queryRaw: vi.fn(txRespond), $executeRaw: vi.fn(async () => []) })),
    };
    const repo = new CanvasDocUpdateRepository(prisma as any);
    repo.setLeaseOwner('me');
    const r = await repo.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n)], { expectedPgSeq: 0n, newPgSeq: 1n, walCheckpointSeq: 1n });
    expect(r).toEqual({ ok: true, rows: 1 });   // cas-miss+行缺失 → 懒建档路径已达
    const insert = execCalls.find((c: any[]) => shape(c).includes('INSERT INTO "CanvasDoc"')) as any[] | undefined;
    expect(insert, '懒建档 INSERT 已触达').toBeDefined();
    const insertCall = insert as any[];
    expect(shape(insertCall)).toContain('SELECT ?::text, ?::int, ?::int, now()');   // 词法：schemaVersion 位=占位参数（红：旧=?::int, 3, now()）
    expect(insertCall.slice(1)[2]).toBe(CANVAS_DOC_SCHEMA_VERSION);                 // 绑定值=常量（改值场景随行——红：旧无此绑定）
  });
});
