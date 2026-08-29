import { Test, TestingModule } from '@nestjs/testing';
import { MaterialService } from './material.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../minio/minio.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { THUMBNAIL_GENERATOR_QUEUE } from '../constants/material-library.constants';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('MaterialService', () => {
  let service: MaterialService;
  let prisma: { media: any; materialFolder: any; team: any; teamMember: any };
  let minio: { generatePresignedGetUrl: ReturnType<typeof vi.fn> };
  let queue: { add: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = {
      media: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        groupBy: vi.fn(),
      },
      materialFolder: {
        findFirst: vi.fn(),
      },
      team: { findFirst: vi.fn().mockResolvedValue({ id: 't1' }) },
      teamMember: { findFirst: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
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

  describe('团队维度鉴权（resolveTeamId）', () => {
    it('外部 teamId 且为成员 → 放行并按 teamId 查', async () => {
      prisma.media.findMany.mockResolvedValue([]);
      await service.getFilesByFolderId('u1', null, undefined, 't-team');
      expect(prisma.teamMember.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ teamId: 't-team', userId: 'u1' }) }),
      );
      expect(prisma.media.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ teamId: 't-team' }) }),
      );
    });

    it('他团队成员（非成员）→ 403', async () => {
      prisma.teamMember.findFirst.mockResolvedValue(null);
      await expect(service.getFilesByFolderId('u1', null, undefined, 't-other')).rejects.toThrow(ForbiddenException);
      expect(prisma.media.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getFilesByFolderId', () => {
    it('should return files with generated presigned URLs', async () => {
      const dbFiles = [{ id: 'm-1', originalName: 'test.png', key: 'key1', thumbnailKey: null }];
      prisma.media.findMany.mockResolvedValue(dbFiles);
      minio.generatePresignedGetUrl.mockResolvedValue('http://minio/signed/test.png');

      const result = await service.getFilesByFolderId('user-1', 'folder-1');

      expect(prisma.media.findMany).toHaveBeenCalledWith({
        where: { teamId: 't1', folderId: 'folder-1', deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(minio.generatePresignedGetUrl).toHaveBeenCalledWith('key1', 3600);
      expect(result[0].url).toBe('http://minio/signed/test.png');
    });

    it('should filter by type (mimeType prefix) when type param is provided', async () => {
      prisma.media.findMany.mockResolvedValue([]);

      await service.getFilesByFolderId('user-1', null, 'image');

      expect(prisma.media.findMany).toHaveBeenCalledWith({
        where: {
          teamId: 't1',
          folderId: null,
          deletedAt: null,
          type: 'generated',
          mimeType: { startsWith: 'image/' },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter by video mimeType when type=video', async () => {
      prisma.media.findMany.mockResolvedValue([]);

      await service.getFilesByFolderId('user-1', null, 'video');

      expect(prisma.media.findMany).toHaveBeenCalledWith({
        where: {
          teamId: 't1',
          folderId: null,
          deletedAt: null,
          type: 'generated',
          mimeType: { startsWith: 'video/' },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter by audio mimeType when type=audio', async () => {
      prisma.media.findMany.mockResolvedValue([]);

      await service.getFilesByFolderId('user-1', null, 'audio');

      expect(prisma.media.findMany).toHaveBeenCalledWith({
        where: {
          teamId: 't1',
          folderId: null,
          deletedAt: null,
          type: 'generated',
          mimeType: { startsWith: 'audio/' },
        },
        orderBy: { createdAt: 'desc' },
      });
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

    it('should not filter by generated when type param is not provided', async () => {
      const dbFiles = [{ id: 'm-1', originalName: 'uploaded.png', key: 'key1', thumbnailKey: null }];
      prisma.media.findMany.mockResolvedValue(dbFiles);
      minio.generatePresignedGetUrl.mockResolvedValue('http://minio/signed/file.png');

      await service.getFilesByFolderId('user-1', 'folder-1');

      expect(prisma.media.findMany).toHaveBeenCalledWith({
        where: { teamId: 't1', folderId: 'folder-1', deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getFileCounts', () => {
    it('should return counts grouped by mimeType prefix', async () => {
      prisma.media.groupBy = vi.fn().mockResolvedValue([
        { mimeType: 'image/png', _count: 10 },
        { mimeType: 'image/jpeg', _count: 5 },
        { mimeType: 'video/mp4', _count: 3 },
        { mimeType: 'audio/mp3', _count: 7 },
      ]);

      const result = await service.getFileCounts('user-1');

      expect(prisma.media.groupBy).toHaveBeenCalledWith({
        by: ['mimeType'],
        where: { teamId: 't1', deletedAt: null, type: 'generated' },
        _count: true,
      });
      expect(result).toEqual({ image: 15, video: 3, audio: 7 });
    });

    it('should return zeros when no files exist', async () => {
      prisma.media.groupBy = vi.fn().mockResolvedValue([]);

      const result = await service.getFileCounts('user-1');

      expect(result).toEqual({ image: 0, video: 0, audio: 0 });
    });
  });

  describe('moveFile', () => {
    it('should move file to folder and trigger thumbnail job', async () => {
      prisma.media.findFirst.mockResolvedValue({
        id: 'm-1', teamId: 't1', originalName: 'test.png', key: 'uploads/test.png', thumbnailKey: null, mimeType: 'image/png',
      });
      prisma.materialFolder.findFirst.mockResolvedValue({ id: 'folder-1', teamId: 't1' });
      prisma.media.update.mockResolvedValue({
        id: 'm-1', folderId: 'folder-1', key: 'uploads/test.png', mimeType: 'image/png', thumbnailKey: null,
      });

      await service.moveFile('user-1', 'm-1', 'folder-1');

      expect(prisma.media.findFirst).toHaveBeenCalledWith({
        where: { id: 'm-1', teamId: 't1', deletedAt: null },
      });
      expect(prisma.materialFolder.findFirst).toHaveBeenCalledWith({
        where: { id: 'folder-1', teamId: 't1', deletedAt: null },
      });
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
      prisma.media.findFirst.mockResolvedValue({ id: 'm-1', teamId: 't1', key: 'k1', thumbnailKey: null });
      prisma.materialFolder.findFirst.mockResolvedValue(null);
      await expect(service.moveFile('u1', 'm-1', 'f-99')).rejects.toThrow('文件夹不存在');
    });

    it('移动越权：目标文件夹属其他团队 → 统一报文件夹不存在', async () => {
      prisma.media.findFirst.mockResolvedValue({ id: 'm-1', teamId: 't1', key: 'k1', thumbnailKey: null });
      // 目标文件夹在别的团队，teamId 过滤后查不到
      prisma.materialFolder.findFirst.mockResolvedValue(null);
      await expect(service.moveFile('u1', 'm-1', 'f-other-team')).rejects.toThrow('文件夹不存在');
      expect(prisma.media.update).not.toHaveBeenCalled();
    });
  });

  describe('toggleFavorite', () => {
    it('should toggle isFavorite from false to true', async () => {
      prisma.media.findFirst.mockResolvedValue({ id: 'm-1', teamId: 't1', isFavorite: false });
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
      prisma.media.findFirst.mockResolvedValue({ id: 'm-1', teamId: 't1' });
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

  describe('deleteFiles', () => {
    it('should batch soft-delete multiple files and return count', async () => {
      prisma.media.updateMany.mockResolvedValue({ count: 3 });

      const count = await service.deleteFiles('user-1', ['m-1', 'm-2', 'm-3']);

      expect(prisma.media.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['m-1', 'm-2', 'm-3'] }, teamId: 't1', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(count).toBe(3);
    });

    it('should return 0 for empty ids array', async () => {
      const count = await service.deleteFiles('user-1', []);
      expect(count).toBe(0);
      expect(prisma.media.updateMany).not.toHaveBeenCalled();
    });

    it('should filter by teamId so cross-team files are untouched', async () => {
      prisma.media.updateMany.mockResolvedValue({ count: 0 });

      const count = await service.deleteFiles('user-1', ['m-other']);

      expect(prisma.media.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['m-other'] }, teamId: 't1', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(count).toBe(0);
    });
  });

  describe('moveFiles', () => {
    it('should batch move multiple files and return count', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({ id: 'folder-1', teamId: 't1' });
      prisma.media.updateMany.mockResolvedValue({ count: 3 });

      const count = await service.moveFiles('user-1', ['m-1', 'm-2', 'm-3'], 'folder-1');

      expect(prisma.materialFolder.findFirst).toHaveBeenCalledWith({
        where: { id: 'folder-1', teamId: 't1', deletedAt: null },
      });
      expect(prisma.media.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['m-1', 'm-2', 'm-3'] }, teamId: 't1', deletedAt: null },
        data: { folderId: 'folder-1' },
      });
      expect(count).toBe(3);
    });

    it('should move to root when folderId is null', async () => {
      prisma.media.updateMany.mockResolvedValue({ count: 2 });

      const count = await service.moveFiles('user-1', ['m-1', 'm-2'], null);

      expect(prisma.media.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['m-1', 'm-2'] }, teamId: 't1', deletedAt: null },
        data: { folderId: null },
      });
      expect(count).toBe(2);
    });

    it('should return 0 for empty ids array', async () => {
      const count = await service.moveFiles('user-1', [], 'folder-1');
      expect(count).toBe(0);
      expect(prisma.media.updateMany).not.toHaveBeenCalled();
    });

    it('should throw if target folder does not exist', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue(null);

      await expect(service.moveFiles('user-1', ['m-1'], 'folder-99')).rejects.toThrow(BadRequestException);
    });

    it('移动越权：目标文件夹属其他团队 → 统一报文件夹不存在', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue(null);

      await expect(service.moveFiles('user-1', ['m-1'], 'f-other-team')).rejects.toThrow('文件夹不存在');
      expect(prisma.media.updateMany).not.toHaveBeenCalled();
    });
  });
});
