import { Module } from '@nestjs/common';
import { TeamModule } from '../team/team.module';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

@Module({
  imports: [TeamModule],
  controllers: [StorageController],
  providers: [StorageService],
})
export class StorageModule {}
