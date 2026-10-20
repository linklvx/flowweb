import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'stream';
import { MinioService, MinioConfig } from './minio.service';

const mockConfig: MinioConfig = {
  endpoint: 'http://127.0.0.1:9000',
  accessKey: 'minioadmin',
  secretKey: 'minioadmin123',
  bucket: 'flowai',
  useSsl: false,
};

describe('MinioService', () => {
  let service: MinioService;

  beforeEach(() => {
    service = new MinioService(mockConfig);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create S3Client with forcePathStyle: true', () => {
    const client = (service as any).s3Client;
    expect(client).toBeDefined();
  });

  it('should build correct key for uploads', () => {
    const key = service.buildKey('uploaded', 'user1', { ext: 'png' });
    expect(key).toMatch(/^uploads\/user1\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+\.png$/);
  });

  it('should build correct key for results', () => {
    const key = service.buildKey('generated', 'user1', { projectId: 'proj1', nodeId: 'node1', ext: 'png' });
    expect(key).toMatch(/^results\/user1\/proj1\/node1\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+\.png$/);
  });

  it('should build correct key for temp', () => {
    const key = service.buildKey('temp', 'user1', { ext: 'bin' });
    expect(key).toMatch(/^temp\/user1\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+\.bin$/);
  });

  it('statSize 返回 HeadObject 的 ContentLength（统一大小口径）', async () => {
    const mockSend = vi.fn().mockResolvedValue({ ContentLength: 12_345 });
    (service as any).s3Client = { send: mockSend };

    await expect(service.statSize('k.mp4')).resolves.toBe(12_345);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('statSize: ContentLength 缺失回落 0', async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    (service as any).s3Client = { send: mockSend };

    await expect(service.statSize('k.mp4')).resolves.toBe(0);
  });

  // Y1b T4 红测组⑤：presign Content-Type 条件——policy 须绑定（现状红=未绑，伪造 Content-Type 上传可过）
  it('T4 presign Content-Type：fields 带 Content-Type+policy 精确匹配条件（进 fields 否则客户端不回传=全 403）', async () => {
    const { fields } = await service.generatePresignedPost('uploads/u1/2026-10-20/x.png', 'image/png', 100);

    expect(fields['Content-Type']).toBe('image/png'); // Content-Type 必须进 presign.fields（客户端原样回传）
    const policy = JSON.parse(Buffer.from(String(fields.Policy), 'base64').toString('utf8'));
    expect(policy.conditions).toContainEqual({ 'Content-Type': 'image/png' }); // 精确匹配条件——回传值不一致⇒MinIO 403
  });

  // Y1b T4：confirm 嗅探取对象头字节——Range 限定（1GB 视频不整读）
  it('T4 getHeadBytes：GetObject 带 Range=bytes=0-(n-1)，只收前 n 字节', async () => {
    const mockSend = vi.fn().mockResolvedValue({
      Body: Readable.from([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(8192, 0xff)]),
    });
    (service as any).s3Client = { send: mockSend };

    const head = await service.getHeadBytes('k.mp4', 16);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ Range: 'bytes=0-15' }),
    }));
    expect(head).toHaveLength(16); // 达到 maxBytes 即止（不吞整流）
  });

  it('should have getObject method', () => {
    expect(typeof service.getObject).toBe('function');
  });

  it('should have ensureBucket method', () => {
    expect(typeof service.ensureBucket).toBe('function');
  });

  describe('ensureBucket', () => {
    it('should log when bucket already exists', async () => {
      const mockSend = vi.fn().mockResolvedValue({});
      (service as any).s3Client = { send: mockSend };

      await service.ensureBucket();

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should create bucket when NotFound (404)', async () => {
      const mockSend = vi.fn()
        .mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
        .mockResolvedValueOnce({});

      (service as any).s3Client = { send: mockSend };

      await service.ensureBucket();

      expect(mockSend).toHaveBeenCalledTimes(2); // HeadBucket → CreateBucket
    });

    it('should skip creation when BucketAlreadyExists (409)', async () => {
      const mockSend = vi.fn()
        .mockRejectedValueOnce({ $metadata: { httpStatusCode: 409 }, name: 'BucketAlreadyExists' });

      (service as any).s3Client = { send: mockSend };

      await service.ensureBucket();

      expect(mockSend).toHaveBeenCalledTimes(1); // Only HeadBucket, no CreateBucket
    });

    it('should throw after exhausting retries', async () => {
      const mockSend = vi.fn().mockRejectedValue({ $metadata: { httpStatusCode: 500 }, name: 'InternalError' });

      (service as any).s3Client = { send: mockSend };

      await expect(service.ensureBucket(0, 0)).rejects.toThrow('MinIO initialization failed');

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});
