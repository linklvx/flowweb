import { Test, TestingModule } from '@nestjs/testing';
import { MaterialService } from './material.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../minio/minio.service';
import { BadRequestException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { THUMBNAIL_GENERATOR_QUEUE } from '../constants/material-library.constants';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('MaterialService', () => {
  let service: MaterialService;
  let prisma: { media: any; materialFolder: any };
  let minio: { generatePresignedGetUrl: ReturnType<typeof vi.fn> };
  let queue: { add: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = {
      media: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      materialFolder: {
        findFirst: vi.fn(),
      },
    };
    minio = { generatePresignedGetUrl: vi.fn() };
    queue = { add: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaterialService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: getQueueToken(THUMBNAIL_GENERATOR_QUEUE), useValue: queue },
      ],
    }).compile();

    service = module.get<MaterialService>(MaterialService);
  });

  describe('getFilesByFolderId', () => {
    it('should return files with generated presigned URLs', async () => {
      const dbFiles = [{ id: 'm-1', originalName: 'test.png', key: 'key1', thumbnailKey: null }];
      prisma.media.findMany.mockResolvedValue(dbFiles);
      minio.generatePresignedGetUrl.mockResolvedValue('http://minio/signed/test.png');

      const result = await service.getFilesByFolderId('user-1', 'folder-1');

      expect(prisma.media.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', folderId: 'folder-1', deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(minio.generatePresignedGetUrl).toHaveBeenCalledWith('key1', 3600);
      expect(result[0].url).toBe('http://minio/signed/test.png');
    });

    it('should generate thumbnail URLs when thumbnailKey exists', async () => {
      const dbFiles = [{ id: 'm-1', originalName: 'test.png', key: 'key1', thumbnailKey: 'thumb/key1.webp' }];
      prisma.media.findMany.mockResolvedValue(dbFiles);
      minio.generatePresignedGetUrl
        .mockResolvedValueOnce('http://minio/signed/test.png')
        .mockResolvedValueOnce('http://minio/signed/thumb.webp');

      const result = await service.getFilesByFolderId('user-1', 'folder-1');

      expect(result[0].url).toBe('http://minio/signed/test.png');
      expect(result[0].thumbnailUrl).toBe('http://minio/signed/thumb.webp');
    });
  });

  describe('moveFile', () => {
    it('should move file to folder and trigger thumbnail job', async () => {
      prisma.media.findFirst.mockResolvedValue({
        id: 'm-1', originalName: 'test.png', key: 'uploads/test.png', thumbnailKey: null, mimeType: 'image/png',
      });
      prisma.materialFolder.findFirst.mockResolvedValue({ id: 'folder-1' });
      prisma.media.update.mockResolvedValue({
        id: 'm-1', folderId: 'folder-1', key: 'uploads/test.png', mimeType: 'image/png', thumbnailKey: null,
      });

      await service.moveFile('user-1', 'm-1', 'folder-1');

      expect(prisma.media.update).toHaveBeenCalledWith({
        where: { id: 'm-1' },
        data: { folderId: 'folder-1' },
      });
      expect(queue.add).toHaveBeenCalledWith('generate-thumbnail', {
        mediaId: 'm-1', key: 'uploads/test.png', mimeType: 'image/png',
      });
    });

    it('should throw if file not found', async () => {
      prisma.media.findFirst.mockResolvedValue(null);
      await expect(service.moveFile('u1', 'm-99', 'f-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw if folder not found', async () => {
      prisma.media.findFirst.mockResolvedValue({ id: 'm-1', key: 'k1', thumbnailKey: null });
      prisma.materialFolder.findFirst.mockResolvedValue(null);
      await expect(service.moveFile('u1', 'm-1', 'f-99')).rejects.toThrow(BadRequestException);
    });
  });

  describe('toggleFavorite', () => {
    it('should toggle isFavorite from false to true', async () => {
      prisma.media.findFirst.mockResolvedValue({ id: 'm-1', isFavorite: false });
      prisma.media.update.mockResolvedValue({ id: 'm-1', isFavorite: true });

      const result = await service.toggleFavorite('user-1', 'm-1');
      expect(result.isFavorite).toBe(true);
    });

    it('should throw if file not found', async () => {
      prisma.media.findFirst.mockResolvedValue(null);
      await expect(service.toggleFavorite('u1', 'm-99')).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteFile', () => {
    it('should soft-delete file', async () => {
      prisma.media.findFirst.mockResolvedValue({ id: 'm-1' });
      prisma.media.update.mockResolvedValue({ id: 'm-1', deletedAt: new Date() });

      await service.deleteFile('user-1', 'm-1');
      expect(prisma.media.update).toHaveBeenCalledWith({
        where: { id: 'm-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should throw if file not found', async () => {
      prisma.media.findFirst.mockResolvedValue(null);
      await expect(service.deleteFile('u1', 'm-99')).rejects.toThrow(BadRequestException);
    });
  });
});
