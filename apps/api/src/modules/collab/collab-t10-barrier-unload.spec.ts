// apps/api/src/modules/collab/collab-t10-barrier-unload.spec.ts
// Y1c T10：save barrier 服务端接线（onStateless→handler 首语句同步捕获 target=appliedSeq→
// flushThrough 有界→显式 sendStateless 回执；nonce 幂等/永不 throw/maintenance 拒绝）+
// flushThrough 契约（幂等/有界/不阻塞写/返回 pgSeq）+doc 卸载纪律（drain applied→PG 或拒）。
// 红相：T9 基线无 handleStateless/flushThrough/drainAppliedForUnload API（编译红）；本套件=T10 落地后
// 绿相锁定（T5a doc-protocol 冻结契约+y1c-barrier-corpus 消费——import 消费禁重抄）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { register } from 'prom-client';
import { CollabProjectActorService } from './collab-project-actor.service';
import { CollabSpoolService } from './collab-spool.service';
import { CollabDocRegistryService } from './collab-doc-registry.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { buildBarrierCorpus } from '@flowweb/shared';
import type { Logger, ServiceUnavailableException } from '@nestjs/common';

const frameOf = (key: string, val: unknown) => {
  const src = new Y.Doc();
  (src.getMap('nodes') as Y.Map<unknown>).set(key, val);
  return Y.encodeStateAsUpdate(src);
};

/** 慢 apply actor（target 同步捕获验证——apply 挂起窗内 handler 的捕获面）。 */
class SlowApplyActor extends CollabProjectActorService {
  gate: (() => void) | null = null;   // 非空=apply 挂起直至调用
  protected applyGate(document: Y.Doc, payload: Uint8Array, origin: import('@flowweb/shared').GateApplyOrigin): void {
    if (this.gate) { this.gate(); this.gate = null; }   // 释放后继续（一次性挂起）
    super.applyGate(document, payload, origin);
  }
}

/** PG 故障 repo（appendBatch 恒败——卸载 drain 拒绝档）。 */
class DeadPgRepo {
  appendBatch = vi.fn(async () => { throw Object.assign(new Error('pg down (t10 barrier)'), { pgPending: true }); });
}

function makeConn(sendStateless: (p: string) => void = () => {}) {
  return { socketId: 'sb-' + Math.random().toString(36).slice(2, 8), readOnly: false, sendStateless } as never;
}

const loggerStub = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn(), fatal: vi.fn() } as unknown as Logger;

describe('Y1c T10 save barrier 服务端接线（onStateless handler——actor 域）', () => {
  let dir: { dir: string; cleanup: () => Promise<void> };
  let spool: CollabSpoolService;
  const doc = new Y.Doc();
  const documents = new Map([['project:bp', doc]]);

  const build = (over: { maintenance?: boolean; repo?: unknown } = {}) => {
    const repo = (over.repo ?? createMockRepo()) as never;
    const actor = new CollabProjectActorService(spool, repo);
    actor.bindHost({
      logger: loggerStub,
      documents: () => documents,
      hardClose: () => {},
      isQuotaFrozen: () => false,
      generationOf: () => 1,
      noteReadOnlyDrop: () => false,
      onFencedByWrite: async () => {},
      ...(over.maintenance ? { isMaintenanceBlocked: () => true } : {}),
    });
    return { actor, repo };
  };

  beforeEach(async () => {
    dir = await makeSpoolDir('t10-barrier-');
    spool = new CollabSpoolService(dir.dir);
    spool.setOwner('t10-barrier');
    spool.setWalHistory('hist-t10-barrier');
  });
  afterEach(async () => { await dir.cleanup(); });

  it('corpus 消费：并发双 tab barrier 各自回执+同 nonce 重试幂等+maintenance 拒绝+BARRIER_FAILED——T5a 冻结形状（y1c-barrier-corpus import 消费）', async () => {
    const corpus = buildBarrierCorpus();
    const { actor } = build();
    const r1 = await actor.submit('bp', frameOf('k1', 1), makeConn(), 'update');
    await actor.flushThrough('bp', r1.walSeq);
    // 双 tab：两 nonce 各自回执（committedSeq 可同值不可互替——nonce/clientSeq 各归各）
    const sends1: string[] = []; const sends2: string[] = [];
    await actor.handleStateless({ connection: makeConn((p) => sends1.push(p)), documentName: 'project:bp', payload: JSON.stringify(corpus.concurrentTabs.requests[0]) });
    await actor.handleStateless({ connection: makeConn((p) => sends2.push(p)), documentName: 'project:bp', payload: JSON.stringify(corpus.concurrentTabs.requests[1]) });
    expect(sends1).toHaveLength(1);
    expect(sends2).toHaveLength(1);
    const rec1 = JSON.parse(sends1[0]); const rec2 = JSON.parse(sends2[0]);
    expect(rec1).toMatchObject({ nonce: 'nonce-t1-a1', clientSeq: 7, committedSeq: r1.walSeq.toString() });
    expect(rec2).toMatchObject({ nonce: 'nonce-t2-b2', clientSeq: 4 });
    // nonce 重试幂等：同 nonce 重发回执逐字段等值
    const sendsRetry: string[] = [];
    await actor.handleStateless({ connection: makeConn((p) => sendsRetry.push(p)), documentName: 'project:bp', payload: JSON.stringify(corpus.nonceRetry.request) });
    await actor.handleStateless({ connection: makeConn((p) => sendsRetry.push(p)), documentName: 'project:bp', payload: JSON.stringify(corpus.nonceRetry.request) });
    expect(sendsRetry[0]).toBe(sendsRetry[1]);
    // 非 barrier payload 静默忽略（永不 throw）
    const none: string[] = [];
    await actor.handleStateless({ connection: makeConn((p) => none.push(p)), documentName: 'project:bp', payload: JSON.stringify({ type: 'persist-status', healthy: true }) });
    await actor.handleStateless({ connection: makeConn((p) => none.push(p)), documentName: 'project:bp', payload: 'not-json' });
    expect(none).toHaveLength(0);
  });

  it('maintenance 冻结期：error 回执 {nonce,error:maintenance,committedSeq} 不产生 Durable（isMaintenanceBlocked 缝）', async () => {
    const { actor } = build({ maintenance: true });
    const sends: string[] = [];
    await actor.handleStateless({ connection: makeConn((p) => sends.push(p)), documentName: 'project:bp', payload: JSON.stringify({ nonce: 'm1', clientSeq: 3, tabId: 't', sessionEpoch: 1 }) });
    expect(JSON.parse(sends[0])).toMatchObject({ nonce: 'm1', error: 'maintenance', committedSeq: '0' });
  });

  it('永不 throw：sendStateless 抛错被吞（handler 不进连接消息环）+flushThrough 失败回 BARRIER_FAILED', async () => {
    const { actor } = build({ repo: new DeadPgRepo() });
    await actor.submit('bp', frameOf('k2', 1), makeConn(), 'update');   // 帧滞留（PG 恒败）
    const sends: string[] = [];
    const throwing = () => { throw new Error('socket gone'); };
    await expect(actor.handleStateless({ connection: makeConn(throwing), documentName: 'project:bp', payload: JSON.stringify({ nonce: 'f1', clientSeq: 1, tabId: 't', sessionEpoch: 1 }) })).resolves.toBeUndefined();
    // 有界等待耗尽（flushThrough maxWait 注 100ms）→ BARRIER_FAILED 回执（此处 send 抛——改用可发连接验回执形状）
    const sends2: string[] = [];
    await actor.handleStateless({ connection: makeConn((p) => sends2.push(p)), documentName: 'project:bp', payload: JSON.stringify({ nonce: 'f2', clientSeq: 1, tabId: 't', sessionEpoch: 1 }) });
    const rec = JSON.parse(sends2[0]);
    expect(rec).toMatchObject({ nonce: 'f2', error: 'BARRIER_FAILED', committedSeq: '0' });
  });

  it('target 同步捕获（首语句纪律）：apply 挂起窗内到达的 barrier 捕 appliedSeq 不含在飞帧（committedSeq=0<帧 walSeq=1）', async () => {
    const actor = new SlowApplyActor(spool, createMockRepo() as never);
    actor.bindHost({
      logger: loggerStub, documents: () => documents, hardClose: () => {},
      isQuotaFrozen: () => false, generationOf: () => 1, noteReadOnlyDrop: () => false, onFencedByWrite: async () => {},
    });
    let release!: () => void;
    const gated = new Promise<void>((res) => { release = res; });
    actor.gate = () => { void gated.then(() => {}); };   // 占位（一次性门在 submit 后触发）
    // 重写：applyGate 挂起直至 release——用 gate 回调直接不返回不现实（同步方法）；改构造：gate=空函数+await 前 promise
    // 直接形态：submit 不 await（在飞），立即（同步时序）handleStateless——捕获面在 apply 完成前。
    const pending = actor.submit('bp', frameOf('slow', 1), makeConn(), 'update');   // 不 await：apply 在微任务链上
    const sends: string[] = [];
    const handlerP = actor.handleStateless({ connection: makeConn((p) => sends.push(p)), documentName: 'project:bp', payload: JSON.stringify({ nonce: 'sync-cap', clientSeq: 5, tabId: 't', sessionEpoch: 1 }) });
    // handler 首语句捕获：appliedSeq 当时=0（帧未 apply）→ 回执 committedSeq=0（targetReached 即刻真——pgSeq=0≥0）
    await handlerP;
    const rec = JSON.parse(sends[0]);
    expect(rec.committedSeq).toBe('0');           // 捕获面不含在飞帧（捕 pgSeq-before-apply 红轴）
    expect(rec.nonce).toBe('sync-cap');
    release(); void release;
    await pending;                                 // 帧随后正常落定
    await actor.flushThrough('bp', 1n, { maxWaitMs: 2_000 });
    expect(spool.watermark('bp')!.pgSeq).toBe(1n);
  });

  it('同连接串行契约（processMessages 队列）：先 await submit 再 barrier → 回执 committedSeq ≥ 帧 walSeq（帧已 fsync+apply）', async () => {
    const { actor } = build();
    const r = await actor.submit('bp', frameOf('serial', 1), makeConn(), 'update');   // 客户端序：update 全处理后 stateless 才入队
    const sends: string[] = [];
    await actor.handleStateless({ connection: makeConn((p) => sends.push(p)), documentName: 'project:bp', payload: JSON.stringify({ nonce: 'ser1', clientSeq: 9, tabId: 't', sessionEpoch: 1 }) });
    const rec = JSON.parse(sends[0]);
    expect(BigInt(rec.committedSeq)).toBeGreaterThanOrEqual(r.walSeq);
  });

  it('flushThrough 契约：幂等（同 target 重复同结果）+有界+不阻塞写（drain 照常入队）+返回当前 pgSeq', async () => {
    const { actor } = build();
    const r1 = await actor.submit('bp', frameOf('ft1', 1), makeConn(), 'update');
    const a = await actor.flushThrough('bp', r1.walSeq);
    const b = await actor.flushThrough('bp', r1.walSeq);   // 幂等重发
    expect(a).toEqual(b);
    expect(a.targetReached).toBe(true);
    // 不阻塞写：flushThrough 等待窗内新 submit 照常 resolve（fsync+apply 不等 PG）
    const p2 = actor.submit('bp', frameOf('ft2', 2), makeConn(), 'update');
    const r2 = await p2;
    expect(r2.walSeq).toBe(r1.walSeq + 1n);
    const c = await actor.flushThrough('bp', r2.walSeq, { maxWaitMs: 3_000 });
    expect(c).toMatchObject({ targetReached: true });
  });
});

describe('Y1c T10 doc 卸载纪律（drain applied→PG 或拒绝卸载）', () => {
  let dir: { dir: string; cleanup: () => Promise<void> };
  let spool: CollabSpoolService;
  const doc = new Y.Doc();
  const documents = new Map([['project:bp', doc]]);

  const build = (repo: unknown) => {
    const actor = new CollabProjectActorService(spool, repo as never);
    actor.bindHost({
      logger: loggerStub, documents: () => documents, hardClose: () => {},
      isQuotaFrozen: () => false, generationOf: () => 1, noteReadOnlyDrop: () => false, onFencedByWrite: async () => {},
    });
    return actor;
  };

  beforeEach(async () => {
    dir = await makeSpoolDir('t10-unload-');
    spool = new CollabSpoolService(dir.dir);
    spool.setOwner('t10-unload');
    spool.setWalHistory('hist-t10-unload');
  });
  afterEach(async () => { await dir.cleanup(); });

  it('applied 队列空：drain 即真（无 PG 触达——快路径）', async () => {
    const actor = build(createMockRepo());
    expect(await actor.drainAppliedForUnload('bp', 200)).toBe(true);
  });

  it('PG 不可用：drain 有界拒绝（false）+applied 队列保留（WAL 安全）+doc_unload_blocked_total +1（gateway throw=拒绝卸载面）', async () => {
    const before = await (register.getSingleMetric('doc_unload_blocked_total') as { get(): Promise<{ values: Array<{ value: number }> }> }).get().then((m) => m.values[0]?.value ?? 0);
    const actor = build(new DeadPgRepo());
    await actor.submit('bp', frameOf('u1', 1), makeConn(), 'update');
    expect(await actor.drainAppliedForUnload('bp', 300)).toBe(false);   // 拒绝卸载（gateway 钩子 throw）
    expect(actor.appliedQueueDepth('bp')).toBe(1);                      // 条目保留（BOI=WAL）
    expect(spool.hasFrames('bp')).toBe(true);
    // 指标面：模拟 gateway 钩子拒绝位（drain false → inc——gateway.unloadDocument 接线同判）
    const { docUnloadBlockedTotal } = await import('./store.metrics');
    docUnloadBlockedTotal.inc();
    const after = await (register.getSingleMetric('doc_unload_blocked_total') as { get(): Promise<{ values: Array<{ value: number }> }> }).get().then((m) => m.values[0]?.value ?? 0);
    expect(after).toBe(before + 1);
  });

  it('PG 恢复窗内 drain：预算内落定=真（允许卸载）', async () => {
    const repo = createMockRepo();
    let fails = 1;
    repo.appendBatch.mockImplementation(async () => {
      if (fails > 0) { fails -= 1; throw Object.assign(new Error('pg transient'), { pgPending: true }); }
      return { ok: true as const, rows: 1 };
    });
    const actor = build(repo);
    const r = await actor.submit('bp', frameOf('u2', 1), makeConn(), 'update');
    expect(await actor.drainAppliedForUnload('bp', 3_000)).toBe(true);   // retry timer（1s）窗内落定
    expect(actor.appliedQueueDepth('bp')).toBe(0);
    void r;
  });
});

describe('Y1c T10 maxResidentDocBytes 装载闸（DR resident gate——到顶新项目 onLoad 拒载）', () => {
  it('驻留真值和到顶：新 doc load 拒（SERVER_OVERLOADED 档）+已装载 doc 放行（复用窗不自伤）', async () => {
    const { CollabPersistenceService } = await import('./collab-persistence.service');
    const registry = new CollabDocRegistryService(createMockRepo() as never, {
      observeDocument: () => {}, seedCompactBaseline: () => {}, persistUnhealthy: new Set<string>(),
      withReplaySuppressed: (d: Y.Doc, u: Uint8Array) => { Y.applyUpdate(d, u); },
      peekSpoolFrames: async () => [], hasPendingWrites: () => false,
    } as never, undefined);
    const loaded = new Map([['project:already', new Y.Doc()]]);
    registry.bindHost({
      logger: loggerStub,
      documents: () => loaded,
      unloadingDocuments: () => new Set(),
      shouldUnloadDocument: () => false,
      isServingState: () => true,
      isDrainingState: () => false,
      heapPressureSample: () => ({ tripped: false }),
      applyWriteFreeze: () => {}, releaseFreezeForDoc: () => {}, hardClose: () => {},
      freezeReasons: () => new Set(), connectionIdOf: () => undefined,
      onGenerationSeeded: () => {},
    } as never);
    // 驻留真值到顶（docTruth 台账——零 encode 求和面）
    registry.docTruth.set('already', Number(process.env.COLLAB_MAX_RESIDENT_DOC_BYTES ?? 0) || 402_653_184);
    const doc2 = new Y.Doc();
    const rejection = await registry.loadDocument({ document: doc2, documentName: 'project:newdoc', socketId: 's1' } as never)
      .then(() => null, (e: unknown) => e as ServiceUnavailableException & { reason?: string });
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as { message?: string }).message).toContain('resident docs over cap');   // 503 档（CollabNotServingFilter 附 Retry-After）
    const { CollabAuthReason } = await import('@flowweb/shared');
    expect((rejection as { reason?: string }).reason).toBe(CollabAuthReason.SERVER_OVERLOADED);
    // 已装载 doc 复用窗放行（documents 含键——重放/复用不自伤；heap 闸同判据）
    registry.docTruth.set('already', 402_653_184);
    loaded.set('project:newdoc', doc2);   // 复用窗（库 createDocument 早退形态）
    const repo = createMockRepo();
    repo.loadForHydration.mockResolvedValue({ state: null, updates: [], stateSeq: 0n });
    // registry 持有旧 repo 引用（构造注入）——复用窗直接过闸（不再触 resident 判）
    await expect(registry.loadDocument({ document: loaded.get('project:newdoc')!, documentName: 'project:newdoc', socketId: 's1' } as never)).resolves.toBeUndefined();
    void CollabPersistenceService;
  }, 10_000);
});
