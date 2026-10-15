// apps/api/src/modules/execution/execution-http.module.ts
// Y0c T25（Z42④ 模块拆分）：Http 半=controllers（Execution/VideoTrim/VideoSeparate）——worker 闭包
// 禁入面（Z131 census ⑰：*HttpModule/*Controller ≡ ∅）。CollabModule/TeamModule 显式导入：Nest imports
// 不传递（Core 已导入不豁免本模块 controller 的 CollabDocumentService/ProjectPermissionService 解析）。
import { Module } from '@nestjs/common';
import { ExecutionController } from './execution.controller';
import { VideoTrimController } from './video-trim.controller';
import { VideoSeparateController } from './video-separate.controller';
import { ExecutionCoreModule } from './execution-core.module';
import { CollabModule } from '../collab/collab.module';
import { TeamModule } from '../team/team.module';
import { WorkerPresenceModule } from '../worker-presence/worker-presence.module';   // Y0c T29-II（Z148②）：ExecutionController enqueue 门

@Module({
  imports: [ExecutionCoreModule, CollabModule, TeamModule, WorkerPresenceModule],
  controllers: [ExecutionController, VideoTrimController, VideoSeparateController],
})
export class ExecutionHttpModule {}
