import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import StyleCategoriesPage from './StyleCategoriesPage';
import * as adminApi from '@/api/adminApi';

vi.mock('@/api/adminApi', () => ({
  adminStylesApi: {
    listCategories: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
  },
}));

// 页面用 AntdApp.useApp() 取 message——裸渲染时 antd context 默认值 {message:{}} → message.error 抛
// is not a function（P2-2）——必须包 <AntdApp>（HomeBannersPage.test.tsx:3 先例）；外层 <MemoryRouter>
// 对齐 9/9 既有 admin 页测试双层包裹（AnnouncementPage.test.tsx:23 等先例——PageContainer/ProTable 依赖 router context）

describe('StyleCategoriesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (adminApi.adminStylesApi.listCategories as any).mockResolvedValue([
      { id: 'c1', name: '摄影写真', sortOrder: 1, active: true, createdAt: '2026-01-01' },
    ]);
  });

  it('渲染分类列表行', async () => {
    render(<MemoryRouter><AntdApp><StyleCategoriesPage /></AntdApp></MemoryRouter>);
    expect(await screen.findByText('摄影写真')).toBeInTheDocument();
  });

  it('删除被 400 阻止时中文文案直达（spec §6.2 删除保护）', async () => {
    (adminApi.adminStylesApi.deleteCategory as any).mockRejectedValue(new Error('该分类下存在风格，请先清空后再删除'));
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><StyleCategoriesPage /></AntdApp></MemoryRouter>);
    await screen.findByText('摄影写真');
    await user.click(screen.getByText('删除'));
    // 测试环境无 zhCN locale（antd 默认 en_US → Popconfirm 确认钮文案='OK'，getByText('确定') 必落空）——
    // 统一用类名选择器（AnnouncementPage.test.tsx:49 逐字先例，:61 有坑位注释）
    await waitFor(() => expect(document.querySelector('.ant-popover .ant-btn-primary')).toBeTruthy());
    await user.click(document.querySelector('.ant-popover .ant-btn-primary') as HTMLElement);
    await waitFor(() => {
      expect(screen.getByText('该分类下存在风格，请先清空后再删除')).toBeInTheDocument();
    });
  });
});
