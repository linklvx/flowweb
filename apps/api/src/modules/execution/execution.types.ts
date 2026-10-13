export interface ExecutionJobData {
  projectId: string;
  nodeId?: string;
  userId: string;
  /** Y0b-2 T6（Z91/Z103）：客户端手势 token（regenToken）——enqueue 端点入 job.data，processor 转传
   *  execute 的 claim（改前 intentId 位——T1 起 wire 语义即手势 token，字段名对齐消除歧义）。
   *  Y0b-2 T7：sv 字段删除（SV 判定移受理端点门——job 载荷零客户端状态）。 */
  regenToken?: string | null;
  /** Y0b-5 T13：W3C trace-id（x-request-id 同源）——enqueue 点自 ALS（requestTraceStorage）显式携带，
   *  processor 首行重建。服务端生成值（非客户端状态，不违"job 载荷零客户端状态"断言意图）——
   *  跨 Redis 保真锚：claim（BullMQ worker 无 HTTP ALS）凭此落 GenerationIntent.traceId。 */
  traceId?: string | null;
  /** 意图表行 id——claim 接 enqueue 链路（0.5-8）后由 failed 钩子消费（意图终态必达） */
  intentRowId?: string;
}

export type ExecutionJobResult = any;
