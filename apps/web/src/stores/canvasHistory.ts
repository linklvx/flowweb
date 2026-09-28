// apps/web/src/stores/canvasHistory.ts
// 画布结构字段提取纯函数（collab 桥 diff 共用；spec: canvas-undo-redo.md v5）
// ⚠️ 本模块严禁 import 任何 store（含 nodeStore——nodeStore 顶层 import canvasStore，
//    会构成 canvasHistory → nodeStore → canvasStore → canvasHistory 环，
//    在本模块先于 canvasStore 求值时 TDZ 崩溃）。store 访问一律依赖注入。
import type { Node, Edge } from '@xyflow/react';

/** equality/白名单共用提取：只保留触发历史的结构字段。
 *  F42（R1b）：组节点 data 纳入——cs 侧组 data 变更（storyboard 配置/cells/名字）必须触发协作桥，
 *  否则纯 data 变更（showIndex）不落盘且会被下一次 applyDocToStore 用 doc 旧值整表覆写。
 *  普通节点 data 不入（nodeStore 订阅已覆盖）。
 *  比较税：组 data 深比较每次 cs 变更都跑——组数量小可接受，换来触发面正确（勿删）。 */
export function pickStructNodes(nodes: Node[]) {
  return nodes.map((nd) => ({
    id: nd.id,
    type: nd.type,
    position: nd.position,
    parentId: nd.parentId,
    width: nd.width,
    height: nd.height,
    data: nd.type === 'group' ? (nd.data as any) : undefined,
  }));
}

export function pickStructEdges(edges: Edge[]) {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: e.type,
  }));
}
