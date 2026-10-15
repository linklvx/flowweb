// apps/api/src/modules/ai-download/ai-download-core.module.ts
// Y0c T25（Z42④ 模块拆分）：ai-download Core 半——本模块零 controllers（原 AiDownloadModule 即无），
// Http 半为空壳禁入（CLAUDE.md 简洁优先——偏离登记见 T25 报告）：Core 单体即终态，worker（T26）
// 直接装本模块。其余面（imports/providers/exports）与原模块逐字相同，仅 ExecutionModule→Core 改道。
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiDownloadProcessor } from './ai-download.processor';
import { AI_DOWNLOAD_QUEUE_NAME } from './ai-download.constants';
import { ExecutionCoreModule } from '../execution/execution-core.module';
import { CollabModule } from '../collab/collab.module';
import { TeamModule } from '../team/team.module';

@Module({
  imports: [
    TeamModule,
    CollabModule,
    ExecutionCoreModule,   // Y0c T25：ExecutionModule 拆分改道（EmitPort 导出面）
    BullModule.registerQueue({
      name: AI_DOWNLOAD_QUEUE_NAME,
    }),
  ],
  providers: [AiDownloadProcessor],
  exports: [BullModule],
})
export class AiDownloadCoreModule {}
