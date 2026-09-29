// apps/web/src/utils/groupGeometry.ts
import { CONVERT_GAP } from '@flowweb/shared';

/** 解散类网格重排（F38 v9 spacing）：行/列 pitch = max(成员自身尺寸, 基准)——异构不重叠。
 *  v5 槽位语义（与现状 ungroup/convertGroup 的 cells.indexOf(n.id) 槽位布局一致）：
 *  **保留槽位**——null 空宫格与悬空 id 都按基准尺寸占格（空槽不塌陷），后续节点不被提前；
 *  sizeOf 未知 id 回落基准（占格后 pos 里无该 id 输出——不产生坐标但占位）。 */
export function placeGrid(
  ids: (string | null)[], gridCols: number, cellW: number, cellH: number,
  sizeOf: (id: string) => { width: number; height: number },
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const slotOf = (v: string | null) => v == null
    ? { width: cellW, height: cellH }                    // null 占位：基准尺寸占格
    : sizeOf(v);                                          // 悬空 id：sizeOf 回落基准（同占格）
  let y = 0;
  for (let r = 0; r * gridCols < ids.length; r++) {
    const row = ids.slice(r * gridCols, (r + 1) * gridCols);
    const rowH = Math.max(cellH, ...row.map(slotOf).map((s) => s.height));
    let x = 0;
    for (const v of row) {
      if (v != null) pos.set(v, { x, y });
      x += Math.max(cellW, slotOf(v).width) + CONVERT_GAP;   // 每槽都推进——空槽不塌陷
    }
    y += rowH + CONVERT_GAP;
  }
  return pos;
}
