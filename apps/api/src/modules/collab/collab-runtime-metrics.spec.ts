// apps/api/src/modules/collab/collab-runtime-metrics.spec.ts
// Y0c T0（spec 片 C0/Z3/Z107/Z134/Z138）——运行面度量基座：
// ①六指标注册存在+labelNames 形态（yjs_doc_load_total{trigger}/yjs_store_total{trigger}/
//   yjs_withdoc_open_duration_seconds/collab_escape_hatch_total{kind}/
//   collab_exec_projection_failed_total{cause}/event_loop_lag_seconds）；
// ②Z138 registry 实证锚：defaultLabels 只在输出文本注入、get() 只返回 hashMap 不读；
// ③load/store trigger 归因（ws|direct 标记单次消费；debounce|retry 显式参；noop 早退不计）；
// ④withDoc 计时点前移（open 段独立直方图+全路径含装载段；open 拒绝仍计时长面）。
// 直构形态=collab-metrics-observability.spec 先例（collabState='serving'+createMockRepo+makeSpoolDir）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { register } from 'prom-client';
import { CollabGateway, type QuotaConfig } from './collab.gateway';
import { CollabDocumentService } from './collab-document.service';
import {
  yjsDocLoadTotal, yjsStoreTotal, yjsWithdocOpenDuration, collabEscapeHatchTotal,
  sampleEventLoopLag, noteDirectLoad,
} from './store.metrics';
import { collabExecProjectionFailedTotal } from '../execution/exec.metrics';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';   // Y0c T39b 波 2：内部状态访问经 façade（check-collab-test-facade 门禁）
import { CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y0c-t0-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => { await spoolCleanup(); vi.restoreAllMocks(); });

/** 直构 gateway（observability spec 同款）：hydration 受控 state/updates */
function buildGateway(hydration?: { state: Buffer | null; updates: Buffer[] }) {
  const repo = createMockRepo();
  if (hydration) repo.hydrateWithRecovery.mockResolvedValue({ ...hydration, stateSeq: 0n });
  const spool = new CollabSpoolService(spoolDir);
  spool.setOwner('t0-owner');
  const gateway = new CollabGateway(
    {} as any, new EventEmitter2() as any, repo as any, createLeaseStub() as any,
    { resolve: vi.fn() } as any,
    47500 + Math.floor(Math.random() * 2500),
    undefined, undefined, undefined, spool,
    undefined as unknown as QuotaConfig,
  );
  gatewayFacade(gateway).forceCollabState('serving');
  return { gateway, repo };
}

/** 装载（loadDocument hook 直调——归因断言唯一入口；W3a：DR 公有化直调 cast 消失） */
async function loadDoc(gateway: CollabGateway, pid = 'p1'): Promise<Y.Doc> {
  const document = new Y.Doc();
  await gateway.docRegistry.loadDocument({ document, documentName: `project:${pid}` } as any);
  return document;
}

function stampedDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('schemaVersion', CANVAS_DOC_SCHEMA_VERSION);
  doc.getMap('nodes').set('n1', new Y.Map([['type', 'textInput']]) as any);
  return doc;
}

/** labeled counter 增量（register 全局单例——恒用增量） */
async function labeledCounterDelta(name: string, labels: Record<string, string>, fn: () => Promise<unknown> | unknown): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  const read = async () => (await metric.get()).values
    .find((v: any) => Object.entries(labels).every(([k, val]) => v.labels[k] === val))?.value ?? 0;
  const before = await read();
  await fn();
  return (await read()) - before;
}

/** histogram count/sum 增量 */
async function histogramDelta(name: string, fn: () => Promise<unknown> | unknown): Promise<{ count: number; sum: number }> {
  const metric: any = register.getSingleMetric(name);
  const read = async () => {
    const vs = (await metric.get()).values;
    return {
      count: vs.find((v: any) => v.metricName === `${name}_count`)?.value ?? 0,
      sum: vs.find((v: any) => v.metricName === `${name}_sum`)?.value ?? 0,
    };
  };
  const before = await read();
  await fn();
  const after = await read();
  return { count: after.count - before.count, sum: after.sum - before.sum };
}

describe('Y0c T0：六指标注册存在+labelNames 形态', () => {
  it('注册可 inc/observe 且经 register 可见；未声明 label 的 inc throw（B8 功能性锚）', async () => {
    expect(register.getSingleMetric('yjs_doc_load_total')).toBeTruthy();
    expect(() => yjsDocLoadTotal.inc({ trigger: 'ws' })).not.toThrow();
    expect(() => (yjsDocLoadTotal as any).inc({ bogus: 1 })).toThrow();   // labelNames=['trigger'] 未声明即 throw

    expect(register.getSingleMetric('yjs_store_total')).toBeTruthy();
    expect(() => yjsStoreTotal.inc({ trigger: 'debounce' })).not.toThrow();

    expect(register.getSingleMetric('yjs_withdoc_open_duration_seconds')).toBeTruthy();
    expect(() => yjsWithdocOpenDuration.observe(0.001)).not.toThrow();

    expect(register.getSingleMetric('collab_escape_hatch_total')).toBeTruthy();
    for (const kind of ['safeReload', 'generation', 'diverged', 'backup-export', 'client-doc-rebuild'])
      expect(() => collabEscapeHatchTotal.inc({ kind })).not.toThrow();   // 五值 kind 域（sink 接线随客户端遥测通道——Y1c-1）

    expect(register.getSingleMetric('collab_exec_projection_failed_total')).toBeTruthy();
    expect(() => collabExecProjectionFailedTotal.inc({ cause: 'other' })).not.toThrow();

    expect(register.getSingleMetric('event_loop_lag_seconds')).toBeTruthy();
    const before = await ((register.getSingleMetric('event_loop_lag_seconds') as any).get() as Promise<any>)
      .then((r: any) => r.values.find((v: any) => v.metricName === 'event_loop_lag_seconds_count')?.value ?? 0);
    sampleEventLoopLag();   // 导出采样函数（30s 周期由模块内 unref timer 驱动——单测直调）
    const after = await ((register.getSingleMetric('event_loop_lag_seconds') as any).get() as Promise<any>)
      .then((r: any) => r.values.find((v: any) => v.metricName === 'event_loop_lag_seconds_count')?.value ?? 0);
    expect(after - before).toBe(1);
  });

  it('Z138 registry 实证锚：defaultLabels 只在输出文本注入（role="api"），get() 只返回 hashMap 不读——既有 getSingleMetric().get() 断言零影响', async () => {
    register.setDefaultLabels({ role: 'api' });
    try {
      yjsDocLoadTotal.inc({ trigger: 'ws' });
      const text = await register.metrics();
      const line = text.split('\n').find((l) => l.startsWith('yjs_doc_load_total{'));
      expect(line, '输出文本须含该族样本行').toBeTruthy();
      expect(line).toContain('role="api"');   // defaultLabels 只在 getMetricsAsString 注入（registry.js :43,:136）
      expect(line).toContain('trigger="ws"'); // 行序无关断言（default 与声明 label 的拼接序不承诺）
      const vs = (await (register.getSingleMetric('yjs_doc_load_total') as any).get()).values;
      expect(vs[0].labels.role).toBeUndefined();   // get() 不读 _defaultLabels（registry.js :109-120）
    } finally {
      register.setDefaultLabels({});   // 还原（defaultLabels 整体替换语义——registry.js :159-160）
    }
  });
});

describe('Y0c T0：load/store trigger 归因', () => {
  it('yjs_doc_load_total：loadDocument 成功路径单点——无直连开窗标记=ws；标记在窗=direct 且一次性消费', async () => {
    const { gateway } = buildGateway({ state: Buffer.from(Y.encodeStateAsUpdate(stampedDoc())), updates: [] });
    const dWs = await labeledCounterDelta('yjs_doc_load_total', { trigger: 'ws' }, () => loadDoc(gateway, 'p1'));
    expect(dWs).toBe(1);
    const dDirect = await labeledCounterDelta('yjs_doc_load_total', { trigger: 'direct' }, async () => {
      noteDirectLoad('p2');
      await loadDoc(gateway, 'p2');
    });
    expect(dDirect).toBe(1);
    const dAfter = await labeledCounterDelta('yjs_doc_load_total', { trigger: 'ws' }, () => loadDoc(gateway, 'p2'));   // 标记已消费→回 ws
    expect(dAfter).toBe(1);
    const dNoResidual = await labeledCounterDelta('yjs_doc_load_total', { trigger: 'direct' }, () => loadDoc(gateway, 'p2'));   // 标记已消费→未标记装载归 ws 不得归 direct
    expect(dNoResidual).toBe(0);   // 零残留——一次性消费语义锁死
  });

  it('yjs_store_total：显式 trigger 参透传=retry；noop 早退不计（Y1c T9：debounce 随 onStoreDocument 拆链退出现役——telemetry-only 后零生产调用）', async () => {
    const { gateway } = buildGateway({ state: Buffer.from(Y.encodeStateAsUpdate(stampedDoc())), updates: [] });
    const document = await loadDoc(gateway, 'p1');
    const w = new Y.Doc();
    w.getMap('x').set('k', 'v'.repeat(64));
    Y.applyUpdate(document, Y.encodeStateAsUpdate(w));   // update 监听入队（非 noop）
    // Y1c T9：onStoreDocument 旧链拆除（telemetry-only）——debounce 档零生产调用方；本断言改验
    // telemetry 探针面（legacy_store_hook_probe_total）+显式 flush 归因（maintenance 档）
    const dDebounce = await labeledCounterDelta('yjs_store_total', { trigger: 'maintenance' }, () =>
      gateway.persistence.storeDocumentUnlocked({ document, documentName: 'project:p1' } as any, 'maintenance'));
    expect(dDebounce).toBe(1);

    const d2document = await loadDoc(gateway, 'p5');
    Y.applyUpdate(d2document, Y.encodeStateAsUpdate(w));
    const dRetry = await labeledCounterDelta('yjs_store_total', { trigger: 'retry' }, () =>
      gateway.persistence.storeDocumentUnlocked({ document: d2document, documentName: 'project:p5' }, 'retry'));
    expect(dRetry).toBe(1);

    // noop 早退：带戳装载（stamp 不入队）+空 spool → 取批零帧
    const noopDoc = await loadDoc(gateway, 'p6');   // stamped——stamp update 在 replay 抑制窗不入队，装载后队列空
    const dNoop = await labeledCounterDelta('yjs_store_total', { trigger: 'debounce' }, () =>
      gateway.persistence.storeDocumentUnlocked({ document: noopDoc, documentName: 'project:p6' }, 'debounce'));
    expect(dNoop).toBe(0);
  });
});

describe('Y0c T0：withDoc 计时点前移（Z3——装载慢 vs 落库慢分辨面）', () => {
  it('open 段独立直方图 observe（含 mock 装载延迟）；全路径 withdoc 直方图 sum ≥ open 段 sum（起点已含 open）', async () => {
    const { gateway } = buildGateway();
    const service = new CollabDocumentService(gateway, { readSnapshotOnly: vi.fn() } as any);
    const doc = stampedDoc();
    const fakeConn = { document: doc, transact: async (fn: (d: Y.Doc) => unknown) => fn(doc), disconnect: async () => {} };   // Y0c T10：withDoc 直开 document 事务——mock 对齐真实 DirectConnection 形状
    vi.spyOn(gateway.server.hocuspocus, 'openDirectConnection').mockImplementation(
      async () => { await new Promise((r) => setTimeout(r, 30)); return fakeConn as any; });
    // Y0c T15：readCanvas 改道会话（会话新开 observe open 段/复用零观测；全路径 withdoc 直方图=withDoc 专属）——载体改直调 withDoc
    const dOpen = await histogramDelta('yjs_withdoc_open_duration_seconds', () => service.withDoc('p1', () => 'x'));
    expect(dOpen.count).toBe(1);
    expect(dOpen.sum).toBeGreaterThanOrEqual(0.02);   // 30ms 装载延迟入样本（起点=open 之前）
    const dFull = await histogramDelta('yjs_withdoc_duration_seconds', () => service.withDoc('p1', () => 'x'));
    expect(dFull.count).toBe(1);
    expect(dFull.sum).toBeGreaterThanOrEqual(0.02);   // 前移后全路径含 open 段
  });

  it('open 拒绝路径：直方图仍 observe（时长面非成功面——装载失败是最该被看见的慢尾）；withdoc 全路径零计', async () => {
    const { gateway } = buildGateway();
    const service = new CollabDocumentService(gateway, { readSnapshotOnly: vi.fn() } as any);
    vi.spyOn(gateway.server.hocuspocus, 'openDirectConnection').mockRejectedValue(new Error('db unavailable'));
    const dOpen = await histogramDelta('yjs_withdoc_open_duration_seconds', () =>
      service.readCanvas('p1').catch(() => {}));
    expect(dOpen.count).toBe(1);
    const dFull = await histogramDelta('yjs_withdoc_duration_seconds', () =>
      service.readCanvas('p1').catch(() => {}));
    expect(dFull.count).toBe(0);   // 未进入 transact 段（既有语义保持——open 后才起算的部分不虚计）
  });
});
