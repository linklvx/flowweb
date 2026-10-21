// apps/api/src/modules/collab/collab-flush-document.spec.ts
// plan v11.2 片 S4 T14：flushDocument 带理由窄接口（v10.1 T6c 载体维持——Z18''④/:30 四分叉裁定④）
// 先红用例。红锚=「调用方若把 spool 当失败计 attempts」的判定载体缺失面：storeDocumentUnlocked
// boolean 五分支混一个 false（noop/spool 成功/spool 失败/FK/fenced——persistence 现状），交付判定
// （spooled≠delivered）无凭据。绿相=FlushOutcome 判别式五分支+noop 显式+epoch 提交前校验
// （v11.1①：会话捕获时 epoch≠当前 CollabLease.epoch→拒绝提交）。
// 装置=persistence spec 同款（mock repo+真 spool tmp 目录+最小 test host——真文件系统，禁 mock fs）
// +saveMutex 直通 doc（collab-shrink.spec 先例）。
// 真 PG 全链（真 CAS/真 FK/真语句级 fence）归 collab-flush-document.int.spec.ts。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { register } from 'prom-client';
import * as Y from 'yjs';
import { rm } from 'node:fs/promises';
import {
  CollabPersistenceService, SPOOL_DEADLINE_MS,
  type CollabPersistenceHost, type PersistenceDocument,
} from './collab-persistence.service';
import { CollabSpoolService } from './collab-spool.service';
import { CollabResidencyService } from './collab-residency.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';

const PID = 't14p1';
const NAME = `project:${PID}`;
const EPOCH = 7n;

/** 最小 host（persistence spec 同款+T14 两位：currentLeaseEpoch 可变注入/isIsolated 经
 *  onFencedByWrite 翻转——复刻生产链 store fenced→host.onFencedByWrite→selfIsolate→isIsolated）。 */
function makeHost(over: Partial<CollabPersistenceHost> = {}): CollabPersistenceHost {
  let isolated = false;
  return {
    logger: new Logger('t14-flush-test'),
    getDocument: () => undefined,
    docStats: () => ({ loadedDocs: 0, connections: 0, directConns: 0 }),
    onUpdateDelta: () => {},
    onFencedByWrite: async () => { isolated = true; },
    calibrateTruth: () => undefined,
    observeDocBytes: () => {},
    isIsolated: () => isolated,
    isServingState: () => true,
    isShuttingDownFlag: () => false,
    onSpoolRecoveredFlip: () => {},
    currentLeaseEpoch: () => EPOCH,
    ...over,
  };
}

/** saveMutex 直通 doc（PersistenceDocument 最小结构面——collab-shrink.spec:57 先例）。 */
function makeDoc(): PersistenceDocument {
  const doc = new Y.Doc() as PersistenceDocument;
  Object.assign(doc, {
    saveMutex: { runExclusive: <T,>(fn: () => Promise<T> | T) => fn() },
    broadcastStateless: () => {},
    connections: new Map(),
  });
  return doc;
}

/** 计数器现值（register 全局单例——恒用增量断言）。 */
async function counterValue(name: string): Promise<number> {
  const m = register.getSingleMetric(name) as any;
  if (!m) return NaN;
  return (await m.get()).values.reduce((s: number, v: any) => s + v.value, 0);
}

/** doc 上入队一批（worker doc 编码→apply——update 监听 push-only 入 pending 队列）。 */
function enqueue(svc: CollabPersistenceService, doc: PersistenceDocument, key: string): void {
  const w = new Y.Doc();
  w.getMap('nodes').set(key, { v: 1 });
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(w));
  expect(svc.hasPendingWrites(PID)).toBe(true);
}

describe('T14 flushDocument 带理由窄接口（五分支+epoch 提交前校验+noop 显式）', () => {
  let dir: string; let cleanup: () => Promise<void>;
  let spool: CollabSpoolService;
  let repo: ReturnType<typeof createMockRepo>;
  let svc: CollabPersistenceService;
  let doc: PersistenceDocument;
  let docs: Map<string, PersistenceDocument>;
  let epochNow: bigint | null;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeSpoolDir('t14-flush-'));
    spool = new CollabSpoolService(dir);
    spool.setOwner('t14-owner');
    repo = createMockRepo();
    epochNow = EPOCH;
    doc = makeDoc();
    docs = new Map([[NAME, doc]]);
    svc = new CollabPersistenceService(repo as never, spool);
    svc.bindHost(makeHost({
      getDocument: (name) => docs.get(name),
      currentLeaseEpoch: () => epochNow,
    }));
    svc.observeDocument(doc, PID, NAME);
  });
  afterEach(async () => { await cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('persisted 主路径：批在队→flush(捕获=当前 epoch)→{persisted}+批落 PG+队列排空（显式 storeDocumentSerialized 原语）', async () => {
    enqueue(svc, doc, 'k1');
    const before = await counterValue('collab_flush_document_outcome_total');
    const r = await svc.flushDocument(PID, EPOCH);
    expect(r).toEqual({ kind: 'persisted' });
    expect(repo.append).toHaveBeenCalledTimes(1);
    expect(svc.hasPendingWrites(PID)).toBe(false);
    expect(svc.isPersistedComplete(PID)).toBe(true);
    expect(await counterValue('collab_flush_document_outcome_total')).toBeGreaterThan(before);
  });

  it('noop 分支显式：无未落库变更（pending 空∧spool 空）∧isPersistedComplete→{persisted} 等价（不触 store——repo.append 零调用）', async () => {
    const r = await svc.flushDocument(PID, EPOCH);
    expect(r).toEqual({ kind: 'persisted' });
    expect(repo.append).not.toHaveBeenCalled();
    expect(spool.hasFrames(PID)).toBe(false);
  });

  it('retry/spooled：PG 不可达→批落 spool（fsync 新家）→{retry,spooled}——磁盘安全档（spooled≠delivered，调用方不耗 attempts）', async () => {
    enqueue(svc, doc, 'k1');
    repo.append.mockRejectedValue(new Error('pg down'));
    const r = await svc.flushDocument(PID, EPOCH);
    expect(r).toEqual({ kind: 'retry', reason: 'spooled' });
    expect(spool.hasFrames(PID)).toBe(true);           // 台账在盘（磁盘安全）
    expect(svc.hasPendingWrites(PID)).toBe(false);     // 批已离开内存队列（BOI 归属地=spool）
  });

  it('spooled 无限重试不设假失败（red：PG 停机>1h 判死磁盘安全帧=假失败——G58「PG 停机>1h 保持 pending 非 failed」）：时钟前拨>spoolDeadline 仍 {retry,spooled} 非 failed', async () => {
    expect(SPOOL_DEADLINE_MS).toBe(3_600_000);         // 1h 兜底常量=failed 档载体（T15 行级判定），spooled 档不受它约束
    enqueue(svc, doc, 'k1');
    repo.append.mockRejectedValue(new Error('pg down'));
    expect(await svc.flushDocument(PID, EPOCH)).toEqual({ kind: 'retry', reason: 'spooled' });
    // —— PG 持续停机>1h（时钟注入：系统时间前拨 2×spoolDeadline）——帧在盘安全，不得判死 ——
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + SPOOL_DEADLINE_MS * 2);
    const r = await svc.flushDocument(PID, EPOCH);
    expect(r).toEqual({ kind: 'retry', reason: 'spooled' });   // 非 failed（假失败根防）
    expect(spool.hasFrames(PID)).toBe(true);                   // 帧仍在盘（未被弃守）
  });

  it('retry/failed：连 spool 都未落（目录已毁）→批滞留内存队列→{retry,failed}——耗 attempts 档（failed=耗 maxAttempts∨spoolDeadline，归调用方/T15）', async () => {
    enqueue(svc, doc, 'k1');
    repo.append.mockRejectedValue(new Error('pg down'));
    await rm(dir, { recursive: true, force: true });    // spool 不可写（真 fs 失败注入）
    const r = await svc.flushDocument(PID, EPOCH);
    expect(r).toEqual({ kind: 'retry', reason: 'failed' });
    expect(svc.hasPendingWrites(PID)).toBe(true);       // 批保留内存队列（BOI 归属地不变）
  });

  it('terminal/fenced（epoch 易主——提交前校验）：捕获值≠当前代→{terminal,fenced} 且不触 store（拒绝提交——repo.append 零调用+批留队未动）', async () => {
    enqueue(svc, doc, 'k1');
    const r = await svc.flushDocument(PID, EPOCH + 1n);   // 模拟租约易主后旧会话（长会话捕获值过期）
    expect(r).toEqual({ kind: 'terminal', reason: 'fenced' });
    expect(repo.append).not.toHaveBeenCalled();           // 提交被拒（不触 store）
    expect(svc.hasPendingWrites(PID)).toBe(true);         // 批留在队列（未提交）
  });

  it('terminal/fenced（lease 失守——当前 epoch=null）：任何捕获值→{terminal,fenced}（停 claim 等租约语义——返回调用方自停）', async () => {
    enqueue(svc, doc, 'k1');
    epochNow = null;                                      // lease 非 held（lost/revoked/not-acquired）
    const r = await svc.flushDocument(PID, EPOCH);
    expect(r).toEqual({ kind: 'terminal', reason: 'fenced' });
    expect(repo.append).not.toHaveBeenCalled();
  });

  it('terminal/fenced（store 路径语句级 fenced）：epoch 校验过但 append={ok:false,fenced}→selfIsolate 链→{terminal,fenced}（终态优先于 spool 在盘——尽管批已安全落 spool）', async () => {
    enqueue(svc, doc, 'k1');
    repo.append.mockResolvedValue({ ok: false, reason: 'fenced' });
    const r = await svc.flushDocument(PID, EPOCH);
    expect(r).toEqual({ kind: 'terminal', reason: 'fenced' });
    expect(spool.hasFrames(PID)).toBe(true);              // 批走 spool（契约 15：fenced 批落 spool+不排梯）
  });

  it('terminal/fk（事件路径终态集预登记）：deletedProjects 命中→{terminal,fk} 不触 store（fk→orphaned 归 T15；不重试）', async () => {
    enqueue(svc, doc, 'k1');
    svc.onProjectGone(PID);                               // project.gone 事件路径（终态集登记+清队列）
    const r = await svc.flushDocument(PID, EPOCH);
    expect(r).toEqual({ kind: 'terminal', reason: 'fk' });
    expect(repo.append).not.toHaveBeenCalled();
  });

  it('terminal/fk（store 路径 FK 发现点）：append 抛 FK（P2003）→批丢弃+终态集登记→{terminal,fk}；复调仍 fk 不死循环（第二次零 append）', async () => {
    enqueue(svc, doc, 'k1');
    repo.append.mockRejectedValue(Object.assign(new Error('FK violation'), { code: 'P2003' }));
    const r1 = await svc.flushDocument(PID, EPOCH);
    expect(r1).toEqual({ kind: 'terminal', reason: 'fk' });
    expect(svc.deletedProjects.has(PID)).toBe(true);      // FK=项目消失的写路径发现点（终态登记）
    expect(svc.hasPendingWrites(PID)).toBe(false);        // 批已丢弃（project deleted——终态处置）
    repo.append.mockClear();
    const r2 = await svc.flushDocument(PID, EPOCH);       // 复调：终态集命中——不再触 PG（无重试死循环）
    expect(r2).toEqual({ kind: 'terminal', reason: 'fk' });
    expect(repo.append).not.toHaveBeenCalled();
  });

  it('doc 已卸载（无会话）：队列批→spool 交接（既有原语）→{retry,spooled}；帧-only→{retry,spooled}（已磁盘安全，PG 落定归退避梯/下轮 flush）', async () => {
    docs.delete(NAME);                                    // doc 不在（reaper/断连窗）
    enqueue(svc, doc, 'k1');
    const r1 = await svc.flushDocument(PID, EPOCH);
    expect(r1).toEqual({ kind: 'retry', reason: 'spooled' });
    expect(spool.hasFrames(PID)).toBe(true);              // 交接落定（fsync）
    expect(svc.hasPendingWrites(PID)).toBe(false);
    repo.append.mockRejectedValue(new Error('pg down'));  // 帧-only 档：PG 仍不可达
    const r2 = await svc.flushDocument(PID, EPOCH);
    expect(r2).toEqual({ kind: 'retry', reason: 'spooled' });
  });

  it('residency 透传面：CollabResidencyService.flushDocument 委托 persistence（T15 投影 poller 消费位）', async () => {
    const gateway: any = {
      persistence: svc,
      registerResidentSessionReleaser: vi.fn(),
      registerResidentSessionsProbe: vi.fn(),
      server: { hocuspocus: { documents: new Map(), openDirectConnection: vi.fn() } },
    };
    const residency = new CollabResidencyService(gateway);
    const spy = vi.spyOn(svc, 'flushDocument');
    await residency.flushDocument(PID, EPOCH);
    expect(spy).toHaveBeenCalledWith(PID, EPOCH);
  });
});
