import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { AppLayout } from './AppLayout';
import { useAnnouncementStore } from '@/stores/announcementStore';
import { useVipModalStore } from '@/stores/vipModalStore';

// 镜像真实 AnnouncementBar：无 announcement 时内部早退 return null
vi.mock('./AnnouncementBar', async () => {
  const { useAnnouncementStore } = await import('@/stores/announcementStore');
  return {
    AnnouncementBar: () => {
      const announcement = useAnnouncementStore(s => s.announcement);
      if (!announcement) return null;
      return <div data-testid="announcement-bar-mock" />;
    },
  };
});
vi.mock('./Sidebar', () => ({
  Sidebar: ({ topOffset }: { topOffset: number }) => <div data-testid="sidebar-mock" data-top={topOffset} />,
}));
vi.mock('./TopActionBar', () => ({
  TopActionBar: () => <div data-testid="top-action-bar-mock" />,
}));
vi.mock('@/components/VipSubscribeModal', () => ({
  VipSubscribeModal: () => <div data-testid="vip-modal-mock" />,
}));

function renderLayout(initial = '/') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<div>首页内容</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('AppLayout', () => {
  const fetchActive = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    useAnnouncementStore.setState({ announcement: null, loaded: false, fetchActive });
    useVipModalStore.setState({ visible: false });
  });

  it('挂载即调 fetchActive；渲染侧栏/操作栏/Outlet 内容', () => {
    renderLayout();
    expect(fetchActive).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument();
    expect(screen.getByTestId('top-action-bar-mock')).toBeInTheDocument();
    expect(screen.getByTestId('top-action-bar-mock').parentElement?.className).toContain('h-[77px]');
    expect(screen.getByText('首页内容')).toBeInTheDocument();
  });

  it('无公告：侧栏 topOffset=0 且不渲染公告条', () => {
    renderLayout();
    expect(screen.getByTestId('sidebar-mock')).toHaveAttribute('data-top', '0');
    expect(screen.queryByTestId('announcement-bar-mock')).toBeNull();
  });

  it('有公告：渲染公告条且侧栏 topOffset=64', () => {
    useAnnouncementStore.setState({ announcement: { id: 'a1', message: 'm' } as never, loaded: true });
    renderLayout();
    expect(screen.getByTestId('announcement-bar-mock')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-mock')).toHaveAttribute('data-top', '64');
  });

  it('vipVisible 时渲染 VipSubscribeModal（全局挂载）', () => {
    useVipModalStore.setState({ visible: true });
    renderLayout();
    expect(screen.getByTestId('vip-modal-mock')).toBeInTheDocument();
  });
});
