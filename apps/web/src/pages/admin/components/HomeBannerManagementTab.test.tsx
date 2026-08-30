import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomeBannerManagementTab } from './HomeBannerManagementTab';
import * as adminApi from '@/api/adminApi';

vi.mock('@/api/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/adminApi')>()),
  fetchHomeBanners: vi.fn(),
  createHomeBanner: vi.fn(),
  updateHomeBanner: vi.fn(),
  deleteHomeBanner: vi.fn(),
  uploadHomeBannerImage: vi.fn(),
}));
const mockFetch = vi.mocked(adminApi.fetchHomeBanners);

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    App: { ...actual.App, useApp: () => ({ message: { success: vi.fn(), error: vi.fn() }, modal: { confirm: vi.fn() } }) },
  };
});

describe('HomeBannerManagementTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('渲染 Banner 列表（缩略图+标题+排序）', async () => {
    mockFetch.mockResolvedValue([
      {
        id: 'b1', title: '活动一', subtitle: null, linkUrl: null,
        imageKey: 'uploads/system/a.jpg', imageUrl: 'http://minio/a.jpg',
        sortOrder: 1, active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    render(<HomeBannerManagementTab />);
    expect(await screen.findByText('活动一')).toBeInTheDocument();
    expect(screen.getByAltText('活动一')).toHaveAttribute('src', 'http://minio/a.jpg');
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('渲染新建 Banner 按钮', async () => {
    mockFetch.mockResolvedValue([]);
    render(<HomeBannerManagementTab />);
    await screen.findByText('暂无 Banner');
    expect(screen.getByRole('button', { name: '新建 Banner' })).toBeInTheDocument();
  });
});
