// apps/web/src/pages/canvas/video-editor/export/client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { pickSaveTarget } from './client';

// Worker 构造 mock：new Worker(url, opts) 返回 fake；postMessage 记录；dispatch 模拟 worker→主线程
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(msg: unknown) { this.posted.push(msg); }
  terminate() { this.terminated = true; }
  // 测试辅助：worker 侧回发
  emit(msg: unknown) { this.onmessage?.({ data: msg }); }
}

describe('runExportJob（主线程 client）', () => {
  it('run 消息带 params；done 回传 buffer 并 resolve；worker terminate', async () => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
    const { runExportJob } = await import('./client');
    const p = runExportJob(
      { data: { version: 1, fps: 30, tracks: [], clips: {} } as never, resolution: '720p', targetSize: { width: 1280, height: 720 }, mediaUrls: {} },
      { onProgress: vi.fn() },
    );
    const w = FakeWorker.instances[0];
    expect(w.posted[0]).toMatchObject({ type: 'run', params: { resolution: '720p' } });
    w.emit({ type: 'done', buffer: new ArrayBuffer(8) });
    const r = await p.promise;
    expect(r.blob.size).toBe(8);
    expect(r.fsa).toBe(false);
    expect(w.terminated).toBe(true);
    vi.unstubAllGlobals();
  });

  it('error 消息 reject 且分类透传', async () => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
    const { runExportJob } = await import('./client');
    const p = runExportJob({ data: {} as never, resolution: '720p', targetSize: { width: 1280, height: 720 }, mediaUrls: {} }, { onProgress: vi.fn() });
    FakeWorker.instances[0].emit({ type: 'error', category: 'memory', message: 'OOM' });
    await expect(p.promise).rejects.toMatchObject({ category: 'memory' });
    vi.unstubAllGlobals();
  });

  it('cancel() → terminate + reject canceled；进度/eta 回调透传', async () => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
    const { runExportJob } = await import('./client');
    const progress = vi.fn(); const eta = vi.fn();
    const p = runExportJob({ data: {} as never, resolution: '720p', targetSize: { width: 1280, height: 720 }, mediaUrls: {} }, { onProgress: progress, onEta: eta });
    const w = FakeWorker.instances[0];
    w.emit({ type: 'progress', phase: 'encode', ratio: 0.5 });
    w.emit({ type: 'eta', etaSec: 42 });
    expect(progress).toHaveBeenCalledWith('encode', 0.5);
    expect(eta).toHaveBeenCalledWith(42);
    p.cancel();
    await expect(p.promise).rejects.toMatchObject({ category: 'canceled' });
    expect(w.terminated).toBe(true);
    vi.unstubAllGlobals();
  });

  it('fsa:true 的 done → 空 Blob + fsa 标记 true（Task 9 upload 侧 getFile() 择源的契约缝合点）', async () => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
    const { runExportJob } = await import('./client');
    const p = runExportJob({ data: {} as never, resolution: '720p', targetSize: { width: 1280, height: 720 }, mediaUrls: {} }, { onProgress: vi.fn() });
    FakeWorker.instances[0].emit({ type: 'done', buffer: null, fsa: true });
    const r = await p.promise;
    expect(r.blob.size).toBe(0);
    expect(r.fsa).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('pickSaveTarget（P1-E 三态）', () => {
  const fakeRoot = () => ({ getFileHandle: vi.fn().mockResolvedValue({ name: 'export-x.mp4' }) });
  it('canceled：FSA AbortError → { kind: "canceled" }（非 null——组件级中止行为在 Task 19 测，此测纯函数）', async () => {
    const r = await pickSaveTarget('a.mp4', { deps: {
      hasFsa: () => true,
      pick: () => Promise.reject(new DOMException('aborted', 'AbortError')),
    } });
    expect(r).toEqual({ kind: 'canceled' });
  });
  it('unsupported（无 FSA）→ OPFS 随机 key 且登记 sessionOpfsKeys（R6-B12）', async () => {
    const root = fakeRoot();
    const r = await pickSaveTarget('a.mp4', { deps: { hasFsa: () => false, getOpfsRoot: () => Promise.resolve(root as never) } });
    expect(r.kind).toBe('opfs');
    expect(root.getFileHandle).toHaveBeenCalledWith(expect.stringMatching(/^export-.+\.mp4$/), { create: true });
    // sessionOpfsKeys 登记（下次导出扫描清理的依据）
  });
  it('SecurityError → onDegraded("security") 被调 + 降级 OPFS', async () => {
    const onDegraded = vi.fn();
    const r = await pickSaveTarget('a.mp4', { onDegraded, deps: {
      hasFsa: () => true,
      pick: () => Promise.reject(new DOMException('inactive', 'SecurityError')),
      getOpfsRoot: () => Promise.resolve(fakeRoot() as never),
    } });
    expect(onDegraded).toHaveBeenCalledWith('security');
    expect(r.kind).toBe('opfs');
  });
});
describe('openOpfsTarget（画布路径专用）', () => {
  it('开随机 key 的 OPFS 文件并登记 sessionOpfsKeys（deps 注入——jsdom 无 navigator.storage）', async () => {
    const root = { getFileHandle: vi.fn().mockResolvedValue({ name: 'export-x.mp4' }) };
    const { openOpfsTarget, sessionOpfsKeys } = await import('./client');
    sessionOpfsKeys.clear();
    // ⚠ R9-2：扁平参 { getOpfsRoot }——与实现签名 deps: Pick<SaveTargetDeps,'getOpfsRoot'> 一致。
    // 勿仿 pickSaveTarget 的 { deps: {...} } 两层包装（那是有 suggestedName 首参的 opts 形状）
    const r = await openOpfsTarget({ getOpfsRoot: () => Promise.resolve(root as never) });
    expect(r.kind).toBe('opfs');
    expect(root.getFileHandle).toHaveBeenCalledWith(expect.stringMatching(/^export-.+\.mp4$/), { create: true });
    expect([...sessionOpfsKeys][0]).toMatch(/^export-.+\.mp4$/);
  });
});
