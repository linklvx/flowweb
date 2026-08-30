import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAnnouncementStore } from './announcementStore';
import { apiFetch } from '@/api/client';

vi.mock('@/api/client', () => ({ apiFetch: vi.fn() }));
const mockApiFetch = vi.mocked(apiFetch);

describe('announcementStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    useAnnouncementStore.setState({ announcement: null, loaded: false });
  });

  it('fetchActive 拉取 /announcements/active 并写入 announcement', async () => {
    mockApiFetch.mockResolvedValue({ id: 'a1', message: 'm', bgColor: '#0f2761', textColor: '#ffffff' });
    await useAnnouncementStore.getState().fetchActive();
    expect(mockApiFetch).toHaveBeenCalledWith('/announcements/active');
    expect(useAnnouncementStore.getState().announcement?.id).toBe('a1');
    expect(useAnnouncementStore.getState().loaded).toBe(true);
  });

  it('本会话已 dismiss 过的公告不再写入', async () => {
    sessionStorage.setItem('announcement_dismissed_a1', '1');
    mockApiFetch.mockResolvedValue({ id: 'a1', message: 'm' });
    await useAnnouncementStore.getState().fetchActive();
    expect(useAnnouncementStore.getState().announcement).toBeNull();
  });

  it('fetch 失败静默置 null 不抛错', async () => {
    mockApiFetch.mockRejectedValue(new Error('network'));
    await expect(useAnnouncementStore.getState().fetchActive()).resolves.toBeUndefined();
    expect(useAnnouncementStore.getState().announcement).toBeNull();
  });

  it('loaded 后再次 fetchActive 不重复请求', async () => {
    mockApiFetch.mockResolvedValue({ id: 'a1', message: 'm' });
    await useAnnouncementStore.getState().fetchActive();
    await useAnnouncementStore.getState().fetchActive();
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it('dismiss 写入按公告 id 的 sessionStorage 键并清空 announcement', () => {
    useAnnouncementStore.setState({ announcement: { id: 'a9', message: 'x' } as never });
    useAnnouncementStore.getState().dismiss();
    expect(sessionStorage.getItem('announcement_dismissed_a9')).toBe('1');
    expect(useAnnouncementStore.getState().announcement).toBeNull();
  });
});
