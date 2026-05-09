import { Controller, Get, Inject } from '@nestjs/common';
import { ContentService } from './content.service';

@Controller('api/announcements')
export class AnnouncementController {
  constructor(@Inject(ContentService) private readonly contentService: ContentService) {}

  @Get('active')
  getActiveAnnouncement() {
    return this.contentService.getActiveAnnouncement();
  }
}
