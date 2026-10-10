export interface ExecutionJobData {
  projectId: string;
  nodeId?: string;
  userId: string;
  /** base64 编码的提交端 state vector（readCanvas SV 等待用，spec 3.1） */
  sv?: string | null;
  /** Y0b-2 T6（Z91/Z103）：客户端手势 token（regenToken）——enqueue 端点入 job.data，processor 转传
   *  execute 的 claim（改前 intentId 位——T1 起 wire 语义即手势 token，字段名对齐消除歧义）。 */
  regenToken?: string | null;
  /** 意图表行 id——claim 接 enqueue 链路（0.5-8）后由 failed 钩子消费（意图终态必达） */
  intentRowId?: string;
}

export type ExecutionJobResult = any;
