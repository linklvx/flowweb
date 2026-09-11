import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, type MockInstance } from 'vitest';
const dispose = vi.fn();
const getCanvas = vi.fn();
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [],
  Input: class { constructor(public opts: unknown) {} // eslint-disable-line
    getPrimaryVideoTrack = vi.fn().mockResolvedValue({ canDecode: () => Promise.resolve(true) });
    dispose = dispose; },
  UrlSource: class { constructor(public url: string) {} }, // eslint-disable-line
  CanvasSink: class { constructor(public track: unknown, public opts: unknown) {} // eslint-disable-line
    getCanvas = (ts: number) => getCanvas(ts); },
}));
// （TDZ 注意：vi.mock 工厂引用上方 const——工厂在首次动态 import 时才执行，届时模块顶层 const 已初始化；
//  实测若报 Cannot access before initialization 改 vi.hoisted() 包一层）
import { ensurePoster } from './poster';
// out canvas 桩——toJpegDataUrl 内部 document.createElement('canvas') 产物（jsdom 无 canvas 包必须桩）：
const outCtx = { drawImage: vi.fn() };
const outCanvas = { getContext: () => outCtx, toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,OUT') } as unknown as HTMLCanvasElement;
let createElementSpy: MockInstance | null = null; // 裸 MockInstance（先例 useThumbnails.test.ts 同款）——ReturnType<typeof vi.spyOn> 推导与重载签名不兼容
beforeAll(() => {
  const orig = document.createElement.bind(document);
  createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(
    ((tag: string, ...rest: any[]) => (tag === 'canvas' ? outCanvas : orig(tag, ...rest))) as typeof document.createElement, // any[]：createElement 重载第二参窄型，先例 useThumbnails.test.ts 同款
  );
});
afterAll(() => { createElementSpy?.mockRestore(); });
beforeEach(() => { dispose.mockClear(); getCanvas.mockClear(); outCtx.drawImage.mockClear(); }); // 模块级 vi.fn 跨用例累积——手动清
const mkCanvas = (w: number) => ({ width: w, height: Math.round(w * 9 / 16),   // 源 canvas——只进 mock 链路
  getContext: () => ({ drawImage: vi.fn() }),
  toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,AAA') } as unknown as HTMLCanvasElement);
const wrapped = (c: HTMLCanvasElement) => ({ canvas: c, timestamp: 0, duration: 0.04 }); // WrappedCanvas 形状
describe('ensurePoster（一次性首帧海报）', () => {
  it('成功：getCanvas(0) → frame.canvas → 恒绘制进新 canvas（≤320 宽）→ JPEG dataURL，且 Input.dispose 用后即调', async () => {
    getCanvas.mockResolvedValue(wrapped(mkCanvas(1920)));  // 源 1920 宽——必须缩到 320
    const r = await ensurePoster('http://x/v.mp4');
    expect(r).toMatch(/^data:image\/jpeg;base64,/);
    expect(getCanvas).toHaveBeenCalledWith(0);
    expect(outCtx.drawImage).toHaveBeenCalled();           // 经 out canvas 桩绘制（非早退）
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('源 ≤320 宽：同样经新 canvas 输出（恒绘制——顺带归一化 HTMLCanvasElement 类型）', async () => {
    getCanvas.mockResolvedValue(wrapped(mkCanvas(320)));
    expect(await ensurePoster('http://x/v.mp4')).toMatch(/^data:image\/jpeg;base64,/);
  });
  it('失败/无视频轨/getCanvas 返回 null：返回 null（静默保持兜底底色）且 dispose 仍被调（finally）', async () => {
    getCanvas.mockRejectedValue(new Error('decode fail'));
    expect(await ensurePoster('http://x/v.mp4')).toBeNull();
    expect(dispose).toHaveBeenCalled();
    getCanvas.mockResolvedValue(null);
    expect(await ensurePoster('http://x/v.mp4')).toBeNull();
  });
});
