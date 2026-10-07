import { Module } from '@nestjs/common';
import { CollabGateway, resolveCollabDebounce } from './collab.gateway';
import { CollabDocumentService } from './collab-document.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabSpoolService } from './collab-spool.service';
import { CollabLeaseService } from './collab-lease.service';
import { SessionService } from '../../auth/session.service';
import { TeamModule } from '../team/team.module';

@Module({
  imports: [TeamModule],
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
  ],
  exports: [CollabDocumentService],
})
export class CollabModule {}
