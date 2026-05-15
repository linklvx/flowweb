import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { ExecutionService } from './execution.service';
import { ExecutionJobData, ExecutionJobResult } from './execution.types';
import { EXECUTION_QUEUE_NAME } from './execution.constants';

@Processor(EXECUTION_QUEUE_NAME)
export class ExecutionProcessor extends WorkerHost {
  private readonly logger = new Logger(ExecutionProcessor.name);

  constructor(
    @Inject(ExecutionService) private readonly executionService: ExecutionService,
  ) {
    super();
  }

  async process(job: Job<ExecutionJobData, ExecutionJobResult>): Promise<ExecutionJobResult> {
    this.logger.log(`开始处理任务 ${job.id}`);
    await job.updateProgress(10);

    try {
      const { projectId, nodeId, userId } = job.data;
      const result = await this.executionService.execute(projectId, nodeId, userId);
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
}
