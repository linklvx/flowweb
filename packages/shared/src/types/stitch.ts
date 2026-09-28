/** stitch 线上载荷键集单源（R0d）：API 的 CreateStitchTaskDto 与 web 的 stitchApi 契约测试共同锚定——
 *  加第 7 键时两侧测试必红其一，杜绝两份手工定义静默漂移（运行时 400）。
 *  字段类型镜像 CreateStitchTaskDto（storyboard.dto.ts）——改类型须双侧同步（v5 补注）。 */
interface StitchWireShape {
  fileIds: string[]; gridRows: number; gridCols: number;
  aspectRatio: string; showIndex: boolean; resolution: string;
}

export const STITCH_JOB_KEYS = [
  'fileIds', 'gridRows', 'gridCols', 'aspectRatio', 'showIndex', 'resolution',
] as const satisfies readonly (keyof StitchWireShape)[];
