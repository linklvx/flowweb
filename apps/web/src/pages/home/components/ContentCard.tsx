import { Tag } from 'antd';
import type { ContentCard as ContentCardType } from '@flowweb/shared';

interface Props {
  card: ContentCardType;
}

export function ContentCard({ card }: Props) {
  return (
    <div className="rounded-xl overflow-hidden bg-[#1a1a1a] border border-[#222] hover:-translate-y-1 hover:shadow-lg transition-all duration-200 cursor-pointer">
      <div className="h-48 bg-[#252525] flex items-center justify-center overflow-hidden">
        <img
          src={card.coverUrl}
          alt={card.title}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="p-4">
        <h3 className="text-sm font-bold text-[#e2e8f0] mb-2">{card.title}</h3>
        {card.tags.length > 0 && (
          <div className="flex gap-1 mb-2 flex-wrap">
            {card.tags.map((tag) => (
              <Tag key={tag} color="green" className="text-xs m-0">
                {tag}
              </Tag>
            ))}
          </div>
        )}
        <p className="text-xs text-gray-500">{card.desc}</p>
      </div>
    </div>
  );
}
