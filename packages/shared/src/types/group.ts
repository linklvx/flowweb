/** 组节点 data 形状（spec §4.6/F30）。R0a 仅作 GROUP_NODE_DATA_KEYS 的锚定面；
 *  web 侧 types/group.ts 的 GroupNodeData 重构切换属 R1（F30），本分片不动它。
 *  注意 color/nameCustom 是 R2c 前向键——现状 store 不产出，为克隆/公开过滤契约预置。 */
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
 *  API 生产源码暂用字面量（F36），R1a 构建后切值导入。 */
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
