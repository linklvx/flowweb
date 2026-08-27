import { Module } from '@nestjs/common';
import { CollabGateway } from './collab.gateway';
import { CollabDocumentService } from './collab-document.service';

@Module({
  providers: [
    { provide: 'COLLAB_PORT', useValue: Number(process.env.COLLAB_PORT) || 3001 },
    { provide: 'COLLAB_DEBOUNCE', useValue: 5000 },
    CollabGateway,
    CollabDocumentService,
  ],
  exports: [CollabDocumentService],
})
export class CollabModule {}
