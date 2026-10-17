// apps/api/src/modules/collab/collab-degraded.spec.ts
// Y0b-5 T14（spec §5.8② E54⑤）：gateway.computeDegraded 四键——ready token 档 degraded 块与
// yjs_oldest_unflushed_age_seconds gauge 的同源数据面。形态：直构单元组（collab-heap-gate.spec 先例）。
// ①dirtyDocs/spoolDepthBytes=computePending 同源（yjs_pending_projects/yjs_spool_depth_bytes 同式）；
// ②pendingSince 台账=update 监听单点播种（空→非空转变），排空后 reader 自愈除账（清账点散布不依赖）；
// ③stuckDocs 与 yjs_doc_stuck_total 同增点（observeIdleDocs 连续 2 轮单点双计——进程寿命累计口径）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { register } from 'prom-client';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';   // Y0c T39b 波 2：内部状态访问经 façade（check-collab-test-facade 门禁）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y0b5-degraded-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => { await spoolCleanup(); vi.useRealTimers(); });

function buildGateway() {
  const prisma = {};
  const repo = createMockRepo();
  const lease = createLeaseStub();
  const perm = {};
  const spool = new CollabSpoolService(spoolDir);
  spool.setOwner('test-owner');
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, lease as any,
    perm as any, 48000 + Math.floor(Math.random() * 1000),
    undefined, undefined, undefined, spool,
  );
  gatewayFacade(gateway).forceCollabState('serving');
  return { gateway, spool };
}

function seedDoc(gateway: CollabGateway, name: string) {
  // getConnections：computePending→server.getConnectionsCount 会遍历调 doc.getConnections（heap-gate
  // 的最小 seed 不含——本 spec 消费 computeDegraded 必须补）
  (gateway.server.hocuspocus.documents as Map<string, any>).set(name, { name, connections: new Map(), isLoading: false, getConnections: () => new Map() });
}

async function gaugeValue(name: string): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  return (await metric.get()).values[0]?.value ?? 0;
}

describe('Y0b-5 T14：computeDegraded 四键（E54⑤——ready token 档 degraded 块数据面）', () => {
  it('①真实路径播种+②自愈：applyUpdate（update 监听唯一 push 点）→ pendingSince 空→非空转变；排空后 reader 消费即除账（漏清守卫——不依赖散布清账点）；gauge 同源可见', async () => {
    const { gateway } = buildGateway();
    const doc = new Y.Doc();
    await gateway.docRegistry.loadDocument({ document: doc, documentName: 'project:p-d1' } as any);   // W3a：DR 公有化直调（cast 消失）
    // 装载 stamp 自愈 update 预期入队（gateway:969-971 注释——update 进 pending 落库）——先排空建立零脏基线
    gatewayFacade(gateway).pendingQueueRef('p-d1')!.splice(0);
    const base = gateway.computeDegraded();
    expect(base.dirtyDocs).toBe(0);
    expect(base.oldestUnflushedAt).toBeNull();
    expect(base.oldestUnflushedAgeSeconds).toBe(0);
    expect(base.stuckDocs).toBeGreaterThanOrEqual(0);   // 进程寿命累计（register 全局单例——增量语义在测试③）
    expect(base.spoolDepthBytes).toBe(0);
    // 真实路径：applyUpdate → document.on('update') 监听 → q.push（队列空→非空转变=播种）。
    // 源 doc 必须有内容——空 doc 的 state update 是 no-op 不触发 update 事件。
    // sleep 5ms：同毫秒内 seed→读 age 恒 0（Age 是 Date.now 差——测试须放走时间）
    const other = new Y.Doc();
    other.getMap('nodes').set('n1', { kind: 'text' });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    await new Promise((r) => setTimeout(r, 5));
    const d = gateway.computeDegraded();
    expect(d.dirtyDocs).toBe(1);                        // yjs_pending_projects 同源（computePending().projects）
    expect(d.oldestUnflushedAt).not.toBeNull();         // at ISO+age 双给（T15 巡检消费形态）
    expect(new Date(d.oldestUnflushedAt!).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(d.oldestUnflushedAgeSeconds).toBeGreaterThanOrEqual(0);
    expect(await gaugeValue('yjs_oldest_unflushed_age_seconds')).toBeGreaterThan(0);
    // 排空（模拟 flush 落定后队列清空）→ 自愈除账（清账点散布外的结构性兜底）
    gatewayFacade(gateway).pendingQueueRef('p-d1')!.splice(0);
    const d2 = gateway.computeDegraded();
    expect(d2.dirtyDocs).toBe(0);
    expect(d2.oldestUnflushedAt).toBeNull();
    expect(d2.oldestUnflushedAgeSeconds).toBe(0);
    expect(await gaugeValue('yjs_oldest_unflushed_age_seconds')).toBe(0);
  }, 15_000);

  it('①spoolDepthBytes=own+stranded total 口径（yjs_spool_depth_bytes collect 同式——容量核算含隔离/外来字节）', async () => {
    const { gateway, spool } = buildGateway();
    await spool.append('p-s', new Uint8Array([1, 2, 3]));
    const d = gateway.computeDegraded();
    const p = gateway.computePending();
    expect(d.spoolDepthBytes).toBe(p.spoolBytes + p.strandedBytes);
    expect(d.spoolDepthBytes).toBeGreaterThan(0);
  });

  it('③stuckDocs 与 yjs_doc_stuck_total 同增点：连续 2 轮真 stuck 单点双计（瞬时 1 轮=不计数）', async () => {
    vi.useFakeTimers();
    const { gateway } = buildGateway();
    seedDoc(gateway, 'project:doomed');
    vi.spyOn(gateway.server.hocuspocus, 'shouldUnloadDocument').mockReturnValue(false);
    const stuckBefore = gateway.computeDegraded().stuckDocs;
    const metricBefore = await gaugeValue('yjs_doc_stuck_total');
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000);   // 第 1 轮（debounce 窗内不计数）
    expect(gateway.computeDegraded().stuckDocs).toBe(stuckBefore);
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000);   // 第 2 轮=真 stuck
    expect(gateway.computeDegraded().stuckDocs).toBe(stuckBefore + 1);
    expect((await gaugeValue('yjs_doc_stuck_total')) - metricBefore).toBe(1);
  });
});
