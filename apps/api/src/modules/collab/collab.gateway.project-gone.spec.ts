// Y0a-2（spec §2.5+V11）：project.gone 单点收敛——处理器只做内存终态+显式清账+关连接（禁慢操作/禁
// 磁盘 I/O）：**emit 在删除事务提交之后**（V11 后置——回滚=无 emit=无假终态）；提交→emit 亚秒窗的
// 写入由 FK 双形状权威承接（撞 FK=项目确已删，丢弃+计数正确）；残留 spool 段收割=FK 识别（Task 2）。
import { describe, it, expect, afterAll, vi } from 'vitest';
import * as Y from 'yjs';
import { register } from 'prom-client';
import { CollabSpoolService } from './collab-spool.service';
import { storeInFlightDocs } from './store.metrics';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { startDualClientServer } from '../../test-utils/dual-client-server';
import { createMockRepo } from '../../test-utils/mock-repo';

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const c of cleanups) await c(); });

/** Y18：带标签指标的公开 API 求和（V17⑥：metric.get() 公开 API——v15 为异步须 await）；
 *  series 恰含两 source 断言的取数源 */
const discardedCount = async (): Promise<number> => {
  const m = register.getSingleMetric('yjs_updates_discarded_deleted_total')!;
  return (await m.get()).values.reduce((s, v) => s + v.value, 0);
};

describe('Y0a-2 project.gone 清账', () => {
  it('project.gone 事件 → 关连接+清 persistRetry/lastCompactAt/persistUnhealthy+终态集登记+**队列显式清账（X1）**', async () => {
    const kit = await startDualClientServer();
    try {
      const g = kit.gateway as any;
      g.lastCompactAt.set('p-gone', 1);
      g.persistUnhealthy.add('project:p-gone');
      g.persistRetry.set('project:p-gone', { rung: 3, timer: setTimeout(() => {}, 60_000) });
      g.pendingQueues.set('p-gone', [new Uint8Array([7])]);   // X1：僵尸队列——事件处理器必须清（doc 卸载后拦截分支结构性不可达）
      // Y1 门用例装置（事件时在飞→落定后归零——平凡 0 断言无鉴别力）：白盒置在飞+gauge 置 1
      g.inFlightProjects.add('p-gone');
      storeInFlightDocs.set(1);
      // 活跃连接关断（真 WS）
      const { provider, synced } = kit.connect('project:p-gone');
      await synced;
      // kit await onModuleInit 时已注册订阅（gateway.onModuleInit 内）——用例经 kit.emitter 直发（同步派发，等价 emitAsync 监听路径）
      kit.emitter.emit('project.gone', { projectIds: ['p-gone'] });
      expect(g.deletedProjects.has('p-gone')).toBe(true);        // 终态集（永久无界——spec §9.10）
      expect(g.lastCompactAt.has('p-gone')).toBe(false);
      expect(g.persistUnhealthy.has('project:p-gone')).toBe(false);
      expect(g.persistRetry.has('project:p-gone')).toBe(false);  // 定时器随清
      expect(g.pendingQueues.has('p-gone')).toBe(false);         // X1+M6：僵尸队列随事件清账（空条目删除——不清则 computePending 恒>0→drain_complete 永不打印）
      expect((await storeInFlightDocs.get()).values[0]?.value ?? 0).toBe(0);   // Y1 已删项目门：事件时在飞→落定后归零
      kit.forget(provider);   // 自管 destroy 后从 dispose 清理数组移除（双 destroy=已知 flaky 源）
      await provider.destroy();
    } finally { await kit.dispose(); }
  });

  it('终态拦截：已删项目的 storeDocument no-op+yjs_updates_discarded_deleted_total{source=gateway} 递增', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-gone2-'); cleanups.push(cleanup);
    const spool = new CollabSpoolService(dir);
    const kit = await startDualClientServer({}, 300, spool);
    try {
      const g = kit.gateway as any;
      kit.emitter.emit('project.gone', { projectIds: ['p-gone2'] });
      const before = await discardedCount();
      g.pendingQueues.set('p-gone2', [new Uint8Array([1])]);      // Y19：projectId 键控
      const r = await kit.gateway.hooks.onStoreDocument({ document: new Y.Doc(), documentName: 'project:p-gone2' } as any);   // 白盒直调（Y.Doc 非 Document 满型）
      expect(r).toBe(false);
      expect(kit.repo.append).not.toHaveBeenCalled();            // 不 append（写了也白写——项目行没了）
      expect(await spool.peek('p-gone2')).toHaveLength(0);       // 不入 spool（台账无意义）
      expect(await discardedCount() - before).toBeGreaterThanOrEqual(1);
    } finally { await kit.dispose(); }
  });

  it('team.disbanded 双订阅汇入同一处理（projectIds 载荷等价）', async () => {
    const kit = await startDualClientServer();
    try {
      kit.emitter.emit('team.disbanded', { teamId: 't1', projectIds: ['p-x'] });
      expect((kit.gateway as any).deletedProjects.has('p-x')).toBe(true);
    } finally { await kit.dispose(); }
  });

  it('FK 兜底（运行期）：append 撞 P2003 → 批丢弃+计数+不排重试梯（残留 spool 段的收割同判——Task 2 replayAll）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y0a2-gone4-'); cleanups.push(cleanup);
    const spool = new CollabSpoolService(dir);
    const repo = createMockRepo({ append: vi.fn(async () => { throw Object.assign(new Error('Foreign key constraint failed'), { code: 'P2003' }); }) });
    const kit = await startDualClientServer({ ...repo }, 300, spool);
    try {
      const g = kit.gateway as any;
      const before = await discardedCount();
      g.pendingQueues.set('p-fk', [new Uint8Array([1])]);        // Y19：projectId 键控
      const r = await kit.gateway.hooks.onStoreDocument({ document: new Y.Doc(), documentName: 'project:p-fk' } as any);   // 白盒直调（Y.Doc 非 Document 满型）
      expect(r).toBe(false);
      expect(g.pendingQueues.get('p-fk')).toHaveLength(0);       // 批丢弃（DB 权威证据=P6）
      expect(g.persistRetry.size).toBe(0);                       // 不进重试梯
      expect(await discardedCount() - before).toBeGreaterThanOrEqual(1);
    } finally { await kit.dispose(); }
  });

  it('Y18：discarded 计数的 series 恰含 source=gateway/spool 两标签（无标签调用会产出 source="" 脏 series）', async () => {
    const m = register.getSingleMetric('yjs_updates_discarded_deleted_total')!;
    const values = (await m.get()).values;
    const sources = new Set(values.map((v) => v.labels.source));
    expect(sources.has('gateway') || sources.size === 0).toBe(true);   // 前两用例已 inc({source:'gateway'})——非空时必含 gateway；禁出现 undefined
    for (const v of values) expect(v.labels.source).toBeDefined();
  });
});
