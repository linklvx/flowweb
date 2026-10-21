// apps/api/src/modules/worker-presence/worker-presence.module.ts
// Y0c T29-II（Z130/Z148②）：WorkerPresence 小模块——付费队列 registerQueue（getWorkers/
// getWaitingCount 探测面）+service 导出。消费方=api 侧模块：ExecutionHttpModule（enqueue 门）/
// AiImageEditHttpModule（runGuarded+lighting createTask 门）/CollabModule（ready workers 维度）。
// **worker.module.ts 零导入**（census ⑰ worker 闭包纯净维持——本模块只服务 api 进程准入面）。
// T12：ai-result-download 退役（video materialize=MaterializeJob DB poller——无 BullMQ 消费面）。
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../config/queue.constants';
import { WorkerPresenceService } from './worker-presence.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.EXECUTION },
      { name: QUEUE_NAMES.AI_IMAGE_EDIT },
    ),
  ],
  providers: [WorkerPresenceService],
  exports: [WorkerPresenceService],
})
export class WorkerPresenceModule {}
