// apps/api/src/modules/ai-image-edit/ai-image-edit-http.module.ts
// Y0c T25（Z42④ 模块拆分）：Http 半=controllers（AiImageEdit/Lighting）——worker 闭包禁入面（Z131）。
// CollabModule/TeamModule/ExecutionCoreModule 显式导入：Nest imports 不传递（controller 的
// CollabDocumentService/ProjectPermissionService/PricingResolverService 解析面）。
import { Module } from '@nestjs/common';
import { AiImageEditController } from './ai-image-edit.controller';
import { LightingController } from './lighting/lighting.controller';
import { AiImageEditCoreModule } from './ai-image-edit-core.module';
import { CollabModule } from '../collab/collab.module';
import { TeamModule } from '../team/team.module';
import { ExecutionCoreModule } from '../execution/execution-core.module';

@Module({
  imports: [AiImageEditCoreModule, ExecutionCoreModule, CollabModule, TeamModule],
  controllers: [AiImageEditController, LightingController],
})
export class AiImageEditHttpModule {}
