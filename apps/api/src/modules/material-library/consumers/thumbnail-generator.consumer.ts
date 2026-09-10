import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../minio/minio.service';
import { THUMBNAIL_GENERATOR_QUEUE } from '../constants/material-library.constants';
import sharp from 'sharp';
import * as fs from 'fs';
import * as tmp from 'tmp';

// Auto-cleanup temp files on process exit (cross-platform safe)
tmp.setGracefulCleanup();

@Processor(THUMBNAIL_GENERATOR_QUEUE)
export class ThumbnailGeneratorConsumer extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private minioService: MinioService,
  ) {
    super();
  }

  async process(job: Job<{ mediaId: string; key: string; mimeType: string; seekSec?: number }>) {
    const { mediaId, key, mimeType, seekSec } = job.data;
    try {
      if (mimeType.startsWith('image/')) {
        await this.processImage(mediaId, key);
      } else if (mimeType.startsWith('video/')) {
        await this.processVideo(mediaId, key, seekSec);
      }
    } catch (error) {
      console.error('Thumbnail generation failed:', error);
      throw error;
    }
  }

  private async processImage(mediaId: string, key: string) {
    const stream = await this.minioService.getObject(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const thumbnailBuffer = await sharp(buffer)
      .resize(300, 225, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();

    const thumbnailKey = `thumbnails/${mediaId}.webp`;
    await this.minioService.upload(thumbnailKey, thumbnailBuffer, 'image/webp');

    // Store key, NOT signed URL — URLs expire after 24h
    await this.prisma.media.update({
      where: { id: mediaId },
      data: { thumbnailKey },
    });
  }

  private async processVideo(mediaId: string, key: string, seekSec?: number) {
    const ffmpeg = await import('fluent-ffmpeg');
    // Use tmp package for automatic cleanup (handles Windows paths with spaces)
    const tempFile = tmp.fileSync({ postfix: '.mp4' });
    const tempPath = tempFile.name;
    const thumbFile = tmp.fileSync({ postfix: '.jpg' });
    const thumbnailPath = thumbFile.name;

    const stream = await this.minioService.getObject(key);
    const writeStream = fs.createWriteStream(tempPath);
    stream.pipe(writeStream);
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', () => resolve());
      writeStream.on('error', reject);
    });

    await new Promise<void>((resolve, reject) => {
      ffmpeg.default(tempPath)
        .screenshots({
          timestamps: [seekSec ?? 1],
          filename: require('path').basename(thumbnailPath),
          folder: require('path').dirname(thumbnailPath),
          size: '300x225',
        })
        .on('end', () => resolve())
        .on('error', reject);
    });

    const thumbnailBuffer = fs.readFileSync(thumbnailPath);
    const thumbnailKey = `thumbnails/${mediaId}.webp`;
    const webpBuffer = await sharp(thumbnailBuffer).webp({ quality: 80 }).toBuffer();

    await this.minioService.upload(thumbnailKey, webpBuffer, 'image/webp');

    // Store key, NOT signed URL
    await this.prisma.media.update({
      where: { id: mediaId },
      data: { thumbnailKey },
    });
    // tmp cleans up temp files automatically on process exit
  }
}
