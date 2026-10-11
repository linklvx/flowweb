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
  exports: [CanvasService],   // Y0b-4 T9：CollabModule 消费（export-fresh 副本创建——依赖单向 Collab→Canvas 无环）
})
export class CanvasModule {}
