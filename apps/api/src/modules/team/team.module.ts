import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TeamService } from './team.service';
import { TeamController } from './team.controller';
import { TeamGuard } from './team.guard';

@Module({
  imports: [BullModule.registerQueue({ name: 'team-media-cleanup' })],
  controllers: [TeamController],
  providers: [TeamService, TeamGuard],
  exports: [TeamService, TeamGuard],
})
export class TeamModule {}
