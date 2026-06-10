import { Controller, Post, Body, Inject } from '@nestjs/common';
import { AiImageEditService } from './ai-image-edit.service';

@Controller('api/image-edit')
export class AiImageEditController {
  constructor(@Inject(AiImageEditService) private readonly service: AiImageEditService) {}

  @Post('outpaint')
  async outpaint(@Body() body: {
    projectId: string;
    nodeId: string;
    fileId: string;
    rect: { x: number; y: number; width: number; height: number };
    imageWidth: number;
    imageHeight: number;
  }) {
    return this.service.enqueueOutpaint(
      body.projectId,
      body.nodeId,
      body.fileId,
      body.rect,
      body.imageWidth,
      body.imageHeight,
    );
  }

  @Post('erase')
  async erase(@Body() body: { projectId: string; nodeId: string; fileId: string; maskFileId: string }) {
    return this.service.enqueueErase(
      body.projectId,
      body.nodeId,
      body.fileId,
      body.maskFileId,
    );
  }

  @Post('redraw')
  async redraw(@Body() body: { projectId: string; nodeId: string; fileId: string; maskFileId: string; prompt: string; strength: number }) {
    return this.service.enqueueRedraw(
      body.projectId,
      body.nodeId,
      body.fileId,
      body.maskFileId,
      body.prompt,
      body.strength,
    );
  }
}
