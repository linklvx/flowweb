import { Body, Controller, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Request } from 'express';
import { AdminIntentService } from './intent.service';
import { ForceVoidIntentDto } from './dto/force-void-intent.dto';

@Controller('api/admin/intents')
export class AdminIntentController {
  constructor(private readonly adminIntentService: AdminIntentService) {}

  /** Y0b-1 force-void：TEAM_HAS_ACTIVE_FUNDS 409 的运维出口（AdminGuard 全局 /api/admin/* 守卫承载）。 */
  @Post('force-void')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  forceVoid(@Body() dto: ForceVoidIntentDto, @Req() req: Request) {
    return this.adminIntentService.forceVoid(dto.intentRowId, (req as any).user.id);
  }
}
