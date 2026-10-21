// apps/api/src/modules/ai-image-edit/ai-image-edit-core.module.ts
// Y0c T25（Z42④ 模块拆分）：ai-image-edit→Core/Http 二分——Core=service+processor+consumer（零
// controller），Http=controllers（ai-image-edit-http.module.ts）。worker（T26）只装 Core。
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiImageEditService } from './ai-image-edit.service';
import { AiImageEditProcessor } from './ai-image-edit.processor';
import { LightingService } from './lighting/lighting.service';
import { LightingConsumer } from './lighting/lighting.consumer';
import { ExecutionCoreModule } from '../execution/execution-core.module';
import { TeamModule } from '../team/team.module';
import { CollabModule } from '../collab/collab.module';
import { GenerationIntentService } from '../execution/generation-intent.service';
import { ArtifactCoreModule } from '../artifact-core/artifact-core.module';
import { SafeRemoteFetchService } from '../media/safe-remote-fetch.service';
import { AI_IMAGE_EDIT_QUEUE_NAME, AI_IMAGE_EDIT_CONNECTION_NAME } from './ai-image-edit.constants';
import { AI_IMAGE_EDIT_JOB_OPTIONS } from './ai-image-edit.queue-options';

@Module({
  imports: [
    ArtifactCoreModule,   // T10：NodeArtifactService（claimCapture）+ArtifactCommitService（T10 processor/consumer 改道）
    CollabModule,
    ExecutionCoreModule,   // Y0c T25：ExecutionModule 拆分改道（EmitPort 导出面）
    TeamModule,
    BullModule.registerQueue({
      name: AI_IMAGE_EDIT_QUEUE_NAME,
      configKey: AI_IMAGE_EDIT_CONNECTION_NAME,
      defaultJobOptions: { ...AI_IMAGE_EDIT_JOB_OPTIONS },
    }),
  ],
  // GenerationIntentService：本模块自注册（ExecutionCoreModule 虽导出但 api/all 双注册同实例语义
  // 不变——PrismaModule @Global；历史形态保留）；T25 起加导出=Http 半 controller 消费面。
  // Y0c T26 根修（T25 漏项——F2 AppModule 全 compile 冒烟抓到）：LightingService 补导出——Http 半
  // LightingController 注入面（拆分前同模块 providers 直取，漏 exports=api 启动即红）
  providers: [AiImageEditService, AiImageEditProcessor, LightingService, LightingConsumer, GenerationIntentService, SafeRemoteFetchService],   // T6：下载原语平铺（MediaModule 闭包脏不可导入）
  exports: [AiImageEditService, GenerationIntentService, LightingService],
})
export class AiImageEditCoreModule {}
