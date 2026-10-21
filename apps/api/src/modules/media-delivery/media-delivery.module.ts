// apps/api/src/modules/media-delivery/media-delivery.module.ts
// Y1a+Y1b T15：交付域模块——ArtifactProjection 投影 poller（唯一交付 owner）+admin retry 最小入口。
// 进程归属=api（spec 部署图 :280）：装配面=ExecutionDaemonModule.register() role 门（api|all——
// worker 零实例化；IntentReconcileService 同形态约束「reconcile/poller 只在 api 进程」）。
// T16 追加：BindingReconcileService（MediaBinding current-state 惰性 reconcile——投影 projected
// 后 post-apply 触发+周期发现轮）+MediaGcService（软删 Media 硬删的引用图护栏 GC）——两服务均需
// withSession doc 读（结构性 api 进程面，poller 同约束）。
import { Module } from '@nestjs/common';
import { CollabModule } from '../collab/collab.module';
import { TeamModule } from '../team/team.module';
import { ProjectionOutboxPoller } from './projection-outbox.poller';
import { ProjectionAdminController } from './projection-admin.controller';
import { BindingReconcileService } from './binding-reconcile.service';
import { MediaGcService } from './media-gc.service';

@Module({
  imports: [CollabModule, TeamModule],
  controllers: [ProjectionAdminController],
  providers: [ProjectionOutboxPoller, BindingReconcileService, MediaGcService],
})
export class MediaDeliveryModule {}
