export interface Folder {
  id: string;
  name: string;
  parentId: string | null; // 自引用，一期恒 null（根级）
  workspaceId: string;     // 一期恒 'personal'
  createdAt: string;
  updatedAt: string;
}

export interface FolderViewModel extends Folder {
  canvasCount: number;
  thumbnails: string[]; // 合法 CSS background 值：url("...") 或 linear-gradient(...)
}

export interface Canvas {
  id: string; // Template id；占位记录为 `placeholder-${projectId}`
  name: string;
  coverUrl: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  folderId: string | null; // null = 根目录
  isPlaceholder?: boolean;
}

export type WorkspaceItem =
  | { type: 'folder'; data: FolderViewModel }
  | { type: 'canvas'; data: Canvas };

export type ViewMode = 'grid' | 'list';
export type FilterKind = 'all' | 'folders' | 'canvases';
