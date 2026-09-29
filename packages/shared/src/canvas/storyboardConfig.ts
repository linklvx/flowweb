// packages/shared/src/canvas/storyboardConfig.ts
// R1b Task 16：apps/web/src/utils/storyboardConfig.ts 整文件迁入（依赖 ASPECT_RATIOS/StoryboardConfig
// 经 types/group.ts 五符号迁入已在 shared）；web 侧改具名 re-export。
import { ASPECT_RATIOS, type StoryboardConfig } from '../types/group';

const RESOLUTIONS = ['2K', '4K'] as const;

export const DEFAULT_STORYBOARD_CONFIG: StoryboardConfig = {
  aspectRatio: '16:9', gridRows: 1, gridCols: 1, showIndex: false, stitchResolution: '2K',
};

const clampInt = (v: unknown, min: number, max: number): number => {
  const n = typeof v === 'number' ? Math.round(v) : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_STORYBOARD_CONFIG.gridRows;
  return Math.min(max, Math.max(min, n));
};

/** 克隆体/异常 data 的分镜配置解析器（spec §4.6 F2）：渲染与 store 全部消费点必须经本函数。
 *  默认值统一引用 DEFAULT_STORYBOARD_CONFIG（改默认一处生效——防硬编码漂移）。 */
export function resolveStoryboardConfig(data: { storyboard?: unknown } | undefined | null): StoryboardConfig {
  const raw = (data as Record<string, unknown> | null | undefined)?.storyboard;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STORYBOARD_CONFIG };
  const s = raw as Record<string, unknown>;
  return {
    aspectRatio: (ASPECT_RATIOS as readonly string[]).includes(s.aspectRatio as string)
      ? (s.aspectRatio as StoryboardConfig['aspectRatio']) : DEFAULT_STORYBOARD_CONFIG.aspectRatio,
    gridRows: clampInt(s.gridRows, 1, 10),
    gridCols: clampInt(s.gridCols, 1, 10),
    showIndex: typeof s.showIndex === 'boolean' ? s.showIndex : DEFAULT_STORYBOARD_CONFIG.showIndex,
    stitchResolution: (RESOLUTIONS as readonly string[]).includes(s.stitchResolution as string)
      ? (s.stitchResolution as StoryboardConfig['stitchResolution']) : DEFAULT_STORYBOARD_CONFIG.stitchResolution,
  };
}

/** 守卫型消费点（StitchButton）用：显式判"有无真实配置"——缺配置时提示用户而非按默认静默拼接。
 *  裸解引用只允许出现在本模块（.storyboard\b 门禁 allowlist 见 storyboard-dereref-guard.test.ts）。 */
export function hasStoryboardConfig(data: { storyboard?: unknown } | undefined | null): boolean {
  const raw = (data as Record<string, unknown> | null | undefined)?.storyboard;
  return raw != null && typeof raw === 'object';
}
