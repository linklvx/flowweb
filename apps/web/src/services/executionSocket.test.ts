import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const listeners = new Map<string, Set<(data: unknown) => void>>();
const emitSpy = vi.fn();
const disconnectSpy = vi.fn();
const fakeSocket = {
  connected: false,
  on: vi.fn((ev: string, fn: (data: unknown) => void) => {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev)!.add(fn);
  }),
  emit: emitSpy,
  disconnect: disconnectSpy,
};
const ioSpy = vi.fn(() => fakeSocket);

vi.mock('socket.io-client', () => ({ io: ioSpy }));

// 模块级单例状态——每用例前重置模块注册表
beforeEach(() => {
  vi.resetModules();
  listeners.clear();
  emitSpy.mockClear();
  disconnectSpy.mockClear();
  ioSpy.mockClear();
  fakeSocket.connected = false;
});
afterEach(async () => {
  const { teardownExecutionSocket } = await import('./executionSocket');
  teardownExecutionSocket();
});

const fire = (ev: string, data: unknown) => listeners.get(ev)?.forEach((fn) => fn(data));

describe('executionSocket 单例服务', () => {
  it('两次 ensure 同一 Socket 实例（io 只调用一次）', async () => {
    const { ensureExecutionSocket } = await import('./executionSocket');
    const a = ensureExecutionSocket('p1');
    const b = ensureExecutionSocket('p1');
    expect(ioSpy).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('connect 后 join 当前 workflowId；重连（再次 connect）重 join（socket 级无 reconnect 事件——SocketReservedEvents 仅 connect/connect_error/disconnect，重连成功即再次 connect）', async () => {
    const { ensureExecutionSocket } = await import('./executionSocket');
    ensureExecutionSocket('p1'); // 未连接 → 不立即 emit
    expect(emitSpy).not.toHaveBeenCalled();
    fire('connect', undefined); // 连接建立 → joinCurrent
    expect(emitSpy).toHaveBeenCalledWith('join', 'p1');
    emitSpy.mockClear();
    fire('connect', undefined); // 断线重连成功 → connect 再触发 → 重 join（真实契约）
    expect(emitSpy).toHaveBeenCalledWith('join', 'p1');
  });

  it('subscribeNodeStatus 全量分发并返回退订函数', async () => {
    const { ensureExecutionSocket, subscribeNodeStatus } = await import('./executionSocket');
    ensureExecutionSocket('p1');
    const seen: string[] = [];
    const off = subscribeNodeStatus((p) => seen.push(p.nodeId));
    fire('node:status', { nodeId: 'n1', status: 'done' });
    off();
    fire('node:status', { nodeId: 'n2', status: 'done' });
    expect(seen).toEqual(['n1']);
  });

  it('决策 1 勘误：edit-result/edit-failed 经 node:status status 值分流到 subscribeNodeEditResult（payload 含 nodeId）', async () => {
    const { ensureExecutionSocket, subscribeNodeEditResult } = await import('./executionSocket');
    ensureExecutionSocket('p1');
    const seen: { nodeId: string; failed: boolean }[] = [];
    subscribeNodeEditResult((p) => seen.push({ nodeId: p.nodeId, failed: p.failed }));
    fire('node:status', { nodeId: 'n1', status: 'edit-result', fileId: 'f1' });
    fire('node:status', { nodeId: 'n2', status: 'edit-failed', error: 'boom' });
    expect(seen).toEqual([{ nodeId: 'n1', failed: false }, { nodeId: 'n2', failed: true }]);
  });

  it('payload.credits 转发 window credits:update（CanvasTopBar 消费，5 创建点转发逻辑统一收编）', async () => {
    const { ensureExecutionSocket } = await import('./executionSocket');
    ensureExecutionSocket('p1');
    const handler = vi.fn();
    window.addEventListener('credits:update', handler);
    fire('node:status', { nodeId: 'n1', status: 'done', credits: { credits: 1, subscriptionCredits: 2, total: 3 } });
    window.removeEventListener('credits:update', handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ credits: 1, subscriptionCredits: 2, total: 3 });
  });

  it('已连接时 ensure 新 projectId 立即 join（Task 2 review 遗留——connected 即 join 分支）', async () => {
    const { ensureExecutionSocket } = await import('./executionSocket');
    ensureExecutionSocket('p1');
    fakeSocket.connected = true;
    ensureExecutionSocket('p2');
    expect(emitSpy).toHaveBeenCalledWith('join', 'p2');
  });

  it('teardown disconnect 且下次 ensure 重建', async () => {
    const { ensureExecutionSocket, teardownExecutionSocket } = await import('./executionSocket');
    ensureExecutionSocket('p1');
    teardownExecutionSocket();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    ensureExecutionSocket('p1');
    expect(ioSpy).toHaveBeenCalledTimes(2);
  });
});
