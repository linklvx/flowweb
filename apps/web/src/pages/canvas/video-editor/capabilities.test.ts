import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectVideoEditorCapabilities, detectExportCapabilities } from './capabilities';

describe('detectVideoEditorCapabilities（编辑入口分层检测：解码器三件）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('VideoDecoder+AudioDecoder+OffscreenCanvas 全有 → canPreview true', () => {
    vi.stubGlobal('VideoDecoder', function () {});
    vi.stubGlobal('AudioDecoder', function () {});
    vi.stubGlobal('OffscreenCanvas', function () {});
    expect(detectVideoEditorCapabilities().canPreview).toBe(true);
  });
  it('缺 VideoDecoder → false', () => {
    vi.stubGlobal('AudioDecoder', function () {});
    vi.stubGlobal('OffscreenCanvas', function () {});
    expect(detectVideoEditorCapabilities().canPreview).toBe(false);
  });
  it('缺 OffscreenCanvas → false', () => {
    vi.stubGlobal('VideoDecoder', function () {});
    vi.stubGlobal('AudioDecoder', function () {});
    expect(detectVideoEditorCapabilities().canPreview).toBe(false);
  });
});

describe('detectExportCapabilities（导出编码器检测）', () => {
  beforeEach(() => {
    vi.stubGlobal('VideoEncoder', class {}); // 绕过短路分支——mock deps 才能被消费
    vi.stubGlobal('AudioEncoder', class {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('mediabunny canEncodeVideo(avc, 1080p 码率) + AAC 检测→polyfill 注册→复测', async () => {
    const canEncodeVideo = vi.fn().mockResolvedValue(true);
    const canEncodeAudio = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const registerAacEncoder = vi.fn();
    const r = await detectExportCapabilities({
      loadMediabunny: async () => ({ canEncodeVideo, canEncodeAudio }) as never,
      loadAacPolyfill: async () => ({ registerAacEncoder }) as never,
    });
    expect(r).toEqual({ video: true, audio: true });
    expect(canEncodeVideo).toHaveBeenCalledWith('avc', expect.objectContaining({ width: 1920, height: 1080 }));
    expect(registerAacEncoder).toHaveBeenCalledTimes(1); // 缺失时静态 polyfill
  });

  it('polyfill 注册后复测仍 false → { video: false, audio: false }（注册不改变结论）', async () => {
    const canEncodeVideo = vi.fn().mockResolvedValue(false);
    const canEncodeAudio = vi.fn().mockResolvedValue(false);
    const registerAacEncoder = vi.fn();
    const r = await detectExportCapabilities({
      loadMediabunny: async () => ({ canEncodeVideo, canEncodeAudio }) as never,
      loadAacPolyfill: async () => ({ registerAacEncoder }) as never,
    });
    expect(r).toEqual({ video: false, audio: false });
    expect(registerAacEncoder).toHaveBeenCalledTimes(1);
  });

  it('WebCodecs 全无（不 stub）→ 首行短路 { video: false, audio: false }，deps 不被消费', async () => {
    vi.unstubAllGlobals(); // 本用例内撤销 stub——短路分支专属
    const loadMediabunny = vi.fn();
    const r = await detectExportCapabilities({ loadMediabunny, loadAacPolyfill: vi.fn() });
    expect(r).toEqual({ video: false, audio: false });
    expect(loadMediabunny).not.toHaveBeenCalled();
  });
});
