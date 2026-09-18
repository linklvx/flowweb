import { Link } from 'react-router';

interface TemplateCardProps {
  id: string;
  name: string;
  description?: string;
  coverUrl?: string;
  importCount: number;
  isOwner: boolean;
  category?: string;
  linkPrefix?: string;
}

export function TemplateCard({ id, name, description, coverUrl, importCount, isOwner, category, linkPrefix = '/templates' }: TemplateCardProps) {
  return (
    <Link
      to={`${linkPrefix}/${id}`}
      className="bg-surface border-0 rounded-lg overflow-hidden no-underline transition-colors group"
    >
      <div className="aspect-video bg-surface-dim flex items-center justify-center text-text-dim-1 text-sm">
        {coverUrl ? (
          <img src={coverUrl} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span>📄 模板封面</span>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-medium text-text truncate group-hover:text-accent-text transition-colors">{name}</h3>
          {category === 'OFFICIAL' && (
            <span className="text-[10px] px-1.5 py-0.5 bg-[#4ade80]/10 text-accent-text rounded">官方</span>
          )}
          {isOwner && (
            <span className="text-[10px] px-1.5 py-0.5 bg-[#888]/10 text-text-dim-2 rounded">我的</span>
          )}
        </div>
        {description && <p className="text-xs text-text-dim-1 truncate mb-2">{description}</p>}
        <div className="flex items-center gap-1 text-xs text-text-dim-1">
          <span>⬇ {importCount}</span>
        </div>
      </div>
    </Link>
  );
}
