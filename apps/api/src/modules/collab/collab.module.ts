import { Module } from '@nestjs/common';
import { CollabGateway, resolveCollabDebounce } from './collab.gateway';
import { CollabDocumentService } from './collab-document.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabSpoolService } from './collab-spool.service';
import { CollabLeaseService } from './collab-lease.service';
import { CollabReadyController } from './collab-ready.controller';
import { CollabReadyService } from './collab-ready.service';
import { AuditService } from '../../common/audit/audit.service';
import { REDIS_CLIENT, createManagedRedis } from '../../common/redis/managed-redis';
import { SessionService } from '../../auth/session.service';
import { TeamModule } from '../team/team.module';

@Module({
  imports: [TeamModule],
  controllers: [CollabReadyController],   // Y0a-3 T7（Z14）：providers 不注册路由——HTTP 面必须 controllers
  providers: [
    { provide: 'COLLAB_PORT', useValue: Number(process.env.COLLAB_PORT) || 3001 },
    { provide: 'COLLAB_DEBOUNCE', useValue: resolveCollabDebounce() },   // 批3-4：dev 1000/prod 2000（env COLLAB_DEBOUNCE 可调；原 5000）
    { provide: 'COLLAB_TIMEOUT', useValue: Number(process.env.COLLAB_TIMEOUT) || 30_000 },   // 批3-4：握手超时+检查周期双语义
    SessionService,   // 批3-3：gateway authenticate 走 touchWithReason（PrismaModule 全局可见）
    CollabGateway,
    CollabDocumentService,
    CanvasDocUpdateRepository,
    CollabSpoolService,
    CollabLeaseService,   // Y0a-3 T5：PG 租约（gateway 构造参数 4——必填）
    CollabReadyService,   // Y0a-3 T7：/api/ready 组装（G-4 八档+1s 单飞）
    AuditService,   // T5 递延至此——drain 审计消费（team/subscription module 直注册同款先例）
    { provide: REDIS_CLIENT, useFactory: () => createManagedRedis(process.env.REDIS_URL, {
      lazyConnect: true, connectTimeout: 500, maxRetriesPerRequest: 1,
      retryStrategy: () => null, enableOfflineQueue: false,   // B11/Z10③：探针参数收紧
    }) },
  ],
  exports: [CollabDocumentService],
})
export class CollabModule {}
