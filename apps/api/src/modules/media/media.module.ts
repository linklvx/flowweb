import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaContentController } from './media-content.controller';
import { MediaService } from './media.service';
import { MediaBatchService } from './media-batch.service';
import { MediaRegistrationService } from './media-registration.service';
import { SafeRemoteFetchService } from './safe-remote-fetch.service';

// Y1a+Y1b T5：REDIS_CLIENT 提供者随 getMediaUrl（presign+缓存旁路）删除退役——MediaModule 零 Redis 消费。
@Module({
  controllers: [MediaController, MediaContentController],
  providers: [
    MediaService,
    MediaBatchService,
    SafeRemoteFetchService,   // T5 原语（content processing 代理消费；T6 四处替换复用）
    // Y1b T4：唯一 Media 写入点（v11 裁决③）——本卡 API 消费；T10 扩展 register 形态移 shared 双 role
    MediaRegistrationService,
  ],
  exports: [MediaService, MediaRegistrationService, SafeRemoteFetchService],
})
export class MediaModule {}
