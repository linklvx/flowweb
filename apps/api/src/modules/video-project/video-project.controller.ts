import { Controller, Post, Get, Patch, Delete, Body, Param, Req, UsePipes, ValidationPipe, Inject } from '@nestjs/common';
import { VideoProjectService } from './video-project.service';
import { CreateVideoProjectDto, PatchVideoProjectDto } from './video-project.dto';

@Controller('api/video-projects')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true })) // ValidationPipe 非全局，必须自挂
export class VideoProjectController {
  // @Inject 显式 token：vitest/esbuild 不生成 design:paramtypes（emitDecoratorMetadata），裸参数属性会注入 undefined（本仓被测 controller 一律此模式）
  constructor(@Inject(VideoProjectService) private readonly svc: VideoProjectService) {}

  @Post()
  create(@Body() dto: CreateVideoProjectDto, @Req() req: any) {
    return this.svc.upsertByNode({ ...dto, userId: req.user?.id });
  }

  @Get('by-node/:sourceNodeId')
  byNode(@Param('sourceNodeId') sourceNodeId: string, @Req() req: any) {
    return this.svc.getByNode(sourceNodeId, req.user?.id);
  }

  @Patch(':id')
  patch(@Param('id') id: string, @Body() dto: PatchVideoProjectDto, @Req() req: any) {
    return this.svc.patch(id, req.user?.id, dto);
  }

  @Delete('by-node/:sourceNodeId')
  deleteByNode(@Param('sourceNodeId') sourceNodeId: string, @Req() req: any) {
    return this.svc.deleteByNode(sourceNodeId, req.user?.id);
  }
}
