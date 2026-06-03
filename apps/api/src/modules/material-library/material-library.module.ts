import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FolderController } from './controllers/folder.controller';
import { FileController } from './controllers/file.controller';
import { FolderService } from './services/folder.service';
import { MaterialService } from './services/material.service';
import { ThumbnailGeneratorConsumer } from './consumers/thumbnail-generator.consumer';
import { THUMBNAIL_GENERATOR_QUEUE, THUMBNAIL_GENERATOR_CONNECTION } from './constants/material-library.constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: THUMBNAIL_GENERATOR_QUEUE,
      configKey: THUMBNAIL_GENERATOR_CONNECTION,
    }),
  ],
  controllers: [FolderController, FileController],
  providers: [FolderService, MaterialService, ThumbnailGeneratorConsumer],
  exports: [MaterialService],
})
export class MaterialLibraryModule {}
