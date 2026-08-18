import { describe, it, expect } from 'vitest';
import { MOCK_FOLDERS, buildInitialFolderMap } from '../fixtures';

describe('fixtures', () => {
  it('预置 2 个根级个人文件夹', () => {
    expect(MOCK_FOLDERS).toHaveLength(2);
    expect(MOCK_FOLDERS.every((f) => f.parentId === null && f.workspaceId === 'personal')).toBe(true);
  });
  it('前 2 个画布归 folder-demo-1，第 3-4 个归 folder-demo-2，其余不归属', () => {
    const map = buildInitialFolderMap(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(map).toEqual({
      c1: 'folder-demo-1',
      c2: 'folder-demo-1',
      c3: 'folder-demo-2',
      c4: 'folder-demo-2',
    });
  });
  it('空画布列表返回空对象', () => {
    expect(buildInitialFolderMap([])).toEqual({});
  });
});
