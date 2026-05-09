import { Controller, Post, Body, Inject } from '@nestjs/common';
import { ExecutionService } from './execution.service';

@Controller('api/execution')
export class ExecutionController {
  constructor(@Inject(ExecutionService) private readonly service: ExecutionService) {}

  @Post('execute')
  execute(@Body() body: { projectId: string; nodeId?: string; userId?: string }) {
    return this.service.execute(body.projectId, body.nodeId, body.userId || 'default-user');
  }
}
