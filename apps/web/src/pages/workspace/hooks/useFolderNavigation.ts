import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { message } from 'antd';
import type { Folder } from '../types';

export function useFolderNavigation(folders: Folder[], loaded: boolean) {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentFolderId = searchParams.get('folder');

  // 无效 folderId fallback：重置根目录并提示（保留其他参数，如 ?tab=）
  useEffect(() => {
    if (loaded && currentFolderId && !folders.some((f) => f.id === currentFolderId)) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('folder');
        return next;
      }, { replace: true });
      message.info('文件夹不存在');
    }
  }, [loaded, currentFolderId, folders, setSearchParams]);

  const setCurrentFolderId = (id: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('folder', id); else next.delete('folder');
      return next;
    }, { replace: true });
  };

  // 根 → 当前层级链（一期深 1，按递归链写）
  const path = useMemo(() => {
    const chain: Folder[] = [];
    let cur = folders.find((f) => f.id === currentFolderId);
    while (cur) {
      chain.unshift(cur);
      cur = cur.parentId ? folders.find((f) => f.id === cur!.parentId) : undefined;
    }
    return currentFolderId && chain.length === 0 ? [] : chain;
  }, [folders, currentFolderId]);

  const valid = !currentFolderId || folders.some((f) => f.id === currentFolderId);
  return { currentFolderId: valid ? currentFolderId : null, setCurrentFolderId, path };
}

