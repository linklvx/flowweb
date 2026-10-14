import { Module } from '@nestjs/common';
import { CollabGateway, resolveCollabDebounce } from './collab.gateway';
import { CollabPgBreakerService } from './collab-pg-breaker.service';
import { CollabDocumentService } from './collab-document.service';
import { CollabDocWriterService } from './collab-doc-writer.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabSpoolService } from './collab-spool.service';
import { CollabLeaseService } from './collab-lease.service';
import { CollabReadyController } from './collab-ready.controller';
import { CollabReadyService } from './collab-ready.service';
import { CollabDocController } from './collab-doc.controller';
import { CollabShrinkService } from './collab-shrink.service';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';
import { AuditService } from '../../common/audit/audit.service';
import { REDIS_CLIENT, createManagedRedis } from '../../common/redis/managed-redis';
import { SessionService } from '../../auth/session.service';
import { TeamModule } from '../team/team.module';
import { CanvasModule } from '../canvas/canvas.module';   // Y0b-4 T9：CanvasService（export-fresh 副本创建）——单向依赖无环

@Module({
  imports: [TeamModule, CanvasModule],
  controllers: [CollabReadyController, CollabDocController, TelemetryController],   // Y0a-3 T7（Z14）：providers 不注册路由——HTTP 面必须 controllers；Y0b-4 T8：shrink 端点；Y0b-5 T1：遥测端点
  providers: [
    { provide: 'COLLAB_PORT', useValue: Number(process.env.COLLAB_PORT) || 3001 },
    { provide: 'COLLAB_DEBOUNCE', useValue: resolveCollabDebounce() },   // 批3-4：dev 1000/prod 2000（env COLLAB_DEBOUNCE 可调；原 5000）
    { provide: 'COLLAB_TIMEOUT', useValue: Number(process.env.COLLAB_TIMEOUT) || 30_000 },   // 批3-4：握手超时+检查周期双语义
    SessionService,   // 批3-3：gateway authenticate 走 touchWithReason（PrismaModule 全局可见）
    CollabGateway,
    CollabDocumentService,
    CollabDocWriterService,   // Y0c T8：writeBatch 同事务组批写门面（execution.service 首个消费方；T13b 端口化前直注入）
    CanvasDocUpdateRepository,
    CollabSpoolService,
    CollabLeaseService,   // Y0a-3 T5：PG 租约（gateway 构造参数 4——必填）
    CollabPgBreakerService,   // Y0b-5 T16：PG 熔断器（准入+store 短路——单例供 gateway/ready 同读）
    CollabReadyService,   // Y0a-3 T7：/api/ready 组装（G-4 九档+1s 单飞）
    CollabShrinkService,   // Y0b-4 T8：REST shrink（Q-G 影子预演/TOCTOU 同步段/信号量/thaw）
    TelemetryService,   // Y0b-5 T1：sendBeacon 遥测批次 ingest（一律 204——计数族在 store.metrics）
    AuditService,   // T5 递延至此——drain 审计消费（team/subscription module 直注册同款先例）
    { provide: REDIS_CLIENT, useFactory: () => createManagedRedis(process.env.REDIS_URL, {
      lazyConnect: true, connectTimeout: 500, maxRetriesPerRequest: 1,
      retryStrategy: () => null, enableOfflineQueue: false,   // B11/Z10③：探针参数收紧
    }) },
  ],
  exports: [CollabDocumentService, CollabDocWriterService],   // Y0c T8：消费面逐步扩（T12 收编 shrink/intent-reconcile）
})
export class CollabModule {}
