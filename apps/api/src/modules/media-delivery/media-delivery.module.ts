// apps/api/src/modules/media-delivery/media-delivery.module.ts
// Y1a+Y1b T15：交付域模块——ArtifactProjection 投影 poller（唯一交付 owner）+admin retry 最小入口。
// 进程归属=api（spec 部署图 :280）：装配面=ExecutionDaemonModule.register() role 门（api|all——
// worker 零实例化；IntentReconcileService 同形态约束「reconcile/poller 只在 api 进程」）。
import { Module } from '@nestjs/common';
import { CollabModule } from '../collab/collab.module';
import { TeamModule } from '../team/team.module';
import { ProjectionOutboxPoller } from './projection-outbox.poller';
import { ProjectionAdminController } from './projection-admin.controller';

@Module({
  imports: [CollabModule, TeamModule],
  controllers: [ProjectionAdminController],
  providers: [ProjectionOutboxPoller],
})
export class MediaDeliveryModule {}
