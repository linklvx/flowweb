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
