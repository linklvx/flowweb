import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaContentController } from './media-content.controller';
import { MediaService } from './media.service';
import { MediaBatchService } from './media-batch.service';
import { SafeRemoteFetchService } from './safe-remote-fetch.service';
import { ArtifactCoreModule } from '../artifact-core/artifact-core.module';

// Y1a+Y1b T5：REDIS_CLIENT 提供者随 getMediaUrl（presign+缓存旁路）删除退役——MediaModule 零 Redis 消费。
// T10：MediaRegistrationService 迁 artifact-core（shared 双 role）——MediaModule 经 imports 消费并
// re-export 模块本身（Nest 约束：跨模块 provider 只能以模块形态 re-export；storage.module 经
// MediaModule 传递可见，模块去重=单实例）。
@Module({
  imports: [ArtifactCoreModule],
  controllers: [MediaController, MediaContentController],
  providers: [
    MediaService,
    MediaBatchService,
    SafeRemoteFetchService,   // T5 原语（content processing 代理消费；T6 四处替换复用）
  ],
  exports: [MediaService, SafeRemoteFetchService, ArtifactCoreModule],
})
export class MediaModule {}
