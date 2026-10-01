// apps/web/src/utils/batchDownload.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  downloadMediaFile: vi.fn(),
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('./mediaDownload', () => ({ downloadMediaFile: mocks.downloadMediaFile }));
vi.mock('antd', () => ({
  Modal: { confirm: mocks.confirm },
  message: { success: mocks.success, error: mocks.error },
}));

import { runBatchDownload } from './batchDownload';
import type { DownloadableItem } from './collectDownloadables';

const HINT_KEY = 'flowweb_batch_dl_hint';

const mkItems = (n: number): DownloadableItem[] =>
  Array.from({ length: n }, (_, i) => ({ fileId: `f${i}`, filename: `文件${i}.png`, type: 'imageGen' }));

describe('runBatchDownload（串行节流 + 双模态门禁 + 聚合提示）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    localStorage.removeItem(HINT_KEY);
    localStorage.setItem(HINT_KEY, '1'); // 默认已许可——首跑 hint 仅专测
    mocks.downloadMediaFile.mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem(HINT_KEY);
  });

  it('3 项：串行逐个 downloadMediaFile（silent:true、起始间隔 300ms）+ 聚合成功提示', async () => {
    const items = mkItems(3);
    const p = runBatchDownload(items);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.downloadMediaFile).toHaveBeenCalledTimes(1);
    expect(mocks.downloadMediaFile).toHaveBeenNthCalledWith(1, items[0], { silent: true });
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.downloadMediaFile).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.downloadMediaFile).toHaveBeenCalledTimes(3);
    expect(mocks.downloadMediaFile).toHaveBeenNthCalledWith(3, items[2], { silent: true });
    await p;
    expect(mocks.success).toHaveBeenCalledWith('已下载 3 个文件');
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('11 项（>10）：数量确认（title=批量下载 + content 含数量）；onCancel → 零下载零提示', async () => {
    const p = runBatchDownload(mkItems(11));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    const arg = mocks.confirm.mock.calls[0][0];
    expect(arg.title).toBe('批量下载');
    expect(arg.content).toBe('将下载 11 个文件，可能占用较多资源，是否继续？');
    expect(mocks.downloadMediaFile).not.toHaveBeenCalled();
    arg.onCancel();
    await p;
    expect(mocks.downloadMediaFile).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('首跑许可：无 localStorage 键 → 先弹 hint（确定→落键并继续）；取消→中止且键不落；二跑不再弹', async () => {
    localStorage.removeItem(HINT_KEY);
    const p = runBatchDownload(mkItems(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    const hint = mocks.confirm.mock.calls[0][0];
    expect(hint.content).toBe('浏览器将开始下载多个文件');
    hint.onOk();
    await vi.advanceTimersByTimeAsync(300);
    await p;
    expect(localStorage.getItem(HINT_KEY)).toBe('1');
    expect(mocks.downloadMediaFile).toHaveBeenCalledTimes(2);

    // 二跑：键已落 → 无 hint 直接下载
    mocks.confirm.mockClear();
    mocks.downloadMediaFile.mockClear();
    mocks.success.mockClear();
    const p2 = runBatchDownload(mkItems(1));
    await vi.advanceTimersByTimeAsync(0);
    await p2;
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.downloadMediaFile).toHaveBeenCalledTimes(1);

    // 首跑取消路径：清键 → hint 弹出 → onCancel → 中止 + 键不落
    localStorage.removeItem(HINT_KEY);
    mocks.confirm.mockClear();
    mocks.downloadMediaFile.mockClear();
    const p3 = runBatchDownload(mkItems(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    mocks.confirm.mock.calls[0][0].onCancel();
    await p3;
    expect(localStorage.getItem(HINT_KEY)).toBeNull();
    expect(mocks.downloadMediaFile).not.toHaveBeenCalled();
  });

  it('混合结果：2 ok 1 fail → 「已下载 2 个文件，1 个失败」', async () => {
    mocks.downloadMediaFile
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, reason: 'fetch-failed' });
    const p = runBatchDownload(mkItems(3));
    await vi.advanceTimersByTimeAsync(600);
    await p;
    expect(mocks.success).toHaveBeenCalledWith('已下载 2 个文件，1 个失败');
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('空集 no-op：无模态、无下载、无提示', async () => {
    await runBatchDownload([]);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.downloadMediaFile).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('localStorage 键名为下划线式 flowweb_batch_dl_hint（仓内 flowweb_ 前缀惯例，非驼峰）', async () => {
    localStorage.removeItem(HINT_KEY);
    const p = runBatchDownload(mkItems(1));
    await vi.advanceTimersByTimeAsync(0);
    mocks.confirm.mock.calls[0][0].onOk();
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(localStorage.getItem('flowweb_batch_dl_hint')).not.toBeNull();
    expect(localStorage.getItem('flowwebBatchDlHint')).toBeNull();
  });

  it('首跑 + 超量：hint 先于数量确认（hint=浏览器行为一次性说明；count=每跑确认）', async () => {
    localStorage.removeItem(HINT_KEY);
    const p = runBatchDownload(mkItems(11));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.confirm.mock.calls[0][0].content).toBe('浏览器将开始下载多个文件');
    mocks.confirm.mock.calls[0][0].onOk();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
    expect(mocks.confirm.mock.calls[1][0].content).toContain('11 个文件');
    mocks.confirm.mock.calls[1][0].onOk();
    await vi.advanceTimersByTimeAsync(10 * 300);
    await p;
    expect(mocks.downloadMediaFile).toHaveBeenCalledTimes(11);
  });
});
