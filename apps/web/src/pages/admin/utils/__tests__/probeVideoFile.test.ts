import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react'; // waitFor 必须显式 import——globals:true 只给 vitest 全局（VideoWorksPage.test.tsx:2 同款）
import { probeVideoFile } from '../probeVideoFile';

// jsdom 无 URL.createObjectURL/revokeObjectURL——直接赋桩 + 还原（ExportModal.test.tsx:148-152 先例；
// 勿 vi.stubGlobal('URL', {...URL}) 整体替换——同文件任何 new URL(...) 会变 "not a constructor"）
const urlBag = URL as unknown as { createObjectURL: () => string; revokeObjectURL: () => void };
const origCreate = urlBag.createObjectURL;
const origRevoke = urlBag.revokeObjectURL;
const createObjectURL = vi.fn().mockReturnValue('blob:mock');
const revokeObjectURL = vi.fn();

// jsdom 的 duration/videoWidth/videoHeight/readyState 是只读 IDL 属性（ESM 严格模式直赋抛 TypeError）——
// 四处全走 defineProperty（VideoGenNode.test.tsx:376-377 先例）；readyState 默认 0，不 stub 抽帧会被跳过。
// canvas getContext jsdom 默认 null——createElement spy 里一并 stub（EraseCanvas/PreviewPlayer 先例）。
const def = (el: HTMLElement, prop: string, value: unknown) =>
  Object.defineProperty(el, prop, { value, configurable: true });

const setupSpies = () => {
  const orig = document.createElement.bind(document);
  let video: HTMLVideoElement | null = null;
  const toBlob = vi.fn((cb: (b: Blob | null) => void) => cb(new Blob(['x'], { type: 'image/jpeg' })));
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = orig(tag);
    if (tag === 'video') video = el as HTMLVideoElement;
    if (tag === 'canvas') {
      (el as HTMLCanvasElement).getContext = () => ({ drawImage: vi.fn() } as any);
      (el as HTMLCanvasElement).toBlob = toBlob as any;
    }
    return el;
  });
  return { get video() { return video!; }, toBlob };
};

describe('probeVideoFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    urlBag.createObjectURL = createObjectURL as any;
    urlBag.revokeObjectURL = revokeObjectURL as any;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    urlBag.createObjectURL = origCreate;
    urlBag.revokeObjectURL = origRevoke;
  });

  it('loadedmetadata → 元数据（12.345 → durationSec=12 钉取整）+ seeked → 抽帧 coverBlob', async () => {
    const spy = setupSpies();
    const p = probeVideoFile(new File(['x'], 'a.mp4', { type: 'video/mp4' }));
    const v = spy.video; // createElement 同步执行——无需 waitFor
    def(v, 'duration', 12.345); def(v, 'videoWidth', 1920); def(v, 'videoHeight', 1080); def(v, 'readyState', 2);
    fireEvent(v, new Event('loadedmetadata'));
    // jsdom 的 currentTime setter 只写字段不发 seeked——同步点：实现已执行 currentTime = min(1, 12.345/2)
    await waitFor(() => expect(v.currentTime).toBe(1));
    fireEvent(v, new Event('seeked'));
    const r = await p;
    expect(r).toEqual({ ok: true, durationSec: 12, width: 1920, height: 1080, coverBlob: expect.any(Blob) });
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it('video error → { ok:false, reason:"decode" }（可播放性闸门——拦 HEVC/ProRes/.mov）', async () => {
    const spy = setupSpies();
    const p = probeVideoFile(new File(['x'], 'a.mov', { type: 'video/quicktime' }));
    fireEvent(spy.video, new Event('error'));
    await expect(p).resolves.toEqual({ ok: false, reason: 'decode' });
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it('数值守卫：duration=Infinity / 宽高=0 / readyState<2 → 字段 null + 抽帧跳过，非整体失败（真实 MP4 形态）', async () => {
    const spy = setupSpies();
    const p = probeVideoFile(new File(['x'], 'a.mp4', { type: 'video/mp4' }));
    const v = spy.video;
    def(v, 'duration', Infinity); def(v, 'videoWidth', 0); def(v, 'videoHeight', 0); def(v, 'readyState', 0);
    fireEvent(v, new Event('loadedmetadata'));
    const r = await p; // 守卫跳过抽帧——无需 seeked，直接 settle
    expect(r).toEqual({ ok: true, durationSec: null, width: null, height: null, coverBlob: null });
  });

  it('duration=Infinity + readyState≥2 → durationSec=null 但抽帧照走且 currentTime=1（第十轮：守卫拦 duration 勿 seek(0)——前导黑帧高发，数值守卫与抽帧互不阻断的正例）', async () => {
    const spy = setupSpies();
    const p = probeVideoFile(new File(['x'], 'a.mp4', { type: 'video/mp4' }));
    const v = spy.video;
    def(v, 'duration', Infinity); def(v, 'videoWidth', 1280); def(v, 'videoHeight', 720); def(v, 'readyState', 2);
    fireEvent(v, new Event('loadedmetadata'));
    await waitFor(() => expect(v.currentTime).toBe(1)); // 非 0——rawDuration=0 分支的 seek 目标（防回归 seek(0) 抽黑帧）
    fireEvent(v, new Event('seeked'));
    const r = await p;
    expect(r).toEqual({ ok: true, durationSec: null, width: 1280, height: 720, coverBlob: expect.any(Blob) });
  });

  it('metadata 正常但 seeked 永不到来 → captureFrame 超时兜底 coverBlob=null（真实浏览器 seek 偶尔不回调——实现必须兜底防挂死）', async () => {
    vi.useFakeTimers();
    try {
      const spy = setupSpies();
      const p = probeVideoFile(new File(['x'], 'a.mp4', { type: 'video/mp4' }));
      const v = spy.video;
      def(v, 'duration', 30); def(v, 'videoWidth', 1280); def(v, 'videoHeight', 720); def(v, 'readyState', 2);
      fireEvent(v, new Event('loadedmetadata'));
      await vi.advanceTimersByTimeAsync(5_000); // CAPTURE_TIMEOUT_MS
      const r = await p;
      expect(r).toEqual({ ok: true, durationSec: 30, width: 1280, height: 720, coverBlob: null }); // 不挂死、元数据照返
    } finally { vi.useRealTimers(); }
  });

  it('事件永不触发 → 10s 超时 decode，且清理真实发生（revokeObjectURL 调用 + src 清空）', async () => {
    vi.useFakeTimers();
    try {
      const spy = setupSpies();
      const p = probeVideoFile(new File(['x'], 'a.mp4', { type: 'video/mp4' }));
      const v = spy.video;
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(p).resolves.toEqual({ ok: false, reason: 'decode' });
      expect(revokeObjectURL).toHaveBeenCalled();
      expect(v.getAttribute('src')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
