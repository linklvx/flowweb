import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { CollabGateway } from './collab.gateway';
import { CollabDocumentService } from './collab-document.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabRedisSync, COLLAB_REDIS } from './collab-redis-sync.service';
import { SessionService } from '../../auth/session.service';
import { TeamModule } from '../team/team.module';

@Module({
  imports: [TeamModule],
  providers: [
    { provide: 'COLLAB_PORT', useValue: Number(process.env.COLLAB_PORT) || 3001 },
    { provide: 'COLLAB_DEBOUNCE', useValue: 5000 },
    SessionService,   // 批3-3：gateway authenticate 走 touchWithReason（PrismaModule 全局可见）
    {
      provide: COLLAB_REDIS,
      useFactory: () => ({
        pub: new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379/0'),
        sub: new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379/0'),
      }),
    },
    CollabGateway,
    CollabDocumentService,
    CanvasDocUpdateRepository,
    CollabRedisSync,
  ],
  exports: [CollabDocumentService],
})
export class CollabModule {}
