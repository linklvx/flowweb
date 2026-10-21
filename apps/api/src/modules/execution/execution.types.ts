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
  /** T9 收尾（评审 Important①）：执行代际票——processor 在 claim 成功即回写（job.updateData 同步刷新
   *  本实例快照+落 Redis）。failed 钩子凭票与行代际比对：无票（claim 前 throw 的旧 worker——
   *  readCanvas 503/validate 等）/异节点/异代=迟到钩子跳过 fail（行属 takeover 新代，takeover 不改
   *  jobId 故 findByActiveNode(jobId) 必命中新代行——改前 fail(..., running.execSeq) 自读自写=代际
   *  CAS 虚设误杀新代）。DB execSeq 仍是唯一权威（票只作钩子 fence 比对，非 CAS 第二真源）。 */
  ticket?: ExecutionClaimTicket;
}

/** T9 收尾：worker 内 claim 成功铸造的代际票（execute 的 onClaimed 回调贯穿 processor——execSeq wire
 *  =string 同 ExecutionTicket 纪律；与 edit/lighting 的 controller 预制票 ExecutionTicket 形态分立：
 *  claim 时点不同〔controller enqueue 前 vs worker process 中〕，nodeId 位是组执行上游 claim 过滤键）。 */
export interface ExecutionClaimTicket {
  nodeId: string;
  intentRowId: string;
  /** BigInt wire=string（代际比较=BigInt 解析后值等比较——census ④ 禁 </> 裸比较） */
  execSeq: string;
}

/** Y1a T9（spec ①/㉒）：执行代际票——edit/lighting（claim 在 controller 的 enqueue 管道）随 job.data
 *  下传 worker（execution 队列的钩子 fence 票见 ExecutionClaimTicket——两票形态分立）。
 *  execSeq=BigInt wire 一律 string（JSON 边界——manifest EXEC_STATUS_KEYS 同纪律，
 *  禁 BigInt 入 Redis 载荷）；消费点 BigInt(execSeq) 解析一次贯穿。 */
export interface ExecutionTicket {
  intentRowId: string;
  /** BigInt wire=string（代际比较=解析后 BigInt 值等比较——census ④ 禁 </> 裸比较） */
  execSeq: string;
  /** 预生成 jobId（controller 铸 UUID 随 add({jobId}) 入队——票完整先于入队，attachJob 同值回写） */
  jobId: string;
  /** T10：claim 事务内 claimCapture 捕获的槽位 rev（NodeArtifact CAS 锚——processor/consumer
   *  finalize（artifactCommit）消费；claim→finalize 窗口内用户 replace/新代 ⇒ CAS 0 行=superseded）。 */
  expectedRev: number;
}

export type ExecutionJobResult = any;
