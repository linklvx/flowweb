import { Module } from '@nestjs/common';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { TeamModule } from '../team/team.module';
import { CollabModule } from '../collab/collab.module';

@Module({
  imports: [TeamModule, CollabModule],
  controllers: [ProjectController],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
