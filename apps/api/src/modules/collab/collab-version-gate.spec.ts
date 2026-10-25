// apps/api/src/modules/collab/collab-version-gate.spec.ts
// Y0b-3 T5（spec §3.1bis）：版本门——authenticateInner 内 heap 闸后、DB 前。
// 四档拒（negotiateClientVersion 精确相等）+collab_version_negotiation_reject_total{reason}
// +authRejectTotal{source:'version'} 双计数+执行序（heap 先于 version）+DB 前短路证据。
// 形态：直构单元组（collab-heap-gate.spec 先例——fake prisma+metricDelta 增量断言）。
// schema-outdated 档：T18 版本硬切 bump csv=3 后 csv=2 即真实旧客户端形态（v2 存量 bundle——
// csv=1 为更早历史档；注入 mock 已拆除，走 negotiateClientVersion 默认 current 真路径）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { register } from 'prom-client';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';   // Y0c T39b 波 2：内部状态访问经 façade（check-collab-test-facade 门禁）
import { CollabAuthReason, isTerminalReason, CLIENT_PROTOCOL_VERSION } from '@flowweb/shared';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { measureHeapPressure, resetHeapPressure, stubHeapMeasure } from './heap-pressure';
import * as Y from 'yjs';

const MiB = 1024 * 1024;

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y0b3-versiongate-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
  resetHeapPressure();
});
afterEach(async () => { await spoolCleanup(); });

function buildGateway() {
  const prisma = {
    systemHistory: { findUnique: vi.fn().mockResolvedValue({ historyId: 'spec-history-id', epochStartedAt: new Date() }) },  // Y1c T9（T8 接线）：listenCollab requireSystemHistory fail-closed 读面 mock

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
    perm as any, 48000 + Math.floor(Math.random() * 2000),
    undefined, undefined, undefined, spool,
  );
  gatewayFacade(gateway).forceCollabState('serving');
  return { gateway, prisma, repo };
}

function makeAuthPayload(socketId: string, query: string) {
  return {
    requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),
    requestParameters: new URLSearchParams(query),
    socketId,
    documentName: 'project:vg',
    connectionConfig: { readOnly: false, isAuthenticated: false },
  };
}

/** stub 成 tripped 态（util 迟滞需 2 连续采样——装置内预热完成；heap-gate.spec 同款） */
function stubHeapTripped(): void {
  stubHeapMeasure({ heapUsed: 0.9e9, heapLimit: 1e9, rss: 100 * MiB });
  measureHeapPressure();
  measureHeapPressure();
}

/** prom-client 计数增量断言（register 全局单例——测试间累积，恒用增量；heap-gate.spec 同款） */
async function metricDelta(name: string, labels: Record<string, string>, fn: () => Promise<unknown>): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  const countOf = async () =>
    (await metric.get()).values.find((s: any) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value ?? 0;
  const before = await countOf();
  await fn();
  return (await countOf()) - before;
}

describe('Y0b-3 T5 版本门（四档拒+双计数+DB 前短路）', () => {
  it('缺 csv→CLIENT_VERSION_MISSING（旧 bundle 不带参数同拒；最廉价检查在 DB 前——prisma 零调用）', async () => {
    const { gateway, prisma } = buildGateway();
    const gateInc = await metricDelta('collab_version_negotiation_reject_total', { reason: 'client-version-missing' }, () =>
      expect(gateway.hooks.onAuthenticate(makeAuthPayload('sock-vg-m1', '') as any))
        .rejects.toMatchObject({ reason: 'client-version-missing' }));
    expect(gateInc).toBe(1);
    const authInc = await metricDelta('collab_auth_reject_total', { reason: 'client-version-missing', source: 'version' }, () =>
      expect(gateway.hooks.onAuthenticate(makeAuthPayload('sock-vg-m2', '') as any))
        .rejects.toMatchObject({ reason: 'client-version-missing' }));
    expect(authInc).toBe(1);
    expect(prisma.session.findUnique).not.toHaveBeenCalled();   // 版本门先于 DB（touchWithReason 零触达）
  });

  it('csv 不可解析→CLIENT_VERSION_INVALID（"abc"/"1.5"/"0"/负数 表驱动）', async () => {
    for (const [i, csv] of ['abc', '1.5', '0', '-1'].entries()) {
      const { gateway } = buildGateway();
      const inc = await metricDelta('collab_version_negotiation_reject_total', { reason: 'client-version-invalid' }, () =>
        expect(gateway.hooks.onAuthenticate(makeAuthPayload(`sock-vg-i${i}`, `csv=${csv}`) as any))
          .rejects.toMatchObject({ reason: 'client-version-invalid' }));
      expect(inc).toBe(1);
    }
  });

  it('csv<current→SCHEMA_OUTDATED（客户端旧——reload 有效档；T18 bump csv=3 后 csv=2 即真实旧客户端〔v2 存量 bundle〕、csv=1 历史档同拒——注入 mock 拆除走默认真路径）', async () => {
    const { gateway } = buildGateway();
    const inc = await metricDelta('collab_version_negotiation_reject_total', { reason: 'schema-outdated' }, () =>
      expect(gateway.hooks.onAuthenticate(makeAuthPayload('sock-vg-s1', 'csv=1') as any))
        .rejects.toMatchObject({ reason: 'schema-outdated' }));
    expect(inc).toBe(1);
    expect(isTerminalReason(CollabAuthReason.SCHEMA_OUTDATED)).toBe(true);   // 终态档——客户端 reload 分流
  });

  it('csv>current→SERVER_OUTDATED（客户端新于服务端——reload 无效档；瞬态档不入终态）', async () => {
    const { gateway } = buildGateway();
    const inc = await metricDelta('collab_version_negotiation_reject_total', { reason: 'server-outdated' }, () =>
      expect(gateway.hooks.onAuthenticate(makeAuthPayload('sock-vg-so1', 'csv=999') as any))
        .rejects.toMatchObject({ reason: 'server-outdated' }));
    expect(inc).toBe(1);
    expect(isTerminalReason(CollabAuthReason.SERVER_OUTDATED)).toBe(false);   // 瞬态——误入终态=部署滞后钉死全部新客户端
  });

  it(`csv=${CLIENT_PROTOCOL_VERSION}（当前）→放行进 DB 环节（版本门不是 DB 拦截）+cb 透传不参与协商`, async () => {
    const { gateway, prisma } = buildGateway();
    await expect(gateway.hooks.onAuthenticate(makeAuthPayload('sock-vg-a1', `csv=${CLIENT_PROTOCOL_VERSION}&cb=dev`) as any))
      .resolves.toBeDefined();
    expect(prisma.session.findUnique).toHaveBeenCalledTimes(1);   // 进了 DB（版本门放行）
  });

  it('版本门在 heap 闸之后（执行序——stub heap tripped+无 csv→server-overloaded 先于 version 档）', async () => {
    const { gateway } = buildGateway();
    stubHeapTripped();
    const versionInc = await metricDelta('collab_version_negotiation_reject_total', { reason: 'client-version-missing' }, () =>
      expect(gateway.hooks.onAuthenticate(makeAuthPayload('sock-vg-o1', '') as any))
        .rejects.toMatchObject({ reason: 'server-overloaded' }));
    expect(versionInc).toBe(0);   // 版本门未及执行——heap 闸先拒
  });
});

describe('T18 版本硬切：CanvasDoc.schemaVersion PG 列门（Y1b T2——meta.schemaVersion 退役）', () => {
  it('旧 doc（行 schemaVersion=2≠current 3）→ 拒载：throw 附 reason=schema-outdated+schemaRefusal 标记（客户端 handleVersionTerminal 一次 reload 通路）——doc meta 残留任何值不再参与判定', async () => {
    const { gateway, repo } = buildGateway();
    const stale = new Y.Doc();   // doc 内容：满节点+旧 meta 残留（历史载荷——列门不解释）
    stale.getMap('meta').set('schemaVersion', 2);
    stale.getMap('nodes').set('n', new Y.Map());
    // 行值=2（旧档行——版本硬切前建行）⇒ 列门拒载（先于 replay）
    repo.hydrateWithRecovery.mockResolvedValue({ state: Buffer.from(Y.encodeStateAsUpdate(stale)), updates: [], stateSeq: 0n, schemaVersion: 2 });
    const rejected = new Y.Doc();
    const denial = await gateway.hooks.onLoadDocument({ document: rejected, documentName: 'project:vg-old' } as any)
      .then(() => { throw new Error('expected rejection'); }, (e: Error & { schemaRefusal?: boolean; reason?: string }) => e);
    expect(denial.reason).toBe(CollabAuthReason.SCHEMA_OUTDATED);   // 库 esm:939 error.reason ?? 'permission-denied' 透传——附上即通
    expect(denial.schemaRefusal).toBe(true);                        // 既有标记保留（无害）
    expect(denial.message).toMatch(/CanvasDoc\.schemaVersion=2/);  // 列门判据（PG 行值——非 doc meta）
    expect(isTerminalReason(CollabAuthReason.SCHEMA_OUTDATED)).toBe(true);   // 网关侧通路锚（shared 侧已测——此处锚网关链路分型一致）
    // 评审 P2#5：判于 replay **前**——拒绝档 doc 零重放残留（state 含节点 n 但未 apply；replay
    // 先行=节点已入 doc，本断言红——旧档不付重放成本的原设计语义回归锁）。
    expect([...rejected.getMap('nodes').keys()]).toHaveLength(0);
    expect(rejected.store.pendingStructs).toBeNull();
  });

  it('行 schemaVersion=3（当前）→ 放行（doc meta 零键也放——doc 内容不再带版本）；行缺失（null，懒建档）→ 放行（首 store 建行 @default(3)）', async () => {
    stubHeapMeasure({ heapUsed: 0.5e9, heapLimit: 1e9, rss: 100 * MiB });   // 前序 heap 桩残留复位（heap-gate.spec 同款——loadDocument 装载门 heap 闸前置）
    resetHeapPressure();
    const { gateway, repo } = buildGateway();
    const fresh = new Y.Doc();   // meta 零键——fillDoc 形态
    fresh.getMap('nodes').set('n', new Y.Map());
    repo.hydrateWithRecovery.mockResolvedValue({ state: Buffer.from(Y.encodeStateAsUpdate(fresh)), updates: [], stateSeq: 0n, schemaVersion: 3 });
    const cur = new Y.Doc();
    await gateway.hooks.onLoadDocument({ document: cur, documentName: 'project:vg-cur' } as any);   // 不抛=放行（hook 返回 void——节点应用为证）
    expect([...cur.getMap('nodes').keys()]).toEqual(['n']);

    const { gateway: g2, repo: r2 } = buildGateway();
    stubHeapMeasure({ heapUsed: 0.5e9, heapLimit: 1e9, rss: 100 * MiB });
    resetHeapPressure();
    r2.hydrateWithRecovery.mockResolvedValue({ state: null, updates: [], stateSeq: 0n, schemaVersion: null });
    await g2.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:vg-lazy' } as any);   // 行缺失（懒建档）不抛
  });
});
