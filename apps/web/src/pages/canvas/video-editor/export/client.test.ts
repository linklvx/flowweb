// apps/web/src/pages/canvas/video-editor/export/client.test.ts
import { describe, it, expect, vi } from 'vitest';

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
      { data: { version: 1, fps: 30, tracks: [], clips: {} } as never, resolution: '720p', mediaUrls: {} },
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
    const p = runExportJob({ data: {} as never, resolution: '720p', mediaUrls: {} }, { onProgress: vi.fn() });
    FakeWorker.instances[0].emit({ type: 'error', category: 'memory', message: 'OOM' });
    await expect(p.promise).rejects.toMatchObject({ category: 'memory' });
    vi.unstubAllGlobals();
  });

  it('cancel() → terminate + reject canceled；进度/eta 回调透传', async () => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
    const { runExportJob } = await import('./client');
    const progress = vi.fn(); const eta = vi.fn();
    const p = runExportJob({ data: {} as never, resolution: '720p', mediaUrls: {} }, { onProgress: progress, onEta: eta });
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
    const p = runExportJob({ data: {} as never, resolution: '720p', mediaUrls: {} }, { onProgress: vi.fn() });
    FakeWorker.instances[0].emit({ type: 'done', buffer: null, fsa: true });
    const r = await p.promise;
    expect(r.blob.size).toBe(0);
    expect(r.fsa).toBe(true);
    vi.unstubAllGlobals();
  });
});
