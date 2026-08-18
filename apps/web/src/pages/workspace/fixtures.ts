import type { Folder } from './types';

// TODO: 后端阶段整体删除，替换为真实文件夹 API
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();

export const MOCK_FOLDERS: Folder[] = [
  { id: 'folder-demo-1', name: '未命名文件夹', parentId: null, workspaceId: 'personal', createdAt: iso(2), updatedAt: iso(2) },
  { id: 'folder-demo-2', name: '项目文件夹', parentId: null, workspaceId: 'personal', createdAt: iso(3), updatedAt: iso(3) },
];

// 初始归属：按画布加载顺序分配（前 2 → folder-demo-1，第 3-4 → folder-demo-2）
export function buildInitialFolderMap(canvasIds: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  canvasIds.slice(0, 2).forEach((id) => { map[id] = 'folder-demo-1'; });
  canvasIds.slice(2, 4).forEach((id) => { map[id] = 'folder-demo-2'; });
  return map;
}
