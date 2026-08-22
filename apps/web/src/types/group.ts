// apps/web/src/types/group.ts
export type GroupType = 'normal' | 'storyboard';
export type AspectRatio = '21:9' | '16:9' | '9:16' | '3:4' | '4:3' | '1:1';
export type StitchResolution = '2K' | '4K';

export interface StoryboardConfig {
  aspectRatio: AspectRatio;
  gridRows: number;
  gridCols: number;
  showIndex: boolean;
  stitchResolution: StitchResolution;
}

export interface GroupNodeData extends Record<string, unknown> {
  groupType: GroupType;
  name?: string;
  collapsed?: boolean;
  cells?: (string | null)[]; // null = 空宫格占位
  storyboard?: StoryboardConfig;
}
