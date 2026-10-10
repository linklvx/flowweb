import { apiFetch } from './client';
import type { AiToolId } from '@/stores/nodeStore';
import { getStateVector, forceSyncAndWaitUnsynced } from '@/stores/canvasCollabRuntime';
import { recordCollabDiag } from '@/utils/collabDiagnostics';

/** Y0b-2 T7：body.stateVector 附加（SV 请求头退役——SV 随 body 上送四受理端点）。
 *  无会话（doc 未建）时省略——服务端 400 SYNC_STATE_VECTOR_REQUIRED fail-closed（canExecute 已保证
 *  发起方必已 synced，此形态结构性不可达）。 */
function svBody(): Record<string, string> {
  const sv = getStateVector();
  return sv ? { stateVector: sv } : {};
}

/** Z56 修订（T7）：反应式重发——先发→409 SYNC_PENDING 才 forceSyncAndWaitUnsynced→重发恰一次；
 *  再拒=服务端停滞信号（观测经诊断 ring），抛出不循环。非 SYNC_PENDING 直接抛零 forceSync。
 *  Y0b-2 T8（Z90）：**只重 SYNC_PENDING 不重 5xx/超时**——504=回执丢失语义（服务端继续跑、产物经 doc
 *  投影照达），**504 不当换 token 重试信号——换 token=新扣费**（regenToken 生命周期归 Z95，重试恒同 token）。
 *  导出消费面=本模块两函数+ImageGenNode 编辑三入口（image-edit 受理端点同门）。 */
export async function withSyncRetry<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e?.errorCode !== 'SYNC_PENDING') throw e;
    await forceSyncAndWaitUnsynced(2_000);
    try { return await fn(); }
    catch (e2: any) { if (e2?.errorCode === 'SYNC_PENDING') syncPendingRetryObserved(); throw e2; }
  }
}

/** 重发后再拒的观测（诊断 ring——服务端停滞信号非客户端故障面） */
function syncPendingRetryObserved(): void {
  recordCollabDiag('sync_pending_retry');
}

/** Y0b-2 T5（Z95/Z88）：组执行错误结构化——nodeId 定位+status 分诊（error=节点失败/skipped=别处在飞）+errorCode。 */
export interface ExecutionErrorEntry {
  nodeId: string;
  status: 'error' | 'skipped';
  error: string;
  errorCode?: string;
}

export async function executeGroupNodes(projectId: string, nodeIds: string[], opts?: { regenToken?: string }): Promise<{ success: boolean; errors: ExecutionErrorEntry[]; results?: { nodeId: string; type: string; resultUrl?: string }[]; totalCost?: number }> {
  // Y0b-2 T7：SV 门受理端点化——body.stateVector+SYNC_PENDING 反应式重发（withSyncRetry 单源）
  return withSyncRetry(() => apiFetch('/execution/execute', {
    method: 'POST',
    // Y0b-2 T6（Z79）：regenToken=手势 token（与 enqueue 管道双管道对齐；组工具条普通执行不传=内容键路径）
    body: JSON.stringify({ projectId, nodeIds, ...svBody(), ...(opts?.regenToken ? { regenToken: opts.regenToken } : {}) }),
  }));
}

export async function enqueueWorkflow(params: {
  projectId: string;
  nodeId?: string;
  aiTool?: AiToolId;
  /** Y0b-2 T6（Z91/Z103）：手势 token（改名自 intentId——wire 语义从 T1 起就是 token，字段名对齐消除歧义）。 */
  regenToken?: string;
}): Promise<{ jobId: string; status: string }> {
  // Y0b-2 T7：SV 门受理端点化——body.stateVector+SYNC_PENDING 反应式重发
  return withSyncRetry(() => apiFetch('/execution/enqueue', {
    method: 'POST',
    body: JSON.stringify({ ...params, ...svBody() }),
  }));
}

export async function fetchBalance(): Promise<{ credits: number }> {
  return apiFetch('/credits/balance');
}

/** 批0.5-6 GET intents 意图行（批1-6 断连恢复消费）——GenerationIntent select 子集（createdAt desc，take 20）。
 *  Y0b-2 T6：attempts 补入（T5 投影代次判据——api listByNode select 已有，对齐消费面补上）。 */
export interface GenerationIntentRow {
  intentId: string;
  kind: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'VOIDED';
  resultRef: string | null;
  error: string | null;
  attempts?: number;
}

/** 节点意图列表（断连恢复读面，成员级——VIEWER 可见；与 jobs/:id 同口径） */
export async function fetchNodeIntents(projectId: string, nodeId: string): Promise<GenerationIntentRow[]> {
  return apiFetch(`/execution/intents?projectId=${encodeURIComponent(projectId)}&nodeId=${encodeURIComponent(nodeId)}`);
}
