// apps/web/src/types/group.ts
// R1b Task 16：类型面五符号（GroupType/ASPECT_RATIOS/AspectRatio/StitchResolution/StoryboardConfig）
// 迁入 @flowweb/shared/src/types/group.ts——本文件降为具名 re-export + F30 交叉定义。
// 值导出必须含 ASPECT_RATIOS（storyboardConfig.test.ts:4 与 canvasStore.storyboardConfig.test.ts:6 值导入它）。
export {
  type GroupType, ASPECT_RATIOS, type AspectRatio, type StitchResolution, type StoryboardConfig,
} from '@flowweb/shared';
import type { GroupNodeDataShape } from '@flowweb/shared';

// F30：宽松面（GroupNodeDataShape 的 storyboard 字段 aspectRatio: string）交叉索引签名——
// 渲染面原始 data 类型；解析后的窄面走 resolveStoryboardConfig → StoryboardConfig。
//（注释措辞注意：本文件在 storyboard-dereref-guard 扫描面内，禁写点号裸解引用字样。）
export type GroupNodeData = GroupNodeDataShape & Record<string, unknown>;
