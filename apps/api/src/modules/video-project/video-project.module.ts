import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { VideoProjectController } from './video-project.controller';
import { VideoProjectService } from './video-project.service';
import { CollabModule } from '../collab/collab.module';
import { TeamModule } from '../team/team.module';            // StorageQuotaService + ProjectPermissionService 已 export——勿手动 provide（会造第二实例）
import { ExecutionModule } from '../execution/execution.module'; // ExecutionService 已 export——无循环依赖，无需 forwardRef
import { THUMBNAIL_GENERATOR_QUEUE, THUMBNAIL_GENERATOR_CONNECTION } from '../material-library/constants/material-library.constants';

@Module({
  imports: [
    CollabModule,
    TeamModule,
    ExecutionModule,
    BullModule.registerQueue({ name: THUMBNAIL_GENERATOR_QUEUE, configKey: THUMBNAIL_GENERATOR_CONNECTION }), // 队列非全局，本模块必须注册
  ],
  controllers: [VideoProjectController],
  providers: [VideoProjectService], // Task 10 时追加 GeneratedMediaService（本 task 不建占位空类）
})
export class VideoProjectModule {}
