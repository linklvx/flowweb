import { Module } from '@nestjs/common';
import { TemplateService } from './template.service';
import { TemplateController } from './template.controller';
import { ProjectModule } from '../project/project.module';
import { FolderModule } from '../folder/folder.module';
import { TeamModule } from '../team/team.module';

@Module({
  imports: [ProjectModule, FolderModule, TeamModule],
  controllers: [TemplateController],
  providers: [TemplateService],
  exports: [TemplateService],
})
export class TemplateModule {}
