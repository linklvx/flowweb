import { Module } from '@nestjs/common';
import { VideoWorkController } from './video-work.controller';
import { AdminVideoWorkController } from './admin-video-work.controller';
import { VideoWorkService } from './video-work.service';
import { VideoWorkCloneService } from './video-work-clone.service'; // Task 1.3 先建空壳类，providers 全量列出（C2）
import { ProjectModule } from '../project/project.module';
import { CollabModule } from '../collab/collab.module';
import { TeamModule } from '../team/team.module';
import { RateLimiterService } from '../../common/services/rate-limiter.service';
import { REDIS_CLIENT, createManagedRedis } from '../../common/redis/managed-redis';
// PrismaService/MinioService 是 @Global（prisma.module.ts:4 / minio.module.ts:5）——service 构造注入即可，module 无需 import/providers（勿写未用导入）

@Module({
  imports: [ProjectModule, CollabModule, TeamModule],
  controllers: [VideoWorkController, AdminVideoWorkController],
  providers: [
    VideoWorkService,
    VideoWorkCloneService,   // 空壳，Task 6.1 填充
    RateLimiterService,      // 类形式直接 provide（auth.module.ts:13-20 先例），构造注入同模块 REDIS_CLIENT token
    { provide: REDIS_CLIENT, useFactory: () => createManagedRedis() },   // 批3-2 B6 受管工厂（env 兜底内置，勿裸 new Redis(undefined)——C2 Task 1.3）
  ],
})
export class VideoWorkModule {}
