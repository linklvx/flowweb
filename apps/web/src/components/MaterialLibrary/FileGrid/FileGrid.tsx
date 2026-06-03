import { useMemo } from 'react';
import { useMaterialLibraryStore } from '../../../stores/materialLibraryStore';
import FileCard from './FileCard';
import type { MaterialFile } from '@flowweb/shared';

export default function FileGrid() {
  const files = useMaterialLibraryStore((s) => s.files);
  const fileGridSize = useMaterialLibraryStore((s) => s.fileGridSize);
  const loading = useMaterialLibraryStore((s) => s.loading);

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

  if (loading) return <div className="file-grid-loading">加载中...</div>;
  if (files.length === 0) return <div className="file-grid-empty">暂无素材，点击上传按钮添加</div>;

  return (
    <div className="file-grid-container">
      {grouped.map(([date, items]) => (
        <div key={date} className="file-group">
          <div className="text-sm text-gray-400 mb-2">{date}</div>
          <div className="file-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${fileGridSize}px, 1fr))` }}>
            {items.map((file) => <FileCard key={file.id} file={file} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
