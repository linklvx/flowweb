import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { ContentService } from './content.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@Controller('api/admin/announcements')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AdminAnnouncementController {
  constructor(@Inject(ContentService) private readonly contentService: ContentService) {}

  @Get()
  list() {
    return this.contentService.listAnnouncements();
  }

  @Post()
  create(@Body() dto: CreateAnnouncementDto) {
    return this.contentService.createAnnouncement(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.contentService.updateAnnouncement(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.contentService.deleteAnnouncement(id);
  }
}
