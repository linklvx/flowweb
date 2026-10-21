// packages/shared/src/canvas/placement.ts
// T17（plan v11.2 S5 片·spec Z12''/Z17''/:258/:90）：placement 复合单键——判别联合落位。
//
// DOC_NODE_KEYS 契约表（:258 钉死）：
//   envelope 7 键 = NODE_ENVELOPE_KEYS（id/type/parentId/width/height/position/data——Z3'' 不动红线）
//   + order/slot 进 **data** 判别（PLACEMENT_DATA_KEYS）——
//     · order：自由节点层内单键序（单一有界分数索引键——order-key.ts；D5：仅同 parentId 层内生效）
//     · slot：分镜子格位（**派生单实现禁两可**——cells 数组不落 doc，deriveStoryboardCells 从
//       子 slot+capacity 派生；同一节点 order+slot 并存=键集违例）
//   fillDoc/applyRecordToYMap/readRecordsFromMaps/normalizeCanvasRecord/toDocRecord 对 order/slot
//   随 data 透传（信封层不解释 placement 键——判别校验在本模块 validatePlacementData/读序在
//   order-records.ts，键集断言挂 docShape.stripDerivedKeys）。
import { NODE_ENVELOPE_KEYS } from './nodeEnvelope';
import { isValidOrderKey } from './order-key';

/** placement 数据键集（判别联合的键面——order|slot 恰两键）。 */
export const PLACEMENT_DATA_KEYS = ['order', 'slot'] as const;

/** DOC_NODE_KEYS 契约表（envelope 7 键+data placement 判别——全仓单源，禁手抄键表）。 */
export const DOC_NODE_KEYS = {
  envelope: NODE_ENVELOPE_KEYS,
  dataPlacement: PLACEMENT_DATA_KEYS,
} as const;

/** placement 判别联合：order=自由层内键 / slot=分镜格位（slot=派生单实现——格值域 [0,·)。 */
export type NodePlacement =
  | { kind: 'order'; order: string | null }
  | { kind: 'slot'; slot: number };

const isFiniteNonNegInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * 读 placement（判别优先级：有效 slot ⇒ slot 档——分镜格位是更具体的 placement；
 * 其余（含非法 slot/缺键）⇒ order 档（order 可为 null=缺键——读侧全函数，排序兜底归读序）。
 */
export function readPlacement(data: Record<string, unknown>): NodePlacement {
  if (isFiniteNonNegInt(data.slot)) return { kind: 'slot', slot: data.slot };
  const order = typeof data.order === 'string' ? data.order : null;
  return { kind: 'order', order };
}

/** 键集违例清单（禁两可：order+slot 并存；order/slot 各自的值合法性）。返回空数组=合法。 */
export function validatePlacementData(data: Record<string, unknown>): string[] {
  const violations: string[] = [];
  const hasSlot = isFiniteNonNegInt(data.slot);
  const hasOrder = data.order != null;
  if (hasSlot && hasOrder) {
    violations.push(`order+slot 并存（禁两可——slot=派生单实现，order=自由层键）: order=${String(data.order)} slot=${String(data.slot)}`);
    return violations;
  }
  if (hasOrder && typeof data.order !== 'string') violations.push(`order 非字符串: ${typeof data.order}`);
  else if (hasOrder && !isValidOrderKey(data.order as string)) violations.push(`order 非法键形: ${String(data.order)}`);
  if (data.slot != null && !hasSlot) violations.push(`slot 非法（须非负整数）: ${String(data.slot)}`);
  return violations;
}

/** 分镜子判定（父记录表入参——storyboard 组的 parentId 子=分镜子）。 */
export function isStoryboardChildRecord(
  rec: { parentId?: string | null; data?: Record<string, unknown> },
  byId: ReadonlyMap<string, { type: string; data?: Record<string, unknown> }>,
): boolean {
  if (rec.parentId == null) return false;
  const parent = byId.get(rec.parentId);
  return parent?.type === 'group' && (parent.data as Record<string, unknown> | undefined)?.groupType === 'storyboard';
}

/**
 * deriveStoryboardCells（Z17'' 维持 v10——cells→slot 派生单实现）：
 *   - capacity 派生不落 doc（=gridRows×gridCols——调用方从 storyboard config 解析后传入）；
 *   - **长度恰=capacity**（Z17'' 断言）；成员=slot<capacity 的分镜子（重复 slot：(slot,id)
 *     tie-break 落格、后到者挤首空格——重复键容忍 Z4''-v14）；
 *   - overflowIds=装不下的成员（slot ≥ capacity / 满员挤格失败——resize 溢出移出与满员 append
 *     的读侧来源；(slot,id) 序）；
 *   - 缺 slot/非法 slot 成员自愈填首空格（读侧派生不写 doc——修复归 T18 CLI renumber）；
 *   - swap=整值写（两子 slot 互换后派生格互换——无第三态）。
 */
export function deriveStoryboardCells(
  children: ReadonlyArray<{ id: string; data: Record<string, unknown> }>,
  capacity: number,
): { cells: (string | null)[]; overflowIds: string[] } {
  const cap = Number.isInteger(capacity) && capacity > 0 ? capacity : 0;
  const cells: (string | null)[] = new Array<string | null>(cap).fill(null);
  const overflow: string[] = [];
  const place = (id: string): void => {
    for (let i = 0; i < cap; i++) {
      if (cells[i] == null) { cells[i] = id; return; }
    }
    overflow.push(id);
  };
  const valid: { id: string; slot: number }[] = [];
  const invalid: string[] = [];
  for (const c of children) {
    if (isFiniteNonNegInt(c.data?.slot)) valid.push({ id: c.id, slot: c.data.slot });
    else invalid.push(c.id);
  }
  // (slot,id) 双 tie-break：同 slot 按 id 字典序——读序稳定（Z4''-v14）
  valid.sort((a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const v of valid) {
    if (v.slot >= cap) { overflow.push(v.id); continue; }   // slot ≥ capacity：溢出（不挤格——越格成员非在格域）
    if (cells[v.slot] == null) cells[v.slot] = v.id;
    else place(v.id);                                       // 重复 slot：挤首空格（重复键容忍）
  }
  for (const id of invalid) place(id); // 缺/非法 slot：自愈填首空格；满员溢出
  return { cells, overflowIds: overflow };
}
