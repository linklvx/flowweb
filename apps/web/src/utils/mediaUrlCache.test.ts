import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchMediaUrl, getCachedUrl, invalidateMediaUrl, NEAR_EXPIRY_MS,
  prefetchMediaUrls, registerInFlight, hasPendingMediaUrl,
  __setUserIdForTests, __resetMediaCacheForTests, __getCacheSizeForTests, __cachePutForTests,
} from './mediaUrlCache';

// Mock apiFetch（与 useMediaUrl.test.ts 同约定：getMediaUrl → apiFetch）
vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '@/api/client';

beforeEach(() => {
  vi.clearAllMocks();
  __resetMediaCacheForTests();
  __setUserIdForTests('user-cache');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('mediaUrlCache 三档语义（R2b-5 临期窗口）', () => {
  it('NEAR_EXPIRY_MS=60_000（判据单点在缓存层，hook 不得出现第二份阈值）', () => {
    expect(NEAR_EXPIRY_MS).toBe(60_000);
  });

  it('已过期（expiresAt<=now）：未命中 + 删条目（现状语义维持）', () => {
    __cachePutForTests('f-exp', '/flowai/old', 0);   // ttl 0 → expiresAt=now → 立即过期
    expect(getCachedUrl('f-exp')).toBeNull();
    expect(__getCacheSizeForTests()).toBe(0);        // 条目已删（非仅返回 null）
  });

  it('剩余 120s：fresh 命中（stale:false）——双边界之一', () => {
    __cachePutForTests('f-120', '/flowai/fresh', 120);
    expect(getCachedUrl('f-120')).toEqual({ url: '/flowai/fresh', stale: false });
  });

  it('临期边界：剩余恰 60s → stale:true；61s → stale:false——双边界之二', () => {
    vi.useFakeTimers();                              // Date 一并冻结：边界毫秒级可控
    __cachePutForTests('f-b60', '/flowai/a', 60);    // 剩余恰 NEAR_EXPIRY_MS
    expect(getCachedUrl('f-b60')).toEqual({ url: '/flowai/a', stale: true });
    __cachePutForTests('f-b61', '/flowai/b', 61);
    expect(getCachedUrl('f-b61')).toEqual({ url: '/flowai/b', stale: false });
  });

  it('ttlSec NaN：按 0 兜底 → 下次读即过期重取（isFinite 防御——NaN 比较恒假=永不重取的最阴险失败）', () => {
    __cachePutForTests('f-nan', '/flowai/u', Number.NaN);
    expect(getCachedUrl('f-nan')).toBeNull();
  });
});

describe('invalidateMediaUrl（R2b-5 onError 自愈缓存入口）', () => {
  it('cache+pending 同清：在飞去重不再短路拿回同一条坏 URL', async () => {
    let resolveA!: (v: any) => void;
    (apiFetch as any).mockImplementationOnce(() => new Promise((r) => { resolveA = r; }));
    const p1 = fetchMediaUrl('f-inv');               // 在飞（将返回坏 url）
    invalidateMediaUrl('f-inv');                     // cache+pending 同清
    (apiFetch as any).mockResolvedValueOnce({ url: '/flowai/alive', ttlSec: 900 });
    const p2 = fetchMediaUrl('f-inv');               // 若 pending 未清 → 返回 p1（短路）→ 拿回坏 URL
    expect(p2).not.toBe(p1);
    expect(apiFetch).toHaveBeenCalledTimes(2);
    resolveA({ url: '/flowai/dead', ttlSec: 900 });  // 旧在飞晚到
    await expect(p1).resolves.toBe('/flowai/dead');
    await expect(p2).resolves.toBe('/flowai/alive');
  });

  it('在飞期间被 invalidate：旧 promise 完成后身份校验不写回（防坏 URL 带旧 expiresAt 复活）', async () => {
    let resolveA!: (v: any) => void;
    let resolveB!: (v: any) => void;
    (apiFetch as any).mockImplementationOnce(() => new Promise((r) => { resolveA = r; }));
    const p1 = fetchMediaUrl('f-id');
    invalidateMediaUrl('f-id');
    (apiFetch as any).mockImplementationOnce(() => new Promise((r) => { resolveB = r; }));
    const p2 = fetchMediaUrl('f-id');                // 重取（pending 已清 → 新请求）
    resolveA({ url: '/flowai/dead', ttlSec: 900 });  // 旧在飞先完成
    await expect(p1).resolves.toBe('/flowai/dead');
    await new Promise((r) => setTimeout(r, 0));      // 让 p1 的写回（若身份校验缺失）落地
    expect(__getCacheSizeForTests()).toBe(0);        // 坏结果作废未写缓存（此刻 p2 尚未完成）
    resolveB({ url: '/flowai/new', ttlSec: 900 });
    await expect(p2).resolves.toBe('/flowai/new');
    expect(getCachedUrl('f-id')?.url).toBe('/flowai/new');
  });
});

describe('折叠卡批量预取（2d-4：prefetchMediaUrls + registerInFlight）', () => {
  it('prefetchMediaUrls：批量写缓存（显式 userId 键——发起时身份捕获 v5 契约）+ ttlSec NaN isFinite 兜底（0=立即过期）', () => {
    prefetchMediaUrls([
      { fileId: 'f-p1', url: '/flowai/p1', ttlSec: 120 },
      { fileId: 'f-p2', url: '/flowai/p2', ttlSec: Number.NaN },
    ], 'user-batch');
    __setUserIdForTests('user-batch');               // 读侧换到写入身份：证明写进了显式传入的 userId 键
    expect(getCachedUrl('f-p1')).toEqual({ url: '/flowai/p1', stale: false });
    expect(getCachedUrl('f-p2')).toBeNull();         // NaN → 0 → 立即过期（isFinite 防御）
  });

  it('registerInFlight：resolve 回填缓存（绝对时间形）+ pending 位清除；hasPendingMediaUrl 在飞可探测', async () => {
    let resolveP!: (v: { url: string; ttlSec: number }) => void;
    registerInFlight('f-reg', new Promise((r) => { resolveP = r; }));
    expect(hasPendingMediaUrl('f-reg')).toBe(true);  // 开位：并发 tile 挂载去重共享
    expect(getCachedUrl('f-reg')).toBeNull();
    resolveP({ url: '/flowai/reg', ttlSec: 120 });
    await new Promise((r) => setTimeout(r, 0));      // 微任务冲刷：写回+finally 落地
    expect(getCachedUrl('f-reg')).toEqual({ url: '/flowai/reg', stale: false });
    expect(hasPendingMediaUrl('f-reg')).toBe(false);
  });

  it('registerInFlight 回填身份校验（同 2b-5 invalidate 竞态）：在飞被 invalidate 后批量晚到 → 校验 pending 身份不等则丢弃不写回', async () => {
    let resolveBatch!: (v: { url: string; ttlSec: number }) => void;
    registerInFlight('f-race', new Promise((r) => { resolveBatch = r; }));
    invalidateMediaUrl('f-race');                    // onError 自愈：cache+pending 同清
    (apiFetch as any).mockResolvedValueOnce({ url: '/flowai/fresh', ttlSec: 900 });
    const p2 = fetchMediaUrl('f-race');              // 继任单取占住 pending 位
    resolveBatch({ url: '/flowai/stale', ttlSec: 120 });  // 批量晚到
    await p2;
    await new Promise((r) => setTimeout(r, 0));
    expect(getCachedUrl('f-race')?.url).toBe('/flowai/fresh');  // 批量旧结果被身份校验丢弃
    expect(hasPendingMediaUrl('f-race')).toBe(false);           // 继任条目未被误删（p2 自清）
  });

  it('registerInFlight reject：仅清 pending 位不写缓存（非阻塞——tile 回落单取）+ 拒绝静默无 unhandled', async () => {
    let rejectP!: (e: Error) => void;
    registerInFlight('f-err', new Promise((_, rej) => { rejectP = rej; }));
    rejectP(new Error('batch fail'));
    await new Promise((r) => setTimeout(r, 0));
    expect(hasPendingMediaUrl('f-err')).toBe(false);
    expect(__getCacheSizeForTests()).toBe(0);
  });

  it('registerInFlight 幂等：cache/pending 已覆盖 → 不重复开位（StrictMode 双跑/shared fileId 也 ≤1 batch）', async () => {
    __cachePutForTests('f-cov', '/flowai/cached', 120);
    registerInFlight('f-cov', Promise.resolve({ url: '/flowai/newer', ttlSec: 120 }));   // cache 已覆盖 → 拦截
    registerInFlight('f-dup', Promise.resolve({ url: '/flowai/a', ttlSec: 120 }));
    registerInFlight('f-dup', Promise.resolve({ url: '/flowai/b', ttlSec: 120 }));       // pending 已覆盖 → 拦截
    await new Promise((r) => setTimeout(r, 0));
    expect(getCachedUrl('f-cov')?.url).toBe('/flowai/cached');  // 未被覆盖写回
    expect(getCachedUrl('f-dup')?.url).toBe('/flowai/a');       // 首注册者持有写回权
  });
});
