// packages/shared/src/canvas/normalizeLoadedCanvas.ts
// R1b Task 17：加载几何兜底（守恒归位——与 refitGroupGeometry 同一部法律）。
import type { CanvasNodeRecord } from './nodeEnvelope';
import { resolveStoryboardConfig } from './storyboardConfig';
import { calcStoryboardSize, calcDefaultGrid, refitGroupGeometry, DEFAULT_CHILD_SIZE, COLLAPSED_SIZE } from './geometry';

/** 加载几何兜底：组缺 width/height 才派生（幂等——有几何早退，归位是一次性的）。
 *  与 refitGroupGeometry 同一部法律（v11 裁决）：normal 组守恒归位（子绝对 rect 喂入 → frame 绝对空间
 *  写回、rel 随动、子绝对不变）——组框是派生量，归位是满足契约 2 的唯一解。
 *  守卫：storyboard→配置型；manuallyResized+savedSize→用户尺寸；collapsed→折叠尺寸。
 *  调用方：服务端导入/clone（幂等保险，Task 20 登记）+ web applyDocToStore（加载补缺——refitExpandedGroups 的
 *  重算职责不变，本函数只处理缺几何组，两者经幂等不冲突）。 */
export function normalizeLoadedCanvas(records: CanvasNodeRecord[]): CanvasNodeRecord[] {
  const patch = new Map<string, Partial<CanvasNodeRecord>>();
  for (const n of records) {
    if (n.type !== 'group' || (n.width != null && n.height != null)) continue;
    const d = n.data as Record<string, unknown>;
    if (d.groupType === 'storyboard') {
      // v5：缺 storyboard 键按 calcDefaultGrid(cells.length) 派生 grid——与建组方同语义（1×1 回落会给同一数据两种尺寸）。
      // 注：calcDefaultGrid 返回 {rows, cols}，须显式映射到 cfg 的 gridRows/gridCols（直展开不覆盖，恒 1×1）
      const grid = calcDefaultGrid(((d.cells as string[]) ?? []).filter(Boolean).length);
      const cfg = d.storyboard
        ? resolveStoryboardConfig({ storyboard: d.storyboard })
        : { ...resolveStoryboardConfig({ storyboard: undefined }), gridRows: grid.rows, gridCols: grid.cols };
      const size = calcStoryboardSize(cfg.gridRows, cfg.gridCols, cfg.aspectRatio);
      patch.set(n.id, { width: size.width, height: size.height });
      continue;
    }
    // v5 C3：manuallyResized 需同时有 savedSize 才用用户尺寸——无 savedSize 的标志（不可达但堵洞）落到下方派生
    if (d.manuallyResized && d.savedSize && typeof d.savedSize === 'object') {
      const s = d.savedSize as { width: number; height: number };
      patch.set(n.id, { width: s.width, height: s.height });
      continue;
    }
    if (d.collapsed) {
      patch.set(n.id, { width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height });
      continue;
    }
    // 守卫序列已隐含 shouldAutoRefit 语义（storyboard/有效 savedSize/collapsed 均已 continue）——
    // 刻意不调 shouldAutoRefit：它对 manuallyResized 一票否决，会把"无 savedSize 的手动组"也跳过（C3 洞）
    const children = records.filter((r) => r.parentId === n.id);
    if (children.length === 0) continue;
    const { frame, rels } = refitGroupGeometry(children.map((c) => ({
      // 关键（v4）：doc 里子的 position 是相对组的 rel——喂绝对 rect 须加组原点（applyGroupFrame 同款）
      x: c.position.x + (n.position?.x ?? 0),
      y: c.position.y + (n.position?.y ?? 0),
      width: c.width ?? DEFAULT_CHILD_SIZE.width,
      height: c.height ?? DEFAULT_CHILD_SIZE.height,
    })));
    patch.set(n.id, { position: { x: frame.x, y: frame.y }, width: frame.width, height: frame.height });
    children.forEach((c, i) => patch.set(c.id, { position: rels[i] }));   // rel 随动——子绝对不变
  }
  if (patch.size === 0) return records;
  return records.map((r) => (patch.has(r.id) ? { ...r, ...patch.get(r.id) } : r));
}
