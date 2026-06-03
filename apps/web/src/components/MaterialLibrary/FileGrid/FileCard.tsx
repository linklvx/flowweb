import { useMaterialLibraryStore } from '../../../stores/materialLibraryStore';
import type { MaterialFile } from '@flowweb/shared';

interface FileCardProps { file: MaterialFile; }

export default function FileCard({ file }: FileCardProps) {
  const toggleFavorite = useMaterialLibraryStore((s) => s.toggleFavorite);
  const deleteFile = useMaterialLibraryStore((s) => s.deleteFile);

  return (
    <div
      className="file-card bg-[#2a2a2a] rounded-lg overflow-hidden hover:bg-[#333] transition-colors group relative"
      style={{ aspectRatio: '4/3' }}
    >
      {/* Preview */}
      {(file.thumbnailUrl || file.url) ? (
        <img
          src={file.thumbnailUrl || file.url}
          alt={file.originalName}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : null}
      <div className={`w-full h-full flex items-center justify-center text-4xl ${(file.thumbnailUrl || file.url) ? 'hidden' : ''}`}>
        {file.mimeType?.startsWith('video/') ? '🎬' : '🖼️'}
      </div>

      {/* Action buttons */}
      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
        <button
          title="收藏"
          className="bg-[#00000080] rounded p-0.5 text-xs hover:bg-[#000000cc]"
          onClick={(e) => { e.stopPropagation(); toggleFavorite(file.id); }}
        >
          {file.isFavorite ? '⭐' : '☆'}
        </button>
        <button
          title="删除"
          className="bg-[#00000080] rounded p-0.5 text-xs hover:bg-[#000000cc] text-red-400"
          onClick={(e) => { e.stopPropagation(); if (confirm('确定删除？')) deleteFile(file.id); }}
        >
          🗑️
        </button>
      </div>

      {/* Name */}
      <div className="p-1 text-xs truncate text-gray-300">
        {file.isFavorite && '⭐ '}{file.originalName}
      </div>
    </div>
  );
}
