import { Module } from '@nestjs/common';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { TeamModule } from '../team/team.module';

// Y0a-3 T8①：CollabModule import 随 ProjectService 种子 PG 化移除（孤儿清理——CollabModule 仍由 app.module 全局导入，gateway 生命周期不变）
@Module({
  imports: [TeamModule],
  controllers: [ProjectController],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
