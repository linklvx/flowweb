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

/** Y1a T9（spec ①/㉒）：执行代际票——edit/lighting（claim 在 controller 的 enqueue 管道）随 job.data
 *  下传 worker；execution 队列不带（claim 在 worker 内——execSeq 由 claim 返回值进程内贯穿，DB 为
 *  唯一权威禁第二真源）。execSeq=BigInt wire 一律 string（JSON 边界——manifest EXEC_STATUS_KEYS 同纪律，
 *  禁 BigInt 入 Redis 载荷）；消费点 BigInt(execSeq) 解析一次贯穿。 */
export interface ExecutionTicket {
  intentRowId: string;
  /** BigInt wire=string（代际比较=解析后 BigInt 值等比较——census ④ 禁 </> 裸比较） */
  execSeq: string;
  /** 预生成 jobId（controller 铸 UUID 随 add({jobId}) 入队——票完整先于入队，attachJob 同值回写） */
  jobId: string;
}

export type ExecutionJobResult = any;
