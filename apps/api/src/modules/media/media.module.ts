import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MediaBatchService } from './media-batch.service';
import { REDIS_CLIENT, createManagedRedis } from '../../common/redis/managed-redis';

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    MediaBatchService,
    { provide: REDIS_CLIENT, useFactory: () => createManagedRedis() },   // 批3-2 B6 受管工厂
  ],
  exports: [MediaService],
})
export class MediaModule {}
