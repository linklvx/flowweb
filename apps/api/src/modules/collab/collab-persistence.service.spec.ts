// apps/api/src/modules/collab/collab-persistence.service.spec.ts
// Y0c T40 W3（RC2 硬判据）：Persistence 独立实例化全链单测——**不启 WS Server** 直构
// CollabPersistenceService（mock repo+真 spool tmp 目录+最小 test host），跑 store→spool→回灌
// 全链（E29 原动机：store/compact/spool 单测直跑，零 hocuspocus Server 装配）。
// 装置参照 spool 单测/pg-breaker int 形态（makeSpoolDir+createMockRepo+setOwner——真文件系统，禁 mock fs）。
// 先红证据（元纪律⑥）：service 文件不存在⇒import 解析红（T40 W3 实施前实跑留存于任务报告）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import * as Y from 'yjs';
import { CollabPersistenceService, type CollabPersistenceHost } from './collab-persistence.service';
import { CollabSpoolService } from './collab-spool.service';
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
    spool = new CollabSpoolService(dir);
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
    expect(repo.append).toHaveBeenCalledTimes(1);
    expect(svc.hasPendingWrites(PID)).toBe(false);   // splice=新家（PG）落定后移出旧归属
    expect(svc.hasInFlightStore(PID)).toBe(false);   // X2 落定点①
    expect(svc.storeFailedDocs.has(PID)).toBe(false);
    expect(svc.isPersistedComplete(PID)).toBe(true);   // 三态全空（in-flight/队列/spool）
    expect(repo.compact).toHaveBeenCalledTimes(1);   // store 成功即 compact（lastCompactAt 无键=首跑放行）
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

    // —— store 失败腿：repo.append 恒抛（非 FK/非租约分型）→ spool 兜底（BOI：批∈spool 已 fsync）——
    repo.append.mockRejectedValue(new Error('pg down'));
    const ok = await svc.storeDocumentUnlocked({ document: doc, documentName: NAME });
    expect(ok).toBe(false);
    expect(svc.hasPendingWrites(PID)).toBe(false);   // 批已离开旧归属（新家=spool）
    expect(svc.hasInFlightStore(PID)).toBe(false);   // X2 落定点②：spool fsync 成功
    expect(spool.hasFrames(PID)).toBe(true);         // 台账在盘
    expect(svc.isPersistedComplete(PID)).toBe(false);   // spool 帧=PG 快照滞后信号
    expect(svc.persistUnhealthy.has(NAME)).toBe(true);   // 电平翻转（setPersistStatus(false)）
    expect(svc.storeFailedDocs.has(PID)).toBe(true);     // Z110：append 失败标记（reaper 强制淘汰路径）

    // —— 回灌腿：repo 恢复→retryPersist（detached 态：host 无 doc/队列空→spool 帧通道三段式 peek→append→confirm）——
    repo.append.mockResolvedValue({ ok: true, seq: 1n });
    await svc.retryPersist(NAME);
    expect(spool.hasFrames(PID)).toBe(false);        // 帧 confirm→段回收（磁盘台账清空）
    expect(svc.isPersistedComplete(PID)).toBe(true);   // 三态全空=内存与 PG 同步
    expect(svc.persistUnhealthy.has(NAME)).toBe(false);   // 电平转健康（setPersistStatus(true)）
    expect(svc.storeFailedDocs.has(PID)).toBe(true);      // 帧通道回灌不清标记（清点=store 成功/真卸载两点——行为零变化）
    expect(repo.append).toHaveBeenCalledTimes(2);    // 失败 1 + 回灌帧 1

    // 内容收敛：回灌落 PG 的帧 apply 进 scratch doc=原 3 键全量（CRDT 幂等语义）
    const payload = repo.append.mock.calls[1][1] as Uint8Array;
    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, payload);
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
});
