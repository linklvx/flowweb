import { describe, it, expect, afterEach, vi } from 'vitest';
import { detectVideoEditorCapabilities } from './capabilities';

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
