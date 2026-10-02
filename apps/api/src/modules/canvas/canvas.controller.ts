import { Controller, Post, Get, Body, Req, Query, Inject, UnauthorizedException, UsePipes, ValidationPipe } from '@nestjs/common';
import { Request } from 'express';
import { CanvasService } from './canvas.service';
import { CreateCanvasDto } from './dto/create-canvas.dto';

@Controller('api/canvases')
export class CanvasController {
  constructor(@Inject(CanvasService) private readonly canvasService: CanvasService) {}

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async create(@Body() dto: CreateCanvasDto, @Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.canvasService.create(dto.name, dto.folderId ?? null, userId, dto.teamId);
  }

  // 静态路由需先于将来可能出现的 @Get(':id') 声明，避免被动态段吞掉
  @Get('next-untitled-name')
  async nextUntitledName(@Req() req: Request, @Query('teamId') teamId?: string) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return { name: await this.canvasService.getNextUntitledName(userId, teamId) };
  }
}
