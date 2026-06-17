import { useState, useEffect, useCallback } from 'react';
import { Popover } from 'antd';
import { useMaterialLibraryStore } from '../../../stores/materialLibraryStore';
import { useCanvasStore } from '../../../stores/canvasStore';
import FilePreviewPopoverContent from '../FilePreviewPopover';
import type { MaterialFile } from '@flowweb/shared';

interface FileCardProps {
  file: MaterialFile;
  batchMode?: boolean;
  selected?: boolean;
  isFinePointer?: boolean;
  onToggleSelect?: () => void;
  onToggleFavorite?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export default function FileCard({ file, batchMode, selected, isFinePointer, onToggleSelect, onToggleFavorite, onDelete }: FileCardProps) {
  const storeToggleFavorite = useMaterialLibraryStore((s) => s.toggleFavorite);
  const storeDeleteFile = useMaterialLibraryStore((s) => s.deleteFile);

  const toggleFavorite = onToggleFavorite || storeToggleFavorite;
  const deleteFile = onDelete || storeDeleteFile;

  const isMedia = file.mimeType?.startsWith('image/') || file.mimeType?.startsWith('video/');
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Listen for scroll-to-close event
  useEffect(() => {
    if (!popoverOpen) return;
    const handler = () => setPopoverOpen(false);
    window.addEventListener('material-library:list-scroll', handler);
    return () => window.removeEventListener('material-library:list-scroll', handler);
  }, [popoverOpen]);

  const handleApplyToCanvas = useCallback((f: MaterialFile) => {
    setPopoverOpen(false);
    useCanvasStore.getState().requestAddMediaNode(f);
    useMaterialLibraryStore.getState().close();
  }, []);

  const cardContent = (
    <div
      className={`file-card bg-[#2a2a2a] rounded-lg overflow-hidden hover:bg-[#333] transition-colors group relative ${batchMode ? 'cursor-pointer' : ''}`}
      style={{ aspectRatio: '4/3' }}
      onClick={() => { if (batchMode) onToggleSelect?.(); }}
    >
      {/* Batch mode checkbox */}
      {batchMode && (
        <div className="absolute top-2 left-2 z-10">
          <input type="checkbox" checked={selected} readOnly
            className="w-5 h-5 accent-blue-500 cursor-pointer rounded" />
        </div>
      )}

      {/* Preview */}
      {file.thumbnailUrl ? (
        <img
          src={file.thumbnailUrl}
          alt={file.originalName}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : file.mimeType?.startsWith('video/') && file.url ? (
        <video
          src={file.url}
          preload="metadata"
          muted
          playsInline
          disablePictureInPicture
          className="w-full h-full object-cover pointer-events-none"
        />
      ) : file.url ? (
        <img
          src={file.url}
          alt={file.originalName}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-4xl">
          {file.mimeType?.startsWith('video/') ? '🎬' : '🖼️'}
        </div>
      )}

      {/* Action buttons — hidden in batch mode */}
      {!batchMode && (
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
      )}

      {/* Name */}
      <div className="p-1 text-xs truncate text-gray-300">
        {file.isFavorite && '⭐ '}{file.originalName}
      </div>
    </div>
  );

  // Non-media file or touch device → no Popover
  if (!isMedia || !isFinePointer) {
    return cardContent;
  }

  return (
    <Popover
      open={popoverOpen}
      onOpenChange={setPopoverOpen}
      arrow={false}
      placement="right"
      mouseEnterDelay={0.3}
      mouseLeaveDelay={0.15}
      destroyTooltipOnHide={true}
      overlayInnerStyle={{ padding: 0 }}
      overlayStyle={{ background: 'transparent' }}
      getPopupContainer={() => document.body}
      content={
        <FilePreviewPopoverContent
          file={file}
          onApplyToCanvas={handleApplyToCanvas}
        />
      }
    >
      {cardContent}
    </Popover>
  );
}
