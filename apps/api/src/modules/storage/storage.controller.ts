import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { StorageService } from './storage.service';
import { AuthGuard } from '../../auth/auth.guard';
import { PresignUploadDto } from './dto/presign.dto';
import { ConfirmUploadDto } from './dto/confirm.dto';

@Controller('api/storage')
@UseGuards(AuthGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('presign')
  async presign(@Req() req: any, @Body() body: PresignUploadDto) {
    const data = await this.storageService.presignUpload(req.user.id, body);
    return { code: 0, data };
  }

  @Post('confirm')
  async confirm(@Req() req: any, @Body() body: ConfirmUploadDto) {
    const data = await this.storageService.confirmUpload(req.user.id, body);
    return { code: 0, data };
  }
}
