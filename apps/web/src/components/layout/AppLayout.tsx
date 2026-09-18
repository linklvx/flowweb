import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { useAnnouncementStore } from '@/stores/announcementStore';
import { useVipModalStore } from '@/stores/vipModalStore';
import { VipSubscribeModal } from '@/components/VipSubscribeModal';
import { AnnouncementBar } from './AnnouncementBar';
import { Sidebar } from './Sidebar';
import { TopActionBar } from './TopActionBar';

export function AppLayout() {
  const announcement = useAnnouncementStore(s => s.announcement);
  const fetchActive = useAnnouncementStore(s => s.fetchActive);
  const vipVisible = useVipModalStore(s => s.visible);

  useEffect(() => { void fetchActive(); }, [fetchActive]);

  const topOffset = announcement ? 64 : 0;

  return (
    <div className="min-w-[1200px] min-h-screen bg-bg flex flex-col">
      <AnnouncementBar />
      <div className="flex flex-1 items-start">
        <Sidebar topOffset={topOffset} />
        <main className="flex-1 min-w-0 px-6">
          <div className="h-[60px] sticky z-20 bg-bg" style={{ top: topOffset }}>
            <TopActionBar />
          </div>
          <Outlet />
        </main>
      </div>
      {vipVisible && <VipSubscribeModal />}
    </div>
  );
}
