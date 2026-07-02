import { Module } from '@nestjs/common';
import { MediaProcessService } from './media-process.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { MinioModule } from '../minio/minio.module';

@Module({
  imports: [PrismaModule, MinioModule],
  providers: [MediaProcessService],
  exports: [MediaProcessService],
})
export class MediaProcessModule {}
