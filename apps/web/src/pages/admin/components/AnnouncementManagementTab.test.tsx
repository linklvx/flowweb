import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnnouncementManagementTab } from './AnnouncementManagementTab';
import * as adminApi from '@/api/adminApi';

vi.mock('@/api/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/adminApi')>()),
  fetchAnnouncements: vi.fn(),
  createAnnouncement: vi.fn(),
  updateAnnouncement: vi.fn(),
  deleteAnnouncement: vi.fn(),
}));
const mockFetch = vi.mocked(adminApi.fetchAnnouncements);
const mockUpdate = vi.mocked(adminApi.updateAnnouncement);

const confirmMock = { onOk: undefined as undefined | (() => void) };
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    App: { ...actual.App, useApp: () => ({ message: { success: vi.fn(), error: vi.fn() }, modal: { confirm: (o: { onOk: () => void }) => { confirmMock.onOk = o.onOk; } } }) },
  };
});

describe('AnnouncementManagementTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.onOk = undefined;
  });

  it('渲染公告列表', async () => {
    mockFetch.mockResolvedValue([
      { id: 'a1', message: '公告一', linkText: null, linkUrl: null, bgColor: '#0f2761', textColor: '#ffffff', active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    render(<AnnouncementManagementTab />);
    expect(await screen.findByText('公告一')).toBeInTheDocument();
  });

  it('禁用开关：直接 PATCH active=false', async () => {
    mockFetch.mockResolvedValue([
      { id: 'a1', message: '公告一', linkText: null, linkUrl: null, bgColor: '#0', textColor: '#f', active: true, createdAt: '', updatedAt: '' },
    ]);
    mockUpdate.mockResolvedValue({} as never);
    render(<AnnouncementManagementTab />);
    await screen.findByText('公告一');
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('a1', { active: false }));
  });

  it('启用开关：弹互斥确认，确认后才 PATCH active=true', async () => {
    mockFetch.mockResolvedValue([
      { id: 'a1', message: '公告一', linkText: null, linkUrl: null, bgColor: '#0', textColor: '#f', active: false, createdAt: '', updatedAt: '' },
    ]);
    mockUpdate.mockResolvedValue({} as never);
    render(<AnnouncementManagementTab />);
    await screen.findByText('公告一');
    fireEvent.click(screen.getByRole('switch'));
    expect(mockUpdate).not.toHaveBeenCalled();
    confirmMock.onOk?.();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('a1', { active: true }));
  });
});
