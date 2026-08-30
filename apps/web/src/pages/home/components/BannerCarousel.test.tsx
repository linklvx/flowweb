import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { BannerCarousel } from './BannerCarousel';
import { apiFetch } from '@/api/client';

vi.mock('@/api/client', () => ({ apiFetch: vi.fn() }));
const mockApiFetch = vi.mocked(apiFetch);

const BANNERS = [
  { id: 'b1', title: '标题一', subtitle: null, linkUrl: null, imageUrl: 'http://x/1.jpg', sortOrder: 1 },
  { id: 'b2', title: null, subtitle: '副标题二', linkUrl: 'https://example.com', imageUrl: 'http://x/2.jpg', sortOrder: 2 },
];

describe('BannerCarousel', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
  afterEach(() => vi.useRealTimers());

  it('加载中显示骨架屏', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    const { container } = render(<BannerCarousel />);
    expect(screen.getByTestId('banner-skeleton')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="banner-carousel"]')).toBeNull();
  });

  it('空数据不渲染任何内容', async () => {
    mockApiFetch.mockResolvedValue([]);
    const { container } = render(<BannerCarousel />);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="banner-carousel"]')).toBeNull();
  });

  it('多张：渲染图片、箭头、指示器，第一张可见', async () => {
    mockApiFetch.mockResolvedValue(BANNERS);
    const { container } = render(<BannerCarousel />);
    await screen.findByTestId('banner-carousel');
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(2);
    expect(screen.getByRole('button', { name: '上一张' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一张' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '跳转到第 2 张' })).toBeInTheDocument();
    expect((imgs[0] as HTMLElement).style.opacity).toBe('1');
    expect((imgs[1] as HTMLElement).style.opacity).toBe('0');
    expect((imgs[0] as HTMLElement).style.pointerEvents).toBe('auto');
    expect((imgs[1] as HTMLElement).style.pointerEvents).toBe('none');
  });

  it('单张：无箭头无指示器', async () => {
    mockApiFetch.mockResolvedValue([BANNERS[0]]);
    render(<BannerCarousel />);
    await screen.findByTestId('banner-carousel');
    expect(screen.queryByRole('button', { name: '上一张' })).toBeNull();
    expect(screen.queryByRole('button', { name: '跳转到第 1 张' })).toBeNull();
  });

  it('5 秒自动切到下一张（fake timers）', async () => {
    vi.useFakeTimers();
    mockApiFetch.mockResolvedValue(BANNERS);
    const { container } = render(<BannerCarousel />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const imgs = container.querySelectorAll('img');
    expect((imgs[0] as HTMLElement).style.opacity).toBe('1');
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect((imgs[0] as HTMLElement).style.opacity).toBe('0');
    expect((imgs[1] as HTMLElement).style.opacity).toBe('1');
  });

  it('hover 暂停自动轮播', async () => {
    vi.useFakeTimers();
    mockApiFetch.mockResolvedValue(BANNERS);
    const { container } = render(<BannerCarousel />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const imgs = container.querySelectorAll('img');
    fireEvent.mouseEnter(screen.getByTestId('banner-carousel'));
    vi.advanceTimersByTime(10000);
    expect((imgs[0] as HTMLElement).style.opacity).toBe('1');
  });

  it('点击指示器跳转', async () => {
    mockApiFetch.mockResolvedValue(BANNERS);
    const { container } = render(<BannerCarousel />);
    await screen.findByTestId('banner-carousel');
    fireEvent.click(screen.getByRole('button', { name: '跳转到第 2 张' }));
    const imgs = container.querySelectorAll('img');
    expect((imgs[1] as HTMLElement).style.opacity).toBe('1');
  });

  it('点击配置了 linkUrl 的 Banner 新窗口打开（一次）', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockApiFetch.mockResolvedValue(BANNERS);
    const { container } = render(<BannerCarousel />);
    await screen.findByTestId('banner-carousel');
    fireEvent.click(container.querySelectorAll('img')[1]);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener noreferrer');
    openSpy.mockRestore();
  });

  it('全部图片加载失败：等价空态不渲染', async () => {
    mockApiFetch.mockResolvedValue(BANNERS);
    const { container } = render(<BannerCarousel />);
    await screen.findByTestId('banner-carousel');
    const imgs = container.querySelectorAll('img');
    fireEvent.error(imgs[0]);
    fireEvent.error(imgs[1]);
    await waitFor(() => {
      expect(screen.queryByTestId('banner-carousel')).toBeNull();
    });
  });
});
