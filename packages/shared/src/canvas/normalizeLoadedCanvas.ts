// packages/shared/src/canvas/normalizeLoadedCanvas.ts
// R1b Task 17：加载几何兜底（守恒归位——与 refitGroupGeometry 同一部法律）。
// R2d-1（§4.9 改道 v2.2）：守卫收敛到 resolveExpandedFrame 单源——storyboard 脏键修复前置于几何早退、
// collapsed 判定恒优先（信封恒等可见盒：折叠 normal 组信封≡COLLAPSED_SIZE）、
// savedSize 存在⟺collapsed（展开组杂散键加载边界删——密封快照展开即删）。
import type { CanvasNodeRecord } from './nodeEnvelope';
import { resolveStoryboardConfig } from './storyboardConfig';
import { calcDefaultGrid, DEFAULT_CHILD_SIZE, COLLAPSED_SIZE } from './geometry';
import { resolveExpandedFrame } from './expandedFrame';

/** 加载几何兜底：组缺 width/height 才派生几何（幂等——有几何早退，归位是一次性的）+ 脏键边界修复。
 *  与 refitGroupGeometry 同一部法律（v11 裁决）：normal 组守恒归位（子绝对 rect 喂入 → frame 绝对空间
 *  写回、rel 随动、子绝对不变）——组框是派生量，归位是满足契约 2 的唯一解。
 *  守卫序列（R2d-1）：①storyboard（剥 collapsed/savedSize+配置型信封）→ ②collapsed（COLLAPSED_SIZE
 *  恒覆写）→ ③展开（杂散 savedSize 删键；缺几何经 resolveExpandedFrame 补齐）。
 *  调用方：服务端导入/clone（幂等保险，Task 20 登记）+ web applyDocToStore（加载补缺——refitExpandedGroups 的
 *  重算职责不变，本函数只处理缺几何组，两者经幂等不冲突）。 */
export function normalizeLoadedCanvas(records: CanvasNodeRecord[]): CanvasNodeRecord[] {
  const patch = new Map<string, Partial<CanvasNodeRecord>>();
  for (const n of records) {
    if (n.type !== 'group') continue;
    const d = (n.data ?? {}) as Record<string, unknown>;
    const hasGeometry = n.width != null && n.height != null;
    // ① storyboard 恒最先且前置于几何早退（R2d-1）：分镜组不可折叠，collapsed/savedSize 落其 data
    //    是脏数据——有几何的脏组（信封已被折成 COLLAPSED_SIZE）若晚于早退判定则永不修复；
    //    剥键 + 信封经 resolveExpandedFrame（storyboard 堵洞档单源）。
    if (d.groupType === 'storyboard') {
      const dirty = d.collapsed !== undefined || d.savedSize !== undefined;
      if (!dirty && hasGeometry) continue;
      const data2: Record<string, unknown> = { ...d };
      delete data2.collapsed;
      delete data2.savedSize;
      // v5：缺 storyboard 键按 calcDefaultGrid(cells.length) 派生 grid——与建组方同语义（1×1 回落会给同一数据两种尺寸）。
      // 注：calcDefaultGrid 返回 {rows, cols}，须显式映射到 cfg 的 gridRows/gridCols（直展开不覆盖，恒 1×1）
      const grid = calcDefaultGrid(((data2.cells as string[]) ?? []).filter(Boolean).length);
      const cfg = data2.storyboard
        ? resolveStoryboardConfig({ storyboard: data2.storyboard })
        : { ...resolveStoryboardConfig({ storyboard: undefined }), gridRows: grid.rows, gridCols: grid.cols };
      const ef = resolveExpandedFrame({ data: data2, childrenAbs: [], config: cfg });
      const rec: Partial<CanvasNodeRecord> = { width: ef.width, height: ef.height };
      if (dirty) rec.data = data2;   // 信封修复随剥键同做（折叠过的信封是脏的一部分——恒等可见盒还原）
      patch.set(n.id, rec);
      continue;
    }
    // ② collapsed 判定恒优先（R2d-1）：信封≡COLLAPSED_SIZE 无条件覆写——脏 savedSize/manuallyResized
    //    不得反写进折叠组信封（旧序手动分支先行的洞）。
    if (d.collapsed) {
      patch.set(n.id, { width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height });
      continue;
    }
    // ③ 展开 normal 组：savedSize 存在⟺collapsed——杂散键加载边界删（有几何时只删键不动信封）；
    //    缺几何经 resolveExpandedFrame 补齐（有效 savedSize 优先=等价档，无/无效→守恒重算，空组→COLLAPSED_SIZE）。
    const stray = d.savedSize !== undefined;
    if (hasGeometry) {
      if (stray) patch.set(n.id, { data: stripSavedSize(d) });
      continue;
    }
    const children = records.filter((r) => r.parentId === n.id);
    const childrenAbs = children.map((c) => ({
      // 关键（v4）：doc 里子的 position 是相对组的 rel——喂绝对 rect 须加组原点（applyGroupFrame 同款）
      x: c.position.x + (n.position?.x ?? 0),
      y: c.position.y + (n.position?.y ?? 0),
      width: c.width ?? DEFAULT_CHILD_SIZE.width,
      height: c.height ?? DEFAULT_CHILD_SIZE.height,
    }));
    const ef = resolveExpandedFrame({ data: d, childrenAbs, config: resolveStoryboardConfig(d) });
    const rec: Partial<CanvasNodeRecord> = { width: ef.width, height: ef.height };
    if (stray) rec.data = stripSavedSize(d);
    if (ef.origin) {
      rec.position = { x: ef.origin.x, y: ef.origin.y };
      children.forEach((c, i) => patch.set(c.id, {
        position: { x: childrenAbs[i].x - ef.origin!.x, y: childrenAbs[i].y - ef.origin!.y },
      }));   // rel 随动——子绝对不变
    }
    patch.set(n.id, rec);
  }
  if (patch.size === 0) return records;
  return records.map((r) => (patch.has(r.id) ? { ...r, ...patch.get(r.id) } : r));
}

function stripSavedSize(d: Record<string, unknown>): Record<string, unknown> {
  const data2: Record<string, unknown> = { ...d };
  delete data2.savedSize;
  return data2;
}
