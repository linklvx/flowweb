export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FolderViewModel extends Folder {
  canvasCount: number;
  thumbnails: string[];
}

export interface Canvas {
  id: string;
  name: string;
  coverUrl: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  folderId: string | null;
}

export type WorkspaceItem =
  | { type: 'folder'; data: FolderViewModel }
  | { type: 'canvas'; data: Canvas };

export type ViewMode = 'grid' | 'list';
export type FilterKind = 'all' | 'folders' | 'canvases';
