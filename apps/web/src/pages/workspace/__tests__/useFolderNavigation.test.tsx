import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router';
import { useFolderNavigation } from '../hooks/useFolderNavigation';
import type { Folder } from '../types';

vi.mock('antd', () => ({ message: { info: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const folders: Folder[] = [
  { id: 'f1', name: 'A', parentId: null, createdAt: '', updatedAt: '' },
  { id: 'f2', name: 'B', parentId: null, createdAt: '', updatedAt: '' },
];

function renderNav(initialUrl = '/works') {
  return renderHook(
    () => {
      const nav = useFolderNavigation(folders, true);
      const [params] = useSearchParams();
      return { ...nav, folderParam: params.get('folder') };
    },
    { wrapper: ({ children }) => <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter> },
  );
}

describe('useFolderNavigation', () => {
  it('默认根目录，path 为空', () => {
    const { result } = renderNav();
    expect(result.current.currentFolderId).toBeNull();
    expect(result.current.path).toEqual([]);
  });

  it('?folder=f1 时定位 f1，path 含该文件夹', () => {
    const { result } = renderNav('/works?folder=f1');
    expect(result.current.currentFolderId).toBe('f1');
    expect(result.current.path.map((f) => f.id)).toEqual(['f1']);
  });

  it('无效 folderId 重置为根目录并清空参数', async () => {
    const { result } = renderNav('/works?folder=nope');
    // 重置发生在 useEffect 中，需 waitFor 等 effect 执行
    await waitFor(() => expect(result.current.currentFolderId).toBeNull());
    expect(result.current.folderParam).toBeNull();
  });

  it('setCurrentFolderId 同步 URL', async () => {
    const { result } = renderNav('/works');
    await act(async () => {
      result.current.setCurrentFolderId('f2');
    });
    expect(result.current.folderParam).toBe('f2');
    await act(async () => {
      result.current.setCurrentFolderId(null);
    });
    expect(result.current.folderParam).toBeNull();
  });
});
