// apps/api/src/modules/collab/collab-backpressure.spec.ts
// Y0b-4 T7 真红门——出站背压 wrap（Q-F v2）：决策每 send 判（与 1/10 采样分离）+readFrameType
// 库常量判型（H-5 禁字节猜型）。装置=stub ws（bufferedAmount 手注入——backlog 行为 stub 即可证，
// 不需真连）+直构 gateway（options.spec 先例）。红相锚：①wrapBackpressure 缺失（TypeError）
// ②collab_awareness_dropped_total/collab_slow_consumer_disconnect_total/yjs_outbound_backlog_bytes
// 未定义 ③census ⑤ 生产零 bufferedAmount 命中。
// maxPayload 16MB=零改动验证锚（Q-T v4 撤回 9MB——§7.2 禁回落 ws 默认 100MiB）；越界不变量
// docSize≤maxDocBytes+maxFrameOvershoot 已由 T4 用例承载（collab-quota-gate）——本文件引用不重写。
// R4b'（v3）：判定核迁 OutboundBudget（collab-outbound-budget.ts）——常量改直源 collab-limits
// （gateway 再导出面退役）；新增四档帧型/同步记账/close 释放闭环用例（①close 释放+迟到 cb ②预算
// close ③控制组豁免 ④SyncReply 大帧前瞻 ⑤reconcile per-ws 回填+迟到 cb 钳位〔T6 评审收口〕）。
// census ⑤ 孪生锚零改（读点仍 SG——getBacklog 闭包）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'prom-client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QUOTA_DEFAULTS } from '@flowweb/shared';
import { CollabGateway } from './collab.gateway';
import { BACKPRESSURE_DROP_BYTES, WS_MAX_PAYLOAD_BYTES, DEFAULT_COLLAB_LIMITS, deriveCollabLimits } from './collab-limits';
import { OutboundBudget } from './collab-outbound-budget';
import { CollabSpoolService } from './collab-spool.service';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { makeFrame, makeAwarenessFrame } from '../../test-utils/frame-encoder';

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y0b4-bp-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => spoolCleanup());

function buildGateway(): CollabGateway {
  return new CollabGateway(
    {} as any, new EventEmitter2() as any, {} as any, createLeaseStub() as any,
    { resolve: vi.fn() } as any,
    49000 + Math.floor(Math.random() * 4000),
    undefined, undefined, undefined, new CollabSpoolService(spoolDir),
  );
}

/** stub ws：bufferedAmount 手注入+send/close 落账（wrap 后 sent/closeCalls 记录真实投递面）。
 *  R4b'：send 加 cb 参数（存 cbs **不自动调**——预扣驻留供释放用例驱动）；once 注册 close 监听；
 *  close() 触发监听（close 兜底释放用例的闭环前提）。 */
function makeStubWs(bufferedAmount: number) {
  const closeCbs: Array<() => void> = [];
  return {
    bufferedAmount,
    sent: [] as unknown[],
    closeCalls: [] as Array<{ code: number; reason: string }>,
    cbs: [] as Array<(err?: Error) => void>,
    send(this: any, data: unknown, cb?: (err?: Error) => void) { this.sent.push(data); if (cb) this.cbs.push(cb); },
    close(this: any, code: number, reason: string) { this.closeCalls.push({ code, reason }); for (const cb of closeCbs) cb(); },
    once(_event: string, cb: () => void) { closeCbs.push(cb); },
  };
}
type StubWs = ReturnType<typeof makeStubWs>;

const wrap = (gw: CollabGateway, ws: StubWs): void => gw.sessionGuard.wrapBackpressure({ webSocket: ws });

/** prom-client 计数现值（rate-gate 同款） */
async function counterOf(name: string, labels: Record<string, string> = {}): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  if (!metric) throw new Error(`metric ${name} 未定义（T7 未实现——红相）`);
  return (await metric.get()).values.find((s: any) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value ?? 0;
}
async function metricDelta(name: string, labels: Record<string, string>, fn: () => Promise<unknown> | unknown): Promise<number> {
  const before = await counterOf(name, labels);
  await fn();
  return (await counterOf(name, labels)) - before;
}
/** 直方图观测次数（_count 采样） */
async function observeCountOf(name: string): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  if (!metric) throw new Error(`metric ${name} 未定义（T7 未实现——红相）`);
  return (await metric.get()).values.find((s: any) => s.metricName === `${name}_count`)?.value ?? 0;
}
/** gauge 现值（R4b'——yjs_outbound_queued_bytes 观测：release/onClose/reconcile 均单点 set） */
async function gaugeValue(name: string): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  if (!metric) throw new Error(`metric ${name} 未定义（R4b' 未实现——红相）`);
  return (await metric.get()).values[0]?.value ?? 0;
}

describe('Y0b-4 T7 出站背压 wrap（Q-F v2：每 send 判+决策/采样分离）', () => {
  it('一级：bufferedAmount>1MB 且出站为 awareness（IncomingMessage/MessageType 解析判型）→drop+计数；sync 帧同 backlog 照发（sync/stateless 永不 drop——doc 同步不可丢）；解析异常 null=放行', async () => {
    const gw = buildGateway();
    const ws = makeStubWs(BACKPRESSURE_DROP_BYTES + 512 * 1024);   // >1MB 恒真
    wrap(gw, ws);
    const dropped = await metricDelta('collab_awareness_dropped_total', {}, async () => {
      ws.send(makeAwarenessFrame('project:bp1', [{ clientId: 7, clock: 1, state: { cursor: { x: 1 } } }]));
      ws.send(makeAwarenessFrame('project:bp1', [{ clientId: 7, clock: 2, state: { cursor: { x: 2 } } }]));
    });
    expect(dropped).toBe(2);                       // awareness 两帧全 drop（决策每 send 判）
    expect(ws.sent).toHaveLength(0);               // 零投递
    expect(ws.closeCalls).toHaveLength(0);         // 一级不 close
    // sync 帧同 backlog 照发（Update 载荷）
    ws.send(makeFrame('project:bp1', 0 /* Sync */, 2 /* Update */, new Uint8Array([1, 2, 3])));
    expect(ws.sent).toHaveLength(1);
    // 判型异常（垃圾字节非帧形）=null=放行——边界安全
    ws.send(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
    expect(ws.sent).toHaveLength(2);
  }, 15_000);

  it('二级：>4MB 每次 send 判（非 1/10 采样——停滞 socket 两 send 间堆帧场景：非采样点第 4 发即 close）→立即 close(1011)+collab_ws_close_total 同点计数；backlog≤4MB 不 close', async () => {
    const gw = buildGateway();
    const ws = makeStubWs(512 * 1024);
    wrap(gw, ws);
    ws.send(makeFrame('project:bp2', 0, 2, new Uint8Array([1])));   // sends=1
    ws.send(makeFrame('project:bp2', 0, 2, new Uint8Array([2])));   // sends=2
    ws.send(makeFrame('project:bp2', 0, 2, new Uint8Array([3])));   // sends=3——非采样点（%10≠0）
    ws.bufferedAmount = DEFAULT_COLLAB_LIMITS.backpressureCloseBytes + 1 * 1024 * 1024;  // >close（两 send 间堆积——停滞 socket）
    const closed = await metricDelta('collab_slow_consumer_disconnect_total', {}, async () => {
      ws.send(makeFrame('project:bp2', 0, 2, new Uint8Array([4])));   // 第 4 发（若决策进采样须等第 10 发——红相）
    });
    expect(closed).toBe(1);
    expect(ws.closeCalls).toEqual([{ code: 1011, reason: 'slow-consumer' }]);   // CollabCloseCode.SLOW_CONSUMER
    expect(ws.sent).toHaveLength(3);               // 触发帧不投递
    // ws 级 close 计数同点（hardCloseWs——collab_ws_close_total{code='1011'}）
    expect(await counterOf('collab_ws_close_total', { code: '1011', reason: 'slow-consumer' })).toBeGreaterThanOrEqual(1);
    // 边界反例（R4b' 前瞻语义改写）：大帧组判定=backlog+frameBytes>close——backlog 留 1MB 余量
    // 时小 sync 帧仍照发（恰等/越界才关；等值钉死见 collab-limits.spec 满帧边界算术）
    const ws2 = makeStubWs(DEFAULT_COLLAB_LIMITS.backpressureCloseBytes - 1024 * 1024);
    wrap(gw, ws2);
    ws2.send(makeFrame('project:bp2', 0, 2, new Uint8Array([9])));
    expect(ws2.sent).toHaveLength(1);
    expect(ws2.closeCalls).toHaveLength(0);
  }, 15_000);

  it('直方图 1/10 采样只归观测（决策与采样分离）：20 发 sync 恰 2 观测；10 帧 awareness 全 drop（决策不进采样——采样点帧也判）且 drop 帧不计观测', async () => {
    const gw = buildGateway();
    const ws = makeStubWs(600 * 1024);   // <1MB——纯观测路径
    wrap(gw, ws);
    const before = await observeCountOf('yjs_outbound_backlog_bytes');
    for (let i = 0; i < 20; i++) ws.send(makeFrame('project:bp3', 0, 2, new Uint8Array([i])));
    expect(ws.sent).toHaveLength(20);
    expect((await observeCountOf('yjs_outbound_backlog_bytes')) - before).toBe(2);   // 第 10/20 发各一次
    // 决策不进采样：>1MB 下连发 10 帧 awareness——若决策挂采样（%10）则仅 1 帧 drop；全 drop=每 send 判
    ws.bufferedAmount = BACKPRESSURE_DROP_BYTES + 1;
    const dropped = await metricDelta('collab_awareness_dropped_total', {}, async () => {
      for (let i = 0; i < 10; i++) ws.send(makeAwarenessFrame('project:bp3', [{ clientId: 9, clock: i, state: { i } }]));
    });
    expect(dropped).toBe(10);
    expect(ws.sent).toHaveLength(20);              // 零新增投递
  }, 15_000);

  it('census ⑤：bufferedAmount 生产单源——apps/api/src 非测试文件仅 collab-session-guard.service.ts 命中 `.bufferedAmount`（wrap 决策唯一读点 W3b 随域迁 SG；spec 装置允许）', () => {
    // T41 W3b 锚随迁（偏离 73——设计 §8.3 表列漏位：本 spec 内 census ⑤ 孪生锚未列于四锚清单，
    // 但 §8.2 ⑤ 已裁 census 目标文件 gateway→SG，本 spec 孪生锚同批切换=机械随迁）。扫描词面
    // `bufferedAmount`→`.bufferedAmount`（属性读=生产读点）：gateway CollabConnection 结构面
    // `bufferedAmount?: number` 类型声明留 gateway（W3a 共消费类型裁决），裸词双命中=假红；`.` 前缀
    // 精确隔离读点（census ⑤ 脚本同款收窄，判别力不降——唯一读点=SG wrapBackpressure）。
    const src = join(process.cwd(), 'src');   // cwd=包根（body-param-ratchet.spec 同款先例）
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (e.endsWith('.ts') && !e.endsWith('.spec.ts') && readFileSync(p, 'utf8').includes('.bufferedAmount')) hits.push(e);
      }
    };
    walk(src);
    expect(hits).toEqual(['collab-session-guard.service.ts']);
  }, 15_000);

  it('maxPayload 维持 16MB（Q-T v4 撤回 9MB——零改动验证：Server 配置读回）；越界不变量 docSize≤maxDocBytes+maxFrameOvershoot 归 T4 用例（collab-quota-gate）不重写', () => {
    const gw = buildGateway();
    expect(gw.server.configuration.websocketOptions).toEqual({ maxPayload: 16 * 1024 * 1024 });   // §7.2 禁回落 ws 默认 100MiB
  }, 15_000);
});

describe("R4b' OutboundBudget 判定核（v3：四档帧型+同步记账+close 释放闭环）", () => {
  it('①close 兜底释放+迟到 cb 不复活：发帧不调 cb（预扣驻留）→ws.close()→queuedBytes 一次归零；close 后迟到 cb 调用禁复活 Map（release 幂等护栏）', async () => {
    const gw = buildGateway();
    const ws = makeStubWs(600 * 1024);
    wrap(gw, ws);
    ws.send(makeFrame('project:bp5', 0, 2, new Uint8Array([1, 2, 3])));
    expect(await gaugeValue('yjs_outbound_queued_bytes')).toBeGreaterThan(0);   // cb 未回调——预扣驻留
    ws.close(1000, 'test');
    expect(await gaugeValue('yjs_outbound_queued_bytes')).toBe(0);   // close 兜底：整连接残账一次释放+台账摘除
    for (const cb of ws.cbs) cb();   // 迟到 cb（close 后）——onClose 已摘除，release 早退不复活不漂移
    expect(await gaugeValue('yjs_outbound_queued_bytes')).toBe(0);
  }, 15_000);

  it('②全局预算 close：小 budget 实例多 stub 连发超限→close(1011 global-budget) 不投递+collab_outbound_budget_close_total 唯一计数（ws_close 事件计数由 hardCloseWs 承——去双计）', async () => {
    const limits = deriveCollabLimits({ ...QUOTA_DEFAULTS, maxDocBytes: 4096 }, 5 * 1024 * 1024);
    const budget = new OutboundBudget(limits);
    const w1 = makeStubWs(0), w2 = makeStubWs(0);
    budget.wrap(w1, (w, code, reason) => w.close(code, reason), () => 0);
    budget.wrap(w2, (w, code, reason) => w.close(code, reason), () => 0);
    const payload = new Uint8Array(1024 * 1024);
    const closed = await metricDelta('collab_outbound_budget_close_total', {}, () => {
      for (let i = 0; i < 4; i++) w1.send(makeFrame('project:bp6', 0, 2, payload));   // 4MiB 界内
      w2.send(makeFrame('project:bp6', 0, 2, payload));   // 第 5 MiB——total+frame>budget 触发
    });
    expect(closed).toBe(1);
    expect(w1.sent).toHaveLength(4);
    expect(w2.sent).toHaveLength(0);   // 预算失败帧不投递
    expect(w2.closeCalls).toEqual([{ code: 1011, reason: 'global-budget' }]);
  }, 15_000);

  it('③控制组不前瞻+预算豁免：backlog=close-1 发 20B stateless 帧→照投不 close（+20B 不前瞻——心跳反杀根修）且 queuedBytes 不计账（状态通道永不因预算静默丢）', async () => {
    const budget = new OutboundBudget(DEFAULT_COLLAB_LIMITS);
    const ws = makeStubWs(DEFAULT_COLLAB_LIMITS.backpressureCloseBytes - 1);
    budget.wrap(ws, (w, code, reason) => w.close(code, reason), () => ws.bufferedAmount);
    const before = await gaugeValue('yjs_outbound_queued_bytes');   // gauge 全局共享——豁免断言用前后差（本实例不 set）
    ws.send(makeFrame('project:bp7', 5 /* Stateless */, null, 'x'));
    expect(ws.sent).toHaveLength(1);
    expect(ws.closeCalls).toHaveLength(0);
    expect(await gaugeValue('yjs_outbound_queued_bytes')).toBe(before);   // 预算豁免——控制帧不进记账（零 set）
  }, 15_000);

  it('④大帧组前瞻（v3 漏网根修证据）：backlog=close-1 发 8MB SyncReply 帧（SS1 回复携全 doc diff 载体——v2 漏归=上界失效）→backlog+frame>close 即 close(1011) 不投递', async () => {
    const budget = new OutboundBudget(DEFAULT_COLLAB_LIMITS);
    const ws = makeStubWs(DEFAULT_COLLAB_LIMITS.backpressureCloseBytes - 1);
    budget.wrap(ws, (w, code, reason) => w.close(code, reason), () => ws.bufferedAmount);
    const frame = makeFrame('project:bp8', 4 /* SyncReply */, 1 /* SyncStep2 */, new Uint8Array(8 * 1024 * 1024));
    expect(frame.byteLength).toBeLessThan(WS_MAX_PAYLOAD_BYTES);   // 8MB 帧在 maxPayload 界内=合法帧
    const closed = await metricDelta('collab_slow_consumer_disconnect_total', {}, () => ws.send(frame));
    expect(closed).toBe(1);
    expect(ws.closeCalls).toEqual([{ code: 1011, reason: 'slow-consumer' }]);
    expect(ws.sent).toHaveLength(0);   // 触发帧不投递
  }, 30_000);

  it('⑤reconcile per-ws 回填+迟到 cb 钳位（T6 评审 Important-1——v3 记账头条「total≡Σper-ws 永不漂移」补证）：两 stub（backlog 3MB/2MB）各发 Sync 帧不调 cb（预扣驻留）→reconcile 后 queuedBytes=5MB（reserved 逐连接回填 getBacklog 基线=Σbacklog）；再调迟到 cb（release 帧字节>回填基线=双扣近似）→Math.max(0,…) 钳位 queuedBytes 不为负（偏差有界——60s 对账自愈）', async () => {
    const budget = new OutboundBudget(DEFAULT_COLLAB_LIMITS);
    const w1 = makeStubWs(3 * 1024 * 1024), w2 = makeStubWs(2 * 1024 * 1024);
    budget.wrap(w1, (w, code, reason) => w.close(code, reason), () => w1.bufferedAmount);
    budget.wrap(w2, (w, code, reason) => w.close(code, reason), () => w2.bufferedAmount);
    const f1 = makeFrame('project:bp9', 0 /* Sync */, 2 /* Update */, new Uint8Array(6 * 1024 * 1024));   // 6MB 帧（<close 16.9MB 界内——3MB backlog+6MB 前瞻不触发）
    const f2 = makeFrame('project:bp9', 0 /* Sync */, 2 /* Update */, new Uint8Array(1024));
    w1.send(f1); w2.send(f2);   // cb 不调——预扣驻留（total=Σ帧字节）
    expect(budget.queuedBytes).toBe(f1.byteLength + f2.byteLength);
    budget.reconcile();
    expect(budget.queuedBytes).toBe(5 * 1024 * 1024);   // per-ws 回填=getBacklog 基线：3MB+2MB——total≡Σper-ws 不漂移
    expect(await gaugeValue('yjs_outbound_queued_bytes')).toBe(5 * 1024 * 1024);   // reconcile 单点 set 同步仪表
    w1.cbs[0]!();   // 迟到 cb：release 6MB 帧字节>回填基线 3MB——双扣近似（cb 抵达晚于对账）
    expect(budget.queuedBytes).toBe(0);   // 钳位兜底（无 Math.max 则 5MB-6MB=-1MB 透负）——偏差有界至多一帧
    expect(await gaugeValue('yjs_outbound_queued_bytes')).toBe(0);
    expect(w1.closeCalls).toHaveLength(0);   // 钳位路径零误杀
  }, 30_000);
});
