import { Module } from '@nestjs/common';
import { ContentController } from './content.controller';
import { AnnouncementController } from './announcement.controller';
import { ContentService } from './content.service';

@Module({
  controllers: [ContentController, AnnouncementController],
  providers: [ContentService],
})
export class ContentModule {}
