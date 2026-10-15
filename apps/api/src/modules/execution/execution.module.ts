import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { GenerationIntentService } from './generation-intent.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { ExecutionProcessor } from './execution.processor';
import { TeamModule } from '../team/team.module';
import { CollabModule } from '../collab/collab.module';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { EmitPort, emitPortForRole } from '../gateway/emit.port';
import { COLLAB_ROLE_DEFAULT, type CollabRole } from '../../config/env';
import { SessionService } from '../../auth/session.service';
import { EXECUTION_QUEUE_NAME, EXECUTION_CONNECTION_NAME } from './execution.constants';
import { EXECUTION_JOB_OPTIONS } from './execution.queue-options';
import { VideoTrimController } from './video-trim.controller';
import { VideoTrimService } from './video-trim.service';
import { VideoTrimProcessor } from './video-trim.processor';
import { VIDEO_TRIM_QUEUE, VIDEO_TRIM_CONNECTION } from './video-trim.constants';
import { VideoSeparateController } from './video-separate.controller';
import { VideoSeparateService } from './video-separate.service';
import { VideoSeparateProcessor } from './video-separate.processor';
import { MediaProcessModule } from '../media-process/media-process.module';
import { PricingResolverService } from './pricing-resolver.service';
import { VIDEO_SEPARATE_QUEUE } from './video-separate.constants';
import { REDIS_CLIENT, createManagedRedis } from '../../common/redis/managed-redis';

@Module({
  imports: [
    CollabModule,
    TeamModule,
    MediaProcessModule,
    BullModule.registerQueue({
      name: EXECUTION_QUEUE_NAME,
      configKey: EXECUTION_CONNECTION_NAME,
      defaultJobOptions: { ...EXECUTION_JOB_OPTIONS },
    }),
    // Y0c T23（Z98）：IntentReconcileService+其专用的 ai-image-edit 队列注册迁 ExecutionDaemonModule
    // （仅 role=api|all 装配）——本模块 processor/服务面不注入该队列
    BullModule.registerQueue({
      name: 'ai-result-download',
    }),
    BullModule.registerQueue({
      name: VIDEO_TRIM_QUEUE,
      configKey: VIDEO_TRIM_CONNECTION,
    }),
    BullModule.registerQueue({
      name: VIDEO_SEPARATE_QUEUE,
      configKey: 'default',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86400 * 7 },
      },
    }),
  ],
  controllers: [ExecutionController, VideoTrimController, VideoSeparateController],
  providers: [
    ExecutionService,
    GenerationIntentService,
    TopologyService,
    ValidationService,
    ApiCallerService,
    SessionService,   // 批3-3：ExecutionGateway authorize 走 touch（鉴权读面顺带续期）
    ExecutionGateway,
    ExecutionProcessor,
    VideoTrimService,
    VideoTrimProcessor,
    VideoSeparateService,
    VideoSeparateProcessor,
    PricingResolverService,   // Y0b-1：定价唯一解析器（AdminModule/AiImageEditModule 经本模块 imports 消费）
    // Y0c T24（Z101）：emit 端口按 COLLAB_ROLE 选形态（api/all=DirectEmitPort 委托真 gateway/worker=
    // WorkerEmitPort 降级 no-op+计数——worker 侧 @WebSocketServer 恒 undefined，gateway.emitNodeStatus
    // 无防护必抛）。useFactory 容器装配期读 env=ExecutionDaemonModule.register 同款形态（T23 先例；
    // census ㉒登记红 until=T34）；emitNodeStatus 消费面（15 调用点/4 文件）注入改道。
    {
      provide: EmitPort,
      useFactory: (gateway: ExecutionGateway) =>
        emitPortForRole((process.env.COLLAB_ROLE ?? COLLAB_ROLE_DEFAULT) as CollabRole, gateway),
      inject: [ExecutionGateway],
    },
    { provide: REDIS_CLIENT, useFactory: () => createManagedRedis() },   // 批3-2 B6 受管工厂
  ],
  exports: [ExecutionService, ExecutionGateway, EmitPort, ApiCallerService, PricingResolverService, GenerationIntentService],   // Y0b-1：GenerationIntentService 注入 AdminModule（force-void 终态化）；Y0c T24：EmitPort 导出（ai-download/ai-image-edit 消费）
})
export class ExecutionModule {}
