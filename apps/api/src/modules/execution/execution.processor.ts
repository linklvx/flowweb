import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { ExecutionService } from './execution.service';

@Processor('execution')
export class ExecutionProcessor {
  constructor(private readonly executionService: ExecutionService) {}

  @Process()
  async handleExecution(job: Job<{ projectId: string; nodeId?: string; userId: string }>) {
    const { projectId, nodeId, userId } = job.data;
    console.log('[Worker] Processing job', job.id, ':', projectId, nodeId);
    try {
      const result = await this.executionService.execute(projectId, nodeId, userId);
      console.log('[Worker] Job', job.id, 'completed:', JSON.stringify(result).slice(0, 200));
      return result;
    } catch (e: any) {
      console.error('[Worker] Job', job.id, 'failed:', e.message, e.stack);
      throw e;
    }
  }
}
