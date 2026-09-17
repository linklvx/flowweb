/** 视频作品展示（spec 2026-09-16 §4.2 契约） */

export interface VideoWorkListItem {
  id: string;
  title: string;
  coverUrl: string | null;
  durationSec: number | null;
  tags: string[];
}

export interface VideoWorkDetail extends VideoWorkListItem {
  videoUrl: string;
  categoryId: string | null;
  viewCount: number;
  likeCount: number;
  liked: boolean;
  description: string | null;
  authorName: string;
  publishedAt: string | null; // PUBLISHED 恒非空；UI 依赖服务端保证，勿用 ! 断言
  width: number | null;
  height: number | null;
  canViewProcess: boolean;
  canClone: boolean;
}

export interface VideoWorkListResult {
  items: VideoWorkListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VideoCategoryItem {
  id: string;
  name: string;
  sortOrder: number;
}

export type CarouselScope = 'all' | 'category';

export interface VideoWorkSettings {
  carouselEnabled: boolean;
  carouselScope: CarouselScope;
}

/** 创作过程快照（§4.6）——data 为白名单后字段，未知类型仅结构字段 */
export interface SnapshotNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  parentId?: string | null;
  data: Record<string, unknown>;
}

export interface SnapshotEdge {
  id: string;
  source: string;
  target: string;
}

export interface ProcessSnapshotData {
  workId: string;
  title: string;
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
}

/** 快照白名单的跨端锚定清单（第八轮裁定，spec §4.6 实现注记）：
 *  真值仍是 CanvasView.tsx:42-51 的 nodeTypes 注册表（8 键）——本常量是两侧测试的锚：
 *  api 断言 WHITELIST 键 ⊇ 本清单（Task 5.1）、web 断言 CanvasView nodeTypes 键 ⊆ 本清单（Task 9.3）。
 *  CanvasView 新增节点类型而清单未同步时任一侧测试红——替代"人工同步 + 自指测试"防线。 */
export const VIDEO_WORK_NODE_TYPES = [
  'imageGen', 'imageExtGen', 'textInput', 'videoGen', 'audioGen', 'multiImageGen', 'videoEdit', 'group',
] as const;
