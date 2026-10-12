// apps/web/src/api/videoProjectApi.test.ts
// Y0b-5 T9 Step2：保存路径（视频工程自动保存 PATCH——autosave deps.patch）503 语义化——withSyncRetry
// 扩消费（executionApi.test.ts:94 既有形态；禁三处复制——保存消费 executionApi 的同一 withSyncRetry
// 单源，spec §5.3「执行/保存/上传路径」）。409 业务冲突语义保持（自动保存退避梯不被改道）。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const messageWarning = vi.hoisted(() => vi.fn());
vi.mock('antd', () => ({ message: { warning: messageWarning, info: vi.fn() } }));
vi.mock('@/stores/canvasCollabRuntime', () => ({
  getStateVector: () => '',
  forceSyncAndWaitUnsynced: vi.fn(async () => true),
}));

const { patchProject } = await import('./videoProjectApi');

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
const unavailable = (retryAfter?: number) => new Response(
  JSON.stringify({ message: 'Service Unavailable' }),
  { status: 503, headers: retryAfter != null ? { 'retry-after': String(retryAfter) } : {} },
);

describe('Y0b-5 T9：保存路径 503 语义化（withSyncRetry 扩消费——Retry-After 后恰重试一次）', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('patchProject：503+Retry-After → 维护提示+等待 retryAfter 后重试恰一次（保存与执行同族）', async () => {
    vi.useFakeTimers();
    try {
      fetchSpy.mockResolvedValueOnce(unavailable(2)).mockResolvedValueOnce(ok({ id: 'vp1', updatedAt: 't2' }));
      const pending = patchProject('vp1', { data: { x: 1 }, baseUpdatedAt: 't1' });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await pending).toMatchObject({ id: 'vp1', updatedAt: 't2' });
      expect(messageWarning).toHaveBeenCalledWith('服务重启/维护中，请稍后重试');
      expect(fetchSpy).toHaveBeenCalledTimes(2);  // 恰一次重试——不循环
    } finally { vi.useRealTimers(); }
  });

  it('patchProject：重试再 503 → 抛出不循环；409 业务冲突 → 直接抛零重试零 forceSync（退避梯语义保持）', async () => {
    vi.useFakeTimers();
    try {
      fetchSpy.mockResolvedValue(unavailable(1));
      const pending = patchProject('vp1', { data: { x: 1 }, baseUpdatedAt: 't1' }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await pending).toMatchObject({ status: 503 });
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      fetchSpy.mockClear();
      messageWarning.mockClear();   // 前段重试路径已合法触发一次提示——后段（409 档）独立断言
      const conflict = () => new Response(
        JSON.stringify({ message: 'conflict', errorCode: 'VIDEO_PROJECT_CONFLICT' }),
        { status: 409 },
      );
      fetchSpy.mockResolvedValueOnce(conflict());
      await expect(patchProject('vp1', { data: { x: 1 }, baseUpdatedAt: 't1' })).rejects.toMatchObject({ status: 409 });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(messageWarning).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
