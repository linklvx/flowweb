// shared 包无 exports 字段，子路径 '@flowweb/shared/types/video-project' 不可解析（TS2307 实证）；
// 既有惯例是 barrel 导出（packages/shared/src/index.ts），故经 barrel re-export。
export * from '@flowweb/shared';

import type { VideoClip, ImageClip, AudioClip, SubtitleClip } from '@flowweb/shared';

/** 四类片段联合——timeline 纯函数/store 的统一操作对象 */
export type Clip = VideoClip | ImageClip | AudioClip | SubtitleClip;

/** 剪辑节点自身 data（一期基本为空——工程数据在 VideoProject 表，节点 id 先于工程存在） */
export interface VideoEditNodeData {
  title?: string;
  [key: string]: unknown;
}
