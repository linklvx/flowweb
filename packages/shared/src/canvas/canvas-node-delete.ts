// packages/shared/src/canvas/canvas-node-delete.ts
// Y4a T1（plan 2026-11-20-y4a-timeline-domain Task 1——spec §0 条 3/4）：shared 删除原语单源
// （真实 Y.Doc 形参——两原语先进 T1，T4 清空时间轴/T5 切块与三路消费只接线不重定义）。
//
// 两个原语各自只开一层 doc.transact(mutate, origin)；文档已在事务里时直接抛
// `nested-transact-forbidden` 禁止静默并帧（Yjs 嵌套 transact 并进外层、内层 origin 被丢——
// 原语在 withDoc/writeBatch 里被调用、切多少块都还是一帧——「先测一笔、不过再改切块」的退路
// 走不通）。幂等/缺 id 跳过/非 Map 边跳过：缺 id 的 delete 是零帧事务（不发 update、不入撤销栈）。
import * as Y from 'yjs';

/** 嵌套事务即抛（spec §0 条 4 消息字面量——与 canApplyIntent 拒因族共用拼写）。 */
function assertOutermostTransact(doc: Y.Doc): void {
  if (doc._transaction !== null) throw new Error('nested-transact-forbidden');
}

/**
 * 节点删除原语：恰好一次事务删节点+source/target 指向它的边+timelines 同名键。
 * 幂等（缺 id 跳过——全缺=零帧）；非 Y.Map 边跳过（对抗面毒值边不炸、原样保留）。
 * 调用即最外层事务：客户端分割删除传 'local-user'、服务端三路每块单独一层
 * SERVER_TRANSACT_ORIGIN（spec §0 条 4——writeBatch/恢复导入逐块提交逐块过闸）。
 */
export function deleteNodesWithTimelines(doc: Y.Doc, nodeIds: readonly string[], origin: unknown): void {
  assertOutermostTransact(doc);
  doc.transact(() => {
    const nodesRoot = doc.getMap('nodes');
    const edgesRoot = doc.getMap('edges');
    const timelinesRoot = doc.getMap('timelines');   // 同名根=同一对象；fresh doc 上物化空根无害
    const idSet = new Set(nodeIds);
    for (const id of nodeIds) nodesRoot.delete(id);   // Y.Map.delete 缺键=无操作
    for (const [edgeId, edge] of edgesRoot.entries()) {
      if (!(edge instanceof Y.Map)) continue;   // 非 Y.Map 边跳过（scalar/纯对象对抗面——get/has 鸭测不成立）
      const src = edge.get('source');
      const dst = edge.get('target');
      if (idSet.has(src as string) || idSet.has(dst as string)) edgesRoot.delete(edgeId);
    }
    for (const id of nodeIds) timelinesRoot.delete(id);   // timelines 同名键（缺键=无操作）
  }, origin);
}

/**
 * 片段键删除原语：恰好一次事务只删给定片段键（T4 清空时间轴/T5 切块同源——预检与真删同一函数）。
 * 缺 node/缺 clip 键跳过（零帧）；clips 非 Y.Map 的毒值时间轴不炸（跳过）。
 */
export function deleteTimelineClips(doc: Y.Doc, nodeId: string, clipIds: readonly string[], origin: unknown): void {
  assertOutermostTransact(doc);
  doc.transact(() => {
    const timelinesRoot = doc.getMap('timelines');
    const entry = timelinesRoot.get(nodeId);
    if (!(entry instanceof Y.Map)) return;   // 缺节点键/毒值——跳过
    const clips = entry.get('clips');
    if (!(clips instanceof Y.Map)) return;   // clips 非 Y.Map——跳过（帧谓词族外的对抗面）
    for (const clipId of clipIds) clips.delete(clipId);   // 缺键=无操作（幂等）
  }, origin);
}
