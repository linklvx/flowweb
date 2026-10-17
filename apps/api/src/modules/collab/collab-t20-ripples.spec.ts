// apps/api/src/modules/collab/collab-t20-ripples.spec.ts
// Y0c T20（片 A2 第 8 条三涟漪+第五涟漪+语义定案）先红用例组：
// ① 读者① computePending 增 residentDocs/directConns 显式字段（Z47——禁混入 connections）；
// ② 读者② zeroConnDocs 口径=仅 WS 零且无 direct 持有（Z73——常驻会话持有的 doc 不计，常驻噪声消除）；
// ③ isDocResident 唯一形态=hasActiveWsConnection（Z105——推翻 Z77「∨活跃会话」：仅 WS 连接数>0，
//    与常驻会话无关；无人看=deferred 语义保留——reconcile 5min 不再钉住无人项目）；
// ④ 读者③ auto-vacuum 判据改读（Z73/Z66：零 WS ∧ 零 direct 才触发——常驻会话持有的 doc 不触发）
//    + stacked 计数载体（Z66 计数半边——四稳态③判据面）。
// 直构形态=collab-runtime-metrics.spec buildGateway 同款（collabState='serving'+createMockRepo+
// makeSpoolDir——直灌 documents，库 Document 形状复刻见 seedDoc）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { register } from 'prom-client';
import { CollabGateway, type QuotaConfig } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';   // Y0c T39b 波 2：内部状态访问经 façade（check-collab-test-facade 门禁）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y0c-t20-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => { await spoolCleanup(); vi.restoreAllMocks(); });

/** 直构 gateway（runtime-metrics spec 同款）。 */
function buildGateway() {
  const repo = createMockRepo();
  const spool = new CollabSpoolService(spoolDir);
  spool.setOwner('t20-owner');
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

/** 库 Document 形状复刻（shutdown.spec seedPendingDoc 同款+directConnectionsCount getter——
 *  本组判据消费面：connections.size（WS，esm Map）+directConnectionsCount（direct 合计 esm:590）+
 *  getConnections（server 级 getConnectionsCount 遍历面）。 */
function seedDoc(gateway: CollabGateway, name: string, ws: number, direct: number) {
  const state = { direct };
  const connections = new Map(Array.from({ length: ws }, (_, i) => [`s${i}`, { socketId: `s${i}-${name}` }]));
  const doc = Object.assign(new Y.Doc(), {
    name,
    connections,
    getConnections: () => [...connections.values()] as { socketId: string }[],   // server 级 getConnectionsCount 遍历面（esm:1337 unique socketId 去重）
    saveMutex: { runExclusive: <T,>(fn: () => Promise<T>) => fn() },
  }) as Y.Doc & { directConnectionsCount?: number };
  Object.defineProperty(doc, 'directConnectionsCount', { get: () => state.direct });
  gateway.server.hocuspocus.documents.set(name, doc as never);   // 库 Document 形状复刻（运行时面按需补齐——类型面 cast，shutdown.spec 同惯例）
  return {
    doc,
    setDirect: (n: number) => { state.direct = n; },
    addWs: () => { connections.set(`w${Date.now()}`, { socketId: `w-${name}` }); },
    detach: () => { gateway.server.hocuspocus.documents.delete(name); },
  };
}

/** collect 型 gauge 读数（register.metrics() 文本触发 collect——get() 只读 hashMap 不断言 collect 执行）。 */
async function gaugeValue(name: string): Promise<number> {
  const text = await register.metrics();
  const line = text.split('\n').find((l) => l.startsWith(`${name} `));
  return line ? Number(line.slice(name.length + 1)) : NaN;
}

/** counter 现值（family 求和）。 */
async function counterValue(name: string): Promise<number> {
  const m = register.getSingleMetric(name) as any;
  if (!m) return NaN;   // 红相：指标未注册——NaN≠任何期望值
  return (await m.get()).values.reduce((s: number, v: any) => s + v.value, 0);
}

describe('Y0c T20：三涟漪+第五涟漪+语义定案（Z47/Z73/Z105/Z66 计数半边）', () => {
  it('读者①：computePending 增 residentDocs/directConns 显式字段（Z47——residentDocs=documents.size 库内存 doc 数；directConns=Σ directConnectionsCount graceDirectConnections 同款求和；loadedDocs/connections 既有字段保留同源）', () => {
    const { gateway } = buildGateway();
    seedDoc(gateway, 'project:p-a', 0, 2);   // 常驻会话持有形态（零 WS+2 direct）
    seedDoc(gateway, 'project:p-b', 1, 1);   // 一 WS 用户+一会话
    const p = gateway.computePending();
    expect(p.residentDocs).toBe(2);          // 改造前 undefined——先红
    expect(p.directConns).toBe(3);           // 改造前 undefined——先红
    expect(p.loadedDocs).toBe(2);            // 既有字段：常驻下与 residentDocs 同源（分工见 computePending 口径注释）
    expect(p.connections).toBe(4);           // 既有合计口径=WS 去重(1)+direct(3)——禁重复计
  });

  it('读者②：zeroConnDocs 口径=仅 WS 零且无 direct 持有（Z73——常驻会话持有的 doc 不再计入：常驻后「零连接 doc」从常态噪声回缩为真 stuck 候选池）', async () => {
    const { gateway } = buildGateway();
    seedDoc(gateway, 'project:p-hold', 0, 1);   // 常驻会话持有（零 WS）
    seedDoc(gateway, 'project:p-idle', 0, 0);   // 真零连接
    expect(await gaugeValue('yjs_zero_conn_docs')).toBe(1);   // 改造前=2（常驻持有误计）——先红
  });

  it('isDocResident 唯一形态=hasActiveWsConnection（Z105 推翻 Z77「∨活跃会话」）：常驻会话在（direct≥1）但零 WS ⇒ false（旧 documents.has 形态=true 即红）——无人看=deferred 语义保留；WS 连接在 ⇒ true', () => {
    const { gateway } = buildGateway();
    const held = seedDoc(gateway, 'project:p-r', 0, 1);   // 常驻会话持有、零 WS
    expect(gateway.isDocResident('p-r')).toBe(false);    // 改造前 documents.has=true——先红（Z105 字面）
    held.addWs();
    expect(gateway.isDocResident('p-r')).toBe(true);     // 仅 WS 连接数>0 才真
    held.detach();
    expect(gateway.isDocResident('p-r')).toBe(false);    // doc 不在=false（既有语义面）
  });

  it('读者③：auto-vacuum 判据=零 WS ∧ 零 direct（Z73——常驻会话持有的 doc 不触发 vacuum）+stacked 计数（Z66 计数半边——同 doc 30s 窗内≥2 次触发计数，四稳态③判据面）', async () => {
    const { gateway } = buildGateway();
    const g = gatewayFacade(gateway);
    const held = seedDoc(gateway, 'project:p-vac', 0, 1);   // 冻结 doc 被常驻会话持有（零 WS）
    g.addQuotaFrozen('p-vac');
    g.seedRecheckRounds('p-vac', 4);                        // ≥AUTO_VACUUM_ROUNDS（recheck 内 ++ 后=5）
    g.seedDocResidue('p-vac', 10_000_000);                  // > floor(8MiB×0.6)=5MiB（QUOTA_DEFAULTS.maxDocBytes=8MiB）
    g.spyMeasureTruth().mockReturnValue(16 * 1024 * 1024);   // ≥softEnter(0.8×8MiB)——recheck 分支可达
    g.spyUpdateResidue().mockImplementation(() => {});      // 跳过全根真空重建重活（判据面外）
    const vacuumRunner = vi.fn(async () => {});
    gateway.setVacuumRunner(vacuumRunner);

    gateway.docRegistry.recheckFrozenDocs();   // W3a：DR 公有化直调（cast 消失——偏离 64② 核销兑现）
    expect(vacuumRunner).not.toHaveBeenCalled();   // 改造前 WS-only 判据命中=已调用——先红

    held.setDirect(0);                              // 会话已释放（零 direct）——真零连接
    gateway.docRegistry.recheckFrozenDocs();
    expect(vacuumRunner).toHaveBeenCalledTimes(1);  // 真零连接 ⇒ 触发

    gateway.docRegistry.recheckFrozenDocs();
    expect(vacuumRunner).toHaveBeenCalledTimes(2);  // 连续第 3 轮（30s 窗内形态——测试时钟同点）
    expect(await counterValue('collab_vacuum_autotrigger_stacked_total')).toBeGreaterThanOrEqual(1);   // 指标未注册=NaN 即红（Z66 计数半边随 T20 落地）
  });
});
