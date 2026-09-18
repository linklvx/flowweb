// 第八轮补 harness（原块无 import 头——照抄即 ReferenceError；CarouselBar 不用 useAuth，无需 AuthProvider mock）：
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest'; // 第十二轮：删未用的 beforeEach 导入（本文件靠 renderBar 首行清理）
import * as api from '@/api/videoWorkApi';
import { CarouselBar } from '../CarouselBar';

vi.mock('@/api/videoWorkApi');

// renderBar helper 必须显式 mock getPublicSettings——组件内部自取设置，漏 mock 时 auto-mock 返回
// undefined → getPublicSettings() 返回 undefined、.then 是同步 TypeError（.catch 接不到同步 throw）→ 用例以 unhandled error 红
function renderBar(settings: { carouselEnabled: boolean; carouselScope: 'all' | 'category' }, currentId = 'w0', categoryId: string | null = null) {
  vi.clearAllMocks(); // 第十二轮 C1-6/S1：未清记录时 null 降级用例的 mock.calls[0] 是上一用例（scope=all）留下的调用——断言恒绿（假防线）。清记录保实现，下方 getPublicSettings 随即重新声明
  vi.mocked(api.getPublicSettings).mockResolvedValue(settings as any);
  const onSwitch = vi.fn();
  render(<CarouselBar currentId={currentId} categoryId={categoryId} onSwitch={onSwitch} />);
  return { onSwitch };
}

describe('CarouselBar', () => {
  it('carouselEnabled=false → 不渲染', async () => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 11 });
    renderBar({ carouselEnabled: false, carouselScope: 'all' });
    await waitFor(() => expect(screen.queryByTestId('carousel')).toBeNull());
  });
  it('scope=all：请求不带 categoryId；过滤当前作品；最多 10 条', async () => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: Array.from({ length: 11 }, (_, i) => ({ id: `w${i}`, title: `t${i}`, coverUrl: null, durationSec: 1, tags: [] })), total: 11, page: 1, pageSize: 11 });
    renderBar({ carouselEnabled: true, carouselScope: 'all' }, 'w0');
    await waitFor(() => screen.getByTestId('carousel'));
    expect(api.fetchVideoWorks).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 11 })); // 11 条再过滤（§4.2）
    expect(screen.getAllByTestId(/^carousel-item-/)).toHaveLength(10);
  });
  it('scope=category：带当前作品 categoryId', async () => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 11 });
    renderBar({ carouselEnabled: true, carouselScope: 'category' }, 'w1', 'cat9');
    await waitFor(() => expect(api.fetchVideoWorks).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'cat9' })));
  });

  it('scope=category 且当前作品 categoryId=null → 降级 all（不带 categoryId——第十一轮补：原标题声称覆盖 null 分支但用例只传了 cat9）', async () => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 11 });
    renderBar({ carouselEnabled: true, carouselScope: 'category' }, 'w1', null);
    await waitFor(() => expect(api.fetchVideoWorks).toHaveBeenCalled());
    expect(vi.mocked(api.fetchVideoWorks).mock.calls[0]?.[0]?.categoryId).toBeUndefined(); // 实现 categoryId ?? undefined——降级全量（上一 waitFor 已保证有调用；参数可选故 [0]?.[0]?. 收窄过 tsc）
  });
  it('点击切换调 onSwitch（第六轮落地——原为空壳用例）', async () => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [
      { id: 'w0', title: 't0', coverUrl: null, durationSec: 1, tags: [] },
      { id: 'w2', title: 't2', coverUrl: null, durationSec: 1, tags: [] },
    ], total: 2, page: 1, pageSize: 11 });
    const { onSwitch } = renderBar({ carouselEnabled: true, carouselScope: 'all' }, 'w0');
    fireEvent.click(await screen.findByTestId('carousel-item-w2'));
    expect(onSwitch).toHaveBeenCalledWith('w2');
  });

  // ─── P2 卡片版式（spec v3.1：180px + rounded-lg + UA 归一 + hover-only ring）───
  it('卡片：w-[180px] rounded-lg + border-0 p-0（UA 归一）+ 封面 absolute inset-0 填充', async () => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [
      { id: 'w0', title: 't0', coverUrl: null, durationSec: 1, tags: [] },
      { id: 'w2', title: 't2', coverUrl: '/flowai/c.jpg', durationSec: 1, tags: [] },
    ], total: 2, page: 1, pageSize: 11 });
    renderBar({ carouselEnabled: true, carouselScope: 'all' }, 'w0');
    const card = await screen.findByTestId('carousel-item-w2');
    for (const cls of ['w-[180px]', 'aspect-video', 'rounded-lg', 'border-0', 'p-0']) {
      expect(card.className).toContain(cls);
    }
    const img = card.querySelector('img');
    expect(img?.className).toContain('absolute');
    expect(img?.className).toContain('inset-0');
    expect(img?.className).toContain('object-cover');
  });

  it('ring 口径（T5 hover-only）：默认无 ring-1、hover 才现——classList 精确匹配防子串误判', async () => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [
      { id: 'w0', title: 't0', coverUrl: null, durationSec: 1, tags: [] },
      { id: 'w2', title: 't2', coverUrl: null, durationSec: 1, tags: [] },
    ], total: 2, page: 1, pageSize: 11 });
    renderBar({ carouselEnabled: true, carouselScope: 'all' }, 'w0');
    const card = await screen.findByTestId('carousel-item-w2');
    expect(card.classList.contains('ring-1')).toBe(false);   // not.toContain('ring-1') 会误伤含 hover:ring-1 的正确实现
    expect(card.classList.contains('hover:ring-1')).toBe(true);
    expect(card.classList.contains('hover:ring-white/60')).toBe(true);
  });

  it('轮播条隐藏滚动条（T3：Windows 经典滚动条占 ~17px 布局高，reserve 常量失真的唯一误差源）', async () => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [
      { id: 'w0', title: 't0', coverUrl: null, durationSec: 1, tags: [] },
      { id: 'w2', title: 't2', coverUrl: null, durationSec: 1, tags: [] },
    ], total: 2, page: 1, pageSize: 11 });
    renderBar({ carouselEnabled: true, carouselScope: 'all' }, 'w0');
    const bar = await screen.findByTestId('carousel');
    expect(bar.classList.contains('[scrollbar-width:none]')).toBe(true);
    expect(bar.classList.contains('[&::-webkit-scrollbar]:hidden')).toBe(true);
  });
});
