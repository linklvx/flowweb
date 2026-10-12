// apps/web/src/api/storageApi.test.ts
// Y0b-5 T9 Step2：上传路径 503 语义化——withSyncRetry 扩消费（executionApi.test.ts:94 既有形态；
// 禁三处复制——上传两端点消费 executionApi 的同一 withSyncRetry 单源，spec §5.3「执行/保存/上传路径」）。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const messageWarning = vi.hoisted(() => vi.fn());
vi.mock('antd', () => ({ message: { warning: messageWarning, info: vi.fn() } }));
vi.mock('@/stores/canvasCollabRuntime', () => ({
  getStateVector: () => '',
  forceSyncAndWaitUnsynced: vi.fn(async () => true),
}));

const { presignUpload, confirmUpload } = await import('./storageApi');

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
const unavailable = (retryAfter?: number) => new Response(
  JSON.stringify({ message: 'Service Unavailable' }),
  { status: 503, headers: retryAfter != null ? { 'retry-after': String(retryAfter) } : {} },
);

describe('Y0b-5 T9：上传路径 503 语义化（withSyncRetry 扩消费——Retry-After 后恰重试一次）', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('presignUpload：503+Retry-After → 维护提示+等待 retryAfter 后重试恰一次', async () => {
    vi.useFakeTimers();
    try {
      fetchSpy.mockResolvedValueOnce(unavailable(2)).mockResolvedValueOnce(ok({ fileId: 'f1', uploadUrl: 'u', key: 'k', fields: {} }));
      const pending = presignUpload({ fileName: 'a.png', fileSize: 1, fileType: 'image/png', type: 'uploaded' });
      await vi.advanceTimersByTimeAsync(2_000);   // Retry-After=2s——等待窗内不重试
      expect(await pending).toMatchObject({ fileId: 'f1' });
      expect(messageWarning).toHaveBeenCalledWith('服务重启/维护中，请稍后重试');
      expect(fetchSpy).toHaveBeenCalledTimes(2);  // 恰一次重试——不循环
    } finally { vi.useRealTimers(); }
  });

  it('confirmUpload：重试再 503 → 抛出不循环（恰两次 fetch）；503 缺 Retry-After → 直接抛零重试', async () => {
    vi.useFakeTimers();
    try {
      fetchSpy.mockResolvedValue(unavailable(1));
      const pending = confirmUpload({ fileId: 'f1', key: 'k', fileSize: 1 }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await pending).toMatchObject({ status: 503 });
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      fetchSpy.mockClear();
      messageWarning.mockClear();   // 前段重试路径已合法触发一次提示——后段（缺 Retry-After 档）独立断言
      fetchSpy.mockResolvedValueOnce(unavailable());
      await expect(confirmUpload({ fileId: 'f1', key: 'k', fileSize: 1 })).rejects.toMatchObject({ status: 503 });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(messageWarning).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
