import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { ContentSection } from './components/ContentSection';
import { AIAssistantFAB } from './components/AIAssistantFAB';
import { VipSubscribeModal } from '@/components/VipSubscribeModal';
import { useVipModalStore } from '@/stores/vipModalStore';
import { useNavigate } from 'react-router';

export function HomePage() {
  const vipModalVisible = useVipModalStore(s => s.visible);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#0f0f0f]">
      <div className="sticky top-0 z-40">
        <Navbar />
      </div>
      <HeroSection onStartCreate={() => { localStorage.removeItem('flowweb_projectId'); navigate('/canvas'); }} />
      <ContentSection />
      <AIAssistantFAB />
      {vipModalVisible && <VipSubscribeModal />}
    </div>
  );
}
