// apps/api/src/modules/collab/collab-backpressure.spec.ts
// Y0b-4 T7 真红门——出站背压 wrap（Q-F v2）：决策每 send 判（与 1/10 采样分离）+readFrameType
// 库常量判型（H-5 禁字节猜型）。装置=stub ws（bufferedAmount 手注入——backlog 行为 stub 即可证，
// 不需真连）+直构 gateway（options.spec 先例）。红相锚：①wrapBackpressure 缺失（TypeError）
// ②collab_awareness_dropped_total/collab_slow_consumer_disconnect_total/yjs_outbound_backlog_bytes
// 未定义 ③census ⑤ 生产零 bufferedAmount 命中。
// maxPayload 16MB=零改动验证锚（Q-T v4 撤回 9MB——§7.2 禁回落 ws 默认 100MiB）；越界不变量
// docSize≤maxDocBytes+maxFrameOvershoot 已由 T4 用例承载（collab-quota-gate）——本文件引用不重写。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'prom-client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CollabGateway, BACKPRESSURE_DROP_BYTES, BACKPRESSURE_CLOSE_BYTES } from './collab.gateway';
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

/** stub ws：bufferedAmount 手注入+send/close 落账（wrap 后 sent/closeCalls 记录真实投递面） */
function makeStubWs(bufferedAmount: number) {
  return {
    bufferedAmount,
    sent: [] as unknown[],
    closeCalls: [] as Array<{ code: number; reason: string }>,
    send(this: any, data: unknown) { this.sent.push(data); },
    close(this: any, code: number, reason: string) { this.closeCalls.push({ code, reason }); },
  };
}
type StubWs = ReturnType<typeof makeStubWs>;

const wrap = (gw: CollabGateway, ws: StubWs): void => (gw as any).wrapBackpressure({ webSocket: ws });

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
    ws.bufferedAmount = BACKPRESSURE_CLOSE_BYTES + 1 * 1024 * 1024;  // >4MB（两 send 间堆积——停滞 socket）
    const closed = await metricDelta('collab_slow_consumer_disconnect_total', {}, async () => {
      ws.send(makeFrame('project:bp2', 0, 2, new Uint8Array([4])));   // 第 4 发（若决策进采样须等第 10 发——红相）
    });
    expect(closed).toBe(1);
    expect(ws.closeCalls).toEqual([{ code: 1011, reason: 'slow-consumer' }]);   // CollabCloseCode.SLOW_CONSUMER
    expect(ws.sent).toHaveLength(3);               // 触发帧不投递
    // ws 级 close 计数同点（hardCloseWs——collab_ws_close_total{code='1011'}）
    expect(await counterOf('collab_ws_close_total', { code: '1011', reason: 'slow-consumer' })).toBeGreaterThanOrEqual(1);
    // 边界反例：恰 4MB（≤CLOSE 阈）不 close 只走一级判（sync 帧照发）
    const ws2 = makeStubWs(BACKPRESSURE_CLOSE_BYTES);
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

  it('census ⑤：bufferedAmount 生产单源——apps/api/src 非测试文件仅 collab.gateway.ts 命中（wrap 决策唯一读点；spec 装置允许）', () => {
    const src = join(process.cwd(), 'src');   // cwd=包根（body-param-ratchet.spec 同款先例）
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (e.endsWith('.ts') && !e.endsWith('.spec.ts') && readFileSync(p, 'utf8').includes('bufferedAmount')) hits.push(e);
      }
    };
    walk(src);
    expect(hits).toEqual(['collab.gateway.ts']);
  }, 15_000);

  it('maxPayload 维持 16MB（Q-T v4 撤回 9MB——零改动验证：Server 配置读回）；越界不变量 docSize≤maxDocBytes+maxFrameOvershoot 归 T4 用例（collab-quota-gate）不重写', () => {
    const gw = buildGateway();
    expect(gw.server.configuration.websocketOptions).toEqual({ maxPayload: 16 * 1024 * 1024 });   // §7.2 禁回落 ws 默认 100MiB
  }, 15_000);
});
