import { describe, it, expect, vi } from 'vitest';
import { AwarenessBridge } from './awareness';
import type { HocuspocusProvider } from '@hocuspocus/provider';

function mockProvider(clientID = 1, states = new Map()) {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    awareness: { clientID, getStates: () => states, getLocalState: vi.fn(() => null), setLocalState: vi.fn() },
    setAwarenessField: vi.fn(),
    on: vi.fn((ev: string, cb: () => void) => { (listeners[ev] ??= []).push(cb); }),
    off: vi.fn(),
    _emit: (ev: string) => (listeners[ev] ?? []).forEach((cb) => cb()),
  } as unknown as HocuspocusProvider & { _emit: (ev: string) => void };
}

describe('awareness', () => {
  it('setCursor/setSelection 写 awareness 字段（T7：user 字段写入退位=服务端注入，客户端无 setLocalUser）', () => {
    const p = mockProvider();
    const bridge = new AwarenessBridge(p);
    bridge.setCursor({ x: 10, y: 20 });
    bridge.setSelection(['n1', 'n2']);
    expect((p as any).setAwarenessField).not.toHaveBeenCalledWith('user', expect.anything());
    expect((p as any).setAwarenessField).toHaveBeenCalledWith('cursor', { x: 10, y: 20 });
    expect((p as any).setAwarenessField).toHaveBeenCalledWith('selection', { nodeIds: ['n1', 'n2'] });
  });

  it('getRemoteStates 排除本地 clientID', () => {
    const states = new Map([
      [1, { user: { id: 'u1', name: 'me' }, cursor: { x: 0, y: 0 } }],
      [2, { user: { id: 'u2', name: 'peer' }, cursor: { x: 5, y: 5 } }],
    ]);
    const bridge = new AwarenessBridge(mockProvider(1, states));
    const remote = bridge.getRemoteStates();
    expect(remote).toHaveLength(1);
    expect(remote[0].user.id).toBe('u2');
  });

  it('onStateChange 订阅 awarenessUpdate', () => {
    const p = mockProvider();
    const bridge = new AwarenessBridge(p);
    const cb = vi.fn();
    bridge.onStateChange(cb);
    (p as any)._emit('awarenessUpdate');
    expect(cb).toHaveBeenCalled();
  });

  it('replayLocalUser（T7 改形）：本地态 null ⇒ 恢复非空占位（user 归服务端注入——pagehide 自愈承重）', () => {
    const p = mockProvider();
    const bridge = new AwarenessBridge(p);
    (p.awareness as any).getLocalState.mockReturnValue(null);
    bridge.replayLocalUser();
    expect((p.awareness as any).setLocalState).toHaveBeenCalledWith({});
  });

  it('replayLocalUser（T7 改形）：本地态非空 ⇒ no-op（不打 clock——终态重建后构造播种已在）', () => {
    const p = mockProvider();
    const bridge = new AwarenessBridge(p);
    (p.awareness as any).getLocalState.mockReturnValue({});
    bridge.replayLocalUser();
    expect((p.awareness as any).setLocalState).not.toHaveBeenCalled();
  });
});

describe('批1-5：AwarenessBridge 稳定对象化', () => {
  it('订阅跨 attach 迁移存活：新实例 awarenessUpdate 仍通知既有 cb', () => {
    const p1 = mockProvider();
    const bridge = new AwarenessBridge(p1);
    const cb = vi.fn();
    bridge.onStateChange(cb);
    const p2 = mockProvider(2);
    bridge.attach(p2); // 终态重建迁移——消费方订阅零改动
    (p2 as any)._emit('awarenessUpdate');
    expect(cb).toHaveBeenCalledTimes(1); // 现状：订阅绑旧实例，迁移后孤儿——必红
  });

  it('退订后不再通知', () => {
    const p1 = mockProvider();
    const bridge = new AwarenessBridge(p1);
    const cb = vi.fn();
    const off = bridge.onStateChange(cb);
    off();
    (p1 as any)._emit('awarenessUpdate');
    expect(cb).not.toHaveBeenCalled();
  });

  it('判空：provider.awareness 缺失 ⇒ getStates/getRemoteStates 空集不抛', () => {
    const p = { on: vi.fn(), off: vi.fn(), setAwarenessField: vi.fn() } as unknown as HocuspocusProvider;
    const bridge = new AwarenessBridge(p);
    expect(bridge.getStates().size).toBe(0);
    expect(bridge.getRemoteStates()).toEqual([]);
  });
});
