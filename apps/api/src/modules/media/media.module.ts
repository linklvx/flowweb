import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MediaBatchService } from './media-batch.service';
import { validateEnv } from '../../config/env';

const env = validateEnv();

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    MediaBatchService,
    { provide: 'REDIS_CLIENT', useFactory: () => new Redis(env.REDIS_URL) },
  ],
  exports: [MediaService],
})
export class MediaModule {}
