// apps/api/src/modules/collab/collab-write.port.spec.ts
// Y0c T13b（端口先行——Z100 顺序修正）：CollabWritePort 抽象面+DirectCollabWritePort
// 委托透传单测——端口形态契约：Direct 形态=构造注入 CollabDocumentService，逐字对齐
// 公开签名、参数原样转发、返回值透传（行为零变化的结构性改道载体；T24 HttpCollabWritePort
// 同面另一形态——worker 走端点）。T13：probeArtifacts 删除——面 7→6；T15：writeNodeData 删——面 6→5。
import { describe, it, expect, vi } from 'vitest';
import { DirectCollabWritePort } from './collab-write.port';
import type { CollabDocumentService } from './collab-document.service';

/** spy/stub CollabDocumentService 装置：5 方法全 mock——断言逐方法参数透传+返回值透传。 */
function makePort() {
  const svc = {
    withDoc: vi.fn(async (_projectId: string, fn: (doc: unknown) => unknown) => fn({ via: 'svc-doc' })),
    readCanvas: vi.fn(async () => ({ nodes: [{ id: 'n1' }], edges: [] })),
    isLeaseServing: vi.fn(() => true),
    isDocResident: vi.fn(() => false),
    writeExecStatus: vi.fn(async () => undefined),
  };
  const port = new DirectCollabWritePort(svc as unknown as CollabDocumentService);
  return { port, svc };
}

describe('DirectCollabWritePort（T13b——T15 后 5 方法委托透传；writeNodeData 随交付归投影 poller 删除）', () => {
  it('withDoc：projectId+fn 原样转发，返回值透传（泛型路径）', async () => {
    const { port, svc } = makePort();
    const fn = vi.fn((doc: any) => doc);
    const out = await port.withDoc('p1', fn);
    expect(svc.withDoc).toHaveBeenCalledTimes(1);
    expect(svc.withDoc).toHaveBeenCalledWith('p1', fn);
    expect(out).toEqual({ via: 'svc-doc' });
  });

  it('withDoc：异步 fn 返回 Promise<T> 透传', async () => {
    const { port, svc } = makePort();
    const out = await port.withDoc('p1', async () => 'async-result');
    expect(svc.withDoc).toHaveBeenCalledWith('p1', expect.any(Function));
    expect(out).toBe('async-result');
  });

  it('readCanvas：projectId 透传，{nodes,edges} 返回值透传', async () => {
    const { port, svc } = makePort();
    const out = await port.readCanvas('p2');
    expect(svc.readCanvas).toHaveBeenCalledWith('p2');
    expect(out).toEqual({ nodes: [{ id: 'n1' }], edges: [] });
  });

  it('isLeaseServing：透传布尔返回值', () => {
    const { port, svc } = makePort();
    expect(port.isLeaseServing()).toBe(true);
    svc.isLeaseServing.mockReturnValue(false);
    expect(port.isLeaseServing()).toBe(false);
  });

  it('isDocResident：projectId 透传，布尔返回值透传', () => {
    const { port, svc } = makePort();
    expect(port.isDocResident('p3')).toBe(false);
    expect(svc.isDocResident).toHaveBeenCalledWith('p3');
  });

  it('writeExecStatus：三参透传（含 attempts 代次），void 透传（T15 后唯一写面——writeNodeData 已删）', async () => {
    const { port, svc } = makePort();
    const patch = { status: 'done', attempts: 1 };
    await expect(port.writeExecStatus('p5', 'n1', patch)).resolves.toBeUndefined();
    expect(svc.writeExecStatus).toHaveBeenCalledWith('p5', 'n1', patch);
  });

});
