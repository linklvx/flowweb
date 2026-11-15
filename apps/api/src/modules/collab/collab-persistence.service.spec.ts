// apps/api/src/modules/collab/collab-persistence.service.spec.ts
// Y0c T40 W3（RC2 硬判据）：Persistence 独立实例化全链单测——**不启 WS Server** 直构
// CollabPersistenceService（mock repo+真 spool tmp 目录+最小 test host），跑 store→spool→回灌
// 全链（E29 原动机：store/compact/spool 单测直跑，零 hocuspocus Server 装配）。
// 装置参照 spool 单测/pg-breaker int 形态（makeSpoolDir+createMockRepo+setOwner——真文件系统，禁 mock fs）。
// 先红证据（元纪律⑥）：service 文件不存在⇒import 解析红（T40 W3 实施前实跑留存于任务报告）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import * as Y from 'yjs';
import { SERVER_TRANSACT_ORIGIN } from '@flowweb/shared';   // C3a-8 C1：普通维护写 origin（负控）
import { CollabPersistenceService, type CollabPersistenceHost } from './collab-persistence.service';
import { CollabSpoolService } from './collab-spool.service';
import { SpoolProjectBlockedError } from './collab-spool.service';
import { spoolForTest } from '../../test-utils/erasure-fixtures';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';

const PID = 'p1';
const NAME = `project:${PID}`;

/** 最小 host（RC2 判据面：service 对 gateway 的全部依赖=host 接口 11 位——logger 共享实例形态、
 *  库文档读面 getDocument/docStats、留 gateway 语义域回调五位、状态机读数三位）。 */
function makeHost(over: Partial<CollabPersistenceHost> = {}): CollabPersistenceHost {
  return {
    logger: new Logger('t40-persistence-test'),
    getDocument: () => undefined,
    docStats: () => ({ loadedDocs: 0, connections: 0, directConns: 0 }),
    onUpdateDelta: () => {},
    onFencedByWrite: vi.fn(async () => {}),
    calibrateTruth: () => undefined,
    observeDocBytes: () => {},
    isIsolated: () => false,
    isServingState: () => true,
    isShuttingDownFlag: () => false,
    onSpoolRecoveredFlip: () => {},
    currentLeaseEpoch: () => null,   // T14：epoch 读缝缺省（本 spec 不触 flushDocument——flush 用例归 collab-flush-document.spec）
    ...over,
  };
}

describe('CollabPersistenceService 独立实例化全链（RC2——不启 WS Server）', () => {
  let dir: string; let cleanup: () => Promise<void>;
  let spool: CollabSpoolService;
  let repo: ReturnType<typeof createMockRepo>;
  let svc: CollabPersistenceService;
  let host: CollabPersistenceHost;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeSpoolDir('y0c-t40-persistence-'));
    spool = spoolForTest(dir);
    spool.setOwner('t40-owner');   // Z13：写/扫路径必先 setOwner（spool 单测同款）
    repo = createMockRepo();
    svc = new CollabPersistenceService(repo as never, spool);
    host = makeHost();
    svc.bindHost(host);
  });
  afterEach(async () => { await cleanup(); vi.restoreAllMocks(); });

  it('store 成功腿：observeDocument 注册→update 监听入队（host.onUpdateDelta 转发）→单片直通 append→队列排空+storeFailedDocs 撤销+三态空+成功即 compact', async () => {
    const onUpdateDelta = vi.fn();
    svc.bindHost(makeHost({ onUpdateDelta }));
    const doc = new Y.Doc();
    svc.observeDocument(doc, PID, NAME);
    svc.storeFailedDocs.add(PID);   // Z110 前置：store 成功落定即撤销强制淘汰标记
    const w = new Y.Doc();
    w.getMap('nodes').set('k', 'v');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(w));   // update 监听入队（X10 push-only）
    expect(svc.hasPendingWrites(PID)).toBe(true);
    expect(onUpdateDelta).toHaveBeenCalledTimes(1);   // host 缝转发（docDelta 留 gateway 的回调位）
    expect(onUpdateDelta.mock.calls[0][0]).toBe(PID);

    const ok = await svc.storeDocumentUnlocked({ document: doc, documentName: NAME });
    expect(ok).toBe(true);
    expect(repo.appendBatch).toHaveBeenCalledTimes(1);
    expect(svc.hasPendingWrites(PID)).toBe(false);   // splice=新家（PG）落定后移出旧归属
    expect(svc.hasInFlightStore(PID)).toBe(false);   // X2 落定点①
    expect(svc.storeFailedDocs.has(PID)).toBe(false);
    expect(svc.isPersistedComplete(PID)).toBe(true);   // 三态全空（in-flight/队列/spool）
    expect(repo.compact).toHaveBeenCalledTimes(1);   // store 成功即 compact（lastCompactAt 无键=首跑放行）
  });

  it('Y1c T11 WAL 段清理（purgeBelowSeq 消费）：maybeCompact 成功 → spool 未 confirm 帧 walSeq≤purgeBelowSeq 全 confirm（段回收）；>purgeBelowSeq 帧保留', async () => {
    // 布景：spool 三帧（appendTracked 次次 fsync——walSeq 1/2/3 连续分配）；compact 发布 purgeBelowSeq=2n
    const f1 = await spool.appendTracked(PID, new Uint8Array([1]));
    const f2 = await spool.appendTracked(PID, new Uint8Array([2]));
    const f3 = await spool.appendTracked(PID, new Uint8Array([3]));
    expect([f1.walSeq, f2.walSeq, f3.walSeq]).toEqual([1n, 2n, 3n]);
    expect(spool.hasFrames(PID)).toBe(true);
    repo.compact.mockResolvedValue({ compacted: true, snapshotBytes: 10, deletedRows: 2, tombstoneBytes: 0, snapshotRev: 2n, stateSeq: 2n, purgeBelowSeq: 2n });
    await svc.maybeCompact(PID);
    // ≤purgeBelowSeq 的帧=内容已证在 PG 前缀（pgSeq≥purgeBelowSeq）——confirm 授权段回收
    expect(spool.hasFrames(PID)).toBe(true);             // f3（walSeq=3>2）仍在
    const frames = await spool.peek(PID);
    expect(frames.map((f) => f.walSeq)).toEqual([3n]);   // f1/f2 已 confirm（peek 只回未 confirm 好帧）
    // Q-M6（T11 双评审）断言锚：C1 修复后新帧 walSeq 恒>pgSeq≥purgeBelowSeq——confirm 过滤只命中
    // 「发布前纪」残留帧（f1/f2）；f3（walSeq=3>purgeBelowSeq=2）禁入 confirm 集=上方 peek 断言
    // （播种面破洞才可能越界——端到端链钉锚=canvas-doc-walseq-seeding.int.spec）。
    void frames;
  });

  it('全链（RC2 硬判据）：append 失败→批落 spool（fsync 新家先落定）+退避梯排程+unhealthy 电平→repo 恢复 retryPersist detached 帧三段式→PG 落定+段回收+三态空+电平转健康+内容收敛', async () => {
    const doc = new Y.Doc();
    svc.observeDocument(doc, PID, NAME);
    for (let i = 0; i < 3; i++) {
      const w = new Y.Doc();
      w.getMap('nodes').set(`k${i}`, { v: i });
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(w));
    }
    expect(svc.hasPendingWrites(PID)).toBe(true);

    // —— store 失败腿：repo.appendBatch 恒抛（非 FK/非租约分型）→ spool 兜底（BOI：批∈spool 已 fsync）——
    repo.appendBatch.mockRejectedValue(new Error('pg down'));
    const ok = await svc.storeDocumentUnlocked({ document: doc, documentName: NAME });
    expect(ok).toBe(false);
    expect(svc.hasPendingWrites(PID)).toBe(false);   // 批已离开旧归属（新家=spool）
    expect(svc.hasInFlightStore(PID)).toBe(false);   // X2 落定点②：spool fsync 成功
    expect(spool.hasFrames(PID)).toBe(true);         // 台账在盘
    expect(svc.isPersistedComplete(PID)).toBe(false);   // spool 帧=PG 快照滞后信号
    expect(svc.persistUnhealthy.has(NAME)).toBe(true);   // 电平翻转（setPersistStatus(false)）
    expect(svc.storeFailedDocs.has(PID)).toBe(true);     // Z110：append 失败标记（reaper 强制淘汰路径）

    // —— 回灌腿：repo 恢复→retryPersist（detached 态：host 无 doc/队列空→spool 帧通道三段式 peek→append→confirm）——
    repo.appendBatch.mockResolvedValue({ ok: true, seq: 1n });
    await svc.retryPersist(NAME);
    expect(spool.hasFrames(PID)).toBe(false);        // 帧 confirm→段回收（磁盘台账清空）
    expect(svc.isPersistedComplete(PID)).toBe(true);   // 三态全空=内存与 PG 同步
    expect(svc.persistUnhealthy.has(NAME)).toBe(false);   // 电平转健康（setPersistStatus(true)）
    expect(svc.storeFailedDocs.has(PID)).toBe(true);      // 帧通道回灌不清标记（清点=store 成功/真卸载两点——行为零变化）
    expect(repo.appendBatch).toHaveBeenCalledTimes(2);    // 失败 1 + 回灌帧 1

    // 内容收敛：回灌落 PG 的帧 apply 进 scratch doc=原 3 键全量（CRDT 幂等语义；Y1c T9 新表形态
    // calls[1][1]=rows[]——帧 payload 取 rows[0].update；断言改为逐行全量重放）
    const rows2 = repo.appendBatch.mock.calls[1][1] as Array<{ update: Uint8Array }>;
    const rebuilt = new Y.Doc();
    for (const row of rows2) Y.applyUpdate(rebuilt, new Uint8Array(row.update));
    expect([...rebuilt.getMap('nodes').keys()].sort()).toEqual(['k0', 'k1', 'k2']);
  });

  it('withReplaySuppressed 抑制窗：replay 帧内容应用但零入队（装载重放语义——update 监听 replaying 守卫）', () => {
    const doc = new Y.Doc();
    svc.observeDocument(doc, PID, NAME);
    const w = new Y.Doc();
    w.getMap('nodes').set('k', { v: 'v' });
    svc.withReplaySuppressed(doc, Y.encodeStateAsUpdate(w));
    expect(doc.getMap('nodes').get('k')).toEqual({ v: 'v' });   // 内容已应用
    expect(svc.hasPendingWrites(PID)).toBe(false);              // 抑制窗——零入队（二次蒸发防线）
  });

  it('computePending 独立读面：自有队列单源+spool depth+host.docStats 四计数（不依赖库 documents Map——B2 同构判据）', async () => {
    svc.bindHost(makeHost({ docStats: () => ({ loadedDocs: 3, connections: 5, directConns: 2 }) }));
    const doc = new Y.Doc();
    svc.observeDocument(doc, PID, NAME);
    const w = new Y.Doc();
    w.getMap('nodes').set('k', 'v');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(w));
    const p = svc.computePending();
    expect(p).toMatchObject({
      projects: 1, batches: 1, storeInFlight: 0,
      spoolFiles: 0, spoolBytes: 0, strandedFiles: 0, strandedBytes: 0,
      loadedDocs: 3, connections: 5, residentDocs: 3, directConns: 2,   // residentDocs=loadedDocs 同源（Z47 分解字段）
    });
  });

  // ═══ C3a-8 修复批 C1：import 维护批次申报未覆盖（persistence 级）═══

  it('C1：origin=import → sink 收到 {bindingUncovered:true}；队列清空后 bindingRecoveryFace.enqueue 恰一次', async () => {
    const sink = vi.fn(async (_pid: string, _payload: Uint8Array, _opts?: { bindingUncovered?: boolean }) => {});
    svc.setMaintenanceSink(sink as never);
    const enqueue = vi.fn();
    svc.setBindingRecoveryFace({ markDirty: async () => {}, enqueue });
    const doc = new Y.Doc();
    svc.observeDocument(doc, PID, NAME);
    const w = new Y.Doc();
    w.getMap('nodes').set('n-imp', { fileId: 'm1' });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(w), 'import');
    expect(await svc.storeDocumentUnlocked({ document: doc, documentName: NAME })).toBe(true);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][2]).toEqual({ bindingUncovered: true });   // 申报未覆盖（闭包 dirty+covered=false）
    expect(enqueue).toHaveBeenCalledTimes(1);                            // 队列清空（import 内容全落 PG）→入队
    expect(enqueue).toHaveBeenCalledWith(PID);
  });

  it('C1 负控：普通维护写（非 import）→ sink 无 flag；不入队（禁把服务端投递写全部改脏）', async () => {
    const sink = vi.fn(async (_pid: string, _payload: Uint8Array, _opts?: { bindingUncovered?: boolean }) => {});
    svc.setMaintenanceSink(sink as never);
    const enqueue = vi.fn();
    svc.setBindingRecoveryFace({ markDirty: async () => {}, enqueue });
    const doc = new Y.Doc();
    svc.observeDocument(doc, PID, NAME);
    const w = new Y.Doc();
    w.getMap('nodes').set('n-plain', { v: 1 });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(w), SERVER_TRANSACT_ORIGIN);
    expect(await svc.storeDocumentUnlocked({ document: doc, documentName: NAME })).toBe(true);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][2]).toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('C1 分块未清空不提前入队：sink 窗内新写留队列→marker 保持；下一 flush 清空后才 enqueue', async () => {
    const doc = new Y.Doc();
    svc.observeDocument(doc, PID, NAME);
    let injected = false;
    const sink = vi.fn(async () => {
      if (!injected) {
        injected = true;
        const extra = new Y.Doc();
        extra.getMap('nodes').set('n-tail', { v: 1 });
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(extra), SERVER_TRANSACT_ORIGIN);   // 尾部新写（flush 窗）
      }
    });
    svc.setMaintenanceSink(sink as never);
    const enqueue = vi.fn();
    svc.setBindingRecoveryFace({ markDirty: async () => {}, enqueue });
    const imp = new Y.Doc();
    imp.getMap('nodes').set('n-imp', { fileId: 'm1' });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(imp), 'import');
    expect(await svc.storeDocumentUnlocked({ document: doc, documentName: NAME })).toBe(true);
    expect(svc.hasPendingWrites(PID)).toBe(true);        // 尾部新写仍在队列（分块未清空）
    expect(enqueue).not.toHaveBeenCalled();              // 不提前入队
    expect(await svc.storeDocumentUnlocked({ document: doc, documentName: NAME })).toBe(true);
    expect(svc.hasPendingWrites(PID)).toBe(false);
    expect(enqueue).toHaveBeenCalledTimes(1);            // 全清后入队一次
  });

  it('C1 无 sink 回退面：importPending → appendBatch 闭包置 dirty 且返回 covered=false（懒建档 covered=false 同源）', async () => {
    const doc = new Y.Doc();
    svc.observeDocument(doc, PID, NAME);
    const w = new Y.Doc();
    w.getMap('nodes').set('n-imp', { fileId: 'm1' });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(w), 'import');
    expect(await svc.storeDocumentUnlocked({ document: doc, documentName: NAME })).toBe(true);
    const call = (repo.appendBatch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const inTx = call[3] as ((tx: unknown) => Promise<{ bindingCovered: boolean }>) | undefined;
    expect(typeof inTx).toBe('function');
    const updateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
    await expect(inTx!({ canvasDoc: { updateMany } })).resolves.toEqual({ bindingCovered: false });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0]).toMatchObject({ where: { projectId: PID }, data: { bindingsDirty: true } });
  });

  it('质量收口 I-1：吸收旧 spool 帧批成功——settle 在 stash confirm 之后（marker 清+enqueue 恰一次）', async () => {
    const doc = new Y.Doc();
    svc.observeDocument(doc, PID, NAME);
    // import 写 + PG 段失败：帧入 spool（队列已清空、marker 保持）
    const imp = new Y.Doc();
    imp.getMap('nodes').set('n-imp', { fileId: 'm1' });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(imp), 'import');
    repo.appendBatch.mockRejectedValueOnce(Object.assign(new Error('injected pg down'), { pgPending: true }));
    expect(await svc.storeDocumentUnlocked({ document: doc, documentName: NAME })).toBe(false);
    expect(spool.hasFrames(PID)).toBe(true);
    (svc as unknown as { cancelPersistRetry(n: string): void }).cancelPersistRetry(NAME);
    // 队列空 + spool 有旧帧 → 本批仅吸收旧帧；settle 必须在 stash confirm 之后（否则被 spool 门挡住滞留）
    const sink = vi.fn(async (_pid: string, _payload: Uint8Array, _opts?: { bindingUncovered?: boolean }) => {});
    svc.setMaintenanceSink(sink as never);
    const enqueue = vi.fn();
    svc.setBindingRecoveryFace({ markDirty: async () => {}, enqueue });
    expect(await svc.storeDocumentUnlocked({ document: doc, documentName: NAME })).toBe(true);
    expect(spool.hasFrames(PID)).toBe(false);   // 旧帧已 confirm
    expect(enqueue).toHaveBeenCalledTimes(1);   // settle 在 confirm 后完成（修前 0——marker 滞留）
    // marker 已清：后续普通维护写不再申报未覆盖
    const plain = new Y.Doc();
    plain.getMap('nodes').set('n-plain', { v: 1 });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(plain), SERVER_TRANSACT_ORIGIN);
    expect(await svc.storeDocumentUnlocked({ document: doc, documentName: NAME })).toBe(true);
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[1][2]).toBeUndefined();
  });

  it('C1 恢复链 #2：replayAll 回灌落定（spool 清空）后清 importPending——后续维护写不再申报未覆盖', async () => {
    const doc = new Y.Doc();
    svc.observeDocument(doc, PID, NAME);
    // 阶段 A：import 写 + PG 段失败（回退通道）→帧入 spool、队列已清空、marker 保持
    const imp = new Y.Doc();
    imp.getMap('nodes').set('n-imp', { fileId: 'm1' });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(imp), 'import');
    repo.appendBatch.mockRejectedValueOnce(Object.assign(new Error('injected pg down'), { pgPending: true }));
    expect(await svc.storeDocumentUnlocked({ document: doc, documentName: NAME })).toBe(false);
    expect(spool.hasFrames(PID)).toBe(true);
    (svc as unknown as { cancelPersistRetry(n: string): void }).cancelPersistRetry(NAME);   // 退避梯不干扰
    // 阶段 B：接 sink + 回灌（reconcileSpool 生产入口）——落定后 marker 使命完成（spool 空∧队列空）
    const sink = vi.fn(async (_pid: string, _payload: Uint8Array, _opts?: { bindingUncovered?: boolean }) => {});
    svc.setMaintenanceSink(sink as never);
    const enqueue = vi.fn();
    svc.setBindingRecoveryFace({ markDirty: async () => {}, enqueue });
    await (svc as unknown as { reconcileSpool(): Promise<void> }).reconcileSpool();
    expect(spool.hasFrames(PID)).toBe(false);
    expect(enqueue).toHaveBeenCalled();   // replay onReplayed 入队（rebuild 收敛）
    (svc as unknown as { cancelPersistRetry(n: string): void }).cancelPersistRetry(NAME);   // rearmQueues 梯随清
    // 阶段 C：后续普通维护写——marker 已清 → 不再申报未覆盖（修前 opts={bindingUncovered:true}）
    const plain = new Y.Doc();
    plain.getMap('nodes').set('n-plain', { v: 1 });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(plain), SERVER_TRANSACT_ORIGIN);
    expect(await svc.storeDocumentUnlocked({ document: doc, documentName: NAME })).toBe(true);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][2]).toBeUndefined();
  });
});

describe('TD-33 C1b T13：终态族（擦除）短路面', () => {
  let dir: string; let cleanup: () => Promise<void>;
  let spool: CollabSpoolService;
  let svc: CollabPersistenceService;
  beforeEach(async () => {
    ({ dir, cleanup } = await makeSpoolDir('td33-t13-'));
    spool = spoolForTest(dir);
    spool.setOwner('t13-owner');
    svc = new CollabPersistenceService(createMockRepo() as never, spool);
    svc.bindHost(makeHost());
  });
  afterEach(async () => { await cleanup(); vi.restoreAllMocks(); });
  it('维护 sink 终态族：批丢弃+onProjectGone+不排梯（不 confirm——段留 purge 删除）', async () => {
    const doc = new Y.Doc();
    svc.observeDocument(doc, PID, NAME);
    const w = new Y.Doc();
    w.getMap('nodes').set('k', 'v');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(w));   // 入队
    expect(svc.hasPendingWrites(PID)).toBe(true);
    vi.spyOn(svc as unknown as { runMaintenanceChannel: () => Promise<void> }, 'runMaintenanceChannel')
      .mockRejectedValue(new SpoolProjectBlockedError('ERASING'));
    const ok = await svc.storeDocumentUnlocked({ document: doc, documentName: NAME });
    expect(ok).toBe(false);
    expect(svc.hasPendingWrites(PID)).toBe(false);                 // 批丢弃
    expect((svc as unknown as { deletedProjects: Set<string> }).deletedProjects.has(PID)).toBe(true);
    expect((svc as unknown as { persistRetry: Map<string, unknown> }).persistRetry.has(NAME)).toBe(false);   // 不排梯
  });

  it('retryPersist 终态族：不推进档位、cancel 停梯（不再续排）', async () => {
    (svc as unknown as { pendingQueues: Map<string, Uint8Array[]> }).pendingQueues.set(PID, [new Uint8Array([1, 2, 3])]);
    (svc as unknown as { schedulePersistRetry(n: string): void }).schedulePersistRetry(NAME);
    expect((svc as unknown as { persistRetry: Map<string, unknown> }).persistRetry.has(NAME)).toBe(true);
    vi.spyOn(svc as unknown as { maintenanceSinkOrThrow: () => Promise<void> }, 'maintenanceSinkOrThrow')
      .mockRejectedValue(new SpoolProjectBlockedError('ERASING'));
    await svc.retryPersist(NAME);
    expect((svc as unknown as { persistRetry: Map<string, unknown> }).persistRetry.has(NAME)).toBe(false);
  });

  it('onProjectGone：blocked 判定先于 hasFrames——擦除项目不排收割梯；非 blocked 同形态仍排（既有语义）', async () => {
    await spool.append(PID, new Uint8Array([1]));
    expect(spool.hasFrames(PID)).toBe(true);
    spool.setErasureGuard({ isBlocked: () => 'ERASING' });
    svc.onProjectGone(PID);
    expect((svc as unknown as { persistRetry: Map<string, unknown> }).persistRetry.has(NAME)).toBe(false);
    spool.setErasureGuard({ isBlocked: () => undefined });
    svc.onProjectGone(PID);
    expect((svc as unknown as { persistRetry: Map<string, unknown> }).persistRetry.has(NAME)).toBe(true);   // 对照：非 blocked 排梯
  });

  it('blocked 收割不 confirm：project.gone 后 ready pending 归零（残段留 purge 不计数）且段保留', async () => {
    await spool.append('p-gone3', new Uint8Array([1]));
    spool.setErasureGuard({ isBlocked: (pid) => (pid === 'p-gone3' ? 'ERASING' : undefined) });
    svc.onProjectGone('p-gone3');
    const p = svc.computePending();
    expect(p.projects).toBe(0);
    expect(p.spoolFiles).toBe(0);                    // blocked 残段不计 pending（drain/ready 不挂）
    expect(spool.hasFrames('p-gone3')).toBe(true);   // 不 confirm 不收割——留 purge 删除
  });
});

// ═══ C3a-8 修复批 C1（卡①）：settle 全触点 characterization（importPending 生命周期）═══

/** 卡①接线读数（P4 后：importTracker.isUncovered）。 */
function importUncovered(svc: CollabPersistenceService): boolean {
  return (svc as unknown as { importTracker: { isUncovered(pid: string): boolean } }).importTracker.isUncovered(PID);
}
/** 卡①接线动作：直调落定入口（releaseImportCoverage）。 */
function settle(svc: CollabPersistenceService): void {
  (svc as unknown as { releaseImportCoverage(id: string): void }).releaseImportCoverage(PID);
}

describe('卡① wiring：settle 全触点 characterization（importPending 生命周期）', () => {
  let dir: string; let cleanup: () => Promise<void>;
  let spool: CollabSpoolService;
  let repo: ReturnType<typeof createMockRepo>;
  let svc: CollabPersistenceService;
  beforeEach(async () => {
    ({ dir, cleanup } = await makeSpoolDir('c3a8-card1-wiring-'));
    spool = spoolForTest(dir);
    spool.setOwner('card1-wiring');
    repo = createMockRepo();
    svc = new CollabPersistenceService(repo as never, spool);
    svc.bindHost(makeHost());
  });
  // ⑥ 失败支/③ 排梯的 1s 定时器随例清——防跨例污染 enqueue 计数
  afterEach(async () => { svc.cancelAllRetries(); await cleanup(); vi.restoreAllMocks(); });

  /** import 写装置（origin='import'：标记+PID 入队；后面跟普通写/失败装置按用例需要）。 */
  function importWrite(): { doc: Y.Doc } {
    const doc = new Y.Doc();
    svc.observeDocument(doc, PID, NAME);
    const imp = new Y.Doc();
    imp.getMap('nodes').set('n-imp', { fileId: 'm1' });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(imp), 'import');
    return { doc };
  }

  it('① discard 终态：import 标记→deletedProjects 短路 store→标记清∧enqueue 0（:449）', async () => {
    const enqueue = vi.fn();
    svc.setBindingRecoveryFace({ markDirty: async () => {}, enqueue });
    const { doc } = importWrite();
    expect(importUncovered(svc)).toBe(true);
    svc.deletedProjects.add(PID);   // 白盒：终态已登记（store :308 短路路径）
    expect(await svc.storeDocumentUnlocked({ document: doc, documentName: NAME })).toBe(false);
    expect(importUncovered(svc)).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('② onProjectGone：import 标记→终态入口→标记清∧enqueue 0（经 :1213 discard；不断言 forget 次数）', () => {
    const enqueue = vi.fn();
    svc.setBindingRecoveryFace({ markDirty: async () => {}, enqueue });
    importWrite();
    svc.onProjectGone(PID);
    expect(importUncovered(svc)).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('③ retryPersist detached 帧通道（:930）：PG 瞬态播种 spool 帧→sink 落定确认→标记清∧enqueue 恰一次', async () => {
    const enqueue = vi.fn();
    svc.setBindingRecoveryFace({ markDirty: async () => {}, enqueue });
    const { doc } = importWrite();
    repo.appendBatch.mockRejectedValueOnce(Object.assign(new Error('injected pg down'), { pgPending: true }));
    expect(await svc.storeDocumentUnlocked({ document: doc, documentName: NAME })).toBe(false);
    expect(spool.hasFrames(PID)).toBe(true);   // 帧已 WAL、队列已 splice、退避梯已排（不 cancel——entry 须在）
    expect((svc as unknown as { persistRetry: Map<string, unknown> }).persistRetry.has(NAME)).toBe(true);
    const sink = vi.fn(async () => {
      const frames = await spool.peek(PID);   // 承接 actor 落定语义：预读 spool 帧集→confirm
      await spool.confirm(PID, frames.map((f) => f.frameId));
    });
    svc.setMaintenanceSink(sink as never);
    await svc.retryPersist(NAME);   // doc 不活（getDocument 恒 undefined）+队列空+spool 有帧=detached 帧通道
    expect(sink).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(importUncovered(svc)).toBe(false);
  });

  it('④a handoffPendingToSpool 成功（queue 非空/spool 清）→enqueue 恰一次（:1063）', async () => {
    const enqueue = vi.fn();
    svc.setBindingRecoveryFace({ markDirty: async () => {}, enqueue });
    const sink = vi.fn(async () => {});
    svc.setMaintenanceSink(sink as never);
    importWrite();
    expect(await svc.handoffPendingToSpool(PID)).toBe(true);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(importUncovered(svc)).toBe(false);
  });

  it('④b handoffPendingToSpool spool 未清→不结算：enqueue 0∧标记保留（:1063 双门）', async () => {
    const enqueue = vi.fn();
    svc.setBindingRecoveryFace({ markDirty: async () => {}, enqueue });
    const { doc } = importWrite();
    // PG 瞬态失败播种 spool 帧（无 sink 内置回退：appendTracked→appendBatch 拒）
    repo.appendBatch.mockRejectedValueOnce(Object.assign(new Error('injected pg down'), { pgPending: true }));
    expect(await svc.storeDocumentUnlocked({ document: doc, documentName: NAME })).toBe(false);
    expect(spool.hasFrames(PID)).toBe(true);
    (svc as unknown as { cancelPersistRetry(n: string): void }).cancelPersistRetry(NAME);   // 梯不干扰
    // 再入队一批（普通维护写）——queue 非空是 settle 前提
    const plain = new Y.Doc();
    plain.getMap('nodes').set('n-plain', { v: 1 });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(plain), SERVER_TRANSACT_ORIGIN);
    expect(svc.hasPendingWrites(PID)).toBe(true);
    const sink = vi.fn(async () => {});   // resolve 但不 confirm 旧帧→spool 未清
    svc.setMaintenanceSink(sink as never);
    expect(await svc.handoffPendingToSpool(PID)).toBe(true);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
    expect(importUncovered(svc)).toBe(true);
  });

  it('⑤a replay 落定（spool+队列空）：onReplayed 无条件 enqueue 恰一次∧标记清（锁「不双入队」）', async () => {
    const enqueue = vi.fn();
    svc.setBindingRecoveryFace({ markDirty: async () => {}, enqueue });
    const { doc } = importWrite();
    repo.appendBatch.mockRejectedValueOnce(Object.assign(new Error('injected pg down'), { pgPending: true }));
    expect(await svc.storeDocumentUnlocked({ document: doc, documentName: NAME })).toBe(false);
    expect(spool.hasFrames(PID)).toBe(true);
    (svc as unknown as { cancelPersistRetry(n: string): void }).cancelPersistRetry(NAME);   // 退避梯不干扰
    const sink = vi.fn(async () => {});
    svc.setMaintenanceSink(sink as never);
    await (svc as unknown as { reconcileSpool(): Promise<void> }).reconcileSpool();
    expect(spool.hasFrames(PID)).toBe(false);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(importUncovered(svc)).toBe(false);
    (svc as unknown as { cancelPersistRetry(n: string): void }).cancelPersistRetry(NAME);   // rearm 梯随清
  });

  it('⑤b replay 残留形态（队列未 flush）：onReplayed 仍恰一次 enqueue∧标记保留', async () => {
    const enqueue = vi.fn();
    svc.setBindingRecoveryFace({ markDirty: async () => {}, enqueue });
    const { doc } = importWrite();
    repo.appendBatch.mockRejectedValueOnce(Object.assign(new Error('injected pg down'), { pgPending: true }));
    expect(await svc.storeDocumentUnlocked({ document: doc, documentName: NAME })).toBe(false);
    expect(spool.hasFrames(PID)).toBe(true);
    (svc as unknown as { cancelPersistRetry(n: string): void }).cancelPersistRetry(NAME);   // 退避梯不干扰
    // 回灌前预置未 flush 维护写入队（内容未全落 PG→标记保留）
    const plain = new Y.Doc();
    plain.getMap('nodes').set('n-plain', { v: 1 });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(plain), SERVER_TRANSACT_ORIGIN);
    const sink = vi.fn(async () => {});
    svc.setMaintenanceSink(sink as never);
    await (svc as unknown as { reconcileSpool(): Promise<void> }).reconcileSpool();
    expect(spool.hasFrames(PID)).toBe(false);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(importUncovered(svc)).toBe(true);
    (svc as unknown as { cancelPersistRetry(n: string): void }).cancelPersistRetry(NAME);   // rearm 梯随清
  });

  it('⑥a handoffOnUnload 成功（queue 非空/sink 落定）→enqueue 恰一次（:1090 全仓首覆盖）', async () => {
    const enqueue = vi.fn();
    svc.setBindingRecoveryFace({ markDirty: async () => {}, enqueue });
    const sink = vi.fn(async () => {});
    svc.setMaintenanceSink(sink as never);
    importWrite();
    await svc.handoffOnUnload(PID, NAME);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(importUncovered(svc)).toBe(false);
  });

  it('⑥b handoffOnUnload 失败（sink 抛非 pgPending/pre-WAL）：标记保留∧enqueue 0', async () => {
    const enqueue = vi.fn();
    svc.setBindingRecoveryFace({ markDirty: async () => {}, enqueue });
    const sink = vi.fn(async () => { throw new Error('pre-wal sink failure'); });
    svc.setMaintenanceSink(sink as never);
    importWrite();
    await svc.handoffOnUnload(PID, NAME);
    expect(importUncovered(svc)).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
    expect(svc.hasPendingWrites(PID)).toBe(true);   // 批留队列（③保活梯已排——afterEach 清）
  });

  it('⑦ purge 负测：purgePersistenceState 不清标记∧enqueue 0（有意语义）', () => {
    const enqueue = vi.fn();
    svc.setBindingRecoveryFace({ markDirty: async () => {}, enqueue });
    importWrite();
    svc.purgePersistenceState(PID);
    expect(importUncovered(svc)).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('⑧ inFlight 不阻挡落定：队列空+spool 空+inFlight→settle 清除∧enqueue 恰一次', () => {
    const enqueue = vi.fn();
    svc.setBindingRecoveryFace({ markDirty: async () => {}, enqueue });
    importWrite();
    (svc as unknown as { pendingQueues: Map<string, Uint8Array[]> }).pendingQueues.get(PID)!.splice(0);   // 模拟并发取批
    (svc as unknown as { inFlightProjects: Set<string> }).inFlightProjects.add(PID);
    settle(svc);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(importUncovered(svc)).toBe(false);
  });

  it('⑨ FK 终态守卫（红先行）：detached 帧通道逐帧 FK→enqueue 0∧不广播 healthy∧电平保持∧标记清', async () => {
    const enqueue = vi.fn();
    svc.setBindingRecoveryFace({ markDirty: async () => {}, enqueue });
    const { doc } = importWrite();
    repo.appendBatch.mockRejectedValueOnce(Object.assign(new Error('injected pg down'), { pgPending: true }));
    expect(await svc.storeDocumentUnlocked({ document: doc, documentName: NAME })).toBe(false);
    expect(spool.hasFrames(PID)).toBe(true);   // 失败路径已排梯——禁 cancel（!entry 早退会让守卫测 vacuous 绿）
    svc.persistUnhealthy.add('project:' + PID);   // 预置不健康电平（=persistKey(NAME)）
    const broadcastStateless = vi.fn();
    // doc 在场（队列空⇒:882 条件假⇒仍走 detached 帧通道；setPersistStatus(true) 会向活 doc 广播）
    svc.bindHost(makeHost({ getDocument: () => ({ broadcastStateless, connections: new Map() }) as never }));
    const sink = vi.fn(async () => { throw Object.assign(new Error('fk'), { fk: true }); });   // mock 不 confirm——:919 分支自 confirm
    svc.setMaintenanceSink(sink as never);
    await svc.retryPersist(NAME);
    expect(enqueue).not.toHaveBeenCalled();                        // 已删项目不再从落定入口入队 rebuild
    expect(broadcastStateless).not.toHaveBeenCalled();             // 也不广播 healthy
    expect(importUncovered(svc)).toBe(false);                      // 守卫 forget 清标记
    expect(svc.persistUnhealthy.has('project:' + PID)).toBe(true); // 不健康电平保持
  });
});
