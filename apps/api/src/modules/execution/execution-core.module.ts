// apps/api/src/modules/execution/execution-core.module.ts
// Y0c T25（Z42④ 模块拆分）：ExecutionModule→Core/Http 二分——Core=service+processor+gateway+EmitPort
// 工厂（零 controller），Http=controllers（execution-http.module.ts）。动机：worker（T26 workerProviders）
// 只装 Core 不带 controller（Z131 模块图闭包 census ⑰）；IntentReconcileService 不在本模块（归
// ExecutionDaemonModule——Z98，worker 装 Core 不得双倍回收钱）。api 侧 app.module=Http+Core 双导入。
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ExecutionService } from './execution.service';
import { GenerationIntentService } from './generation-intent.service';
import { TopologyService } from './topology.service';
import { UpstreamMediaService } from './upstream-media.service';
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
import { VideoTrimService } from './video-trim.service';
import { VideoTrimProcessor } from './video-trim.processor';
import { VIDEO_TRIM_QUEUE, VIDEO_TRIM_CONNECTION } from './video-trim.constants';
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
  providers: [
    ExecutionService,
    GenerationIntentService,
    TopologyService,
    UpstreamMediaService,   // Y1a T8：上游媒体解析（NodeArtifact 读源/身份 canonicalize/外呼 URL 解析——MinIO/Prisma 均 @Global 直注）
    ValidationService,
    ApiCallerService,
    SessionService,   // 批3-3：ExecutionGateway authorize 走 touch（鉴权读面顺带续期）
    ExecutionGateway,
    ExecutionProcessor,
    VideoTrimService,
    VideoTrimProcessor,
    VideoSeparateService,
    VideoSeparateProcessor,
    PricingResolverService,   // Y0b-1：定价唯一解析器（AdminModule/AiImageEditCoreModule 经本模块 imports 消费）
    // Y0c T24（Z101）：emit 端口按 COLLAB_ROLE 选形态（api/all=DirectEmitPort 委托真 gateway/worker=
    // WorkerEmitPort 降级 no-op+计数——worker 侧 @WebSocketServer 恒 undefined，gateway.emitNodeStatus
    // 无防护必抛）。useFactory 容器装配期读 env=ExecutionDaemonModule.register 同款形态（T23 先例；
    // census ㉒登记红 until=T34）；emit 族消费面（emitNodeStatus 15 点+T25 三族 6 点）注入改道。
    {
      provide: EmitPort,
      useFactory: (gateway: ExecutionGateway) =>
        emitPortForRole((process.env.COLLAB_ROLE ?? COLLAB_ROLE_DEFAULT) as CollabRole, gateway),
      inject: [ExecutionGateway],
    },
    { provide: REDIS_CLIENT, useFactory: () => createManagedRedis() },   // 批3-2 B6 受管工厂
  ],
  // Y0c T25：拆分后 exports 扩三——VideoTrimService/VideoSeparateService（ExecutionHttpModule 的两
  // controller 消费）+ BullModule（队列 token 再导出——ExecutionController @InjectQueue(EXECUTION_QUEUE)
  // 解析面，ai-download.module exports:[BullModule] 同款先例）。
  exports: [ExecutionService, ExecutionGateway, EmitPort, ApiCallerService, PricingResolverService, GenerationIntentService, VideoTrimService, VideoSeparateService, BullModule],
})
export class ExecutionCoreModule {}
