// apps/web/src/stores/execStatusView.ts
// 批1-6（B2 合并视图）：执行状态合并视图纯模块——零 store 运行时依赖（仅类型），
// 可选链读 exec 单源——nodeStore 被 vi.mock 整替的组件测试（state 无 exec 键）天然回落 data.status。
/** 节点执行状态（与 ImageNodeData/VideoNodeData/AudioNodeData 的 status 同域）。
 *  Y0b-2 T5（Z99/Z88）：域补 'skipped'——NodeBusy/重复外呼的降级投影（非终态：在飞 worker 的 done 照常覆盖）。 */
export type NodeExecStatus = 'idle' | 'loading' | 'done' | 'error' | 'skipped';

/** exec 投影条目（runtimeStore 投影器唯一写者 shape：{status,jobId,intentId,error,fileId?}）。
 *  Y0b-2 T5（Z95/Z99/Z111）：补 errorCode/rearmable/attempts（error 投影三件——重试/轮换判据单源）
 *  +reason（skipped 投影的分诊说明）。
 *  Y1c T32：intents 恢复对齐终态源随 doc.exec 删除清单退役——断连/刷新恢复对齐由 Runtime Store
 *  投影承载（IDB 持久化+feed 重连追平——spec §7 UI 契约），exec 单源=execStatus。 */
export interface ExecStatusEntry {
  status: Exclude<NodeExecStatus, 'idle'>;
  jobId?: string;
  intentId?: string;
  error?: string;
  fileId?: string;
  errorCode?: string;
  rearmable?: boolean;
  attempts?: number;
  reason?: string;
}

/** 合并视图读入 slice（nodeStore state 的结构子集——mock state 缺 exec 键可传；
 *  nodes 值收宽 unknown：NodeData 联合含 TextNodeData（无 status 键），弱类型结构
 *  检查不兼容——读点内收窄） */
export interface ExecViewSlice {
  execStatus?: Map<string, ExecStatusEntry>;  // runtime 投影（runtimeStore 唯一写者）
  nodes?: Record<string, unknown>;
}

/** exec 覆盖值（无条目=undefined——data 回落交调用方自己的 data 源；
 *  canvasStore 节点为数据源的读点用本函数，避免回落误读 nodeStore 的 nodes） */
export function execOverrideStatus(s: ExecViewSlice, nodeId: string): NodeExecStatus | undefined {
  return s.execStatus?.get(nodeId)?.status;
}

/** Y0b-2 T6（Z79）：整条投影 entry（rearmable/attempts——面板 token 轮换与按钮三态的判据单源）。 */
export function selectExecEntry(s: ExecViewSlice, nodeId: string): ExecStatusEntry | undefined {
  return s.execStatus?.get(nodeId);
}

/** B2 合并视图：exec 投影 → node.data.status。
 *  读侧终态优先不回退（服务端写前幂等读同语义）：exec 投影 loading 压过 data.status done
 *  （服务端重跑接管）；条目删除（GC）随投影重建自然回落 data.status。 */
export function selectExecStatus(s: ExecViewSlice, nodeId: string): NodeExecStatus {
  const data = s.nodes?.[nodeId] as { data?: { status?: NodeExecStatus } } | undefined;
  return execOverrideStatus(s, nodeId)
    ?? data?.data?.status
    ?? 'idle';
}
