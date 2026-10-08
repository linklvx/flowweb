import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { ExecutionService } from './execution.service';
import { GenerationIntentService } from './generation-intent.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { ExecutionJobData, ExecutionJobResult } from './execution.types';
import { EXECUTION_QUEUE_NAME } from './execution.constants';

/** maxStalledCount:1——stalled 仅重排一次（防双跑双扣——扣费幂等由意图表 intentGuard 兜底，此处收敛重排次数）；
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
      const { projectId, nodeId, userId, sv, intentId } = job.data;
      const svBytes = sv ? new Uint8Array(Buffer.from(sv, 'base64')) : undefined;
      // jobId 透传 claim——同 job stalled 重排可重入续跑（F13：不传则重进 claim 自锁 NodeBusy）
      const result = await this.executionService.execute(projectId, nodeId, userId, undefined, svBytes, intentId ?? undefined, job.id);
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
   *  Z 终裁（P14）：未 await 钩子抛错=unhandledRejection=进程退出——整函数兜底，绝不外抛。 */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<any> | undefined, err: Error) {
    try {
      if (!job) return;
      const { projectId, nodeId, intentId } = job.data ?? {};
      if (!projectId || !nodeId) return;
      const reason = String(err?.message ?? err);
      await this.collabDoc.writeExecStatus(projectId, nodeId, {
        status: 'error', error: reason.slice(0, 200), intentId: intentId ?? undefined,
      }).catch(() => {}); // best-effort——doc 写失败不挡意图终态
      const running = await this.intentService.findByActiveNode(projectId, nodeId, job.id);
      if (running) await this.intentService.fail(running.id, reason, job.id);
    } catch (e) {
      this.logger.warn(`[onFailed] 兜底失败 job=${job?.id}（意图交由 reconcile 收尾）: ${e}`);
    }
  }
}
