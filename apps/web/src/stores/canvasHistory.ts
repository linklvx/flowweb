// apps/web/src/stores/canvasHistory.ts
// 画布结构字段提取纯函数（collab 桥 diff 共用；spec: canvas-undo-redo.md v5）
// ⚠️ 本模块严禁 import 任何 store（含 nodeStore——nodeStore 顶层 import canvasStore，
//    会构成 canvasHistory → nodeStore → canvasStore → canvasHistory 环，
//    在本模块先于 canvasStore 求值时 TDZ 崩溃）。store 访问一律依赖注入。
import type { Node, Edge } from '@xyflow/react';

/** equality/白名单共用提取：只保留触发历史的结构字段 */
export function pickStructNodes(nodes: Node[]) {
  return nodes.map((nd) => ({
    id: nd.id,
    type: nd.type,
    position: nd.position,
    parentId: nd.parentId,
    width: nd.width,
    height: nd.height,
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
