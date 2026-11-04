// apps/api/src/modules/collab/collab-write.port.http.spec.ts
// Y0c T24（Z99）→Y1c T32：HttpCollabWritePort——worker 形态写端口（走内部端点，结果三分契约）。
// 三分（Z99 字面）：瞬态（503/COLLAB_NOT_SERVING/真空窗/租约失守/网络错误族）⇒预算内退避重试，
// 耗尽后**绝不上抛到 job**（作业成败由生成结果决定，不由投影写决定；attempts:1 维持）；
// 永久（token 失配/404/schema 拒）⇒计数告警不上抛。readCanvas=计费读 fail-closed（E49）——
// 503 显式传递（throw SUE），区别于投影写的绝不上抛。
// T32 改造注记：writeExecStatus 改道 POST /api/collab/doc/exec-status 端点（RuntimeEvent feed
// 写——write-batch 端点/doc 批写面退役）；writeOpsBatch/HttpCollabDocWriter/typed 异常族用例
// 随令牌删除（writeBatch worker 形态零消费）。
// 第一验收锚（先红——spec Z99/plan T24）：注入 503 ⇒ rollbackDeliveryFailed 零调用+job 不失败。
import { describe, it, expect, vi } from 'vitest';
import { register } from 'prom-client';
import { ServiceUnavailableException } from '@nestjs/common';
import { HttpCollabWritePort } from './collab-write.port';
import { ExecutionService } from '../execution/execution.service';

/** 结构化响应装置（port 只读 status+json——plain object 免环境依赖）。 */
function res(status: number, body?: unknown) {
  return { status, json: async () => body };
}

/** collab_write_http_outcome_total{method,outcome} 增量读取。 */
async function outcomeDelta(method: string, outcome: string, fn: () => Promise<unknown> | unknown): Promise<number> {
  const metric: any = register.getSingleMetric('collab_write_http_outcome_total');
  const read = async () =>
    (await metric.get()).values.find((v: any) => v.labels.method === method && v.labels.outcome === outcome)?.value ?? 0;
  const before = await read();
  await fn();
  return (await read()) - before;
}

/** 快速端口装置（backoffBaseMs=1——退避不拖测试墙钟）。 */
function fastPort(fetchImpl: ReturnType<typeof vi.fn>, opts: { maxAttempts?: number; token?: string } = {}) {
  return new HttpCollabWritePort({ fetchImpl: fetchImpl as any, backoffBaseMs: 1, ...opts });
}

describe('HttpCollabWritePort（Z99 三分契约——真走 HTTP=writeExecStatus/readCanvas〔T32 后两方法〕）', () => {
  it('瞬态收敛：503×2 后 200——预算内退避重试后成功（exec-status 单条请求面——worker 唯一写面）', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(200, { written: true }));
    const port = fastPort(fetchImpl, { maxAttempts: 3 });
    await expect(port.writeExecStatus('p1', 'n1', { status: 'loading', attempts: 0 })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // 请求面（Y1c T32）：exec-status 端点+{projectId,nodeId,patch} 单条 body（原 write-batch 单 op 批退役）
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/api/collab/doc/exec-status');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ projectId: 'p1', nodeId: 'n1', patch: { status: 'loading', attempts: 0 } });
  });

  it('writeExecStatus 持续 503：resolve（void）不上抛+计数——投影写不决定作业成败', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(503));
    const port = fastPort(fetchImpl, { maxAttempts: 2 });
    const d = await outcomeDelta('writeExecStatus', 'transient-exhausted', () => port.writeExecStatus('p1', 'n1', { status: 'done', attempts: 1 }));
    expect(d).toBe(1);
    await expect(port.writeExecStatus('p1', 'n1', { status: 'done', attempts: 1 })).resolves.toBeUndefined();
  });

  it('网络错误（ECONNREFUSED 族 fetch reject）：同瞬态重试族——预算耗尽 resolve 不上抛（writeExecStatus 投影写不决定作业成败）', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
    const port = fastPort(fetchImpl, { maxAttempts: 2 });
    await expect(port.writeExecStatus('p1', 'n1', { status: 'loading', attempts: 0 })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('readCanvas 503 持续：显式传递 503（throw ServiceUnavailableException——计费读 fail-closed E49，区别于投影写）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(503));
    const port = fastPort(fetchImpl, { maxAttempts: 2 });
    await expect(port.readCanvas('p1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('readCanvas 200：{nodes,edges} 透传（GET 读端点）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, { nodes: [{ id: 'n1' }], edges: [] }));
    const port = fastPort(fetchImpl);
    const out = await port.readCanvas('p1');
    expect(out).toEqual({ nodes: [{ id: 'n1' }], edges: [] });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/api/collab/doc/p1/canvas');
    expect(init.method).toBe('GET');
  });

  it('NotImplemented 显式面：withDoc/isDocResident——worker 不消费（Z100 实测）显式抛错且零 fetch', () => {
    const fetchImpl = vi.fn();
    const port = fastPort(fetchImpl);
    expect(() => port.withDoc('p1', () => 1)).toThrow(/NotImplemented.*withDoc/);
    expect(() => port.isDocResident('p1')).toThrow(/NotImplemented.*isDocResident/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Y0c T25：isLeaseServing=门放行（恒 true 零 fetch）——worker 受理判据由端点 503 显式传递承担（Z99 三分/Z102③）', async () => {
    const fetchImpl = vi.fn();
    const port = fastPort(fetchImpl);
    expect(port.isLeaseServing()).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('WORKER_WRITE_TOKEN 预留参数：token 提供时 Authorization: Bearer 头携带（T27 服务端鉴权对齐）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, { written: true }));
    const port = fastPort(fetchImpl, { token: 'tok-1' });
    await port.writeExecStatus('p1', 'n1', { status: 'loading', attempts: 0 });
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer tok-1');
  });

  it('T13 scope 铸造：token 配置时写请求携带 x-worker-scope 头（scope=claim 上下文→HMAC 绑定 projectId+intentRowId+execSeq+exp；缺省=裸项目档）', async () => {
    const { verifyWorkerScopeToken, WORKER_SCOPE_HEADER } = await import('./worker-scope-token');
    const fetchImpl = vi.fn().mockResolvedValue(res(200, { written: true }));
    const port = fastPort(fetchImpl, { token: 'tok-scope-1' });
    await port.writeExecStatus('p1', 'n1', { status: 'loading', attempts: 1 }, { intentRowId: 'gi-9', execSeq: '31' });
    const headers = fetchImpl.mock.calls[0][1].headers;
    const v = verifyWorkerScopeToken('tok-scope-1', headers[WORKER_SCOPE_HEADER]);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.payload).toMatchObject({ p: 'p1', i: 'gi-9', s: '31' });
    // 裸档（pre-claim 断言路径——无 intent 行可绑）
    await port.writeExecStatus('p1', 'n1', { status: 'error', attempts: 0 });
    const bare = verifyWorkerScopeToken('tok-scope-1', fetchImpl.mock.calls[1][1].headers[WORKER_SCOPE_HEADER]);
    expect(bare.ok).toBe(true);
    if (bare.ok) { expect(bare.payload.i).toBe(''); expect(bare.payload.p).toBe('p1'); }
  });
});

describe('Z99 第一验收锚（先红锚）：注入 503 ⇒ rollbackDeliveryFailed 零调用+job 不失败', () => {
  it('503 全程持续（writeExecStatus 全部瞬态耗尽——worker 唯一投影写面）：runNodeLifecycle 完成（外呼完成+零 throw+errors 空）∧ rollbackDeliveryFailed 零调用', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(503));
    const port = new HttpCollabWritePort({ fetchImpl: fetchImpl as any, maxAttempts: 2, backoffBaseMs: 1 });
    const rollbackDeliveryFailed = vi.fn().mockResolvedValue(true);
    const teamCredit = {
      reserve: vi.fn().mockResolvedValue({ success: true, mayCall: true }),
      settle: vi.fn().mockResolvedValue({ success: true }),
      void_: vi.fn().mockResolvedValue(undefined),
      getBalanceView: vi.fn().mockResolvedValue({ credits: 95, subscriptionCredits: 0, total: 95 }),
      rollbackDeliveryFailed,   // 锚断言对象：503 瞬态禁入退款腿（误退款防线）
    };
    const apiCaller = { callImageGen: vi.fn().mockResolvedValue({ url: 'http://x/img.png' }) };
    const intentSvc = {
      claim: vi.fn().mockResolvedValue({ created: true, result: 'new', intent: { id: 'ir1', intentId: 'i1', attempts: 1, execSeq: 1n, providerTaskId: null } }),
      complete: vi.fn().mockResolvedValue(1),
      fail: vi.fn().mockResolvedValue(undefined),
      void_: vi.fn().mockResolvedValue(undefined),
      reanchorDeadline: vi.fn().mockResolvedValue(1),
      touchHeartbeat: vi.fn().mockResolvedValue(undefined),
      ensureProviderRequestId: vi.fn().mockResolvedValue('rid-t9'), // T9 write-ahead
      observeNodeExecution: vi.fn().mockResolvedValue(undefined),   // Y1c T23 收口 I-1(spec)：NodeExecution 观测锚（统一迁 GenerationIntentService）
      recordProviderTaskId: vi.fn().mockResolvedValue(undefined),   // T9 taskId 落库
      tickFence: vi.fn().mockResolvedValue(undefined),              // T9 onTick 双职+代际
    };
    const emitPort = { emitNodeStatus: vi.fn() };   // T24 改道后消费面注入 EmitPort（锚与 emit 面正交）
    const svc = new ExecutionService(
      { generationIntent: { findUnique: vi.fn().mockResolvedValue(null) } } as any,   // prisma（B-1 分支读态——不触）
      { collectUpstreamData: vi.fn().mockResolvedValue({ textContents: [], imageMediaId: undefined }) } as any,   // topology（Y1a T8：async+身份形态）
      {} as any,                                                                                          // validation
      apiCaller as any,                                                                                   // apiCaller
      teamCredit as any,                                                                                  // teamCredit
      {} as any,                                                                                          // perm
      port,                                                                                               // collabDoc=Http 形态（503 注入）
      emitPort as any,                                                                                    // emit 端口
      intentSvc as any,                                                                                   // intentService
      { readUpstreamMediaId: vi.fn().mockResolvedValue(null), canonicalizeMediaRef: vi.fn().mockResolvedValue(undefined), resolveCallUrl: vi.fn().mockResolvedValue(undefined) } as any,   // upstreamMedia（Y1a T8）
      { commitImage: vi.fn().mockResolvedValue({ outcome: 'committed', mediaId: 'media-t10' }), finalizeText: vi.fn().mockResolvedValue({ outcome: 'committed' }), finalizeVideo: vi.fn().mockResolvedValue({ outcome: 'committed', mediaId: 'media-t12' }) } as any,   // T10/T12 artifactCommit（本用例焦点=503 全程投影面——stub 直通）,
    undefined as never,   // Y1c T21：ExecutionRequestService（spec 不触达）
    );
    const errors: unknown[] = [];
    const results: unknown[] = [];
    await (svc as any).runNodeLifecycle({
      projectId: 'p1', node: { id: 'n1', type: 'imageGen', data: { model: 'm1' } }, userId: 'u1',
      gestureToken: undefined, jobId: undefined, traceId: undefined, teamId: 't1',
      planMap: new Map([['n1', { creditCost: 5 }]]),
      upstreamSource: [], allEdges: [], styleTextOf: () => '',
      results, errors, onDeducted: () => {},
    });
    // 锚三断言：①零退款 ②job 不失败（零 throw+节点零 error+外呼完成）③外呼/结算照常（作业成败由生成结果决定）
    expect(rollbackDeliveryFailed).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    expect(apiCaller.callImageGen).toHaveBeenCalledTimes(1);
    // T10：image 腿 settle 归 finalize 单事务（stub 直通 committed）——settle 直调零
    expect(teamCredit.settle).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
  });
});
