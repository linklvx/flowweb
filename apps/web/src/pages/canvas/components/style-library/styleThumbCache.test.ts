import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStyleThumb, styleThumbCacheMap } from './styleThumbCache';
import * as api from '@/api/stylesApi';

vi.mock('@/api/stylesApi', () => ({ fetchStyleById: vi.fn() }));

describe('styleThumbCache（TTL 缓存 {styleName, coverUrl, fetchedAt}——B1 方案）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    styleThumbCacheMap.clear();
  });

  it('404/不存在 → null；结果缓存（第二次不发请求，防反复打 404）', async () => {
    (api.fetchStyleById as any).mockResolvedValue(null);
    expect(await getStyleThumb('gone')).toBeNull();
    await getStyleThumb('gone');
    expect(api.fetchStyleById).toHaveBeenCalledTimes(1);
  });

  it('命中 → {styleName, url}；TTL 内同 id 复用不发请求', async () => {
    (api.fetchStyleById as any).mockResolvedValue({ id: 's1', name: '胶片', coverUrl: '/presigned.png' });
    const a = await getStyleThumb('s1');
    const b = await getStyleThumb('s1');
    expect(a).toEqual({ styleName: '胶片', url: '/presigned.png' });
    expect(b).toEqual(a);
    expect(api.fetchStyleById).toHaveBeenCalledTimes(1);
  });

  it('TTL 过期（>55min）→ 重新请求刷新', async () => {
    vi.useFakeTimers();
    (api.fetchStyleById as any).mockResolvedValue({ id: 's1', name: '胶片', coverUrl: '/p1.png' });
    await getStyleThumb('s1');
    vi.setSystemTime(Date.now() + 56 * 60 * 1000);
    (api.fetchStyleById as any).mockResolvedValue({ id: 's1', name: '胶片新名', coverUrl: '/p2.png' });
    const c = await getStyleThumb('s1');
    expect(c).toEqual({ styleName: '胶片新名', url: '/p2.png' });
    expect(api.fetchStyleById).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
