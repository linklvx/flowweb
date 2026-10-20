import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MediaBatchService } from './media-batch.service';
import { MediaRegistrationService } from './media-registration.service';
import { REDIS_CLIENT, createManagedRedis } from '../../common/redis/managed-redis';

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    MediaBatchService,
    // Y1b T4：唯一 Media 写入点（v11 裁决③）——本卡 API 消费；T10 扩展 register 形态移 shared 双 role
    MediaRegistrationService,
    { provide: REDIS_CLIENT, useFactory: () => createManagedRedis() },   // 批3-2 B6 受管工厂
  ],
  exports: [MediaService, MediaRegistrationService],
})
export class MediaModule {}
