import { Controller, Post, Body, Inject, Req } from '@nestjs/common';
import { AiImageEditService } from './ai-image-edit.service';
import { ProjectPermissionService } from '../team/project-permission.service';

@Controller('api/image-edit')
export class AiImageEditController {
  constructor(
    @Inject(AiImageEditService) private readonly service: AiImageEditService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
  ) {}

  @Post('outpaint')
  async outpaint(@Body() body: {
    projectId: string;
    nodeId: string;
    fileId: string;
    rect: { x: number; y: number; width: number; height: number };
    imageWidth: number;
    imageHeight: number;
  }, @Req() req: any) {
    await this.perm.assertEditor(body.projectId, req.user.id);
    return this.service.enqueueOutpaint(
      req.user.id,
      body.projectId,
      body.nodeId,
      body.fileId,
      body.rect,
      body.imageWidth,
      body.imageHeight,
    );
  }

  @Post('erase')
  async erase(@Body() body: { projectId: string; nodeId: string; fileId: string; maskFileId: string }, @Req() req: any) {
    await this.perm.assertEditor(body.projectId, req.user.id);
    return this.service.enqueueErase(
      req.user.id,
      body.projectId,
      body.nodeId,
      body.fileId,
      body.maskFileId,
    );
  }

  @Post('redraw')
  async redraw(@Body() body: { projectId: string; nodeId: string; fileId: string; maskFileId: string; prompt: string; strength: number }, @Req() req: any) {
    await this.perm.assertEditor(body.projectId, req.user.id);
    return this.service.enqueueRedraw(
      req.user.id,
      body.projectId,
      body.nodeId,
      body.fileId,
      body.maskFileId,
      body.prompt,
      body.strength,
    );
  }
}
