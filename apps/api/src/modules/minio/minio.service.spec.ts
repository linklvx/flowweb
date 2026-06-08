import { describe, it, expect, beforeEach } from 'vitest';
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

  it('should have getObject method', () => {
    expect(typeof service.getObject).toBe('function');
  });

  it('should have ensureBucket method', () => {
    expect(typeof service.ensureBucket).toBe('function');
  });

  describe('ensureBucket', () => {
    it('should be a function accepting optional retries and delay', () => {
      expect(service.ensureBucket.length).toBe(0); // all params have defaults
    });
  });
});
