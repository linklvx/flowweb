import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCanvasPersistence } from '../useCanvasPersistence';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { snapshotKey } from '../canvasSnapshot';

const PID = 'test-pid';
const V2_KEY = snapshotKey(PID);

const seedNode = (id: string, data: Record<string, unknown> = {}) => ({
  id,
  type: 'imageGen',
  position: { x: 1, y: 2 },
  data,
});

function seedSnapshot(payload: Record<string, unknown>) {
  localStorage.setItem(V2_KEY, JSON.stringify({ version: 2, edges: [], viewport: { x: 0, y: 0, zoom: 1 }, ...payload }));
}

function v2Writes() {
  return vi.mocked(Storage.prototype.setItem).mock.calls.filter(([k]) => k === V2_KEY);
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useCanvasStore.setState({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, isHydrating: false });
  useNodeStore.setState({ nodes: {} });
  vi.spyOn(Storage.prototype, 'setItem');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// 本 describe 必须最先执行：清扫依赖模块级 flag 的首次 mount（下方测试的 renderHook 也会消耗首次 mount）
describe('useCanvasPersistence — 旧 key 一次性清扫', () => {
  it('首次 mount 清扫旧 key，v2/projectId 不受影响；再次 mount 不重复清扫', () => {
    localStorage.setItem('flowweb_canvas_oldp', '{}');
    localStorage.setItem('flowweb_canvas_content_oldp', '{}');
    localStorage.setItem(snapshotKey('other'), '{}');
    localStorage.setItem('flowweb_projectId', 'keep-me');

    const { unmount } = renderHook(() => useCanvasPersistence(PID));
    expect(localStorage.getItem('flowweb_canvas_oldp')).toBeNull();
    expect(localStorage.getItem('flowweb_canvas_content_oldp')).toBeNull();
    expect(localStorage.getItem(snapshotKey('other'))).not.toBeNull();
    expect(localStorage.getItem('flowweb_projectId')).toBe('keep-me');

    // flag 单次：重新植入旧 key 后二次 mount 不再清扫
    localStorage.setItem('flowweb_canvas_oldp2', '{}');
    unmount();
    renderHook(() => useCanvasPersistence(PID));
    expect(localStorage.getItem('flowweb_canvas_oldp2')).toBe('{}');
  });
});

describe('useCanvasPersistence — 恢复派生', () => {
  it('store 空时从 v2 快照恢复双 store（视图派生 + 同源数据）', () => {
    seedSnapshot({
      nodes: { n1: seedNode('n1', { foo: 'bar' }) },
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      viewport: { x: 9, y: 8, zoom: 0.5 },
    });

    renderHook(() => useCanvasPersistence(PID));

    const cs = useCanvasStore.getState();
    expect(cs.nodes.map((n) => n.id)).toContain('n1');
    expect((cs.nodes[0].data as any).foo).toBe('bar');
    expect(cs.edges[0]).toMatchObject({ id: 'e1', source: 'n1', target: 'n2' }); // 恢复后视图派生会附加 hidden 字段
    expect(cs.viewport).toEqual({ x: 9, y: 8, zoom: 0.5 });
    expect(useNodeStore.getState().nodes.n1).toBeDefined();
    expect(useCanvasStore.getState().isHydrating).toBe(false);
  });

  it('store 非空时不读 localStorage（DB 优先，串行兜底）', () => {
    useCanvasStore.setState({ nodes: [{ id: 'db1', type: 'textGen', position: { x: 0, y: 0 }, data: {} } as any] });
    seedSnapshot({ nodes: { n1: seedNode('n1') } });

    renderHook(() => useCanvasPersistence(PID));

    expect(useCanvasStore.getState().nodes.map((n) => n.id)).toEqual(['db1']);
    expect(useNodeStore.getState().nodes.n1).toBeUndefined();
  });

  it('恢复窗口抑制写者：恢复后 advance 1000ms 无回写', () => {
    seedSnapshot({ nodes: { n1: seedNode('n1') } });
    vi.mocked(Storage.prototype.setItem).mockClear(); // 排除 seed 预置本身的 setItem

    renderHook(() => useCanvasPersistence(PID));
    vi.advanceTimersByTime(1000);

    expect(v2Writes()).toHaveLength(0);
  });
});

describe('useCanvasPersistence — 单写者（500ms 防抖合并）', () => {
  it('双 store 各变一次 → advance 500ms 恰一次写，payload 合并且 edges 裁剪最小字段', () => {
    renderHook(() => useCanvasPersistence(PID));

    useCanvasStore.setState({
      edges: [{ id: 'e1', source: 'a', target: 'b', type: 'default' } as any],
      viewport: { x: 1, y: 2, zoom: 3 },
    });
    useNodeStore.setState({ nodes: { n1: seedNode('n1') as never } });
    vi.advanceTimersByTime(499);
    expect(v2Writes()).toHaveLength(0);
    vi.advanceTimersByTime(1);

    const writes = v2Writes();
    expect(writes).toHaveLength(1);
    const payload = JSON.parse(writes[0][1]);
    expect(payload.version).toBe(2);
    expect(Object.keys(payload.nodes)).toEqual(['n1']);
    expect(payload.edges).toEqual([{ id: 'e1', source: 'a', target: 'b' }]);
    expect(payload.viewport).toEqual({ x: 1, y: 2, zoom: 3 });
  });
});

describe('useCanvasPersistence — isHydrating 抑制（S1：跳过并清待执行定时器）', () => {
  it('防抖定时器挂起期间进入 hydrating → advance 500ms 无写（fire 时守卫）', () => {
    renderHook(() => useCanvasPersistence(PID));

    useNodeStore.setState({ nodes: { n1: seedNode('n1') as never } }); // 调度定时器
    useCanvasStore.getState().setHydrating(true);
    vi.advanceTimersByTime(500);
    expect(v2Writes()).toHaveLength(0);

    // hydrating 结束后新的变化恢复正常写
    useCanvasStore.getState().setHydrating(false);
    useNodeStore.setState({ nodes: { n2: seedNode('n2') as never } });
    vi.advanceTimersByTime(500);
    expect(v2Writes()).toHaveLength(1);
  });

  it('hydrating 期间的 store 变化被订阅点拦截：不调度且清除挂起定时器', () => {
    renderHook(() => useCanvasPersistence(PID));

    useNodeStore.setState({ nodes: { n1: seedNode('n1') as never } }); // 定时器挂起
    useCanvasStore.getState().setHydrating(true);
    useNodeStore.setState({ nodes: { n2: seedNode('n2') as never } }); // 订阅点：hydrating → 清定时器不调度
    useCanvasStore.getState().setHydrating(false);
    vi.advanceTimersByTime(2000); // 无定时器存活 → 无写
    expect(v2Writes()).toHaveLength(0);
  });
});
