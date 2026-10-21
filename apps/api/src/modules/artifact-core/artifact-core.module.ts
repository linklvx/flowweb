// apps/api/src/modules/artifact-core/artifact-core.module.ts —— Y1a+Y1b T10：shared artifact-core
// （Z18''-v14 ③：双 role DI——API 进程（app.module 经 MediaModule/ExecutionCoreModule/
// AiImageEditCoreModule imports）与 worker 进程（worker.module 平铺 provider——本模块 imports
// TeamModule 其闭包含 controller，census ⑰ 下 worker 不可导入；SafeRemoteFetchService 平铺先例）
// 均可装配；worker 是 ArtifactCommit 真实调用方——生产 API manualRegistration:true 不消费队列）。
// 三服务：NodeArtifactService（CAS 原语）+MediaRegistrationService（唯一 Media 写入点，T4 自
// modules/media/ 迁入）+ArtifactCommitService（资金路径唯一 finalize）。
// GenerationIntentService/SafeRemoteFetchService 本模块自注册（AiImageEditCoreModule 自注册先例：
// zero-state 服务多实例语义等同；Prisma/Minio 均 @Global 直注）。
import { Module } from '@nestjs/common';
import { TeamModule } from '../team/team.module';
import { GenerationIntentService } from '../execution/generation-intent.service';
import { SafeRemoteFetchService } from '../media/safe-remote-fetch.service';
import { NodeArtifactService } from './node-artifact.service';
import { MediaRegistrationService } from './media-registration.service';
import { ArtifactCommitService } from './artifact-commit.service';

@Module({
  imports: [TeamModule],   // CreditLedgerService/TeamCreditService（锁序契约 20 消费面）
  providers: [NodeArtifactService, MediaRegistrationService, ArtifactCommitService, GenerationIntentService, SafeRemoteFetchService],
  exports: [NodeArtifactService, MediaRegistrationService, ArtifactCommitService],
})
export class ArtifactCoreModule {}
