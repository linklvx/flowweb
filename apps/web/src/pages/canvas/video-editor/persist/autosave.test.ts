import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAutosaveController, type AutosaveDeps } from './autosave';

const mkDeps = (over: Partial<AutosaveDeps> = {}): AutosaveDeps => {
  const state = { data: { v: 1 }, baseUpdatedAt: 't0' };
  const deps: any = {
    getProjectId: () => 'p1',
    patch: vi.fn().mockResolvedValue({ updatedAt: 't1' }),
    getData: () => ({ ...state }),
    onSaved: vi.fn((t: string) => { state.baseUpdatedAt = t; }),
    onStateChange: vi.fn(),
    onConflict: vi.fn(),
    isConnected: () => true,
    ...over,
  };
  return deps;
};

describe('autosave（1.5s 防抖 + PATCH 单飞 latest-wins + 乐观锁回填 + 重试 + 离线 + flush）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('防抖：1.5s 内多次 notify 只一次 PATCH', async () => {
    const deps = mkDeps();
    const c = createAutosaveController(deps);
    c.notifyChange(); c.notifyChange(); c.notifyChange();
    expect(deps.patch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(deps.patch).toHaveBeenCalledTimes(1);
    expect(deps.patch).toHaveBeenCalledWith('p1', { data: { v: 1 }, baseUpdatedAt: 't0' });
    c.dispose();
  });

  it('单飞：PATCH 进行中有新改动 → 完成后 latest-wins 排队补一发', async () => {
    let resolveFirst: (v: any) => void = () => {};
    const deps = mkDeps({ patch: vi.fn()
      .mockImplementationOnce(() => new Promise(r => { resolveFirst = r; }))
      .mockResolvedValueOnce({ updatedAt: 't2' }) });
    const c = createAutosaveController(deps);
    c.notifyChange();
    await vi.advanceTimersByTimeAsync(1500); // 第一发发出（pending）
    let dataV = 1;
    deps.getData = () => ({ data: { v: ++dataV }, baseUpdatedAt: 't1' });
    c.notifyChange(); // 进行中改动 → 排队
    await vi.advanceTimersByTimeAsync(1500); // 防抖到期但 inFlight → 不发第二发
    expect(deps.patch).toHaveBeenCalledTimes(1);
    resolveFirst({ updatedAt: 't1' });
    await vi.advanceTimersByTimeAsync(0);   // 完成后补发 latest-wins
    expect(deps.patch).toHaveBeenCalledTimes(2);
    expect(deps.patch).toHaveBeenLastCalledWith('p1', { data: { v: 2 }, baseUpdatedAt: 't1' });
    c.dispose();
  });

  it('updatedAt 回填（onSaved）+ saved 状态', async () => {
    const deps = mkDeps();
    const c = createAutosaveController(deps);
    c.notifyChange();
    await vi.advanceTimersByTimeAsync(1500);
    expect(deps.onSaved).toHaveBeenCalledWith('t1');
    expect(deps.onStateChange).toHaveBeenCalledWith('saving');
    expect(deps.onStateChange).toHaveBeenLastCalledWith('saved');
    c.dispose();
  });

  it('409 → onConflict 且停止自动保存（不自打自冲突）', async () => {
    const err = Object.assign(new Error('conflict'), { status: 409 });
    const deps = mkDeps({ patch: vi.fn().mockRejectedValue(err) });
    const c = createAutosaveController(deps);
    c.notifyChange();
    await vi.advanceTimersByTimeAsync(1500);
    expect(deps.onConflict).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(deps.patch).toHaveBeenCalledTimes(1); // 不重试
    c.dispose();
  });

  it('失败指数退避 1s/4s/16s 自动重试 3 次，期间状态点保持 error', async () => {
    const deps = mkDeps({ patch: vi.fn().mockRejectedValue(new Error('network')) });
    const c = createAutosaveController(deps);
    c.notifyChange();
    await vi.advanceTimersByTimeAsync(1500);
    expect(deps.onStateChange).toHaveBeenLastCalledWith('error');
    await vi.advanceTimersByTimeAsync(1000);
    expect(deps.patch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(deps.patch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(16000);
    expect(deps.patch).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60000);
    expect(deps.patch).toHaveBeenCalledTimes(4);
    c.dispose();
  });

  it('离线暂停：connected 前不发；notifyConnected 立即 flush', async () => {
    const deps = mkDeps({ isConnected: () => false });
    const c = createAutosaveController(deps);
    c.notifyChange();
    await vi.advanceTimersByTimeAsync(10000);
    expect(deps.patch).not.toHaveBeenCalled();
    deps.isConnected = () => true;
    c.notifyConnected();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.patch).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it('flush：立即发 + await 排空（收起时序）', async () => {
    const deps = mkDeps();
    const c = createAutosaveController(deps);
    c.notifyChange();
    const p = c.flush();
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(deps.patch).toHaveBeenCalledTimes(1);
    c.dispose();
  });
});
