import { Controller, Get, Param, UseGuards, Req, Inject } from '@nestjs/common';
import { MediaService } from './media.service';
import { AuthGuard } from '../../auth/auth.guard';

@Controller('api/media')
@UseGuards(AuthGuard)
export class MediaController {
  constructor(
    @Inject(MediaService) private readonly mediaService: MediaService,
  ) {}

  @Get(':fileId/url')
  async getUrl(@Req() req: any, @Param('fileId') fileId: string) {
    const url = await this.mediaService.getMediaUrl(fileId, req.user.id);
    return { url };
  }
}
