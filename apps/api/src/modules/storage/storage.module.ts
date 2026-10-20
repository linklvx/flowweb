import { Module } from '@nestjs/common';
import { TeamModule } from '../team/team.module';
import { MediaModule } from '../media/media.module';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

@Module({
  imports: [TeamModule, MediaModule], // Y1b T4：MediaRegistrationService（唯一 Media 写入点）
  controllers: [StorageController],
  providers: [StorageService],
})
export class StorageModule {}
