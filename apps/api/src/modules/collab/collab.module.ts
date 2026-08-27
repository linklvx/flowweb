import { Module } from '@nestjs/common';
import { CollabGateway } from './collab.gateway';
import { CollabDocumentService } from './collab-document.service';

@Module({
  providers: [CollabGateway, CollabDocumentService],
  exports: [CollabDocumentService],
})
export class CollabModule {}
