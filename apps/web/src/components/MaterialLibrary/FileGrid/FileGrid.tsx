import { useMemo } from 'react';
import { useMaterialLibraryStore } from '../../../stores/materialLibraryStore';
import FileCard from './FileCard';
import type { MaterialFile } from '@flowweb/shared';

export default function FileGrid() {
  const files = useMaterialLibraryStore((s) => s.files);
  const fileGridSize = useMaterialLibraryStore((s) => s.fileGridSize);
  const loading = useMaterialLibraryStore((s) => s.loading);
  const batchMode = useMaterialLibraryStore((s) => s.batchMode);
  const selectedFileIds = useMaterialLibraryStore((s) => s.selectedFileIds);

  const grouped = useMemo(() => {
    const groups: Record<string, MaterialFile[]> = {};
    files.forEach((f) => {
      const date = new Date(f.createdAt).toLocaleDateString('zh-CN');
      if (!groups[date]) groups[date] = [];
      groups[date].push(f);
    });
    return Object.entries(groups).sort((a, b) =>
      new Date(b[0]).getTime() - new Date(a[0]).getTime()
    );
  }, [files]);

  const toggleDateGroup = (date: string) => {
    const filesInGroup = grouped.find(([d]) => d === date)?.[1] || [];
    const allSelected = filesInGroup.every((f) => selectedFileIds.has(f.id));
    const store = useMaterialLibraryStore.getState();
    filesInGroup.forEach((f) => {
      if (allSelected) {
        store.deselectFile(f.id);
      } else {
        store.selectFile(f.id);
      }
    });
  };

  if (loading) return <div className="file-grid-loading">加载中...</div>;
  if (files.length === 0) return <div className="file-grid-empty">暂无素材，点击上传按钮添加</div>;

  return (
    <div className="file-grid-container">
      {grouped.map(([date, items]) => {
        const allSelected = items.length > 0 && items.every((f) => selectedFileIds.has(f.id));
        return (
          <div key={date} className="file-group">
            <div className="text-sm text-gray-400 mb-2 flex items-center gap-2">
              {batchMode && (
                <input type="checkbox" checked={allSelected} readOnly
                  className="w-4 h-4 accent-blue-500 cursor-pointer rounded"
                  onClick={() => toggleDateGroup(date)} />
              )}
              {date}
            </div>
            <div className="file-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${fileGridSize}px, 1fr))` }}>
              {items.map((file) => (
                <FileCard
                  key={file.id}
                  file={file}
                  batchMode={batchMode}
                  selected={selectedFileIds.has(file.id)}
                  onToggleSelect={() => useMaterialLibraryStore.getState().toggleFileSelection(file.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
