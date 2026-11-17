// apps/web/src/utils/projectCanvas.ts
// Y2 第①步（A2a）：主画布唯一渲染出口——D1 装配序五步（spec 2026-11-17-y2-projection-convergence D1）：
//   ①墓碑前置剔除（isActiveTombstone 谓词复用不重写——死节点不进内核才不会撑大 auto 组帧/留 cellNodes）
//   ②gesture 折进记录副本再进内核（叶子/顶层 position/wh 折入；resize 中组=会话矩形作 liveFrame
//     经 deriveRenderCanvas 传 deriveGroupFrame 值面——manual/storyboard 消费、auto 恒派生）
//   ③deriveRenderCanvas 产出几何/rel/hidden 剔除/边过滤/cellNodes（共享内核单源——禁第二套帧算法）
//   ④执行覆盖：主槽解析雏形（过渡期 data.fileId 非空用它，否则运行时产物——B3 写者换键同步切
//     data.mediaId+resolvePrimaryMediaId）；execStatus 只来自投影（无投影=无键，unknown≠idle）；
//     localPreview 只在主槽解析为空时盖面（粘贴本地预览）；格子覆盖按格子 id 回剔除前作者记录
//     取值写进 cellNodes（只遍历 React Flow 输出节点的格子是空的——分镜子被 hidden 剔除仍在）
//   ⑤mediaFacts 只供尺寸等事实（mediaNatural），不改作者坐标、不写 doc
// 等价域（spec D1）：runtime/gesture/mediaFacts/localPreview 皆空时，几何/parent/hidden 剔除/边集
// 与 deriveRenderCanvas 逐位相等（执行覆盖叠 data 键不在比较面）。
// 渲染输出是两份数据的渲染侧（D2）：只渲染、不进 diff、不回灌 doc——projectCanvasNodes
//（apps/web/src/utils/ 同名异构——EPHEMERAL 剥键适配）与本函数不是同一个。
import {
  deriveRenderCanvas,
  isActiveTombstone,
  type RenderNode,
  type RenderEdge,
  type RenderSourceEdge,
  type RenderSourceNode,
  type RuntimeProjection,
} from '@flowweb/shared';
import type { MediaFactEntry } from '../stores/mediaFacts';

/** 手势覆盖层（会话活值——不进 doc；A2b 接线从 DragSession 构造）。 */
export interface GestureOverlay {
  position?: { x: number; y: number };
  width?: number;
  height?: number;
}

/** 渲染节点/格子叠加键（派生面——不回写 doc/ns 作者缓存）：
 *  mediaId=解析主槽（过渡期=data.fileId 非空用它，否则 runtime 产物）；execStatus=投影态；
 *  previewUrl=localPreview 空槽盖面；mediaNatural=尺寸事实。 */
export interface ProjectedMediaOverlay {
  mediaId?: string;
  execStatus?: string;
  previewUrl?: string;
  mediaNatural?: { width: number; height: number; rotation: number | null };
}

export function projectCanvas(input: {
  readModel: { records: readonly RenderSourceNode[]; edges?: readonly RenderSourceEdge[] };
  runtime: RuntimeProjection | null;
  mediaFacts: ReadonlyMap<string, MediaFactEntry>;
  gesture: ReadonlyMap<string, GestureOverlay>;
  localPreview: ReadonlyMap<string, string>;
}): { nodes: RenderNode[]; edges: RenderEdge[] } {
  const { runtime, mediaFacts, gesture, localPreview } = input;

  // ① 墓碑前置剔除（从记录副本先去——对着墓碑节点的手势项不折入）
  const alive = runtime === null
    ? input.readModel.records
    : input.readModel.records.filter((r) => {
        const entry = runtime.nodes[r.id];
        return entry === undefined || !isActiveTombstone(entry);
      });

  // ② gesture 折入记录副本+组会话矩形作 liveFrame
  const liveFrames = new Map<string, { position?: { x: number; y: number }; width?: number; height?: number }>();
  const folded: RenderSourceNode[] = gesture.size === 0
    ? alive.slice()
    : alive.map((r) => {
        const g = gesture.get(r.id);
        if (g === undefined) return r;
        if (r.type === 'group' && (g.position !== undefined || g.width !== undefined || g.height !== undefined)) {
          liveFrames.set(r.id, { position: g.position, width: g.width, height: g.height });
        }
        return {
          ...r,
          ...(g.position !== undefined ? { position: g.position } : {}),
          ...(g.width !== undefined ? { width: g.width } : {}),
          ...(g.height !== undefined ? { height: g.height } : {}),
        };
      });

  // ③ 共享内核产出
  const base = deriveRenderCanvas({ records: folded, edges: input.readModel.edges, liveFrames });

  // ④ 执行覆盖——格子数据源=剔除前作者记录（分镜子被 hidden 剔除后按格子 id 仍可取值）
  const authorById = new Map(input.readModel.records.map((r) => [r.id, r]));
  const overlayOf = (id: string): ProjectedMediaOverlay => {
    const authorKey = authorById.get(id)?.data?.fileId;   // 过渡期作者键（B3 切 data.mediaId）
    const display = typeof authorKey === 'string' && authorKey !== ''
      ? authorKey
      : (() => {
          const art = runtime?.nodes[id]?.artifact?.mediaId;
          return typeof art === 'string' && art !== '' ? art : undefined;
        })();
    const execStatus = runtime?.nodes[id]?.execStatus?.status;
    const previewUrl = display === undefined ? localPreview.get(id) : undefined;
    const fact = display !== undefined ? mediaFacts.get(display) : undefined;
    return {
      ...(display !== undefined ? { mediaId: display } : {}),
      ...(typeof execStatus === 'string' && execStatus !== '' ? { execStatus } : {}),
      ...(previewUrl !== undefined ? { previewUrl } : {}),
      ...(fact?.natural !== undefined ? { mediaNatural: fact.natural } : {}),
    };
  };

  const nodes: RenderNode[] = base.nodes.map((n) => {
    const overlay = overlayOf(n.id);
    const cells = n.data.cellNodes;
    if (cells !== undefined && Array.isArray(cells)) {
      const newCells = (cells as Array<{ id: string }>).map((c) => ({ ...c, ...overlayOf(c.id) }));
      return { ...n, data: { ...n.data, cellNodes: newCells, ...overlay } };
    }
    const hasKeys = Object.keys(overlay).length > 0;
    return hasKeys ? { ...n, data: { ...n.data, ...overlay } } : n;
  });

  return { nodes, edges: base.edges };
}
