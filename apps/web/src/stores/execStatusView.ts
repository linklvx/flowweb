// apps/web/src/stores/execStatusView.ts
// 批1-6（B2 合并视图）：执行状态合并视图纯模块——零 store 运行时依赖（仅类型），
// 可选链读 exec 两源——nodeStore 被 vi.mock 整替的组件测试（state 无 exec 键）天然回落 data.status。
/** 节点执行状态（与 ImageNodeData/VideoNodeData/AudioNodeData 的 status 同域） */
export type NodeExecStatus = 'idle' | 'loading' | 'done' | 'error';

/** doc exec map 条目 / intents 对齐条目（服务端唯一写者 shape：{status,jobId,intentId,error,fileId?}） */
export interface ExecStatusEntry {
  status: Exclude<NodeExecStatus, 'idle'>;
  jobId?: string;
  intentId?: string;
  error?: string;
  fileId?: string;
}

/** 合并视图读入 slice（nodeStore state 的结构子集——mock state 缺 exec 键可传；
 *  nodes 值收宽 unknown：NodeData 联合含 TextNodeData（无 status 键），弱类型结构
 *  检查不兼容——读点内收窄） */
export interface ExecViewSlice {
  execStatus?: Map<string, ExecStatusEntry>;  // doc exec 投影（runtime 唯一写者）
  execAligned?: Map<string, ExecStatusEntry>; // intents 恢复对齐终态（runtime 唯一写者）
  nodes?: Record<string, unknown>;
}

/** exec 两源覆盖值（无条目=undefined——data 回落交调用方自己的 data 源；
 *  canvasStore 节点为数据源的读点用本函数，避免回落误读 nodeStore 的 nodes） */
export function execOverrideStatus(s: ExecViewSlice, nodeId: string): NodeExecStatus | undefined {
  return s.execStatus?.get(nodeId)?.status
    ?? s.execAligned?.get(nodeId)?.status;
}

/** B2 合并视图：exec 投影 → intents 对齐 → node.data.status。
 *  读侧终态优先不回退（服务端写前幂等读同语义）：exec 投影 loading 压过对齐 done
 *  （服务端重跑接管）；条目删除（GC）随投影重建自然回落 data.status。 */
export function selectExecStatus(s: ExecViewSlice, nodeId: string): NodeExecStatus {
  const data = s.nodes?.[nodeId] as { data?: { status?: NodeExecStatus } } | undefined;
  return execOverrideStatus(s, nodeId)
    ?? data?.data?.status
    ?? 'idle';
}
