import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { ExecutionService } from './execution.service';
import { GenerationIntentService } from './generation-intent.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { ExecutionJobData, ExecutionJobResult } from './execution.types';
import { EXECUTION_QUEUE_NAME } from './execution.constants';

/** Y0b-2 T1（Z110 终裁）：maxStalledCount 保持 1——安全链=stall→BullMQ 同 jobId 重排→claim② 可重入→
 *  reserve 门 alreadyReserved→mayCall:false（Z35 结构门）→静默退出零外呼——重复 submit 结构性不可能；
 *  =1 的代价=真死 worker 悬挂由 deadline reaper 收敛（T2）；
 *  改 0 的代价=lock 过期≠进程死：活 worker 被置 FAILED⇒complete CAS=0⇒平台已付费产物丢弃。
 *  lockDuration:60s——长外呼（视频生成）锁续期窗口，过短会误判 stalled。 */
@Processor(EXECUTION_QUEUE_NAME, { maxStalledCount: 1, lockDuration: 60_000 })
export class ExecutionProcessor extends WorkerHost {
  private readonly logger = new Logger(ExecutionProcessor.name);

  constructor(
    @Inject(ExecutionService) private readonly executionService: ExecutionService,
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
    @Inject(GenerationIntentService) private readonly intentService: GenerationIntentService,
  ) {
    super();
  }

  async process(job: Job<ExecutionJobData, ExecutionJobResult>): Promise<ExecutionJobResult> {
    this.logger.log(`开始处理任务 ${job.id}`);
    await job.updateProgress(10);

    try {
      const { projectId, nodeId, userId, regenToken } = job.data;
      // jobId 透传 claim——同 job stalled 重排可重入续跑（F13：不传则重进 claim 自锁 NodeBusy）
      // Y0b-2 T6（Z91）：regenToken 透传（enqueue 管道与 execute 直达同 claim 语义）
      // Y0b-2 T7：SV 字节载荷退役（SV 判定在受理端点门——job 载荷零客户端状态）
      const result = await this.executionService.execute(projectId, nodeId, userId, undefined, regenToken ?? undefined, job.id);
      await job.updateProgress(100);
      this.logger.log(`任务 ${job.id} 完成`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`任务 ${job.id} 失败: ${message}`, stack);
      throw error;
    }
  }

  /** F13 终态兜底：SIGKILL 场景 process 的 catch 不执行——意图终态只能靠 worker 钩子。
   *  形态按 bullmq Worker 'failed' 实际签名（job, error, prev）位置参数——@nestjs/bullmq explorer
   *  直绑 worker.on（banner-cleanup.processor.ts 先例）；job 可为 undefined（移除中）。
   *  Y0b-1（§1.3/N4）：intentRowId 从不入队（死代码）——改凭 partial unique
   *  generation_intent_active_node_unique 反查在飞行：付费意图悬空从 15min 压到 worker failed 即时。
   *  Z27：jobId 限定——迟到的失败钩子只 fail 本 job 自己的在飞意图（同节点新活意图归属不同 job）。
   *  Y0b-2 T5（Z111）：换序——先 findByActiveNode 后写投影（原"先写后查"拿不到 attempts，
   *  守卫 fail-closed 会拦无代次投影）；投影携 running?.attempts ?? 0（0 代不得覆盖任何 ≥1 代）。
   *  Z 终裁（P14）：未 await 钩子抛错=unhandledRejection=进程退出——整函数兜底，绝不外抛。 */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<any> | undefined, err: Error) {
    try {
      if (!job) return;
      const { projectId, nodeId } = job.data ?? {};
      if (!projectId || !nodeId) return;
      const reason = String(err?.message ?? err);
      const running = await this.intentService.findByActiveNode(projectId, nodeId, job.id);
      await this.collabDoc.writeExecStatus(projectId, nodeId, {
        status: 'error', error: reason.slice(0, 200), attempts: running?.attempts ?? 0,
        errorCode: 'WORKER_FAILED',
        // Y0b-2 T6：投影 intentId=行身份（running 行的 intentId 非客户端手势 token——旧 job.data.intentId 位语义错位随改名修正）
        ...(running?.intentId ? { intentId: running.intentId } : {}),
      }).catch(() => {}); // best-effort——doc 写失败不挡意图终态
      if (running) await this.intentService.fail(running.id, reason, job.id);
    } catch (e) {
      this.logger.warn(`[onFailed] 兜底失败 job=${job?.id}（意图交由 reconcile 收尾）: ${e}`);
    }
  }
}
