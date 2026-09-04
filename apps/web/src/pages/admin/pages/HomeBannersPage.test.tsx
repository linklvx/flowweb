import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/api/adminApi')>()),
  fetchHomeBanners: vi.fn().mockResolvedValue([
    { id: 'b1', title: '新版上线', subtitle: null, linkUrl: null, imageKey: 'k1', imageUrl: 'https://img/1.png', sortOrder: 1, active: true, createdAt: '', updatedAt: '' },
  ]),
}));

import HomeBannersPage from './HomeBannersPage';

describe('HomeBannersPage', () => {
  it('Banner 列表渲染（含图片预览列）', async () => {
    render(<MemoryRouter><AntdApp><HomeBannersPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('新版上线')).toBeTruthy());
    // 预览列 img：ProTable 工具栏 antd 图标也带 role="img"（多命中），改用 alt 精确定位（alt 取自 title，强度不降）
    expect(screen.getByAltText('新版上线')).toBeTruthy();
    expect(screen.getByRole('switch')).toBeTruthy(); // 行内启停
  });
});
