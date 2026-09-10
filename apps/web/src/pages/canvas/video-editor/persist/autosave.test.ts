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

  it('retry：重试耗尽后点击红点无条件重发且退避额度重置（I1）', async () => {
    let calls = 0;
    const patch = vi.fn().mockImplementation(() => { calls++; return calls < 5 ? Promise.reject(new Error('net')) : Promise.resolve({ updatedAt: 't9' }); });
    const deps = mkDeps({ patch });
    const c = createAutosaveController(deps);
    c.notifyChange();
    await vi.advanceTimersByTimeAsync(1500 + 1000 + 4000 + 16000 + 60000); // 首发+3 重试后停
    expect(deps.patch).toHaveBeenCalledTimes(4);
    c.retry(); // 手动重试
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.patch).toHaveBeenCalledTimes(5); // 无条件发出
    expect(deps.onStateChange).toHaveBeenLastCalledWith('saved'); // 第 5 次成功
    c.dispose();
  });

  it('retry 在 409 冲突后点击 → 重发（toast 重弹语义）', async () => {
    const err = Object.assign(new Error('conflict'), { status: 409 });
    const deps = mkDeps({ patch: vi.fn().mockRejectedValue(err) });
    const c = createAutosaveController(deps);
    c.notifyChange();
    await vi.advanceTimersByTimeAsync(1500);
    expect(deps.onConflict).toHaveBeenCalledTimes(1);
    c.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.patch).toHaveBeenCalledTimes(2);
    expect(deps.onConflict).toHaveBeenCalledTimes(2); // 重弹——半自动恢复
    c.dispose();
  });

  it('flush 返回 false：离线且有脏数据（I3——阻止关闭语义）', async () => {
    const deps = mkDeps({ isConnected: () => false });
    const c = createAutosaveController(deps);
    c.notifyChange();
    const drained = await c.flush();
    expect(drained).toBe(false);
    c.dispose();
  });

  it('flush 持续失败（connected）不绕退避——烧完额度返回 false 阻止关闭（review 残留）', async () => {
    const deps = mkDeps({ patch: vi.fn().mockRejectedValue(new Error('500')) });
    const c = createAutosaveController(deps);
    c.notifyChange();
    await vi.advanceTimersByTimeAsync(1500 + 1000 + 4000 + 16000); // 首发+3 次退避全失败，停机
    const p = c.flush(); // 无脏数据（dirty 已清）但 retryCount=3
    const drained = await p;
    expect(drained).toBe(false); // 最终失败——阻止关闭
    expect(deps.patch).toHaveBeenCalledTimes(4); // flush 不再补发（不绕退避）
    c.dispose();
  });

  it('flush 在途排空 + 等待期新编辑也排空（M1）', async () => {
    let resolveFirst: (v: any) => void = () => {};
    const deps = mkDeps({ patch: vi.fn()
      .mockImplementationOnce(() => new Promise(r => { resolveFirst = r; }))
      .mockResolvedValueOnce({ updatedAt: 't3' }) });
    const c = createAutosaveController(deps);
    c.notifyChange();
    await vi.advanceTimersByTimeAsync(1500); // 第一发在途
    let v = 1;
    deps.getData = () => ({ data: { v: ++v }, baseUpdatedAt: 't1' });
    c.notifyChange(); // 排空等待期新编辑
    const p = c.flush();
    resolveFirst({ updatedAt: 't1' });
    const drained = await vi.advanceTimersByTimeAsync(50).then(() => p);
    expect(drained).toBe(true);
    expect(deps.patch).toHaveBeenCalledTimes(2); // 新编辑也被排空
    c.dispose();
  });
});
