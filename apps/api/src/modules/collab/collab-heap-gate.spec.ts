// apps/api/src/modules/collab/collab-heap-gate.spec.ts
// Y0b-3 T4（spec §3.2）：heap 压力自保闸落点——authenticateInner 顶部+loadDocument 汇聚点双落点
// （仅拒新物化=防自伤）+fail-open 落点级+5min 零连接卡住观测器（纯观测无卸载动作）+观测 gauge。
// 形态：直构单元组（collab-auth-defense.spec 先例——fake conn+seedDocument+fake timers）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { register } from 'prom-client';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';   // Y0c T39b 波 2：内部状态访问经 façade（check-collab-test-facade 门禁）
import { isTerminalReason, CollabAuthReason, CLIENT_PROTOCOL_VERSION } from '@flowweb/shared';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { measureHeapPressure, resetHeapPressure, stubHeapMeasure } from './heap-pressure';

const MiB = 1024 * 1024;

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y0b3-heapgate-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
  resetHeapPressure();
});
afterEach(async () => { await spoolCleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); });

function buildGateway() {
  const prisma = {
    session: {
      findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, userId: 'u1', expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }),
      update: vi.fn(async (args: any) => ({ user: { id: 'u1', name: '张三' }, expiresAt: args.data.expiresAt })),
    },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1', userId: 'other' }) },
    projectMember: { findUnique: vi.fn().mockResolvedValue(null) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
  };
  const repo = createMockRepo();
  const lease = createLeaseStub();
  const perm = {
    resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }),
  };
  const spool = new CollabSpoolService(spoolDir);
  spool.setOwner('test-owner');
  const gateway = new CollabGateway(
    prisma as any, new EventEmitter2() as any, repo as any, lease as any,
    perm as any, 47000 + Math.floor(Math.random() * 2000),
    undefined, undefined, undefined, spool,
  );
  gatewayFacade(gateway).forceCollabState('serving');
  return { gateway, prisma, perm, spool };
}

function makeAuthPayload(socketId: string, documentName: string) {
  return {
    requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),
    requestParameters: new URLSearchParams(`csv=${CLIENT_PROTOCOL_VERSION}`),   // Y0b-3 T5 版本门：装置带当前协议版（缺 csv=CLIENT_VERSION_MISSING 先拒）
    socketId,
    documentName,
    connectionConfig: { readOnly: false, isAuthenticated: false },
  };
}

/** stub 成 tripped 态（util 迟滞需 2 连续采样——装置内预热完成） */
function stubHeapTripped(): void {
  stubHeapMeasure({ heapUsed: 0.9e9, heapLimit: 1e9, rss: 100 * MiB });
  measureHeapPressure();
  measureHeapPressure();
}

function seedDoc(gateway: CollabGateway, name: string) {
  (gateway.server.hocuspocus.documents as Map<string, any>).set(name, { name, connections: new Map(), isLoading: false });
}

/** prom-client 计数增量断言（register 全局单例——测试间累积，恒用增量） */
async function metricDelta(name: string, labels: Record<string, string>, fn: () => Promise<unknown>): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  const countOf = async () =>
    (await metric.get()).values.find((s: any) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value ?? 0;
  const before = await countOf();
  await fn();
  return (await countOf()) - before;
}

describe('Y0b-3 T4 heap 闸落点（仅拒新物化+fail-open+瞬态档）', () => {
  it('①tripped→新 doc 连接拒+auth_reject{server-overloaded,heap}+load_rejected 双计数+瞬态档（isTerminalReason=false）', async () => {
    expect(isTerminalReason(CollabAuthReason.SERVER_OVERLOADED)).toBe(false); // 瞬态档——误入终态=一次尖峰钉死客户端
    const { gateway } = buildGateway();
    stubHeapTripped();
    const authInc = await metricDelta('collab_auth_reject_total', { reason: 'server-overloaded', source: 'heap' }, () =>
      expect(gateway.hooks.onAuthenticate(makeAuthPayload('sock-h1', 'project:new-doc') as any)).rejects.toMatchObject({ reason: 'server-overloaded' }));
    expect(authInc).toBe(1);
    const loadInc = await metricDelta('collab_load_rejected_total', { reason: 'server-overloaded' }, () =>
      expect(gateway.hooks.onAuthenticate(makeAuthPayload('sock-h2', 'project:new-doc-2') as any)).rejects.toMatchObject({ reason: 'server-overloaded' }));
    expect(loadInc).toBe(1);
  });

  it('②同压力下已加载 doc 重连不被拒（!documents.has 防自伤——压力期放行存量编辑）', async () => {
    const { gateway } = buildGateway();
    stubHeapTripped();
    seedDoc(gateway, 'project:resident');
    await expect(gateway.hooks.onAuthenticate(makeAuthPayload('sock-h3', 'project:resident') as any)).resolves.toBeDefined();
  });

  it('③谓词抛错→放行（fail-open 落点级——指标失败不得全站拒连）', async () => {
    const { gateway } = buildGateway();
    stubHeapMeasure(null);
    await expect(gateway.hooks.onAuthenticate(makeAuthPayload('sock-h4', 'project:x') as any)).resolves.toBeDefined();
  });

  it('loadDocument 汇聚点：tripped→新 doc 装载拒（ServiceUnavailableException 带 COLLAB_NOT_SERVING code——filter 才附 Retry-After）', async () => {
    const { gateway } = buildGateway();
    stubHeapTripped();
    const loadInc = await metricDelta('collab_load_rejected_total', { reason: 'server-overloaded' }, () =>
      expect(gateway.docRegistry.loadDocument({ document: new Y.Doc(), documentName: 'project:rest-load' } as any))   // W3a：DR 公有化直调（cast 消失）
        .rejects.toMatchObject({ reason: 'server-overloaded' }));
    expect(loadInc).toBe(1);
  });

  it('loadDocument 汇聚点：已加载 doc（重放窗）不被 load 闸拒（防自伤同款）', async () => {
    const { gateway } = buildGateway();
    stubHeapTripped();
    seedDoc(gateway, 'project:resident-load');
    await gateway.docRegistry.loadDocument({ document: new Y.Doc(), documentName: 'project:resident-load' } as any); // 不 throw（W3a：DR 公有化直调）
  });
});

describe('Y0b-3 T4 卡住观测器（纯观测——卸载归库自愈排程）', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('④库守卫不满足+零连接+队列空→连续 2 轮计 yjs_doc_stuck_total（瞬时 debounce 1 轮=不计数）', async () => {
    const { gateway } = buildGateway();
    seedDoc(gateway, 'project:doomed');
    vi.spyOn(gateway.server.hocuspocus, 'shouldUnloadDocument').mockReturnValue(false);
    const metric: any = register.getSingleMetric('yjs_doc_stuck_total');
    const value = async () => (await metric.get()).values[0]?.value ?? 0;
    const before = await value();
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000); // 第 1 轮
    expect(await value()).toBe(before);                    // 1 轮不计数
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000); // 第 2 轮
    expect(await value()).toBe(before + 1);                // 连续 2 轮=真 stuck
  });

  it('守卫满足（shouldUnloadDocument=true）或连接回来→不计数且计数窗清零（连续性判定）', async () => {
    const { gateway } = buildGateway();
    seedDoc(gateway, 'project:healthy');
    vi.spyOn(gateway.server.hocuspocus, 'shouldUnloadDocument').mockReturnValue(true);
    const metric: any = register.getSingleMetric('yjs_doc_stuck_total');
    const value = async () => (await metric.get()).values[0]?.value ?? 0;
    const before = await value();
    await vi.advanceTimersByTimeAsync(5 * 60_000 * 3 + 2_000);
    expect(await value()).toBe(before);
  });

  it('自队列非空（pendingQueue 有帧）=正常流转不计 stuck（轮内跳过≠stuck——区分观测）', async () => {
    const { gateway } = buildGateway();
    seedDoc(gateway, 'project:queued');
    vi.spyOn(gateway.server.hocuspocus, 'shouldUnloadDocument').mockReturnValue(false);
    gatewayFacade(gateway).seedPendingQueue('queued', [new Uint8Array([1])]);
    const metric: any = register.getSingleMetric('yjs_doc_stuck_total');
    const value = async () => (await metric.get()).values[0]?.value ?? 0;
    const before = await value();
    await vi.advanceTimersByTimeAsync(5 * 60_000 * 2 + 2_000);
    expect(await value()).toBe(before);
  });

  it('观测器每轮周期采样（评审 F-2）：tripped→released 翻转在 5min tick 消费——gauge 复位 ok+refusalCache 清空（纯需求驱动=客户端放弃重试后恒读 tripped 假阳性）', async () => {
    const { gateway } = buildGateway();
    stubHeapTripped();
    // 需求驱动一次：auth 拒绝（heap 闸）→gauge tripped=1+refusalCache 写入（SERVER_OVERLOADED 白名单+cookie 凭据）
    await expect(gateway.hooks.onAuthenticate(makeAuthPayload('sock-c1', 'project:cycle') as any)).rejects.toMatchObject({ reason: 'server-overloaded' });
    const gauge: any = register.getSingleMetric('collab_overload_state');
    expect((await gauge.get()).values.find((s: any) => s.labels.state === 'tripped')?.value).toBe(1);
    expect(gatewayFacade(gateway).refusalCacheSize()).toBe(1);
    // 内存回落 released 档——客户端放弃重试（无新 auth/load）时仅观测器 tick 可消费翻转
    stubHeapMeasure({ heapUsed: 0.5e9, heapLimit: 1e9, rss: 100 * MiB });
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000);
    const values = (await gauge.get()).values;
    expect(values.find((s: any) => s.labels.state === 'tripped')?.value).toBe(0);
    expect(values.find((s: any) => s.labels.state === 'ok')?.value).toBe(1);
    expect(gatewayFacade(gateway).refusalCacheSize()).toBe(0);   // 释放钩子→onServingTransition 清空（P-Q 钩子②周期消费）
  });
});

describe('Y0b-3 T4 观测 gauge（collect 现算——零手动维护点）', () => {
  it('yjs_pending_bytes/yjs_zero_conn_docs 可见（池外内存早于 RSS 可见——pendingQueues 在 external 不进 heapUsed）', async () => {
    const { gateway } = buildGateway();
    seedDoc(gateway, 'project:idle');
    gatewayFacade(gateway).seedPendingQueue('idle', [new Uint8Array(10), new Uint8Array(5)]);
    seedDoc(gateway, 'project:busy');
    ((gateway.server.hocuspocus.documents as Map<string, any>).get('project:busy')!.connections as Map<unknown, unknown>).set({}, {});
    const pendingBytes: any = register.getSingleMetric('yjs_pending_bytes');
    expect((await pendingBytes.get()).values[0]?.value).toBe(15);
    const zeroConn: any = register.getSingleMetric('yjs_zero_conn_docs');
    expect((await zeroConn.get()).values[0]?.value).toBe(1);
  });

  it('collab_overload_state 互斥两 series（state=ok|tripped——翻转可见）', async () => {
    const { gateway } = buildGateway();
    stubHeapTripped();
    await expect(gateway.hooks.onAuthenticate(makeAuthPayload('sock-g1', 'project:new-doc') as any)).rejects.toMatchObject({ reason: 'server-overloaded' });
    const gauge: any = register.getSingleMetric('collab_overload_state');
    const values = (await gauge.get()).values;
    expect(values.find((s: any) => s.labels.state === 'tripped')?.value).toBe(1);
    expect(values.find((s: any) => s.labels.state === 'ok')?.value).toBe(0);
  });
  // 注：heap 释放翻转→refusalCache 清空的真实路径接线证明在 collab-auth-defense.spec（T3 清空表
  // heap 格——T4 接线后改驱动真实钩子，不在此重复）。
});

describe('Y0b-3 T4 评审小补 F-1：Y2 兜底计数断言（契约 3 最后一道闸）', () => {
  // 覆盖缺口补齐性质——埋点已存在（T4 :824），本测落测即绿：驱动链=hooks.onStoreDocument 直通
  // storeDocumentUnlocked（A14），白盒 spy peekSpoolFrames reject（try 内首 await——Y2 注释的"IO 逃逸"场景）。
  it('store 路径意外 throw→yjs_store_unexpected_throw_total 差值 1 且不向上抛（resolve false——批保留原归属地）', async () => {
    const { gateway } = buildGateway();
    gatewayFacade(gateway).seedPendingQueue('y2proj', []);   // 队列条目播种（!queue tripwire 早退在 try 之前）
    gatewayFacade(gateway).spyPeekSpoolFrames().mockRejectedValue(new Error('io escaped'));
    const inc = await metricDelta('yjs_store_unexpected_throw_total', {}, () =>
      expect(gateway.hooks.onStoreDocument({ document: new Y.Doc(), documentName: 'project:y2proj' } as any)).resolves.toBe(false));
    expect(inc).toBe(1);
  });
});
