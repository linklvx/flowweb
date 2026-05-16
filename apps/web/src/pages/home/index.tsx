import { useAnnouncementStore } from '@/stores/announcementStore';
import { AnnouncementBanner } from './components/AnnouncementBanner';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { ContentSection } from './components/ContentSection';
import { AIAssistantFAB } from './components/AIAssistantFAB';
import { useNavigate } from 'react-router';

export function HomePage() {
  const { visible, message, linkUrl, dismiss } = useAnnouncementStore();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#0f0f0f]">
      {/* TopBar */}
      <div className="sticky top-0 z-40">
        {visible && message && (
          <AnnouncementBanner
            message={message}
            linkUrl={linkUrl}
            onClose={dismiss}
          />
        )}
        <Navbar />
      </div>

      {/* Hero */}
      <HeroSection onStartCreate={() => { localStorage.removeItem('flowweb_projectId'); navigate('/canvas'); }} />

      {/* Content */}
      <ContentSection />

      {/* Floating */}
      <AIAssistantFAB />
    </div>
  );
}
