import { describe, it, expect, vi } from 'vitest';
import { AwarenessBridge, userColor } from './awareness';
import type { HocuspocusProvider } from '@hocuspocus/provider';

function mockProvider(clientID = 1, states = new Map()) {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    awareness: { clientID, getStates: () => states },
    setAwarenessField: vi.fn(),
    on: vi.fn((ev: string, cb: () => void) => { (listeners[ev] ??= []).push(cb); }),
    off: vi.fn(),
    _emit: (ev: string) => (listeners[ev] ?? []).forEach((cb) => cb()),
  } as unknown as HocuspocusProvider & { _emit: (ev: string) => void };
}

describe('awareness', () => {
  it('setCursor/setSelection/setLocalUser 写 awareness 字段', () => {
    const p = mockProvider();
    const bridge = new AwarenessBridge(p);
    bridge.setLocalUser({ id: 'u1', name: '张三' });
    bridge.setCursor({ x: 10, y: 20 });
    bridge.setSelection(['n1', 'n2']);
    expect((p as any).setAwarenessField).toHaveBeenCalledWith('user', { id: 'u1', name: '张三' });
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

  it('userColor 同 id 稳定、不同 id 可不同', () => {
    expect(userColor('u1')).toBe(userColor('u1'));
    expect(typeof userColor('u2')).toBe('string');
  });

  it('userColor 对缺 id 的畸形 awareness 状态不抛错（远端可发任意字段）', () => {
    expect(typeof userColor(undefined as any)).toBe('string');
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
