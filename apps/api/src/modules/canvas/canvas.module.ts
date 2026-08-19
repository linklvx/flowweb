import { Module } from '@nestjs/common';
import { CanvasService } from './canvas.service';
import { CanvasController, CanvasSaveController } from './canvas.controller';
import { ProjectModule } from '../project/project.module';
import { FolderModule } from '../folder/folder.module';
import { TemplateModule } from '../template/template.module';

@Module({
  imports: [ProjectModule, FolderModule, TemplateModule],
  controllers: [CanvasController, CanvasSaveController],
  providers: [CanvasService],
})
export class CanvasModule {}
