import { useMemo, useState, useEffect, useCallback } from 'react';
import { useMaterialLibraryStore } from '../../../stores/materialLibraryStore';
import FileCard from './FileCard';
import type { MaterialFile } from '@flowweb/shared';

function useFinePointer(): boolean {
  const [fine, setFine] = useState(() => window.matchMedia('(pointer: fine)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: fine)');
    const handler = (e: MediaQueryListEvent) => setFine(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return fine;
}

function throttle(fn: () => void, ms: number) {
  let last = 0;
  return () => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(); }
  };
}

interface FileGridStore {
  selectFile?: (id: string) => void;
  deselectFile?: (id: string) => void;
  toggleFileSelection?: (id: string) => void;
}

interface FileGridProps {
  files?: MaterialFile[];
  fileGridSize?: number;
  loading?: boolean;
  batchMode?: boolean;
  selectedFileIds?: Set<string>;
  emptyText?: string;
  onToggleFavorite?: (id: string) => void;
  onDelete?: (id: string) => void;
  store?: FileGridStore;
}

export default function FileGrid(props: FileGridProps = {}) {
  const storeFiles = useMaterialLibraryStore((s) => s.files);
  const storeFileGridSize = useMaterialLibraryStore((s) => s.fileGridSize);
  const storeLoading = useMaterialLibraryStore((s) => s.loading);
  const storeBatchMode = useMaterialLibraryStore((s) => s.batchMode);
  const storeSelectedFileIds = useMaterialLibraryStore((s) => s.selectedFileIds);

  const files = props.files ?? storeFiles;
  const fileGridSize = props.fileGridSize ?? storeFileGridSize;
  const loading = props.loading ?? storeLoading;
  const batchMode = props.batchMode ?? storeBatchMode;
  const selectedFileIds = props.selectedFileIds ?? storeSelectedFileIds;

  const isFinePointer = useFinePointer();

  const handleScroll = useCallback(
    throttle(() => {
      window.dispatchEvent(new CustomEvent('material-library:list-scroll'));
    }, 100),
    [],
  );

  const getOps = () => props.store ?? useMaterialLibraryStore.getState();

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
    const ops = getOps();
    filesInGroup.forEach((f) => {
      if (allSelected) {
        ops.deselectFile?.(f.id);
      } else {
        ops.selectFile?.(f.id);
      }
    });
  };

  if (loading) return <div className="file-grid-loading">加载中...</div>;
  if (files.length === 0) return <div className="file-grid-empty">{props.emptyText ?? '暂无素材，点击上传按钮添加'}</div>;

  return (
    <div className="file-grid-container" onScroll={handleScroll}>
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
                  isFinePointer={isFinePointer}
                  onToggleSelect={() => getOps().toggleFileSelection?.(file.id)}
                  onToggleFavorite={props.onToggleFavorite}
                  onDelete={props.onDelete}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
