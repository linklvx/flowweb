import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadMediaFile } from './mediaDownload';

// jsdom 未实现 URL.createObjectURL/revokeObjectURL——补最小桩使下方 spyOn 有宿主方法（环境 shim，同 test-setup 先例）
if (!URL.createObjectURL) (URL as any).createObjectURL = () => '';
if (!URL.revokeObjectURL) (URL as any).revokeObjectURL = () => {};

function stubAnchor() {
  const click = vi.fn();
  const a: any = { click, href: '', download: '', style: {}, remove: vi.fn() };
  // 限定 tag==='a' 才返回桩——全量 mockReturnValue 会把 document.body.appendChild 等其他 createElement 一并卷进桩
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => tag === 'a' ? a : document.createElementNS('http://www.w3.org/1999/xhtml', tag)) as any);
  // 桩 a 非 Node，真 appendChild 会 throw（被外层 catch 吞成 fetch-failed）——置空
  vi.spyOn(document.body, 'appendChild').mockImplementation((n: Node) => n);
  return { a, click };
}

describe('downloadMediaFile（§4.3：url 优先、缺则 fileId 现取、失败重取一次、60s revoke、结果对象）', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('url 直用不查 fileId；a.download=filename；60s 后 revoke（非同步）', async () => {
    const { a, click } = stubAnchor();
    const revoke = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob()) });
    vi.useFakeTimers();
    const r = await downloadMediaFile({ url: 'http://u', filename: '图.png' });
    expect(r).toEqual({ ok: true });
    expect(click).toHaveBeenCalled();
    expect(a.download).toBe('图.png');
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:x');
    vi.useRealTimers();
  });

  it('fetch 失败且有 fileId → 重取一次 URL 再试（两段显式：取 url → fetch 失败 → 重取 url → 再 fetch）', async () => {
    stubAnchor();
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'http://fresh', ttlSec: 900 });
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob()) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:y');
    await downloadMediaFile({ fileId: 'f1', url: 'http://stale', filename: 'x.png', getMediaUrl });
    expect(getMediaUrl).toHaveBeenCalledWith('f1');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fetch 网络异常（throw）且有 fileId → 同样重取一次', async () => {
    stubAnchor();
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'http://fresh', ttlSec: 900 });
    global.fetch = vi.fn()
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob()) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:n');
    const r = await downloadMediaFile({ fileId: 'f1', url: 'http://stale', filename: 'x.png', getMediaUrl });
    expect(r.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('headers 超时（AbortController 新机制）：挂起 fetch + 假定时器 advanceTimersByTime(30_000) → ctrl.abort() 触发 → 有 fileId 时走重取路径二次尝试成功；timer 双路清理（成功/失败都不泄漏）', async () => {
    stubAnchor();
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'http://fresh', ttlSec: 900 });
    global.fetch = vi.fn()
      // 挂死但忠于真 fetch 语义：signal abort → reject（AbortError）；否则 mock 永不 settle，abort 无从生效
      .mockImplementationOnce((_u: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(new Error('AbortError'))); }))
      .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob()) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:t');
    vi.useFakeTimers();
    const p = downloadMediaFile({ fileId: 'f1', url: 'http://stale', filename: 'x.png', getMediaUrl });
    await vi.advanceTimersByTimeAsync(30_000);                      // 触发 abort → 首次 attempt 返回 null → 重取
    const r = await p;
    expect(r.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('最终失败返回 {ok:false, reason}；silent=true 不弹单文件 toast（批路径只聚合）', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('net'));
    const error = vi.fn();
    const { message } = await import('antd');
    vi.spyOn(message, 'error').mockImplementation(error);
    const r = await downloadMediaFile({ url: 'http://u', filename: 'x.png' }, { silent: true });
    expect(r.ok).toBe(false);
    expect(error).not.toHaveBeenCalled();
  });

  it('扩展名映射：无扩展名 filename 按 mimeType 兜底', async () => {
    const { a } = stubAnchor();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob([], { type: 'video/mp4' })) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:z');
    await downloadMediaFile({ url: 'http://u', filename: '视频-abc12' });
    expect(a.download).toBe('视频-abc12.mp4');
  });
});
