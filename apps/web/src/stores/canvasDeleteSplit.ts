// apps/web/src/stores/canvasDeleteSplit.ts
// Y4a T5（plan 2026-11-20-y4a-timeline-domain Task 5——spec §0 条 3）：删除分割函数——三入口
// （deleteNode/onNodesChange remove/deleteTransformNode）同一函数。**executeDeleteSplit 从计划
// 到最后一笔之间不 await**（切块序一旦让出事件循环、并发编辑会插进块间）；**不调 deleteNode
// （防递归重入）、客户端唯一一次删除写入直接调 deleteNodesWithTimelines、不再派 deleteNode
// intent**（spec §0 条 3——删除写入路径只有原语一次调用，dispatch spy 钉死）。
//
// 编排（spec §0 条 3 全序）：
//  - splitDeletePlan 纯函数：收齐=选中+被删组全部后代（递归——单层 parentId 循环收不全深层
//    嵌套组，v6 组级联形态提取）+分两类（timelineNodes=doc 侧 timelines.<id> 仍带非空片段的
//    剪辑节点 / others=其余）+祖先组索引（每个 timelineNode 在删除集里的全部祖先组——嵌套组
//    逐级上溯）；
//  - executeDeleteSplit：①栈容量预检 undoStack.length+块数+1>UNDO_STACK_LIMIT(100)→整次删除
//    不写（不清栈）→逐 timelineNode：清该节点自己的时间轴栈（clearTimelineStackOf——spec §0
//    条 6 卸栈）→切块删片段（T4 同一条规则同源复用 chunkClipDeletes：captureTimeout:0 逐片段
//    量两帧、每块逆操作≤262144、贪心装箱+候选箱合成帧复测、块间 stopCapturing；**origin
//    local-user 进画布栈不进时间轴栈**；单片段仍超→该节点入 aborted、文档不动）→每笔事务后
//    applyUnifiedDocSnapshot 尾投（onRemote 本地 origin 早退=本地事务不投影回 store——删除后
//    必须主动尾投）→最后一笔 local-user 删小节点+连边+已变小的 timelines.<nodeId>（组骨架
//    仍在最后一笔、排在片段块之后；前后 stopCapturing；保护集=aborted 节点+它在删除集里的
//    全部祖先组——都不进最后一笔）→进程取消按 doc 前后节点 id 差（不按 id 清单平行删 store）；
//  - 无剪辑节点时 others 合成现状一笔、不额外 stopCapturing（500ms 合并窗保持）。
// 测试观测面：deleteSplitCallLog/resetDeleteSplitCallLog（spec ⑧「唯一删除写入路径」断言用）。
import * as Y from 'yjs';
import {
  deleteNodesWithTimelines, deleteTimelineClips, UNDO_STACK_LIMIT,
  measureTransactionFrames,
} from '@flowweb/shared';
import { getUndoManager, stopCapturing, setPendingRestoreBytes, Origin } from './canvasUndo';
import { clearTimelineStackOf, planClipDeletes } from './timelineUndo';
import { applyUnifiedDocSnapshot } from './canvasCollabRuntime';
import { useCanvasStore } from './canvasStore';

/** 分割计划（纯函数产物——不碰 doc）。ancestors=每个 timelineNode 在删除集里的全部祖先组
 *  （嵌套组逐级上溯——aborted 保护集的取数面）。 */
export interface DeleteSplitPlan {
  /** doc 侧仍带非空片段的剪辑节点（先切块清片段再删小节点）。 */
  timelineNodes: string[];
  /** 其余被删节点（含组骨架——合成现状一笔）。 */
  others: string[];
  /** 删除集全量（选中+组全部后代——store 清理/nodeStore 三件套按此收齐）。 */
  allIds: string[];
  /** timelineNode → 其在删除集里的全部祖先组 id 列表（保护集材料）。 */
  ancestors: Map<string, string[]>;
}

/** 执行结果（调用方善后/断言面）。 */
export interface DeleteSplitResult {
  /** 切块拒（单片段逆操作仍超 262144）的节点——文档未动、不进最后一笔。 */
  aborted: string[];
  /** 栈容量预检拒（undoStack+块数+1>100）——整次删除未写、栈未清。 */
  precheckRejected: boolean;
  /** 实际删成集（收齐集−保护集——store/nodeStore 清理面）。 */
  deletedIds: string[];
}

/** 观测面（spec ⑧ dispatch spy 断言——「删除写入路径只有 deleteNodesWithTimelines」）。 */
let callLog: { primitiveCalls: string[][] } = { primitiveCalls: [] };
export function resetDeleteSplitCallLog(): void { callLog = { primitiveCalls: [] }; }
export function deleteSplitCallLog(): { readonly primitiveCalls: readonly (readonly string[])[] } { return callLog; }

/** doc 侧时间轴判空（classifyPlanByDoc 内部消费——clips 空 Map 或非 Map=无片段可切）。 */
function timelineClipsEmpty(doc: Y.Doc, nodeId: string): boolean {
  const entry = doc.getMap('timelines').get(nodeId);
  if (!(entry instanceof Y.Map)) return true;
  const clips = entry.get('clips');
  if (!(clips instanceof Y.Map)) return true;
  return clips.size === 0;
}

/** splitDeletePlan：收齐=选中+被删组全部后代（递归）；分两类；祖先组索引（纯函数不碰 doc）。
 *  分类判据=doc 侧 timelines.<id> 是否仍带非空片段——纯函数层只做祖先/收齐（doc 判型在
 *  executeDeleteSplit 入口前由调用方补：timelineNodes=doc 判非空片段者）。 */
export function splitDeletePlan(
  state: { nodes: Array<{ id: string; parentId?: string | null; type?: string }> },
  removedIds: string[],
): DeleteSplitPlan {
  const byId = new Map(state.nodes.map((n) => [n.id, n]));
  const removed = new Set(removedIds);
  // 组后代递归收齐（v6 deleteNode :1152-1156 递归形态提取——单层 parentId 循环收不全深层嵌套组）
  const all = new Set(removedIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of state.nodes) {
      if (n.parentId != null && all.has(n.parentId) && !all.has(n.id)) {
        all.add(n.id);
        grew = true;
      }
    }
  }
  // 祖先组索引：每个节点在删除集里的全部祖先（parentId 链上溯——嵌套组逐级）
  const ancestors = new Map<string, string[]>();
  for (const id of all) {
    const chain: string[] = [];
    let cur = byId.get(id)?.parentId ?? null;
    while (cur != null && all.has(cur)) {
      chain.push(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
    ancestors.set(id, chain);
  }
  return { timelineNodes: [], others: [...all], allIds: [...all], ancestors };
}

/** doc 侧分类补齐（splitDeletePlan 之后、executeDeleteSplit 之前——timelineNodes=timelines
 *  键仍带非空片段的收齐集成员；others=其余含组骨架）。纯读不写。 */
export function classifyPlanByDoc(doc: Y.Doc, plan: DeleteSplitPlan): DeleteSplitPlan {
  const timelineNodes: string[] = [];
  const others: string[] = [];
  for (const id of plan.allIds) {
    if (timelineClipsEmpty(doc, id)) others.push(id);
    else timelineNodes.push(id);
  }
  return { ...plan, timelineNodes, others };
}

/** executeDeleteSplit：按计划编排（**全同步无 await**——spec §0 条 3）。
 *  无剪辑节点档（timelineNodes 空）=others 合成现状一笔、**不额外 stopCapturing**（500ms 合并
 *  窗保持）；有剪辑节点档=每节点片段块（块间 stopCapturing）+最后一笔信封（前后 stopCapturing
 *  ——片段块与信封各自成步）。 */
export function executeDeleteSplit(doc: Y.Doc, plan: DeleteSplitPlan): DeleteSplitResult {
  const um = getUndoManager();
  const beforeIds = new Set<string>(doc.getMap('nodes').keys());   // 进程取消按 doc 前后节点 id 差
  const hasClipNodes = plan.timelineNodes.length > 0;
  // ② 计划先行（全部块在 temp doc 上量——零突变）：切块计划+栈容量预检共用同一块数
  //    （栈预检需真块数——节点数会低估：一节点可切多箱）。计划 null=单片段仍超→该节点入
  //    aborted、零块跳过（文档不动）；继续量其余节点（计划零突变——aborted 判定不写 doc）。
  const clipPlans: Array<{ nodeId: string; boxes: Array<{ ids: string[]; undoBytes: number }> }> = [];
  const abortedSet = new Set<string>();
  for (const nodeId of plan.timelineNodes) {
    const entry = doc.getMap('timelines').get(nodeId);
    const clips = entry instanceof Y.Map ? entry.get('clips') : undefined;
    const clipIds = clips instanceof Y.Map ? [...clips.keys()] : [];
    if (clipIds.length === 0) continue;
    const boxes = planClipDeletes(doc, nodeId, clipIds, Origin.LocalUser);
    if (boxes === null) {
      abortedSet.add(nodeId);   // 单片段仍超→该节点一笔都不写、文档不动
      clipPlans.push({ nodeId, boxes: [] });
      continue;
    }
    clipPlans.push({ nodeId, boxes });
  }
  // ① 栈容量预检（spec §0 条 3）：undoStack.length+块数+1>UNDO_STACK_LIMIT →整次删除不写
  //    （不清栈）——块数=计划真块数（aborted 节点零块不计）。
  const blockCount = clipPlans.reduce((n, p) => n + p.boxes.length, 0);
  if (um != null && um.undoStack.length + blockCount + 1 > UNDO_STACK_LIMIT) {
    return { aborted: [], precheckRejected: true, deletedIds: [] };
  }
  const aborted: string[] = [...abortedSet];
  if (hasClipNodes) stopCapturing();   // 首块前切窗（种子笔与第一块不并窗）
  // ③ 逐 timelineNode：清栈→按已过闸计划逐块写（origin local-user 进画布栈不进时间轴栈）
  for (const { nodeId, boxes } of clipPlans) {
    if (boxes.length === 0) continue;   // aborted 节点——零块跳过（文档不动）
    clearTimelineStackOf(nodeId);   // spec §0 条 6：删除该节点第一块之前卸下其时间轴 UndoManager
    for (const box of boxes) {
      stopCapturing();   // 写前切
      setPendingRestoreBytes(Origin.LocalUser, box.undoBytes);
      deleteTimelineClips(doc, nodeId, box.ids, Origin.LocalUser);
      stopCapturing();   // 写后切——下一块不并入
      applyUnifiedDocSnapshot(doc);   // 每笔切块事务后尾投（本地事务不投影回 store——主动尾投）
    }
  }
  // ③ 保护集=aborted 节点+它们在删除集里的全部祖先组（嵌套组逐级）
  const protectedIds = new Set<string>(aborted);
  for (const id of aborted) {
    for (const anc of plan.ancestors.get(id) ?? []) protectedIds.add(anc);
  }
  // ④ 最后一笔：删小节点+连边+已变小的 timelines.<nodeId>（组骨架仍在最后这笔——LIFO 撤销
  //    第一步组骨架整棵回来、子回来时 parentId 指向的组已在）
  const finalIds = plan.allIds.filter((id) => !protectedIds.has(id));
  if (finalIds.length > 0) {
    const m = measureTransactionFrames(doc, (temp) => {
      deleteNodesWithTimelines(temp, finalIds, Origin.LocalUser);
    });
    setPendingRestoreBytes(Origin.LocalUser, m.undoBytes);
    deleteNodesWithTimelines(doc, finalIds, Origin.LocalUser);
    callLog.primitiveCalls.push(finalIds);
    applyUnifiedDocSnapshot(doc);
  }
  if (hasClipNodes) stopCapturing();   // 信封后切窗（下一笔不并入——组善后独立成步前提）
  // ⑤ 进程取消：doc 前后节点 id 差（不按 id 清单平行删 store——store 由尾投快照写回）
  const afterIds = new Set<string>(doc.getMap('nodes').keys());
  const s = useCanvasStore.getState();
  for (const id of beforeIds) {
    if (!afterIds.has(id) && s.nodeProcessMap[id]) s.cancelNodeProcess(id);
  }
  return { aborted, precheckRejected: false, deletedIds: finalIds };
}
