// apps/web/src/stores/canvasSyncRuntime.test.ts
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('antd', () => ({ message: { warning: vi.fn(), error: vi.fn() } }));
vi.mock('@/api/projectApi', () => ({
  syncCanvas: vi.fn(),
}));
vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
}));

import { message } from 'antd';
import { syncCanvas } from '@/api/projectApi';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { undoCanvas } from './canvasHistoryRuntime';
import {
  AUTO_SAVE_DELAY_MS,
  bindCanvasSync,
  buildSyncPayload,
  flushCanvasSync,
  flushOnUnload,
  scheduleSync,
} from './canvasSyncRuntime';

const syncCanvasMock = vi.mocked(syncCanvas);

function seedStore() {
  useCanvasStore.setState({
    projectId: 'p1',
    nodes: [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any],
    edges: [],
    serverVersion: 3,
    saveStatus: 'saved',
    isHydrating: false,
  });
  useNodeStore.setState({ nodes: { n1: { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: 'hi' } } as any } });
}

describe('canvasSyncRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seedStore();
    syncCanvasMock.mockReset();
    // 项目 vitest 配置未开 clearMocks：模块级 antd spy 跨用例累积，
    // 需清理以保证 not.toHaveBeenCalled 断言只反映当前用例
    vi.mocked(message.warning).mockClear();
    vi.mocked(message.error).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('scheduleSync 默认 2s debounce：连续 3 次仅 1 次 PUT', async () => {
    syncCanvasMock.mockResolvedValue({ version: 4 });
    void scheduleSync();
    void scheduleSync();
    void scheduleSync();
    expect(useCanvasStore.getState().saveStatus).toBe('dirty');
    expect(syncCanvasMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    expect(syncCanvasMock).toHaveBeenCalledTimes(1);
    expect(useCanvasStore.getState().saveStatus).toBe('saved');
    expect(useCanvasStore.getState().serverVersion).toBe(4);
  });

  it('PUT 载荷：nodes 合并 nodeStore data + 携带 version', async () => {
    syncCanvasMock.mockResolvedValue({ version: 4 });
    void scheduleSync();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    const arg = syncCanvasMock.mock.calls[0][1];
    expect(arg.version).toBe(3);
    expect(arg.nodes[0].data).toEqual({ content: 'hi' });
    expect(arg.edges).toEqual([]);
  });

  it('H-1：窗口内切换项目不写旧项目', async () => {
    syncCanvasMock.mockResolvedValue({ version: 4 });
    void scheduleSync();
    useCanvasStore.setState({ projectId: 'p2' });
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    expect(syncCanvasMock).not.toHaveBeenCalled();
  });

  it('isHydrating 窗口内定时器触发不保存', async () => {
    syncCanvasMock.mockResolvedValue({ version: 4 });
    void scheduleSync();
    useCanvasStore.setState({ isHydrating: true });
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    expect(syncCanvasMock).not.toHaveBeenCalled();
  });

  it('保存期间再变更（epoch 竞争）：完成后保持 dirty 并重调度', async () => {
    let resolveFirst!: (v: { version: number }) => void;
    syncCanvasMock.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    void scheduleSync();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS); // 首次 doSave in flight
    void scheduleSync(); // flight 中新变更
    resolveFirst({ version: 4 });
    await vi.advanceTimersByTimeAsync(0);
    expect(useCanvasStore.getState().saveStatus).toBe('dirty');
    syncCanvasMock.mockResolvedValue({ version: 5 });
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    expect(useCanvasStore.getState().saveStatus).toBe('saved');
    expect(useCanvasStore.getState().serverVersion).toBe(5);
  });

  it('flush 与在途保存并发：串行排队，第二次 PUT 携带新 version（防双 PUT 假 409）', async () => {
    let resolveFirst!: (v: { version: number }) => void;
    syncCanvasMock.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    void scheduleSync();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS); // A in flight（version 3）
    void scheduleSync(); // flight 中编辑 → dirty + 新 timer
    syncCanvasMock.mockResolvedValue({ version: 4 });
    const p = flushCanvasSync('execute'); // clearTimer + doSave B —— 应排队等 A 结算
    resolveFirst({ version: 4 }); // A 结算（epoch 不匹配 → dirty + reschedule）
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(syncCanvasMock).toHaveBeenCalledTimes(2);
    // 核心断言：B 在 A 之后执行，携带 A 推进后的 version 4，而非陈旧的 3
    expect(syncCanvasMock.mock.calls[1][1].version).toBe(4);
    expect(useCanvasStore.getState().saveStatus).toBe('saved');
  });

  it('在途保存完成时项目已切换：不污染新项目 serverVersion/saveStatus', async () => {
    let resolveFirst!: (v: { version: number }) => void;
    syncCanvasMock.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    void scheduleSync();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS); // A in flight for p1
    // 模拟项目切换 + hydrate 完成
    useCanvasStore.setState({ projectId: 'p2', serverVersion: 100, saveStatus: 'saved' });
    resolveFirst({ version: 4 });
    await vi.advanceTimersByTimeAsync(0);
    expect(useCanvasStore.getState().serverVersion).toBe(100);
    expect(useCanvasStore.getState().saveStatus).toBe('saved');
  });

  it('网络失败：saveStatus=error', async () => {
    syncCanvasMock.mockRejectedValue(new Error('network'));
    void scheduleSync();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    expect(useCanvasStore.getState().saveStatus).toBe('error');
  });

  it('409：按 hydrate 模式重载——withHistoryPaused + 清历史 + serverVersion 取服务端 + 组尺寸重算 + toast', async () => {
    const err = Object.assign(new Error('conflict'), { status: 409 });
    syncCanvasMock.mockRejectedValueOnce(err);
    const { apiFetch } = await import('@/api/client');
    vi.mocked(apiFetch).mockResolvedValueOnce({
      version: 9,
      nodes: [
        { id: 'n1', type: 'textInput', position: { x: 1, y: 1 }, data: { content: 'server' } },
        { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal' } },
      ],
      edges: [],
    });
    const refit = vi.fn();
    useCanvasStore.setState({ refitGroupBounds: refit } as any);
    void scheduleSync();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    expect(useCanvasStore.getState().serverVersion).toBe(9);
    expect(useCanvasStore.getState().saveStatus).toBe('saved');
    expect((useNodeStore.getState().nodes.n1 as any).data.content).toBe('server');
    expect(refit).toHaveBeenCalledWith('g1');
    const t = useCanvasStore.temporal.getState() as any;
    expect(t.pastStates.length).toBe(0);
    expect(message.warning).toHaveBeenCalledWith('画布已被他人修改，已加载最新版本');
  });

  describe('flushCanvasSync', () => {
    // ⚠️ execute 含 500ms 真实 setTimeout 等待——fake timers 下不可直接 await 整个 flush
    // （会死锁），须先持有 promise 再 advanceTimersByTimeAsync 推进重试定时器
    it('execute：失败重试 1 次（500ms 间隔），仍失败 toast 放行', async () => {
      syncCanvasMock.mockRejectedValue(new Error('x'));
      void scheduleSync();
      const p = flushCanvasSync('execute');
      await vi.advanceTimersByTimeAsync(500);
      await p;
      expect(syncCanvasMock).toHaveBeenCalledTimes(2);
      expect(message.warning).toHaveBeenCalledWith('保存失败，生成将使用上次保存的参数');
      expect(useCanvasStore.getState().saveStatus).toBe('error');
    });

    it('execute：首次失败重试成功则无 toast', async () => {
      syncCanvasMock.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ version: 4 });
      void scheduleSync();
      const p = flushCanvasSync('execute');
      await vi.advanceTimersByTimeAsync(500);
      await p;
      expect(message.warning).not.toHaveBeenCalled();
      expect(useCanvasStore.getState().saveStatus).toBe('saved');
    });

    it('error 态 flush(retry) 直接再保存——重试按钮路径', async () => {
      useCanvasStore.setState({ saveStatus: 'error' });
      syncCanvasMock.mockResolvedValue({ version: 4 });
      await flushCanvasSync('retry');
      expect(syncCanvasMock).toHaveBeenCalledTimes(1);
      expect(useCanvasStore.getState().saveStatus).toBe('saved');
    });

    it('template：失败返回 false（由调用方阻断模板提交），无 toast', async () => {
      syncCanvasMock.mockRejectedValue(new Error('x'));
      void scheduleSync();
      const ok = await flushCanvasSync('template');
      expect(ok).toBe(false);
      expect(message.warning).not.toHaveBeenCalled();
      expect(useCanvasStore.getState().saveStatus).toBe('error');
    });

    it('无 dirty/error 时直接返回不发请求', async () => {
      await flushCanvasSync('execute');
      expect(syncCanvasMock).not.toHaveBeenCalled();
    });
  });

  it('flushOnUnload：keepalive fetch 携带完整载荷', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    void scheduleSync();
    flushOnUnload();
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/p1/canvas', expect.objectContaining({
      method: 'PUT',
      keepalive: true,
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.version).toBe(3);
    vi.unstubAllGlobals();
  });

  describe('bindCanvasSync 订阅判脏', () => {
    it('nodes 结构变更 → dirty', async () => {
      syncCanvasMock.mockResolvedValue({ version: 4 });
      const unbind = bindCanvasSync();
      useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'n2', type: 'textInput', position: { x: 5, y: 5 }, data: {} } as any] }));
      expect(useCanvasStore.getState().saveStatus).toBe('dirty');
      unbind();
    });

    it('nodeProcessMap / selected 变更 → 不 dirty', () => {
      const unbind = bindCanvasSync();
      useCanvasStore.setState({ nodeProcessMap: { n1: { processType: 'generating', status: 'processing' } as any } });
      useCanvasStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
      expect(useCanvasStore.getState().saveStatus).toBe('saved');
      unbind();
    });

    it('isHydrating 窗口内变更 → 不 dirty', () => {
      const unbind = bindCanvasSync();
      useCanvasStore.setState({ isHydrating: true });
      useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'n3', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any] }));
      useCanvasStore.setState({ isHydrating: false });
      expect(useCanvasStore.getState().saveStatus).toBe('saved');
      unbind();
    });

    it('nodeStore.nodes 引用变更（data 写入）→ dirty', () => {
      const unbind = bindCanvasSync();
      const ns = useNodeStore.getState();
      useNodeStore.setState({ nodes: { ...ns.nodes } });
      expect(useCanvasStore.getState().saveStatus).toBe('dirty');
      unbind();
    });
  });

  describe('undo → 300ms flush（scheduleSync 收编）', () => {
    it('undo 后 300ms 触发 syncCanvas（非 2s、不叠加双发）', async () => {
      syncCanvasMock.mockResolvedValue({ version: 4 });
      // 干净历史基线：清掉前序用例可能残留的 pastStates
      useCanvasStore.temporal.getState().clear();
      // 结构变更即入历史（zundo 自动采样），为 undo 准备一条可回退快照
      useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'n2', type: 'textInput', position: { x: 1, y: 1 }, data: {} } as any] }));
      // 不直接 await 整链：undo 返回的 Promise 在 300ms 定时器保存完成后才结算，
      // fake timers 下先推进时钟再 await，否则死锁
      const p = undoCanvas();
      expect(syncCanvasMock).not.toHaveBeenCalled();   // 无立即 PUT
      await vi.advanceTimersByTimeAsync(299);
      expect(syncCanvasMock).not.toHaveBeenCalled();   // 非 0ms 抢跑
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(syncCanvasMock).toHaveBeenCalledTimes(1); // 恰在 300ms 触发一次
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
      expect(syncCanvasMock).toHaveBeenCalledTimes(1); // 不再叠加 2s 双发
    });
  });
});
