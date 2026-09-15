import { render, screen, waitFor } from '@testing-library/react';
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
});
