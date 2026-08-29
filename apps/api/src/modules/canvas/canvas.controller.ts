import { Controller, Post, Get, Body, Req, Inject, UnauthorizedException, UsePipes, ValidationPipe, Param, Headers } from '@nestjs/common';
import { Request } from 'express';
import { CanvasService } from './canvas.service';
import { CreateCanvasDto } from './dto/create-canvas.dto';
import { SaveCanvasDto } from './dto/save-canvas.dto';

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
  async nextUntitledName(@Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return { name: await this.canvasService.getNextUntitledName(userId) };
  }
}

@Controller('api/projects')
export class CanvasSaveController {
  constructor(@Inject(CanvasService) private readonly canvasService: CanvasService) {}

  @Post(':id/save')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async save(
    @Param('id') id: string,
    @Body() dto: SaveCanvasDto,
    @Req() req: Request,
    @Headers('x-yjs-sv') sv?: string,
  ) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    const svBytes = sv ? new Uint8Array(Buffer.from(sv, 'base64')) : undefined;
    return this.canvasService.save(id, dto, userId, svBytes);
  }
}
