import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMediaUrl } from './useMediaUrl';

// Mock apiFetch
vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '@/api/client';
import { __setUserIdForTests, __resetMediaCacheForTests, __getCacheSizeForTests, __cachePutForTests } from '@/utils/mediaUrlCache';

beforeEach(() => {
  vi.clearAllMocks();
  __resetMediaCacheForTests();        // v3：模块级缓存跨用例残留是既有 4 条用例的隐形破坏者
  __setUserIdForTests('user-a');
});

describe('useMediaUrl', () => {

  it('should return null url and loading=false when fileId is null', () => {
    const { result } = renderHook(() => useMediaUrl(null));
    expect(result.current.url).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should fetch URL and return it', async () => {
    (apiFetch as any).mockResolvedValueOnce({ url: 'http://minio/path?X-Amz=...' });
    const { result } = renderHook(() => useMediaUrl('file-1'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.url).toBe('http://minio/path?X-Amz=...');
    expect(result.current.error).toBeNull();
  });

  it('should set error on fetch failure', async () => {
    (apiFetch as any).mockRejectedValueOnce(new Error('Not found'));
    const { result } = renderHook(() => useMediaUrl('file-2'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.url).toBeNull();
  });

  it('should handle undefined fileId same as null', () => {
    const { result } = renderHook(() => useMediaUrl(undefined));
    expect(result.current.url).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});

describe('useMediaUrl 完整缓存（R0c v2——用户拍板提前）', () => {
  it('同 fileId 二次挂载 0 请求（缓存命中，未过期）', async () => {
    (apiFetch as any).mockResolvedValue({ url: '/flowai/u1', ttlSec: 900 });
    const first = renderHook(() => useMediaUrl('f1'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    first.unmount();
    const second = renderHook(() => useMediaUrl('f1'));
    await waitFor(() => expect(second.result.current.url).toBe('/flowai/u1'));
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('ttlSec 缺失/NaN：兜底按 0——立即过期，下次挂载重取（isFinite 兜底）', async () => {
    (apiFetch as any).mockResolvedValueOnce({ url: '/flowai/u1' });
    const { unmount } = renderHook(() => useMediaUrl('f2'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    unmount();
    const again = renderHook(() => useMediaUrl('f2'));
    await waitFor(() => expect(again.result.current.url).toBe('/flowai/u1'));
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('切 userId 不串图（键含用户维度——A 缓存的 URL 对 B 是 miss）', async () => {
    (apiFetch as any).mockResolvedValue({ url: '/flowai/a-url', ttlSec: 900 });
    const a = renderHook(() => useMediaUrl('f3'));
    await waitFor(() => expect(a.result.current.url).toBe('/flowai/a-url'));
    a.unmount();
    __setUserIdForTests('user-b');
    (apiFetch as any).mockResolvedValue({ url: '/flowai/b-url', ttlSec: 900 });
    const b = renderHook(() => useMediaUrl('f3'));
    await waitFor(() => expect(b.result.current.url).toBe('/flowai/b-url'));
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('同 fileId 并发挂载共享单请求（in-flight 去重）', async () => {
    let resolveFetch!: (v: any) => void;
    (apiFetch as any).mockImplementationOnce(() => new Promise((r) => { resolveFetch = r; }));
    const a = renderHook(() => useMediaUrl('f4'));
    const b = renderHook(() => useMediaUrl('f4'));
    resolveFetch({ url: '/flowai/shared', ttlSec: 900 });
    await waitFor(() => expect(a.result.current.url).toBe('/flowai/shared'));
    await waitFor(() => expect(b.result.current.url).toBe('/flowai/shared'));
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('fileId 快速切换：旧响应晚到不覆盖新 url（cancelled 竞态保护）', async () => {
    let resolveOld!: (v: any) => void;
    (apiFetch as any).mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }));
    (apiFetch as any).mockResolvedValueOnce({ url: '/flowai/new', ttlSec: 900 });
    const { result, rerender } = renderHook(({ id }) => useMediaUrl(id), { initialProps: { id: 'f-old' } });
    rerender({ id: 'f-new' });
    await waitFor(() => expect(result.current.url).toBe('/flowai/new'));
    resolveOld({ url: '/flowai/stale', ttlSec: 900 });
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.url).toBe('/flowai/new'); // 旧响应被 cancelled 丢弃
  });

  it('currentUserId 未就绪（null）：直取不入缓存（防 ":fileId" 孤儿键——AuthProvider 渲染期写入前的窗口兜底）', async () => {
    __setUserIdForTests(null);
    (apiFetch as any).mockResolvedValue({ url: '/flowai/orphan', ttlSec: 900 });
    const first = renderHook(() => useMediaUrl('f5'));
    await waitFor(() => expect(first.result.current.url).toBe('/flowai/orphan'));
    expect(__getCacheSizeForTests()).toBe(0);   // 未入缓存
    first.unmount();
    __setUserIdForTests('user-a');
    const second = renderHook(() => useMediaUrl('f5'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2)); // 有身份后正常取+缓存
  });

  it('LRU 上限 64：超出淘汰最旧（v4 纯函数测点——65 次 renderHook 降为 0）', () => {
    // 前提（v5 写死）：beforeEach 已设 userId='user-a'——__cachePutForTests 内部经 cacheKey(fileId) 含当前 userId；
    // 本用例依赖 65 个 fileId 互异 ⇒ 65 个互异键。挪去无 userId 的 describe 前先重估键空间。
    for (let i = 0; i < 65; i++) __cachePutForTests(`lru-${i}`, `/flowai/f-${i}`, 900);
    expect(__getCacheSizeForTests()).toBe(64);   // 第 1 条被淘汰
  });

  it('身份就绪后以新键重取一次：null 窗口取的 url 在新响应到达前保持展示（契约钉，v5——原"不重取"断言与 uid dep 自相矛盾必红）', async () => {
    // v5 推演：rerender → uid null→'user-a' → effect 重跑 → cacheGet('user-a:f6') miss（null 窗口未入缓存）
    // → 二次 fetch——这正是 uid dep 的语义（身份切换重评估）；断言"1 次"必红（用例与实现互相否定）。
    __setUserIdForTests(null);
    (apiFetch as any).mockResolvedValueOnce({ url: '/flowai/pre-auth', ttlSec: 900 });
    const h = renderHook(() => useMediaUrl('f6'));
    await waitFor(() => expect(h.result.current.url).toBe('/flowai/pre-auth'));
    __setUserIdForTests('user-a');
    (apiFetch as any).mockResolvedValueOnce({ url: '/flowai/post-auth', ttlSec: 900 });
    h.rerender();                                  // uid 变 → effect 重评估
    expect(h.result.current.url).toBe('/flowai/pre-auth');   // 新响应前旧 url 不清空（实现只 setError 不清 url）
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));   // 新键 miss → 重取一次
    await waitFor(() => expect(h.result.current.url).toBe('/flowai/post-auth'));
  });

  it('在飞请求跨换号完成：只写回自己的键（不污染新用户缓存——key 发起时捕获契约，v5）', async () => {
    __setUserIdForTests('user-a');
    let resolveA!: (v: any) => void;
    (apiFetch as any).mockImplementationOnce(() => new Promise((r) => { resolveA = r; }));
    const a = renderHook(() => useMediaUrl('f7'));
    __setUserIdForTests('user-b');                 // 换号（不 reset cache——模拟登出只清 cache 保留 pending）
    a.unmount();                                   // cancelled 只挡 hook setState，不挡缓存层写回
    resolveA({ url: '/flowai/a-only', ttlSec: 900 });   // A 的在飞响应晚到：闭包捕获 key='user-a:f7'
    await new Promise((r) => setTimeout(r, 10));
    (apiFetch as any).mockResolvedValue({ url: '/flowai/b-only', ttlSec: 900 });
    const b = renderHook(() => useMediaUrl('f7')); // B 取自己的
    await waitFor(() => expect(b.result.current.url).toBe('/flowai/b-only'));
    expect(apiFetch).toHaveBeenCalledTimes(2);
    __setUserIdForTests('user-a');
    const a2 = renderHook(() => useMediaUrl('f7'));     // A 回来：自己的缓存未被 B 污染（各写各键）
    await waitFor(() => expect(a2.result.current.url).toBe('/flowai/a-only'));   // 命中 A 键缓存——0 新请求
    expect(apiFetch).toHaveBeenCalledTimes(2);      // 若实现误按"调用时刻重算 key"，A 的响应会写进 B 的键 → 此处必红
  });
});
