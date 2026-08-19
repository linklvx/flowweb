import { Controller, Post, Body, Req, Inject, UnauthorizedException, UsePipes, ValidationPipe, Param } from '@nestjs/common';
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
    return this.canvasService.create(dto.name, dto.folderId ?? null, userId);
  }
}

@Controller('api/projects')
export class CanvasSaveController {
  constructor(@Inject(CanvasService) private readonly canvasService: CanvasService) {}

  @Post(':id/save')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async save(@Param('id') id: string, @Body() dto: SaveCanvasDto, @Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.canvasService.save(id, dto, userId);
  }
}
