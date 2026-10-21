// apps/api/src/modules/collab/collab-flush-document.int.spec.ts
// plan v11.2 片 S4 T14：flushDocument 带理由窄接口真 PG 证明（先红——接口缺失=runtime 红）。
// 真链面：真 CollabLeaseService CAS（epoch 换代/失守两态）+真 CanvasDocUpdateRepository（语句级
// fence/真 FK）+真 spool tmp 目录（fsync 交接）。五分支+epoch 易主+fk 全走真库——mock 测不出
// 代际/语句级 fence 形态（lease-fence.int.spec 同源纪律；fileParallelism=false 单行资源串行）。
// 装置：真 lease 实例**逐用例新建**（halt 后不可复得——换代/失守用例终态不互染；owner 每实例唯一）。
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';
import * as Y from 'yjs';
import { rm } from 'node:fs/promises';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabLeaseService } from './collab-lease.service';
import { CollabSpoolService } from './collab-spool.service';
import {
  CollabPersistenceService,
  type CollabPersistenceHost, type PersistenceDocument,
} from './collab-persistence.service';
import { ensureProjectFixture, cleanupProjectFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { makeSpoolDir } from '../../test-utils/spool-dir';

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

const P1 = 't14-flush-int-p1';
const P2 = 't14-flush-int-p2';
const NAME1 = `project:${P1}`;
const NAME2 = `project:${P2}`;

function makeDoc(): PersistenceDocument {
  const doc = new Y.Doc() as PersistenceDocument;
  Object.assign(doc, {
    saveMutex: { runExclusive: <T,>(fn: () => Promise<T> | T) => fn() },
    broadcastStateless: () => {},
    connections: new Map(),
  });
  return doc;
}

d('T14 flushDocument 真库（五分支+epoch 易主两态+fk）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);
  let dir: string; let cleanup: () => Promise<void>;
  let spool: CollabSpoolService;
  let svc: CollabPersistenceService;
  let docs: Map<string, PersistenceDocument>;
  let isolated: boolean;
  let lease: CollabLeaseService;

  beforeAll(async () => {
    ({ dir, cleanup } = await makeSpoolDir('t14-flush-int-'));
    await restoreLeaseRow(prisma as any);   // 清残留 fixture owner——首获 WHERE owner IS NULL 可达
    await ensureProjectFixture(prisma as any, P1, 't14-flush-int-p1');
    await ensureProjectFixture(prisma as any, P2, 't14-flush-int-p2');
  });
  afterAll(async () => {
    await cleanupProjectFixture(prisma as any, P1);
    await cleanupProjectFixture(prisma as any, P2);
    await restoreLeaseRow(prisma as any);
    await prisma.$disconnect();
    await cleanup();
  });

  beforeEach(async () => {
    spool = new CollabSpoolService(dir);
    isolated = false;
    docs = new Map([[NAME1, makeDoc()], [NAME2, makeDoc()]]);
    svc = new CollabPersistenceService(repo as never, spool);
    // host 缝复刻生产链：currentLeaseEpoch=真 lease 读；onFencedByWrite→isolated 翻转=selfIsolate
    // 后 isIsolated() 真值（gateway transition 同步先行）；getDocument=库 documents Map 语义。
    svc.bindHost({
      logger: new Logger('t14-flush-int'),
      getDocument: (name) => docs.get(name),
      docStats: () => ({ loadedDocs: docs.size, connections: 0, directConns: 0 }),
      onUpdateDelta: () => {},
      onFencedByWrite: async () => { isolated = true; },
      calibrateTruth: () => undefined,
      observeDocBytes: () => {},
      isIsolated: () => isolated,
      isServingState: () => true,
      isShuttingDownFlag: () => false,
      onSpoolRecoveredFlip: () => {},
      currentLeaseEpoch: () => lease.currentEpoch(),
    } as CollabPersistenceHost);
    lease = new CollabLeaseService(prisma as any, repo, spool);   // 真实例逐用例新建（换代/失守终态不互染）
    expect(await lease.tryAcquireFast()).toBe(true);               // 真 CAS（onHeld 接线 repo/spool owner）
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: { in: [P1, P2] } } });
  });
  afterEach(async () => {
    lease.halt();
    await lease.release().catch(() => {});
    await restoreLeaseRow(prisma as any);
    vi.restoreAllMocks();
  });

  /** 入队一批（真 doc 监听） */
  function enqueue(pid: string, name: string, key: string): void {
    const doc = docs.get(name)!;
    svc.observeDocument(doc, pid, name);
    const w = new Y.Doc();
    w.getMap('nodes').set(key, { v: 1 });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(w));
  }

  it('persisted 真链：真 lease 捕获 epoch→flush→{persisted}+真 CanvasDocUpdate 行落库；复调 noop→{persisted} 行数不变', async () => {
    const epoch = lease.currentEpoch();
    expect(typeof epoch).toBe('bigint');
    enqueue(P1, NAME1, 'k1');
    const r1 = await svc.flushDocument(P1, epoch);
    expect(r1).toEqual({ kind: 'persisted' });
    const rows1 = await prisma.canvasDocUpdate.count({ where: { projectId: P1 } });
    expect(rows1).toBeGreaterThan(0);
    const r2 = await svc.flushDocument(P1, epoch);   // noop∧isPersistedComplete=persisted 等价
    expect(r2).toEqual({ kind: 'persisted' });
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: P1 } })).toBe(rows1);
  });

  it('retry/spooled 真链：PG 故障注入→批落真 spool（fsync）→{retry,spooled}；恢复复调→帧回灌真 PG→{persisted}+段回收', async () => {
    const epoch = lease.currentEpoch();
    const spy = vi.spyOn(repo, 'append').mockRejectedValueOnce(new Error('injected pg down'));
    enqueue(P1, NAME1, 'k1');
    const r1 = await svc.flushDocument(P1, epoch);
    expect(r1).toEqual({ kind: 'retry', reason: 'spooled' });
    expect(spool.hasFrames(P1)).toBe(true);          // 真磁盘台账
    const r2 = await svc.flushDocument(P1, epoch);   // append 已复原（Once 队列耗尽）——帧三段式回灌
    expect(r2).toEqual({ kind: 'persisted' });
    expect(spy).toHaveBeenCalledTimes(2);            // 故障 1+回灌 1
    expect(spool.hasFrames(P1)).toBe(false);         // confirm→段回收
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: P1 } })).toBeGreaterThan(0);
  });

  it('epoch 易主两态（v11.1① red：租约易主后旧会话 flush 被拒）：释放=失守（currentEpoch null）→fenced；复得=换代（epoch+1）→旧捕获值 fenced+新捕获值可提交', async () => {
    const e1 = lease.currentEpoch();
    enqueue(P1, NAME1, 'k1');
    await lease.release();                            // 失守（owner=NULL+repo owner 清空——真链）
    expect(lease.currentEpoch()).toBe(null);
    expect(await svc.flushDocument(P1, e1)).toEqual({ kind: 'terminal', reason: 'fenced' });
    expect(svc.hasPendingWrites(P1)).toBe(true);      // 未提交（拒绝落库）
    expect(await lease.tryAcquireFast()).toBe(true);  // 复得=换代
    const e2 = lease.currentEpoch();
    expect(e2).toBeGreaterThan(e1!);                  // epoch=epoch+1（每次 acquire 自增）
    expect(await svc.flushDocument(P1, e1)).toEqual({ kind: 'terminal', reason: 'fenced' });   // 旧捕获值（长会话）必被拒
    expect(await svc.flushDocument(P1, e2)).toEqual({ kind: 'persisted' });                    // 新捕获值正常提交
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: P1 } })).toBeGreaterThan(0);
  });

  it('terminal/fenced 语句级（epoch 缓存未变窗——SQL 夺锁）：append={ok:false,fenced}（写语句 owner 断言）→隔离链→{terminal,fenced}', async () => {
    const epoch = lease.currentEpoch();
    enqueue(P1, NAME1, 'k1');
    // SQL 模拟 B 实例夺锁（lease-fence.int.spec 同款）——本进程 epoch 缓存未及刷新（heartbeat 窗）
    await prisma.$executeRawUnsafe(`UPDATE "CollabLease" SET owner = 'owner-B', "expiresAt" = now() + interval '1 hour' WHERE scope = 'primary'`);
    const r = await svc.flushDocument(P1, epoch);
    expect(r).toEqual({ kind: 'terminal', reason: 'fenced' });
    expect(isolated).toBe(true);                      // onFencedByWrite 链已走（selfIsolate 语义）
  });

  it('terminal/fk 真链（red：删 project 后 flush→fk 不重试不死循环）：真 FK 违反→批丢弃+终态登记→{terminal,fk}；复调零 PG 触达', async () => {
    const epoch = lease.currentEpoch();
    enqueue(P2, NAME2, 'k1');
    await cleanupProjectFixture(prisma as any, P2);   // 真删（Cascade 清 CanvasDocUpdate）——FK 权威证据
    const r1 = await svc.flushDocument(P2, epoch);
    expect(r1).toEqual({ kind: 'terminal', reason: 'fk' });
    expect(svc.deletedProjects.has(P2)).toBe(true);
    expect(svc.hasPendingWrites(P2)).toBe(false);     // 批终态丢弃
    const spy = vi.spyOn(repo, 'append');
    expect(await svc.flushDocument(P2, epoch)).toEqual({ kind: 'terminal', reason: 'fk' });   // 复调不死循环
    expect(spy).not.toHaveBeenCalled();
  });

  it('retry/failed 真链（最后执行——毁 spool 目录）：PG 故障∧spool 不可写→批滞留内存队列→{retry,failed}', async () => {
    const epoch = lease.currentEpoch();
    enqueue(P1, NAME1, 'k1');
    vi.spyOn(repo, 'append').mockRejectedValueOnce(new Error('injected pg down'));
    await rm(dir, { recursive: true, force: true });  // 真 fs 失败注入（spool 不可写）
    const r = await svc.flushDocument(P1, epoch);
    expect(r).toEqual({ kind: 'retry', reason: 'failed' });
    expect(svc.hasPendingWrites(P1)).toBe(true);      // 批保留队列（BOI 归属地不变）
  });
});
