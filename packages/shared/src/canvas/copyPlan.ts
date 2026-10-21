import type { CanvasNodeRecord } from './nodeEnvelope';

/**
 * normalizeCopiedNodeData（Z14''-v13 收窄——**单函数五路径共用**：copyPlan[duplicate]/seed/clone/
 * paste/explode）：副本 data 归一，规则：
 *   - status loading/error → **有 fileId 则 done 无则 idle**（red 锚：copyPlan:63 structuredClone
 *     连 loading 复制=副本永久转圈——无交付者的 loading 是死态）；
 *   - 清 errorCode/error（副本不继承失败态）；
 *   - 删 ImageItem.url（历史键——T5a ImageItem 去 url 契约；**保留 images[].id**——新建路径不 strip
 *     身份引用，消灭空图窗口 G46）；
 *   - **保留 fileId/images[].id**（新建不 strip——裁决 3/Z11''-v14：CLIENT_FORBIDDEN_ON_UPDATE
 *     只挂更新路径）；
 *   - exec 永不复制（exec=doc 独立根，不在节点 data——本函数断言域不含 exec 键，副本构造点
 *     全走 addNode 意图=结构性零 exec 复制）；
 *   - cells 派生删（Z17''——cells 不落 doc；格位由子 slot 承载，slot **保留**：分镜副本格位保真，
 *     新组内 slot 域独立于源组）；
 *   - order 删（副本禁携源层 order 键——**allocator 唯一入口重新分配** G54：副本同层同 order
 *     重复键红线）。
 * 纯函数（structuredClone 入参隔离）。
 */
export function normalizeCopiedNodeData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = structuredClone(data);
  delete out.cells;    // cells 派生删（格位=子 slot）
  delete out.order;    // order 重新分配（allocator 唯一入口）
  const status = out.status;
  if (status === 'loading' || status === 'error') {
    const fid = out.fileId;
    out.status = typeof fid === 'string' && fid !== '' ? 'done' : 'idle';
  }
  delete out.errorCode;
  delete out.error;
  if (Array.isArray(out.images)) {
    out.images = out.images.map((img) => {
      if (img == null || typeof img !== 'object' || Array.isArray(img)) return img;
      const { url: _url, ...rest } = img as Record<string, unknown>;  // 删 ImageItem.url（保留 id）
      return rest;
    });
  }
  return out;
}

/** 副本构造体（注记 9/19a 分工单点）：闭包展开与 hidden/detached 裁决由 participation('duplicate') 前置完成
 *  （hidden 排除仅 detached/直接选中桶），本函数只接收已裁决 ids 做纯映射构造，不再自行闭包过滤。
 *  records=调用方经 resolveNodeData 组装的记录集（组=cs data、普通=ns 全量）；含 ids 全员的父记录
 *  超集（detached 绝对位换算需父 position——父仅作坐标参照，不被复制）。
 */
export interface CopyRecord extends CanvasNodeRecord {
  selected?: boolean;
}

export interface CopyPlan {
  copies: CopyRecord[];
  newEdges: { id: string; source: string; target: string }[];
  idMap: Map<string, string>;
}

/**
 * order 分配备选缝（T17 G54——allocator 唯一入口）：按副本落层分配新 order 键。
 * null 层=根层（对既有层尾键 after）；父在复制集内的子层=全新层（顺序键 1,2,…）。
 * 缺省（未传）=副本无 order 键（order 删——normalizeCopiedNodeData）；分配责任归调用方 allocator。
 */
export type CopyOrderAllocator = (layerParentId: string | null) => string;

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
  allocateOrder?: CopyOrderAllocator,
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
    const inClosure = !!(parent && idMap.has(rec.parentId!));
    // T17（Z14''/G54）：副本 data 经 normalizeCopiedNodeData 单源归一——cells 派生删（格位=子 slot
    // 保留：分镜副本宫格保真）、order 删（allocator 重新分配——副本同层同 order 重复键红线）、
    // loading/error→有 fileId 则 done 无则 idle（副本永久转圈红线）、清 errorCode/error、
    // 删 ImageItem.url（保留 fileId/images[].id——新建不 strip，消灭空图窗口）。
    const data: Record<string, unknown> = normalizeCopiedNodeData(rec.data ?? {});
    if (allocateOrder != null) {
      data.order = allocateOrder(inClosure ? idMap.get(rec.parentId!)! : null);
    }
    const base = {
      ...(rec.width != null ? { width: rec.width } : {}),
      ...(rec.height != null ? { height: rec.height } : {}),
      data,
    };
    if (inClosure) {
      // 闭包内子：parentId=组副本 id、rel 原样；分镜组子 position 归零 {0,0}（纯 DOM 宫格，坐标无意义）
      const storyboardChild = parent!.type === 'group' && (parent!.data as Record<string, unknown> | undefined)?.groupType === 'storyboard';
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
