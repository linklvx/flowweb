import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageService } from './storage.service';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('StorageService', () => {
  let service: StorageService;
  let prisma: any;
  let minio: any;

  beforeEach(async () => {
    prisma = {
      media: {
        create: vi.fn().mockResolvedValue({ id: 'media-1', key: 'uploads/u1/2026-01-01/a.png', status: 'pending' }),
        update: vi.fn().mockResolvedValue({ id: 'media-1', status: 'completed' }),
        findUnique: vi.fn(),
        delete: vi.fn().mockResolvedValue({}),
      },
    };
    minio = {
      buildKey: vi.fn().mockReturnValue('uploads/user1/2026-05-20/uuid.png'),
      generatePresignedPost: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:9000/flowai',
        fields: {
          key: 'uploads/user1/2026-05-20/uuid.png',
          Policy: 'mock-policy',
          'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
          'X-Amz-Credential': 'mock',
          'X-Amz-Date': 'mock',
          'X-Amz-Signature': 'mock',
        },
      }),
      statObject: vi.fn().mockResolvedValue({ ContentLength: 2048000 }),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
      ],
    }).compile();
    service = module.get<StorageService>(StorageService);
  });

  it('should generate presigned POST URL and create pending Media', async () => {
    const result = await service.presignUpload(
      'user1',
      { fileName: 'ref.png', fileSize: 2048000, fileType: 'image/png', type: 'uploaded' },
    );
    expect(result.fileId).toBe('media-1');
    expect(result.uploadUrl).toBe('http://127.0.0.1:9000/flowai');
    expect(result.fields).toBeDefined();
    expect(result.fields.key).toBe('uploads/user1/2026-05-20/uuid.png');
    expect(prisma.media.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user1',
          status: 'pending',
          type: 'uploaded',
        }),
      }),
    );
  });

  it('should confirm upload and update status to completed', async () => {
    prisma.media.findUnique = vi.fn().mockResolvedValue({ id: 'media-1', status: 'pending', key: 'uploads/u1/test.png' });
    const result = await service.confirmUpload('user1', {
      fileId: 'media-1',
      key: 'uploads/u1/test.png',
      fileSize: 2048000,
    });
    expect(result.fileId).toBe('media-1');
    expect(prisma.media.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'media-1', userId: 'user1' },
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  it('should reject confirm if fileSize mismatch', async () => {
    minio.statObject = vi.fn().mockResolvedValue({ ContentLength: 999 });
    await expect(
      service.confirmUpload('user1', {
        fileId: 'media-1',
        key: 'uploads/u1/test.png',
        fileSize: 2048000,
      }),
    ).rejects.toThrow();
    expect(minio.delete).toHaveBeenCalled();
  });
});
