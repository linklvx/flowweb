import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
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

// ══ R2b-5 F7 缓存自愈补齐（临期窗口 + onError 失效重取 + 身份校验防脏回写）══
// 分工注记（plan 注记 8）：临期=挂载时余寿不足（第一入口，mount-time）；
// onError=驻留节点 URL 事后死亡（第二入口，resident）。双入口是分工不是冗余——
// 2b-6/2b-7 撤兜底前本组用例必须全绿。

describe('临期窗口（NEAR_EXPIRY_MS=60_000——判据单点在 mediaUrlCache，hook 内不得出现第二份阈值）', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('临期 30s：命中回旧 url + 后台预刷新（二次挂载 0 请求——pending 合并/触发时复查）', async () => {
    vi.useFakeTimers();
    __cachePutForTests('f-near', '/flowai/old', 30);      // 剩余 30s < 60s → 临期档
    let resolveRefresh!: (v: any) => void;
    (apiFetch as any).mockImplementationOnce(() => new Promise((r) => { resolveRefresh = r; }));
    const first = renderHook(() => useMediaUrl('f-near'));
    expect(first.result.current.url).toBe('/flowai/old'); // 立即回旧 url（不等刷新）
    expect(first.result.current.loading).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();              // 预刷新随机延迟 0-5s 未到
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(apiFetch).toHaveBeenCalledTimes(1);            // 后台预刷新恰一次（仍在飞）
    const second = renderHook(() => useMediaUrl('f-near')); // 二次挂载：仍临期 → 回旧 url + 排队预刷新
    expect(second.result.current.url).toBe('/flowai/old');
    resolveRefresh({ url: '/flowai/new', ttlSec: 900 });  // 首次刷新完成入缓存
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); }); // second 预刷新 timer 触发
    expect(apiFetch).toHaveBeenCalledTimes(1);            // second 0 新请求：触发时缓存已 fresh
    expect(second.result.current.url).toBe('/flowai/new');
  });

  it('剩余 120s：零请求（fresh 不排预刷新）', async () => {
    vi.useFakeTimers();
    __cachePutForTests('f-fresh', '/flowai/fresh', 120);
    const h = renderHook(() => useMediaUrl('f-fresh'));
    expect(h.result.current.url).toBe('/flowai/fresh');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(apiFetch).not.toHaveBeenCalled();              // fresh 档零请求
  });

  it('已过期（<=now）：未命中删条目 + 重取（现状语义维持）', async () => {
    __cachePutForTests('f-expired', '/flowai/old', 0);    // ttl 0 → expiresAt=now → 立即过期
    (apiFetch as any).mockResolvedValue({ url: '/flowai/fresh2', ttlSec: 900 });
    const h = renderHook(() => useMediaUrl('f-expired'));
    expect(h.result.current.url).toBeNull();              // 不回旧 url（过期≠临期）
    expect(h.result.current.loading).toBe(true);
    await waitFor(() => expect(h.result.current.url).toBe('/flowai/fresh2'));
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});

describe('onError 失效自愈（useMediaUrl 暴露 onError 给 <img>/<video>/<audio>）', () => {
  it('img 加载失败 → invalidateMediaUrl（cache+pending 同清——只清 cache 会被 in-flight 去重短路拿回同一条坏 URL）→ 重取恰一次；第二次 onError 不再重试', async () => {
    __cachePutForTests('f-err', '/flowai/dead', 900);     // 预置坏 url（模拟 presign 失效）
    let resolveRetry!: (v: any) => void;
    (apiFetch as any).mockImplementationOnce(() => new Promise((r) => { resolveRetry = r; }));
    const h = renderHook(() => useMediaUrl('f-err'));
    expect(h.result.current.url).toBe('/flowai/dead');    // 缓存命中直出
    act(() => { h.result.current.onError(); });           // <img> onError 直通
    expect(h.result.current.url).toBeNull();              // url=null → 占位（禁空串 src）
    expect(h.result.current.loading).toBe(true);
    expect(apiFetch).toHaveBeenCalledTimes(1);            // 重取发起（pending 已清，未被短路）
    const twin = renderHook(() => useMediaUrl('f-err'));  // 并发挂载：合并到同一条重取在飞
    resolveRetry({ url: '/flowai/alive', ttlSec: 900 });
    await waitFor(() => expect(h.result.current.url).toBe('/flowai/alive'));
    await waitFor(() => expect(twin.result.current.url).toBe('/flowai/alive'));
    expect(apiFetch).toHaveBeenCalledTimes(1);            // 重取恰一次
    act(() => { h.result.current.onError(); });           // 第二次 onError
    expect(apiFetch).toHaveBeenCalledTimes(1);            // 一次性重试门：不再重试
    expect(h.result.current.url).toBe('/flowai/alive');   // url 保持展示（不清空）
  });

  it('重取成功：error 清空（error 仅表"取 URL 失败"，自愈成功必须清）', async () => {
    (apiFetch as any).mockRejectedValueOnce(new Error('network down'));   // 先制造取 URL 失败的 error 态
    const h = renderHook(() => useMediaUrl('f-err2'));
    await waitFor(() => expect(h.result.current.error).toBeTruthy());
    expect(h.result.current.url).toBeNull();
    (apiFetch as any).mockResolvedValueOnce({ url: '/flowai/alive2', ttlSec: 900 });
    act(() => { h.result.current.onError(); });           // 自愈启动
    expect(h.result.current.error).toBeNull();            // 启动即清 error（不背负旧失败）
    await waitFor(() => expect(h.result.current.url).toBe('/flowai/alive2'));
    expect(h.result.current.error).toBeNull();            // 重取成功 error 保持空
  });

  it('重取期间 url=null 走占位（禁空串 src）', async () => {
    __cachePutForTests('f-err3', '/flowai/dead3', 900);
    let resolveRetry!: (v: any) => void;
    (apiFetch as any).mockImplementationOnce(() => new Promise((r) => { resolveRetry = r; }));
    const h = renderHook(() => useMediaUrl('f-err3'));
    act(() => { h.result.current.onError(); });
    expect(h.result.current.url).toBeNull();              // 重取在飞窗口：null 占位而非旧坏 url/空串
    expect(h.result.current.loading).toBe(true);
    resolveRetry({ url: '/flowai/alive3', ttlSec: 900 });
    await waitFor(() => expect(h.result.current.url).toBe('/flowai/alive3'));
    expect(h.result.current.loading).toBe(false);
  });
});

describe('长会话恢复', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('假定时器推 900s（presign 15min 寿命耗尽）→ 挂载重取（临期档）；已挂载节点经 onError 恢复出图', async () => {
    vi.useFakeTimers();
    __cachePutForTests('f-long', '/flowai/t0', 900);      // 满血 15min 入场
    const mounted = renderHook(() => useMediaUrl('f-long'));
    expect(mounted.result.current.url).toBe('/flowai/t0');
    mounted.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(850_000); });  // 剩 50s < 60s → 临期档
    (apiFetch as any).mockResolvedValue({ url: '/flowai/t850', ttlSec: 900 });
    const remounted = renderHook(() => useMediaUrl('f-long'));
    expect(remounted.result.current.url).toBe('/flowai/t0');   // 临期档：旧 url 立即回
    expect(apiFetch).not.toHaveBeenCalled();                    // 预刷新延迟未到
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(remounted.result.current.url).toBe('/flowai/t850');  // 预刷新完成
    let resolveRetry!: (v: any) => void;
    (apiFetch as any).mockImplementationOnce(() => new Promise((r) => { resolveRetry = r; }));
    act(() => { remounted.result.current.onError(); });         // 驻留节点 URL 死亡 → 第二入口
    expect(remounted.result.current.url).toBeNull();            // 重取期间占位
    resolveRetry({ url: '/flowai/t-recovered', ttlSec: 900 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(remounted.result.current.url).toBe('/flowai/t-recovered');  // 恢复出图
    expect(apiFetch).toHaveBeenCalledTimes(2);                  // 预刷新 1 + onError 重取 1
  });
});
