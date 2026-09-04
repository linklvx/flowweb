// 覆盖点对齐旧 AnnouncementManagementTab.test.tsx:40-88（禁用直改/启用互斥确认/颜色 hex 拦截）
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/api/adminApi')>()),
  fetchAnnouncements: vi.fn().mockResolvedValue([
    { id: 'a1', message: '系统维护通知', linkText: null, linkUrl: null, bgColor: '#0f2761', textColor: '#ffffff', active: true, createdAt: '', updatedAt: '' },
  ]),
  updateAnnouncement: vi.fn().mockResolvedValue({}),
  createAnnouncement: vi.fn().mockResolvedValue({}),
}));

import AnnouncementPage from './AnnouncementPage';

beforeEach(() => vi.clearAllMocks()); // 隔离 mock 调用历史（clearAllMocks 只清记录保留工厂实现）

describe('AnnouncementPage', () => {
  it('公告列表渲染（默认色对齐现网 #0f2761）', async () => {
    render(<MemoryRouter><AntdApp><AnnouncementPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('系统维护通知')).toBeTruthy());
    expect(screen.getByText('#0f2761')).toBeTruthy();
  });

  it('行内开关：禁用直改（不弹确认）', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><AnnouncementPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('系统维护通知')).toBeTruthy());
    await user.click(screen.getByRole('switch'));
    const { updateAnnouncement } = await import('@/api/adminApi');
    await waitFor(() => expect(updateAnnouncement).toHaveBeenCalledWith('a1', expect.objectContaining({ active: false })));
  });

  it('启用走互斥确认：确认前不发、确认后发 active:true', async () => {
    // 独立未启用夹具（一次点击即到确认分支）
    const { fetchAnnouncements, updateAnnouncement } = await import('@/api/adminApi');
    vi.mocked(fetchAnnouncements).mockResolvedValueOnce([
      { id: 'a1', message: '系统维护通知', linkText: null, linkUrl: null, bgColor: '#0f2761', textColor: '#ffffff', active: false, createdAt: '', updatedAt: '' },
    ]);
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><AnnouncementPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('系统维护通知')).toBeTruthy());
    await user.click(screen.getByRole('switch')); // 未启用行：Popconfirm 可用，点击弹互斥确认
    expect(await screen.findByText(/并停用其他公告/)).toBeTruthy();
    expect(updateAnnouncement).not.toHaveBeenCalledWith('a1', expect.objectContaining({ active: true }));
    await user.click(document.querySelector('.ant-popover .ant-btn-primary') as HTMLElement);
    await waitFor(() => expect(updateAnnouncement).toHaveBeenCalledWith('a1', expect.objectContaining({ active: true })));
  });

  it('表单颜色 hex 校验：非法值不提交', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><AnnouncementPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('系统维护通知')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: '新建公告' }));
    const colorInput = await screen.findByLabelText('背景色');
    await user.clear(colorInput);
    await user.type(colorInput, 'red');
    // 测试环境无 zhCN locale，统一用类名选择器
    const okBtn = document.querySelector('.ant-modal-footer .ant-btn-primary') as HTMLElement;
    await user.click(okBtn);
    const { createAnnouncement } = await import('@/api/adminApi');
    await waitFor(() => expect(screen.getByText(/颜色格式/)).toBeTruthy());
    expect(createAnnouncement).not.toHaveBeenCalled();
  });
});
