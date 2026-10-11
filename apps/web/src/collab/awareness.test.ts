import { describe, it, expect, vi, afterEach } from 'vitest';
import { AwarenessBridge } from './awareness';
import { QUOTA_DEFAULTS } from '@flowweb/shared';
import { getRecentCollabDiag, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';
import type { HocuspocusProvider } from '@hocuspocus/provider';

afterEach(() => {
  vi.useRealTimers();   // T12：去抖测试用 fake timers——异常路径防泄漏到后续用例
  vi.restoreAllMocks();
});

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
    vi.useFakeTimers();
    const p = mockProvider();
    const bridge = new AwarenessBridge(p);
    bridge.setCursor({ x: 10, y: 20 });
    bridge.setSelection(['n1', 'n2']);
    vi.advanceTimersByTime(200);   // T12：selection 去抖 200ms trailing——非空选区经去抖管道
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

  it('replayLocalUser（T10 根修）：本地态 null ⇒ 播种非空态锚点 {presence:true}（真身帧非空态过 guard 幽灵判据——改前播 {} 被剔=空闲 30-45s 重连循环；无 user 键=身份归服务端注入）', () => {
    const p = mockProvider();
    const bridge = new AwarenessBridge(p);
    (p.awareness as any).getLocalState.mockReturnValue(null);
    bridge.replayLocalUser();
    expect((p.awareness as any).setLocalState).toHaveBeenCalledWith({ presence: true });
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

describe('Y0b-4 T12（E38）：selection 去抖 200ms+clearSelection+4KB 客户端拒', () => {
  const selectionCalls = (p: unknown) =>
    (p as any).setAwarenessField.mock.calls.filter((c: unknown[]) => c[0] === 'selection');

  it('去抖 200ms trailing：连续 selection 变更只发末态（中间态不上 wire）', () => {
    vi.useFakeTimers();
    const p = mockProvider();
    const bridge = new AwarenessBridge(p);
    bridge.setSelection(['a']);
    bridge.setSelection(['a', 'b']);
    bridge.setSelection(['a', 'b', 'c']);
    expect(selectionCalls(p)).toEqual([]);   // 去抖窗内零上 wire——中间态 ['a']/['a','b'] 不发
    vi.advanceTimersByTime(200);
    expect(selectionCalls(p)).toEqual([['selection', { nodeIds: ['a', 'b', 'c'] }]]);   // 恰一次=末态
  });

  it('clearSelection：选区清空立即发 setAwarenessField("selection", null)（清字段值非清条目——presence/user 保留 §0.4b-17）且取消 pending 去抖', () => {
    vi.useFakeTimers();
    const p = mockProvider();
    const bridge = new AwarenessBridge(p);
    bridge.setSelection(['a']);   // pending 去抖中
    bridge.setSelection([]);
    expect(selectionCalls(p)).toEqual([['selection', null]]);   // 立即发（未 advance——清空不走去抖）
    vi.advanceTimersByTime(400);
    expect(selectionCalls(p)).toEqual([['selection', null]]);   // pending 已取消——去抖尾帧不补发
  });

  it('4KB 客户端拒：utf8Bytes(JSON)>QUOTA_DEFAULTS.awarenessLimitBytes 的 selection 不发+diag write_reject{selection-too-large}', () => {
    vi.useFakeTimers();
    _resetCollabDiagForTest();
    const p = mockProvider();
    const bridge = new AwarenessBridge(p);
    bridge.setSelection(['n'.repeat(QUOTA_DEFAULTS.awarenessLimitBytes)]);   // 单 id 即超 4KB（常量绑定——改值本测试红）
    vi.advanceTimersByTime(400);
    expect(selectionCalls(p)).toEqual([]);   // 不发（不进管道不补发）
    const last = getRecentCollabDiag().at(-1);
    expect(last?.type).toBe('write_reject');
    expect(last?.detail).toEqual({ reason: 'selection-too-large' });
  });
});
