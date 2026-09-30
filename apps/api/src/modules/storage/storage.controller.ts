import { Controller, Post, Body, Req } from '@nestjs/common';
import { StorageService } from './storage.service';
import { PresignUploadDto } from './dto/presign.dto';
import { ConfirmUploadDto } from './dto/confirm.dto';

// 批7 gate 真启动取证：同 media.controller——类级 AuthGuard 注册随批3-3 SessionService 依赖炸启动，
// 全局 APP_GUARD 已覆盖
@Controller('api/storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('presign')
  async presign(@Req() req: any, @Body() body: PresignUploadDto) {
    return this.storageService.presignUpload(req.user.id, body);
  }

  @Post('confirm')
  async confirm(@Req() req: any, @Body() body: ConfirmUploadDto) {
    return this.storageService.confirmUpload(req.user.id, body);
  }
}
