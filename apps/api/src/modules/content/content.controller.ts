import { Controller, Get, Inject } from '@nestjs/common';
import { ContentService } from './content.service';

@Controller('api/content')
export class ContentController {
  constructor(@Inject(ContentService) private readonly contentService: ContentService) {}

  @Get('cards')
  getCards() {
    return this.contentService.getCards();
  }
}
