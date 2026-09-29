/** 组节点 data 形状（spec §4.6/F30）。R0a 仅作 GROUP_NODE_DATA_KEYS 的锚定面；
 *  web 侧 types/group.ts 的 GroupNodeData 重构切换属 R1（F30），本分片不动它。
 *  注意 color 是 R2c 前向键——现状 store 不产出，为克隆/公开过滤契约预置；nameCustom 已由
 *  canvasStore convertGroup 产出（→storyboard 设 false，→normal 删键）。 */
export interface GroupNodeDataShape {
  groupType: 'normal' | 'storyboard';
  name?: string;
  collapsed?: boolean;
  cells?: (string | null)[];
  storyboard?: {
    aspectRatio: string;
    gridRows: number;
    gridCols: number;
    showIndex: boolean;
    stitchResolution: '2K' | '4K';
  };
  savedSize?: { width: number; height: number };
  nameCustom?: boolean;
  color?: string;
  manuallyResized?: boolean;
}

/** 组节点 data 克隆/公开过滤白名单单源（注意：是"过滤契约键"，非组 data 全集——
 *  store 实际还写 aspectRatio/customSize 等运行键，不在此表、克隆会剥，属预期）。
 *  API 生产源码已切值导入（snapshot-filter.util.ts 的 CLONE_WHITELIST.group 用 [...GROUP_NODE_DATA_KEYS]）。 */
export const GROUP_NODE_DATA_KEYS = [
  'groupType', 'cells', 'name', 'storyboard', 'collapsed',
  'savedSize', 'nameCustom', 'color', 'manuallyResized',
] as const satisfies readonly (keyof GroupNodeDataShape)[];

// 双向编译锚定（spec §4.6：satisfies 防多余键 + Exclude 防缺键——两向任一漂移 tsc 红）。
// v4：纯类型别名断言——零运行时代码零 lint 面（无 no-empty-function/noUnusedLocals 风险，产物无痕）
type _MissingFromKeys = Exclude<keyof GroupNodeDataShape, (typeof GROUP_NODE_DATA_KEYS)[number]>;
type _AssertNoMissing<T extends never> = T;
// v5：编译器断言锚——勿删/勿被"清理死代码"误清（无任何引用是刻意的：删除即静默失去缺键防护，没有任何测试会红）
type _Anchor = _AssertNoMissing<_MissingFromKeys>;

// ---- 组类型面五符号（R1b Task 16 自 apps/web/src/types/group.ts:2-13 整体迁入——web 侧改 re-export，消费点零改动）----

export type GroupType = 'normal' | 'storyboard';

export const ASPECT_RATIOS = ['21:9', '16:9', '9:16', '3:4', '4:3', '1:1'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export type StitchResolution = '2K' | '4K';

/** 解析后的分镜配置（运行时/配置面）。GroupNodeDataShape.storyboard 的 aspectRatio: string 是
 *  刻意宽松（模板/克隆边界的原始数据）——两种类型勿"统一"，边界语义依赖宽松面。 */
export interface StoryboardConfig {
  aspectRatio: AspectRatio;
  gridRows: number;
  gridCols: number;
  showIndex: boolean;
  stitchResolution: StitchResolution;
}
