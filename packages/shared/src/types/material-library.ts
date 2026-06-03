export interface MaterialFolder {
  id: string;
  name: string;
  parentId: string | null;
  userId: string;
  sortOrder: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  url?: string;           // 动态生成的预签名URL，不持久化
  thumbnailUrl?: string;   // 动态生成，来自 thumbnailKey
  folderId: string | null;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}
