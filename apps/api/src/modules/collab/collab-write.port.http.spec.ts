// apps/api/src/modules/collab/collab-write.port.http.spec.ts
// Y0c T24（Z99）：HttpCollabWritePort——worker 形态写端口（走内部端点，结果三分契约）。
// 三分（Z99 字面）：瞬态（503/COLLAB_NOT_SERVING/真空窗/租约失守/网络错误族）⇒预算内退避重试，
// 耗尽后**绝不上抛到 job**（作业成败由生成结果决定，不由投影写决定；attempts:1 维持）；
// 业务 written:false（端点 200 业务响应）⇒原样传递（退款终态链唯一凭据——HTTP 侧 written:false 唯一
// 生产者）；永久（token 失配/404/schema 拒）⇒计数告警不上抛。readCanvas=计费读 fail-closed（E49）——
// 503 显式传递（throw SUE），区别于投影写的绝不上抛。
// 第一验收锚（先红——spec Z99/plan T24）：注入 503 ⇒ rollbackDeliveryFailed 零调用+job 不失败——
// 以端口单测+execution.service 既有 rollbackDeliveryFailed 调用链 mock 断言落锚（processor 全链归 T25 改道后）。
import { describe, it, expect, vi } from 'vitest';
import { register } from 'prom-client';
import { ServiceUnavailableException } from '@nestjs/common';
import { HttpCollabWritePort, HttpCollabDocWriter } from './collab-write.port';
import { CollabDocWriterService } from './collab-doc-writer.service';
import { docWriterStubOf } from './test-utils/doc-writer-stub';
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

describe('HttpCollabWritePort（Z99 三分契约——真走 HTTP=writeNodeData/writeExecStatus/readCanvas）', () => {
  it('瞬态收敛：503×2 后 200——预算内退避重试后成功，written 结果透传', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(200, [{ index: 0, op: 'writeNodeData', written: true }]));
    const port = fastPort(fetchImpl, { maxAttempts: 3 });
    const out = await port.writeNodeData('p1', 'n1', { resultUrl: 'http://x/1.png' });
    expect(out).toEqual({ written: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // 请求面：write-batch 单端点（P8）+writeNodeData 单 op 批
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/api/collab/doc/write-batch');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).ops[0]).toEqual({ op: 'writeNodeData', nodeId: 'n1', patch: { resultUrl: 'http://x/1.png' } });
  });

  it('持续 503：预算耗尽 ⇒ writeNodeData 绝不上抛（resolve 非 reject）且 written≠false——written:false 唯一生产者=端点业务响应（防误退款）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(503));
    const port = fastPort(fetchImpl, { maxAttempts: 2 });
    const d = await outcomeDelta('writeNodeData', 'transient-exhausted', () => port.writeNodeData('p1', 'n1', { a: 1 }));
    expect(d).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 预算上界执法（有限次）
    await expect(port.writeNodeData('p1', 'n1', { a: 1 })).resolves.toMatchObject({ written: true }); // 不上抛+不进退款腿
  });

  it('writeExecStatus 持续 503：resolve（void）不上抛+计数——投影写不决定作业成败', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(503));
    const port = fastPort(fetchImpl, { maxAttempts: 2 });
    const d = await outcomeDelta('writeExecStatus', 'transient-exhausted', () => port.writeExecStatus('p1', 'n1', { status: 'done', attempts: 1 }));
    expect(d).toBe(1);
    await expect(port.writeExecStatus('p1', 'n1', { status: 'done', attempts: 1 })).resolves.toBeUndefined();
  });

  it('网络错误（ECONNREFUSED 族 fetch reject）：同瞬态重试族——预算耗尽 resolve 不上抛', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
    const port = fastPort(fetchImpl, { maxAttempts: 2 });
    await expect(port.writeNodeData('p1', 'n1', { a: 1 })).resolves.toMatchObject({ written: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('业务 written:false（200 端点业务响应）：原样传递不重试（fetch 恰一次）——退款终态链凭据', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, [{ index: 0, op: 'writeNodeData', written: false, reason: 'node-deleted' }]));
    const port = fastPort(fetchImpl);
    const out = await port.writeNodeData('p1', 'n1', { fileId: 'm1' });
    expect(out).toEqual({ written: false, reason: 'node-deleted' });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 业务合法失败不重试（Z99 分义：重试=错误退款方向）
  });

  it('永久（401 token 失配）：计数+不上抛+不重试（fetch 恰一次）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(401));
    const port = fastPort(fetchImpl);
    const d = await outcomeDelta('writeNodeData', 'permanent:401', () => port.writeNodeData('p1', 'n1', { a: 1 }));
    expect(d).toBe(1);
    await expect(port.writeNodeData('p1', 'n1', { a: 1 })).resolves.toMatchObject({ written: true }); // 不上抛（计数告警承担）
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

  it('NotImplemented 显式面：withDoc/isDocResident/probeArtifacts——worker 不消费（Z100 实测）显式抛错且零 fetch', async () => {
    const fetchImpl = vi.fn();
    const port = fastPort(fetchImpl);
    expect(() => port.withDoc('p1', () => 1)).toThrow(/NotImplemented.*withDoc/);
    expect(() => port.isDocResident('p1')).toThrow(/NotImplemented.*isDocResident/);
    await expect(port.probeArtifacts('p1', [{ nodeId: 'n1', kind: 'text' }])).rejects.toThrow(/NotImplemented.*probeArtifacts/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Y0c T25：isLeaseServing=门放行（恒 true 零 fetch）——worker 受理判据由端点 503 显式传递承担（Z99 三分/Z102③「正确性由三分语义承担，不由启动顺序承担」：readCanvas fail-closed E49 在首个端点调用点 503 显式 throw，execution.service :155 前置门在 worker 侧冗余）', async () => {
    const fetchImpl = vi.fn();
    const port = fastPort(fetchImpl);
    expect(port.isLeaseServing()).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('WORKER_WRITE_TOKEN 预留参数：token 提供时 Authorization: Bearer 头携带（T27 服务端鉴权对齐）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, [{ index: 0, op: 'writeNodeData', written: true }]));
    const port = fastPort(fetchImpl, { token: 'tok-1' });
    await port.writeNodeData('p1', 'n1', { a: 1 });
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer tok-1');
  });
});

describe('Y0c T26（偏离 31）：writeOpsBatch+HttpCollabDocWriter——CollabDocWriterService 令牌 worker 形态', () => {
  it('200 数组响应：WriteOpResult[] 一一对应透传（整批单 POST——deliver+done 组批契约）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, [
      { index: 0, op: 'writeNodeData', written: true },
      { index: 1, op: 'writeExecStatus', written: true },
    ]));
    const port = fastPort(fetchImpl);
    const ops = [
      { op: 'writeNodeData' as const, nodeId: 'n1', patch: { resultUrl: 'http://x/1.png' } },
      { op: 'writeExecStatus' as const, nodeId: 'n1', patch: { status: 'done' as const, attempts: 1 } },
    ];
    const out = await port.writeOpsBatch('p1', ops);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ index: 0, op: 'writeNodeData', written: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/api/collab/doc/write-batch');
    expect(JSON.parse(init.body)).toEqual({ projectId: 'p1', ops });
  });

  it('持续 503：合成 written:true 全批（长度=ops 一一对应）不 throw+transient-exhausted 计数——防误退款（Z99 三分同 writeNodeData 裁决）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(503));
    const port = fastPort(fetchImpl, { maxAttempts: 2 });
    const d = await outcomeDelta('writeBatch', 'transient-exhausted', () =>
      port.writeOpsBatch('p1', [{ op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1 } }]));
    expect(d).toBe(1);
    const out = await port.writeOpsBatch('p1', [
      { op: 'writeNodeData', nodeId: 'n1', patch: { a: 1 } },
      { op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1 } },
    ]);
    expect(out).toEqual([
      { index: 0, op: 'writeNodeData', written: true },
      { index: 1, op: 'writeExecStatus', written: true },
    ]);
  });

  it('永久（401）与 200 非数组 body：合成 written:true+计数（permanent:401/permanent:bad-body）', async () => {
    const f401 = vi.fn().mockResolvedValue(res(401));
    const p401 = fastPort(f401);
    const d1 = await outcomeDelta('writeBatch', 'permanent:401', () => p401.writeOpsBatch('p1', [{ op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1 } }]));
    expect(d1).toBe(1);
    const fBad = vi.fn().mockResolvedValue(res(200, { code: 0 }));
    const pBad = fastPort(fBad);
    const d2 = await outcomeDelta('writeBatch', 'permanent:bad-body', () => pBad.writeOpsBatch('p1', [{ op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1 } }]));
    expect(d2).toBe(1);
    await expect(pBad.writeOpsBatch('p1', [{ op: 'writeExecStatus', nodeId: 'n1', patch: { status: 'done', attempts: 1 } }])).resolves.toEqual([{ index: 0, op: 'writeExecStatus', written: true }]);
  });

  it('HttpCollabDocWriter：extends CollabDocWriterService（令牌兼容）+writeBatch 委托 writeOpsBatch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, [{ index: 0, op: 'writeNodeData', written: false, reason: 'node-deleted' }]));
    const port = fastPort(fetchImpl);
    const writer = new HttpCollabDocWriter(port);
    expect(writer).toBeInstanceOf(CollabDocWriterService);
    const out = await writer.writeBatch('p1', [{ op: 'writeNodeData', nodeId: 'n1', patch: { a: 1 } }]);
    expect(out[0]).toMatchObject({ written: false, reason: 'node-deleted' });   // 业务 written:false 原样传递（退款终态链凭据——HTTP 侧唯一合法生产者）
  });
});

describe('Z99 第一验收锚（先红锚）：注入 503 ⇒ rollbackDeliveryFailed 零调用+job 不失败', () => {
  it('503 全程持续（writeExecStatus/writeNodeData 全部瞬态耗尽）：runNodeLifecycle 完成（外呼完成+零 throw+errors 空）∧ rollbackDeliveryFailed 零调用', async () => {
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
      claim: vi.fn().mockResolvedValue({ created: true, intent: { id: 'ir1', intentId: 'i1', attempts: 1 } }),
      complete: vi.fn().mockResolvedValue(1),
      fail: vi.fn().mockResolvedValue(undefined),
      void_: vi.fn().mockResolvedValue(undefined),
      reanchorDeadline: vi.fn().mockResolvedValue(1),
      touchHeartbeat: vi.fn().mockResolvedValue(undefined),
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
      docWriterStubOf(port) as any,                                                                       // docWriter（writeBatch 按 op 分派回端口）
      emitPort as any,                                                                                    // emit 端口
      { add: vi.fn().mockResolvedValue(undefined) } as any,                                               // downloadQueue
      intentSvc as any,                                                                                   // intentService
      { readUpstreamMediaId: vi.fn().mockResolvedValue(null), canonicalizeMediaRef: vi.fn().mockResolvedValue(undefined), resolveCallUrl: vi.fn().mockResolvedValue(undefined) } as any,   // upstreamMedia（Y1a T8）
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
    expect(teamCredit.settle).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });
});
