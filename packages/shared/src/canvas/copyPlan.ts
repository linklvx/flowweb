import type { CanvasNodeRecord } from './nodeEnvelope';

/** 副本构造体（注记 9/19a 分工单点）：闭包展开与 hidden/detached 裁决由 participation('duplicate') 前置完成
 *  （hidden 排除仅 detached/直接选中桶），本函数只接收已裁决 ids 做纯映射构造，不再自行闭包过滤。
 *  records=调用方经 resolveNodeData 组装的记录集（组=cs data、普通=ns 全量）；含 ids 全员的父记录
 *  超集（detached 绝对位换算需父 position——父仅作坐标参照，不被复制）。 */

/** 副本记录：信封 + selected（UI 选择态，store 落位时逐字映射）。extent 不落信封（doc 无此键）——
 *  子副本 extent='parent' 由 store 落位层按 parentId 推导补齐，detached 顶层化副本无键（=undefined）。 */
export interface CopyRecord extends CanvasNodeRecord {
  selected?: boolean;
}

export interface CopyPlan {
  copies: CopyRecord[];
  newEdges: { id: string; source: string; target: string }[];
  idMap: Map<string, string>;
}

export interface CopyPlacement {
  /** duplicate 模式：整体平移量 */
  offset?: { x: number; y: number };
  /** paste 模式：首个顶层副本落点锚（见实现内平移裁定注释） */
  position?: { x: number; y: number };
}

export function buildCopyPlan(
  records: CanvasNodeRecord[],
  ids: string[],
  placement: CopyPlacement,
  newId: () => string,
  edges: { id: string; source: string; target: string }[] = [],
): CopyPlan {
  const byId = new Map(records.map((r) => [r.id, r]));
  // pass 1：idMap（闭包全员预生成新 id——cells 重映射/边重映射/副本构造三处共用）
  const idMap = new Map<string, string>();
  for (const id of ids) {
    if (!byId.has(id)) throw new Error(`buildCopyPlan: records 缺成员 ${id}`);
    idMap.set(id, newId());
  }
  // 平移量裁定（position 粘贴模式）：delta = position − 首个顶层原件 position，施加于全部顶层副本
  // （组平移、子 rel 随父走；offset 复制模式退化为 +offset）
  const firstTop = ids.map((id) => byId.get(id)!).find((r) => !(r.parentId && idMap.has(r.parentId)));
  let dx: number, dy: number;
  if (placement.position) {
    if (!firstTop) throw new Error('buildCopyPlan: position 模式无顶层副本可锚定');
    dx = placement.position.x - firstTop.position.x;
    dy = placement.position.y - firstTop.position.y;
  } else {
    dx = placement.offset?.x ?? 0;
    dy = placement.offset?.y ?? 0;
  }
  // pass 2：副本构造
  const copies: CopyRecord[] = [];
  for (const id of ids) {
    const rec = byId.get(id)!;
    if (rec.parentId && !byId.has(rec.parentId)) {
      throw new Error(`buildCopyPlan: records 缺父记录 ${rec.parentId}`);   // 绝对位换算无据——fail-fast
    }
    const parent = rec.parentId ? byId.get(rec.parentId) : undefined;
    // data 逐字保真（collapsed/color/name/storyboard 配置原样——savedSize 键已随 O0c-3 全链删）；
    // 仅组副本 cells 重映射（悬空 id → null 占位——禁 || id 兜底，与 clone remapIds 红线同款）
    const data: Record<string, unknown> = structuredClone(rec.data ?? {});
    if (rec.type === 'group' && Array.isArray(data.cells)) {
      data.cells = (data.cells as string[]).map((c) => idMap.get(c) ?? null);
    }
    const base = {
      ...(rec.width != null ? { width: rec.width } : {}),
      ...(rec.height != null ? { height: rec.height } : {}),
      data,
    };
    if (parent && idMap.has(rec.parentId!)) {
      // 闭包内子：parentId=组副本 id、rel 原样；分镜组子 position 归零 {0,0}（纯 DOM 宫格，坐标无意义）
      const storyboardChild = parent.type === 'group' && (parent.data as Record<string, unknown> | undefined)?.groupType === 'storyboard';
      copies.push({
        id: idMap.get(id)!,
        type: rec.type,
        parentId: idMap.get(rec.parentId!)!,
        ...base,
        position: storyboardChild ? { x: 0, y: 0 } : { ...rec.position },
        selected: false,   // 子副本不入选（新选区=组/顶层副本）
      });
    } else {
      // detached/顶层：顶层化（F41）——parentId 删、绝对位（父位+rel）+平移、extent 无键
      // 父环为 producer 侧禁产结构——脏入脏出（ensureParentOrder 兜底排序不崩溃）
      const absX = (parent ? parent.position.x : 0) + rec.position.x;
      const absY = (parent ? parent.position.y : 0) + rec.position.y;
      copies.push({
        id: idMap.get(id)!,
        type: rec.type,
        ...base,
        position: { x: absX + dx, y: absY + dy },
        selected: true,
      });
    }
  }
  // 互连边重映射：两端都在复制集内才保留（跨集边丢弃）
  const newEdges = edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({ id: newId(), source: idMap.get(e.source)!, target: idMap.get(e.target)! }));
  return { copies, newEdges, idMap };
}
