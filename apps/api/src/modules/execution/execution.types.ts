export interface ExecutionJobData {
  projectId: string;
  nodeId?: string;
  userId: string;
  /** base64 编码的提交端 state vector（readCanvas SV 等待用，spec 3.1） */
  sv?: string | null;
  /** 客户端意图 id（幂等键）——批0.5-6 enqueue 透传，processor 转传 execute 的 claim */
  intentId?: string | null;
  /** 意图表行 id——claim 接 enqueue 链路（0.5-8）后由 failed 钩子消费（意图终态必达） */
  intentRowId?: string;
}

export type ExecutionJobResult = any;
