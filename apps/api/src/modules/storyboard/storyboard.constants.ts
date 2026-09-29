// R1b Task 16：VALID_ASPECT_RATIOS 从 shared ASPECT_RATIO_MAP 派生（键集单源——
// 原字面量数组与 web 侧六比例清单逐字双份，派生后漂移即 tsc/测试红）。
import { ASPECT_RATIO_MAP, type AspectRatio } from '@flowweb/shared';

export const STORYBOARD_STITCH_QUEUE = 'stitch';
export const VALID_ASPECT_RATIOS = Object.keys(ASPECT_RATIO_MAP) as AspectRatio[];
export const VALID_RESOLUTIONS = ['2K', '4K'] as const;
