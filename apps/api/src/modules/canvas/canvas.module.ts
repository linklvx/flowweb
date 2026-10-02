import { Module } from '@nestjs/common';
import { CanvasService } from './canvas.service';
import { CanvasController } from './canvas.controller';
import { FolderModule } from '../folder/folder.module';
import { TemplateModule } from '../template/template.module';
import { TeamModule } from '../team/team.module';

@Module({
  imports: [FolderModule, TemplateModule, TeamModule],
  controllers: [CanvasController],
  providers: [CanvasService],
})
export class CanvasModule {}
