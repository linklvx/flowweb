import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VideosPage } from '../VideosPage';
import * as api from '@/api/videoWorkApi';
import type { VideoWorkListResult } from '@flowweb/shared';

vi.mock('@/api/videoWorkApi');

const listResult: VideoWorkListResult = {
  items: [
    { id: 'w1', title: '末班地铁', coverUrl: '/flowai/c.webp', durationSec: 204, tags: ['悬疑', 'AI真人'] },
    { id: 'w2', title: 'THE TURN', coverUrl: null, durationSec: null, tags: [] },
  ],
  total: 2, page: 1, pageSize: 20,
};

describe('VideosPage（D13 卡片裁剪）', () => {
  beforeEach(() => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue(listResult);
    vi.mocked(api.fetchVideoCategories).mockResolvedValue([{ id: 'c1', name: 'AI真人影视', sortOrder: 0 }]);
  });

  it('卡片只含 封面/时长/标题/标签——不含作者/日期/计数', async () => {
    render(<MemoryRouter><VideosPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('末班地铁'));
    expect(screen.getByText('03:24')).toBeInTheDocument();      // 204s → mm:ss 角标
    expect(screen.getByText('悬疑')).toBeInTheDocument();
    // D13：不渲染作者/日期/观看/喜欢
    expect(screen.queryByText(/404_STUDIO/)).toBeNull();
    expect(screen.queryByText(/\d+月\d+/)).toBeNull();
    expect(screen.queryByText(/观看/)).toBeNull();
    expect(screen.queryByText(/♥/)).toBeNull();
  });

  it('无封面占位、null 时长无角标', async () => {
    render(<MemoryRouter><VideosPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('THE TURN'));
    expect(screen.queryByText('00:00')).toBeNull();
  });

  it('类型 tab 含"全部"+数据项', async () => {
    render(<MemoryRouter><VideosPage /></MemoryRouter>);
    await waitFor(() => screen.getByRole('tab', { name: 'AI真人影视' }));
    expect(screen.getByRole('tab', { name: '全部' })).toBeInTheDocument();
  });

  it('接口失败 → 渲染错误提示而非暂无作品', async () => {
    vi.mocked(api.fetchVideoWorks).mockRejectedValueOnce(new Error('network down'));
    render(<MemoryRouter><VideosPage /></MemoryRouter>);
    expect(await screen.findByText(/加载失败/)).toBeInTheDocument();
    expect(screen.queryByText('暂无作品')).toBeNull();
  });

  it('快速切换 tab 时旧响应不覆盖新数据', async () => {
    let resolveA!: () => void;
    let resolveB!: () => void;
    const resultA: VideoWorkListResult = { items: [{ id: 'wa', title: '旧数据A', coverUrl: null, durationSec: null, tags: [] }], total: 1, page: 1, pageSize: 20 };
    const resultB: VideoWorkListResult = { items: [{ id: 'wb', title: '新数据B', coverUrl: null, durationSec: null, tags: [] }], total: 1, page: 1, pageSize: 20 };
    // 第一次调用（tab all）返回 pending A，第二次调用（tab B）返回 pending B；先 resolve B 再 resolve A
    vi.mocked(api.fetchVideoWorks)
      .mockImplementationOnce(() => new Promise<VideoWorkListResult>(res => { resolveA = () => res(resultA); }))
      .mockImplementationOnce(() => new Promise<VideoWorkListResult>(res => { resolveB = () => res(resultB); }));
    render(<MemoryRouter><VideosPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: 'AI真人影视' }));
    await act(async () => {
      resolveB();
      resolveA();
    });
    expect(screen.getByText('新数据B')).toBeInTheDocument();
    expect(screen.queryByText('旧数据A')).toBeNull();
  });
});
