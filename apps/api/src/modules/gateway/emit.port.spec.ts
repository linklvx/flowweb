// apps/api/src/modules/gateway/emit.port.spec.ts
// Y0c T24（Z101）：emit 端口三态——EmitPort 抽象（emitNodeStatus 单方法面，按 gateway :70-79 签名）
// +DirectEmitPort（api：逐字委托真 gateway）+WorkerEmitPort（worker：降级 no-op+计数安全——非资金路径）。
// 先红锚（Z101）：worker 侧 @WebSocketServer 恒 undefined ⇒ gateway.emitNodeStatus（:70-82 无防护
// this.server.to()）必抛 TypeError——端口层解决（gateway 本体零改），本 spec 落地时三类均不存在（结构性红）。
import { describe, it, expect, vi } from 'vitest';
import { register } from 'prom-client';
import { DirectEmitPort, WorkerEmitPort, emitPortForRole } from './emit.port';

/** collab_emit_degraded_total 增量（register 全局单例——恒用增量，causeDelta 同款形态）。 */
async function degradedDelta(fn: () => unknown): Promise<number> {
  const metric: any = register.getSingleMetric('collab_emit_degraded_total');
  const read = async () => (await metric.get()).values[0]?.value ?? 0;
  const before = await read();
  await fn();
  return (await read()) - before;
}

describe('Y0c T24（Z101）emit 端口', () => {
  it('WorkerEmitPort：emitNodeStatus=降级 no-op——不抛（无 gateway 无 server）+collab_emit_degraded_total +1', async () => {
    const port = new WorkerEmitPort();
    const d = await degradedDelta(() => port.emitNodeStatus('p1', { nodeId: 'n1', status: 'loading' }));
    expect(d).toBe(1);
    // 连发不抛（worker 全生命周期安全——Z101「emit 非资金路径，降级安全」）
    expect(() => port.emitNodeStatus('p1', { nodeId: 'n1', status: 'done', fileId: 'f1' })).not.toThrow();
    expect(() => port.emitNodeStatus('p1', { nodeId: 'n1', status: 'error', error: 'x' })).not.toThrow();
  });

  it('DirectEmitPort：逐字委托真 gateway（projectId+data 原样转发——api 进程行为零变化）', () => {
    const emitNodeStatus = vi.fn();
    new DirectEmitPort({ emitNodeStatus } as any).emitNodeStatus('p2', { nodeId: 'n2', status: 'error', error: 'boom' });
    expect(emitNodeStatus).toHaveBeenCalledTimes(1);
    expect(emitNodeStatus).toHaveBeenCalledWith('p2', { nodeId: 'n2', status: 'error', error: 'boom' });
  });

  it('emitPortForRole：api/all=DirectEmitPort（真 gateway 注入）/worker=WorkerEmitPort（降级）——COLLAB_ROLE 选形态', () => {
    const gw = { emitNodeStatus: vi.fn() } as any;
    expect(emitPortForRole('api', gw)).toBeInstanceOf(DirectEmitPort);
    expect(emitPortForRole('all', gw)).toBeInstanceOf(DirectEmitPort);
    expect(emitPortForRole('worker', gw)).toBeInstanceOf(WorkerEmitPort);
  });

  // ── Y0c T25（T24 评审 F1 补面）：三族 emit 专法（gateway :84-117 与 emitNodeStatus 同构无防护） ──

  it('WorkerEmitPort：三族（trim/separate/stitch）=降级 no-op——不抛+collab_emit_degraded_total 增计（worker 无 server 同族安全）', async () => {
    const port = new WorkerEmitPort();
    const d1 = await degradedDelta(() => port.emitTrimStatus('wf-1', { nodeId: 'n1', taskId: 't1', status: 'done', outputFileId: 'f1' }));
    expect(d1).toBe(1);
    const d2 = await degradedDelta(() => port.emitSeparateStatus('wf-1', { nodeId: 'n1', taskId: 't1', status: 'processing' }));
    expect(d2).toBe(1);
    const d3 = await degradedDelta(() => port.emitStitchStatus('p1', { taskId: 't1', status: 'COMPLETED', fileId: 'f1', cellCount: 4 }));
    expect(d3).toBe(1);
    // 失败载荷（error 分支）同样不抛——worker 全生命周期安全
    expect(() => port.emitTrimStatus('wf-1', { nodeId: 'n1', taskId: 't1', status: 'error', error: 'x' })).not.toThrow();
    expect(() => port.emitSeparateStatus('wf-1', { nodeId: 'n1', taskId: 't1', status: 'error', error: 'x' })).not.toThrow();
    expect(() => port.emitStitchStatus('p1', { taskId: 't1', status: 'FAILED', error: 'x' })).not.toThrow();
  });

  it('DirectEmitPort：三族逐字委托真 gateway（workflowId/projectId+data 原样转发——api 进程行为零变化）', () => {
    const emitTrimStatus = vi.fn();
    const emitSeparateStatus = vi.fn();
    const emitStitchStatus = vi.fn();
    const port = new DirectEmitPort({ emitTrimStatus, emitSeparateStatus, emitStitchStatus } as any);
    port.emitTrimStatus('wf-9', { nodeId: 'n1', taskId: 't1', status: 'done', outputFileId: 'f1' });
    expect(emitTrimStatus).toHaveBeenCalledWith('wf-9', { nodeId: 'n1', taskId: 't1', status: 'done', outputFileId: 'f1' });
    port.emitSeparateStatus('wf-9', { nodeId: 'n2', taskId: 't2', status: 'error', error: 'boom' });
    expect(emitSeparateStatus).toHaveBeenCalledWith('wf-9', { nodeId: 'n2', taskId: 't2', status: 'error', error: 'boom' });
    port.emitStitchStatus('p-9', { taskId: 't3', status: 'FAILED', failedCount: 1, error: 'boom' });
    expect(emitStitchStatus).toHaveBeenCalledWith('p-9', { taskId: 't3', status: 'FAILED', failedCount: 1, error: 'boom' });
  });
});
