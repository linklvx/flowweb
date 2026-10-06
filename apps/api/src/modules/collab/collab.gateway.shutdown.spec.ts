// apps/api/src/modules/collab/collab.gateway.shutdown.spec.ts
// Y0a-2 关停 drain 六步（spec v2.4 §2.4——预算 ≤22s；G-2a 双档：归属要么落定、要么被如实点名）。
// 形态：dual-client 装置（真 listen+真 spool tmpdir）+ 直灌 pendingQueues/documents（V4 projectId 键控）。
// 真实 timers——六步预算依赖真实时钟（勿 fake timers）；用例独立 kit。
// 装置裁定（执行适配，plan 代码块之外四处）：
// ①seedPendingDoc 载荷=真 Y update（Y.mergeUpdates 对任意字节 throw——Task 2 勘误④同源；批合并路径
//   注入 [n] 裸字节会走 Y2 兜底=假红）；
// ②destroy 生命周期：种子 doc 无连接→库 destroy memoized 等 documents 清空永不满足（hocuspocus-server
//   esm runDestroy 只在 getDocumentsCount===0 resolve）→用例 1-3 destroy 打桩直通（dispose 复用同一 mock，
//   禁先 restore）；用例 4 finally 先 restoreAllMocks 再摘除种子 doc 再 dispose（Y13 序）；
// ③种子 doc 形状补 connections: Map（closeAllConnections1012 对裸 Y.Doc 的 [...document.connections]
//   会 TypeError——真实 Document 该字段恒在，测试种子同形状）；
// ④G-2a ii 注入=容量位+append 恒抛双保险：白盒 overCapacityFlag 单独注入会被 append 滞回解除支对空盘
//   自清（d.bytes=0≤90%×CAP→翻 false→批成功入盘=注入失效）。
import { describe, it, expect, vi, afterAll } from 'vitest';
import * as Y from 'yjs';
import { CollabSpoolService } from './collab-spool.service';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { startDualClientServer } from '../../test-utils/dual-client-server';
import { failingRepo } from '../../test-utils/failing-repo';

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const c of cleanups) await c(); });

/** Y16：spy 必须**动作前**安装（v3 在 shutdown 之后装——mock.calls 恒空=日志断言全假绿）。
 *  install → 跑 onApplicationShutdown → collectEvents 三段式。 */
function installLogSpies(gateway: any) {
  return {
    log: vi.spyOn(gateway.logger, 'log'),
    warn: vi.spyOn(gateway.logger, 'warn'),
    error: vi.spyOn(gateway.logger, 'error'),
  };
}
function collectEvents(spies: ReturnType<typeof installLogSpies>): any[] {
  const out: any[] = [];
  for (const spy of [spies.log, spies.warn, spies.error]) {
    for (const call of spy.mock.calls) {
      const s = String(call[0]);
      if (/\{"event":"[a-z_]+"/.test(s)) out.push(JSON.parse(s.slice(s.indexOf('{'))));
    }
  }
  return out;
}

/** Y19：装置=projectId 键控 pendingQueues（V4）+documents Map 保留（drain 循环经它取 document 走
 *  storeDocumentSerialized——detached 路径只灌帧，队列批出口=store/force-spool）+saveMutex stub
 *  （裸 Y.Doc 无 saveMutex——drain 取出直调 runExclusive 会 TypeError；stub 直执行 fn）+connections
 *  Map（closeAllConnections1012 遍历面——见文件头③）。载荷=真 Y update（见文件头①）。 */
async function seedPendingDoc(kit: any, name: string, updates: number): Promise<Y.Doc> {
  const projectId = name.replace(/^project:/, '');
  const doc = Object.assign(new Y.Doc(), {
    saveMutex: { runExclusive: <T,>(fn: () => Promise<T>) => fn() },
    connections: new Map(),
  }) as Y.Doc;
  const src = new Y.Doc();
  const us: Uint8Array[] = [];
  src.on('update', (u: Uint8Array) => us.push(u));
  for (let i = 0; i < updates; i++) src.getMap('nodes').set(`k${i}`, { i });
  (kit.gateway as any).pendingQueues.set(projectId, us);
  (kit.gateway as any).docProject.set(doc, projectId);
  kit.gateway.server.hocuspocus.documents.set(name, doc);
  return doc;
}

describe('Y0a-2 关停 drain 六步（spec v2.4 §2.4——预算 ≤22s；G-2a 双档）', () => {
  it('drain 主路径：pending 批全部 append 落 PG → shutdown_drain_complete 日志 pending 全 0（G-2a i 档）', async () => {
    const kit = await startDualClientServer();   // append 工厂默认 ok:true
    try {
      vi.spyOn(kit.gateway.server, 'destroy').mockResolvedValue(undefined as any);   // 见文件头②
      const spies = installLogSpies(kit.gateway);   // Y16：动作前安装
      await seedPendingDoc(kit, 'project:p-dr1', 3);
      await seedPendingDoc(kit, 'project:p-dr2', 1);
      await kit.gateway.onApplicationShutdown();
      expect(kit.repo.append).toHaveBeenCalledTimes(2);        // 两项目各一批单行 append
      const events = collectEvents(spies);
      const done = events.find((e) => e.event === 'shutdown_drain_complete');
      expect(done).toMatchObject({ pending: { projects: 0, batches: 0 } });   // Y5：projects 键名
      expect(done.storeInFlight).toBe(0);
    } finally { await kit.dispose(); }
  }, 15_000);

  it('drain force-spool：append 失败+spool 可用 → 批入 spool（归属落定）→ drain_complete pending.projects===0（批已出队列）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-shut2-'); cleanups.push(cleanup);
    const spool = new CollabSpoolService(dir);
    const kit = await startDualClientServer({ append: failingRepo({ failAppend: 99 }).append }, 300, spool);
    try {
      vi.spyOn(kit.gateway.server, 'destroy').mockResolvedValue(undefined as any);   // 见文件头②
      const spies = installLogSpies(kit.gateway);
      await seedPendingDoc(kit, 'project:p-dr3', 2);
      await kit.gateway.onApplicationShutdown();
      expect(await spool.peek('p-dr3')).toHaveLength(1);       // 批在 spool（磁盘）
      const events = collectEvents(spies);
      const done = events.find((e) => e.event === 'shutdown_drain_complete');
      expect(done).toBeTruthy();
      expect(done.pending.projects).toBe(0);
    } finally { await kit.dispose(); }
  }, 15_000);

  it('G-2a ii 档：append 失败+spool 不可写 → shutdown_undrained 点名（batches/projects 与 storeInFlight 一致；不得声称 0）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-shut3-'); cleanups.push(cleanup);
    const spool = new CollabSpoolService(dir);
    (spool as any).overCapacityFlag = true;                    // Y14：服务态容量位——受理闸/重试梯首行读点同态（mkdir 段路径占位会被 V2 封段滚动绕过：seg0 EISDIR→seg1 可写=注入失效）
    vi.spyOn(spool, 'append').mockRejectedValue(new Error('spool capacity exceeded'));   // 见文件头④：容量态 append 恒抛且不触盘（滞回解除支对空盘自清白盒位——双保险）
    const kit = await startDualClientServer({ append: failingRepo({ failAppend: 99 }).append }, 300, spool);
    try {
      vi.spyOn(kit.gateway.server, 'destroy').mockResolvedValue(undefined as any);   // 见文件头②
      const spies = installLogSpies(kit.gateway);
      await seedPendingDoc(kit, 'project:p-dr4', 2);
      await kit.gateway.onApplicationShutdown();
      const events = collectEvents(spies);
      const undrained = events.find((e) => e.event === 'shutdown_undrained');
      expect(undrained).toMatchObject({ batches: 2, projects: 1 });   // 如实点名（Y5 键名）
      expect(undrained.storeInFlight).toBe(1);                        // 与 projects 一致（P5 口径——spool 失败不清标志）
    } finally { await kit.dispose(); }
  }, 15_000);

  it('destroy 超时分型：destroy 挂起+pending 已清 → destroy_timeout hangReason=direct-open；未清 → store-undrained', async () => {
    const kit = await startDualClientServer();
    try {
      const spies = installLogSpies(kit.gateway);
      await seedPendingDoc(kit, 'project:p-dr5', 1);
      vi.spyOn(kit.gateway.server, 'destroy').mockImplementation(() => new Promise<void>(() => {}) as any);
      await kit.gateway.onApplicationShutdown();
      const events = collectEvents(spies);
      const timeout = events.find((e) => e.event === 'destroy_timeout');
      expect(timeout).toBeTruthy();
      expect(['store-undrained', 'direct-open']).toContain(timeout.hangReason);
      expect(typeof timeout.storeInFlight).toBe('number');
    } finally {
      vi.restoreAllMocks();   // Y13：先还原 destroy mock——否则 dispose 的 server.destroy 仍挂起=整套用例超时
      (kit.gateway.server.hocuspocus.documents as Map<string, unknown>).delete('project:p-dr5');   // 种子 doc 无连接→真 destroy memoized 等 documents 清空永不满足——dispose 前摘除（见文件头②）
      await kit.dispose();
    }
  }, 20_000);

  it('总预算：正常档关停全程 ≤22s（本地实测断言——kill_timeout 30s 余量 ≥8s 由 Y0a-4 ecosystem 承载）', async () => {
    const kit = await startDualClientServer();
    try {
      const t0 = Date.now();
      await kit.gateway.onApplicationShutdown();
      expect(Date.now() - t0).toBeLessThan(22_000);
    } finally { await kit.dispose(); }
  }, 22_000);

  it('force-spool 成功腿（白盒 drainAllDocuments）：store 全败批留队 → 批 splice 出队+帧入 spool（forcedSpool=1）——M-1 保守口径：不补打 drain_complete，undrained 如实含 forcedSpool', async () => {
    const kit = await startDualClientServer();
    try {
      vi.spyOn(kit.gateway.server, 'destroy').mockResolvedValue(undefined as any);   // 见文件头②（dispose 复用同一 mock，禁先 restore）
      vi.spyOn(kit.gateway as any, 'storeDocumentSerialized').mockResolvedValue(false);   // 主循环全败=批留队（8s 总闸耗尽后的纯 force-spool 等效态）
      const spies = installLogSpies(kit.gateway);   // Y16：动作前安装
      await seedPendingDoc(kit, 'project:p-dr6', 2);
      await (kit.gateway as any).drainAllDocuments(Date.now() + 3_000);
      const q = (kit.gateway as any).pendingQueues.get('p-dr6');
      expect(q).toHaveLength(0);                               // 批出队列（J5：真写成才 splice）
      expect(await kit.spool.peek('p-dr6')).toHaveLength(1);   // 批入 spool（磁盘落定）
      const events = collectEvents(spies);
      expect(events.find((e) => e.event === 'shutdown_drain_complete')).toBeUndefined();   // M-1：成功腿不补打（保守口径锁定）
      const undrained = events.find((e) => e.event === 'shutdown_undrained');
      expect(undrained).toMatchObject({ batches: 0, projects: 0, forcedSpool: 1, storeInFlight: 0 });
    } finally { await kit.dispose(); }
  }, 15_000);

  it('J5 反向：force-spool race 超时 → ids===null 不 splice（批保留）且不 leave（storeInFlight 点名一致）', async () => {
    const kit = await startDualClientServer({ append: failingRepo({ failAppend: 99 }).append });
    const releases: ((v: string[]) => void)[] = [];
    try {
      vi.spyOn(kit.gateway.server, 'destroy').mockResolvedValue(undefined as any);   // 见文件头②
      vi.spyOn(kit.spool, 'append').mockImplementation(() => new Promise<string[]>((resolve) => { releases.push(resolve); }));   // spool 挂起（主循环 V1 支+force-spool 双挂）
      const spies = installLogSpies(kit.gateway);
      await seedPendingDoc(kit, 'project:p-dr7', 2);
      await (kit.gateway as any).drainAllDocuments(Date.now() + 400);   // 短 deadline——两腿 race 超时路径
      const q = (kit.gateway as any).pendingQueues.get('p-dr7');
      expect(q).toHaveLength(2);                               // J5：null 不 splice（真写成才出队——批蒸发防线）
      const events = collectEvents(spies);
      const undrained = events.find((e) => e.event === 'shutdown_undrained');
      expect(undrained).toMatchObject({ batches: 2, projects: 1, storeInFlight: 1, forcedSpool: 0 });   // Y12：race 超时不 leave——点名一致
    } finally {
      for (const release of releases) release(['y0a2-late-release']);   // 释放挂起 append（结果已被 race 弃——防悬挂）
      vi.restoreAllMocks();   // Y13：先还原（spool mock+destroy mock）
      (kit.gateway.server.hocuspocus.documents as Map<string, unknown>).delete('project:p-dr7');   // 种子 doc 摘除（真 destroy 等 documents 清空——见文件头②）
      await kit.dispose();
      for (const [name] of [...((kit.gateway as any).persistRetry as Map<string, unknown>)]) {   // 释放引发的迟到 V1 成功腿会排重试定时器——dispose 后收口
        (kit.gateway as any).cancelPersistRetry(name);
      }
    }
  }, 15_000);
});
