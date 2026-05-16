import { useEffect } from 'react';
import { useContentStore } from '@/stores/contentStore';
import { ContentCard } from './ContentCard';

export function ContentSection() {
  const { cards, loading, error, fetchCards } = useContentStore();

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  return (
    <section className="px-5 md:px-10 lg:px-[120px] py-10 mx-auto max-w-[1640px]">
      <h2 className="text-xl font-bold text-[#e2e8f0] mb-6 px-0">精选工作流模板</h2>
      {error ? (
        <div className="text-center py-16">
          <p className="text-[#888] text-sm mb-4">内容加载失败</p>
          <button onClick={fetchCards} className="px-4 py-2 bg-[#252525] border border-[#444] rounded-md text-xs text-[#ccc] hover:border-[#4ade80] transition-colors">
            重新加载
          </button>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-64 bg-[#1a1a1a] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[#666] text-sm">暂无内容</p>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {cards.map((card) => (
            <ContentCard key={card.id} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}
