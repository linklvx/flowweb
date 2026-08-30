import { AIAssistantFAB } from './components/AIAssistantFAB';
import { BannerCarousel } from './components/BannerCarousel';
import { CreateCanvasCard } from './components/CreateCanvasCard';
import { Footer } from './components/Footer';

export function HomePage() {
  return (
    <div>
      <BannerCarousel />
      <CreateCanvasCard />
      <Footer />
      <AIAssistantFAB />
    </div>
  );
}
