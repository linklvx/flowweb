import { Controller, Post, Body, Req, UsePipes, ValidationPipe, Inject } from '@nestjs/common';
import { VideoProjectService } from './video-project.service';
import { GeneratedMediaService } from './generated-media.service';
import { RegenerateDto, RegisterGeneratedDto, ConfirmGeneratedDto, ExportPrecheckDto } from './video-project.dto';

// Y4a T8（spec §0 条 9）：VideoProject 表整删——工程 CRUD 四路由（POST /、GET by-node、PATCH :id、
// DELETE by-node）随 REST autosave 链退场；时间轴数据面迁画布 doc（timelines 根按剪辑节点 id 键控）。
// 留存四路由全部零依赖表（regenerate 读 doc/export-precheck 从 CanvasProject 派生 teamId/register
// 只写 Media 元数据/confirm 按 mediaId 收尾）。
@Controller('api/video-projects')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true })) // ValidationPipe 非全局，必须自挂
export class VideoProjectController {
  // @Inject 显式 token：vitest/esbuild 不生成 design:paramtypes（emitDecoratorMetadata），裸参数属性会注入 undefined（本仓被测 controller 一律此模式）
  constructor(
    @Inject(VideoProjectService) private readonly svc: VideoProjectService,
    @Inject(GeneratedMediaService) private readonly generated: GeneratedMediaService,
  ) {}

  @Post('generated-media/register')
  registerGenerated(@Body() dto: RegisterGeneratedDto, @Req() req: any) {
    return this.generated.register({ ...dto, userId: req.user?.id });
  }
  @Post('generated-media/confirm')
  confirmGenerated(@Body() dto: ConfirmGeneratedDto, @Req() req: any) {
    return this.generated.confirm(req.user?.id, dto);
  }

  @Post('regenerate')
  regenerate(@Body() dto: RegenerateDto, @Req() req: any) {
    return this.svc.regenerate(req.user?.id, dto);
  }

  @Post('export-precheck')
  exportPrecheck(@Body() dto: ExportPrecheckDto, @Req() req: any) {
    return this.svc.exportPrecheck(req.user?.id, dto);
  }
}
